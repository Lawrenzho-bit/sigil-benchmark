import { config } from '../config';
import { pool, query } from '../db';
import { logger } from '../logger';
import { audit } from '../lib/audit';
import { findNewBreaches, markBreachAlerted } from '../services/slaService';
import { sendBreachAlert } from '../email/outbound';

const SLA_SCAN_INTERVAL_MS = 60_000; // scan for breaches every minute
const GDPR_SCAN_INTERVAL_MS = 24 * 3600_000; // purge sweep once a day

/**
 * One SLA breach scan: find tickets that have crossed an SLA target without
 * being met, email an alert, and mark them so they are not re-alerted.
 */
export async function checkBreaches(): Promise<number> {
  const breaches = await findNewBreaches();
  for (const breach of breaches) {
    // Alert the assignee; fall back to the support inbox for unassigned tickets.
    let recipient = config.supportFromAddress;
    if (breach.assignee_id) {
      const agent = (
        await query<{ email: string }>('SELECT email FROM agents WHERE id = $1', [
          breach.assignee_id,
        ])
      )[0];
      if (agent) recipient = agent.email;
    }

    await sendBreachAlert(recipient, breach.ticket_id, breach.kind);
    await markBreachAlerted(breach.ticket_id);
    await audit({
      actorType: 'system',
      action: 'sla.breach',
      entityType: 'ticket',
      entityId: String(breach.ticket_id),
      metadata: { kind: breach.kind, notified: recipient },
    });
  }
  if (breaches.length > 0) logger.warn({ count: breaches.length }, 'SLA breaches detected');
  return breaches.length;
}

/**
 * GDPR retention sweep. Customers whose most recent ticket activity is older
 * than GDPR_RETENTION_DAYS are anonymized in place: direct identifiers are
 * scrubbed while ticket/SLA history is kept for reporting integrity.
 *
 * Disabled when GDPR_RETENTION_DAYS is 0.
 */
export async function runGdprPurge(): Promise<number> {
  if (config.gdprRetentionDays <= 0) return 0;

  const purged = await query<{ id: string }>(
    `UPDATE customers
        SET email = 'anonymized+' || id || '@deleted.invalid',
            name = NULL, phone = NULL, attributes = '{}', anonymized_at = now()
      WHERE anonymized_at IS NULL
        AND id IN (
          SELECT c.id FROM customers c
          LEFT JOIN tickets t ON t.customer_id = c.id
          GROUP BY c.id
          HAVING coalesce(max(t.updated_at), c.created_at)
                 < now() - ($1 || ' days')::interval
        )
      RETURNING id`,
    [String(config.gdprRetentionDays)],
  );

  for (const row of purged) {
    await audit({
      actorType: 'system',
      action: 'customer.anonymize.retention',
      entityType: 'customer',
      entityId: row.id,
    });
  }
  if (purged.length > 0) {
    logger.info({ count: purged.length }, 'GDPR retention purge anonymized customers');
  }
  return purged.length;
}

/**
 * Start the in-process monitor. Returns a stop function. Two timers run:
 * the SLA scan (every minute) and the GDPR purge (daily).
 */
export function startSlaMonitor(): () => void {
  const safe = (fn: () => Promise<unknown>, label: string) => () => {
    fn().catch((err) => logger.error({ err, label }, 'monitor task failed'));
  };

  const slaTimer = setInterval(safe(checkBreaches, 'sla'), SLA_SCAN_INTERVAL_MS);
  const gdprTimer = setInterval(safe(runGdprPurge, 'gdpr'), GDPR_SCAN_INTERVAL_MS);
  // Run once immediately so a fresh boot doesn't wait a full interval.
  safe(checkBreaches, 'sla')();
  logger.info('SLA monitor started');

  return () => {
    clearInterval(slaTimer);
    clearInterval(gdprTimer);
  };
}

// CLI: `node dist/jobs/slaMonitor.js`        → one scan, then exit
//      `node dist/jobs/slaMonitor.js --daemon` → run forever (worker container)
if (require.main === module) {
  const daemon = process.argv.includes('--daemon');
  if (daemon) {
    startSlaMonitor();
  } else {
    Promise.all([checkBreaches(), runGdprPurge()])
      .then(() => pool.end())
      .then(() => process.exit(0))
      .catch((err) => {
        logger.error({ err }, 'SLA monitor run failed');
        process.exit(1);
      });
  }
}
