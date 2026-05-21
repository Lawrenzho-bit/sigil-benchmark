// Sweeps overdue SLA rows and records breaches; alerts agents via Slack hook.
import { query } from '../db.js';
import { notifyBreach } from '../slack/webhook.js';
import { audit } from '../audit.js';

const TICK_MS = 30_000;

async function markFirstResponseBreaches(): Promise<void> {
  // A first-response breach: the SLA's first_response_due has passed and the
  // ticket has not yet received an agent reply.
  const rows = (await query<{ ticket_id: string; number: number; org_id: string; subject: string }>(
    `WITH targets AS (
       SELECT ts.ticket_id
         FROM ticket_sla ts
         JOIN tickets t ON t.id = ts.ticket_id
        WHERE ts.first_response_breached_at IS NULL
          AND ts.first_response_due IS NOT NULL
          AND ts.first_response_due < now()
          AND t.first_response_at IS NULL
          AND t.status NOT IN ('solved','closed')
        LIMIT 500
     )
     UPDATE ticket_sla ts SET first_response_breached_at = now()
       FROM targets, tickets t
      WHERE ts.ticket_id = targets.ticket_id
        AND t.id = ts.ticket_id
     RETURNING ts.ticket_id, t.number, t.org_id, t.subject`,
  )).rows;

  for (const r of rows) {
    audit({ actor: { kind: 'system' }, action: 'sla.first_response_breach',
            orgId: r.org_id, target: { kind: 'ticket', id: r.ticket_id },
            meta: { number: r.number } });
    notifyBreach({ kind: 'first_response', ticketId: r.ticket_id, number: r.number, subject: r.subject })
      .catch(err => console.error('[slack]', err));
  }
  if (rows.length > 0) console.log(`[sla] first-response breaches: ${rows.length}`);
}

async function markResolutionBreaches(): Promise<void> {
  const rows = (await query<{ ticket_id: string; number: number; org_id: string; subject: string }>(
    `WITH targets AS (
       SELECT ts.ticket_id
         FROM ticket_sla ts
         JOIN tickets t ON t.id = ts.ticket_id
        WHERE ts.resolution_breached_at IS NULL
          AND ts.resolution_due IS NOT NULL
          AND ts.resolution_due < now()
          AND t.resolved_at IS NULL
          AND t.status NOT IN ('solved','closed')
        LIMIT 500
     )
     UPDATE ticket_sla ts SET resolution_breached_at = now()
       FROM targets, tickets t
      WHERE ts.ticket_id = targets.ticket_id
        AND t.id = ts.ticket_id
     RETURNING ts.ticket_id, t.number, t.org_id, t.subject`,
  )).rows;

  for (const r of rows) {
    audit({ actor: { kind: 'system' }, action: 'sla.resolution_breach',
            orgId: r.org_id, target: { kind: 'ticket', id: r.ticket_id },
            meta: { number: r.number } });
    notifyBreach({ kind: 'resolution', ticketId: r.ticket_id, number: r.number, subject: r.subject })
      .catch(err => console.error('[slack]', err));
  }
  if (rows.length > 0) console.log(`[sla] resolution breaches: ${rows.length}`);
}

async function tick(): Promise<void> {
  try {
    await markFirstResponseBreaches();
    await markResolutionBreaches();
  } catch (err) {
    console.error('[sla-monitor] tick failed:', err);
  }
}

console.log('[sla-monitor] starting');
tick();
setInterval(tick, TICK_MS);
