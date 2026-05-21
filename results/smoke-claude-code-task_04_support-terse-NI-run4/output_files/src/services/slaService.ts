import { PoolClient } from 'pg';
import { pool, query } from '../db';
import { TicketPriority } from '../types';
import { logger } from '../logger';

type Executor = Pick<PoolClient, 'query'>;

export interface SlaState {
  ticket_id: string;
  first_response_due: Date;
  resolution_due: Date;
  first_response_met_at: Date | null;
  resolution_met_at: Date | null;
  first_response_breached: boolean;
  resolution_breached: boolean;
}

/**
 * Attach an SLA target to a freshly created ticket, based on its priority.
 *
 * Targets are computed once and stored, so later edits to the policy do not
 * retroactively change (or breach) tickets already in flight. Times here are
 * wall-clock; a production deployment would offset by business-hours
 * calendars — see `addBusinessMinutes` below for the extension point.
 */
export async function applySlaPolicy(
  ticketId: number | string,
  priority: TicketPriority,
  exec: Executor = pool,
): Promise<void> {
  const policy = (
    await exec.query<{ id: string; first_response_minutes: number; resolution_minutes: number }>(
      `SELECT id, first_response_minutes, resolution_minutes
         FROM sla_policies
        WHERE priority = $1 AND active = true`,
      [priority],
    )
  ).rows[0];

  if (!policy) {
    logger.warn({ priority }, 'no active SLA policy for priority — ticket has no SLA');
    return;
  }

  const now = new Date();
  await exec.query(
    `INSERT INTO ticket_sla (ticket_id, policy_id, first_response_due, resolution_due)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (ticket_id) DO UPDATE
        SET policy_id = EXCLUDED.policy_id,
            first_response_due = EXCLUDED.first_response_due,
            resolution_due = EXCLUDED.resolution_due`,
    [
      ticketId,
      policy.id,
      addBusinessMinutes(now, policy.first_response_minutes),
      addBusinessMinutes(now, policy.resolution_minutes),
    ],
  );
}

/** Record that an agent has sent the first response, stopping that timer. */
export async function recordFirstResponse(
  ticketId: number | string,
  at: Date,
  exec: Executor = pool,
): Promise<void> {
  await exec.query(
    `UPDATE ticket_sla
        SET first_response_met_at = $2
      WHERE ticket_id = $1 AND first_response_met_at IS NULL`,
    [ticketId, at],
  );
}

/** Record resolution, stopping the resolution timer. */
export async function recordResolution(
  ticketId: number | string,
  at: Date,
  exec: Executor = pool,
): Promise<void> {
  await exec.query(
    `UPDATE ticket_sla
        SET resolution_met_at = $2
      WHERE ticket_id = $1 AND resolution_met_at IS NULL`,
    [ticketId, at],
  );
}

/**
 * Find tickets that have crossed an SLA target without being met and have not
 * yet been alerted. The SLA monitor job (src/jobs/slaMonitor.ts) calls this.
 */
export async function findNewBreaches(): Promise<
  Array<{ ticket_id: number; kind: 'first_response' | 'resolution'; assignee_id: string | null }>
> {
  const rows = await query<{
    ticket_id: number;
    fr_breach: boolean;
    res_breach: boolean;
    assignee_id: string | null;
  }>(
    `SELECT s.ticket_id,
            (s.first_response_met_at IS NULL AND s.first_response_due < now()) AS fr_breach,
            (s.resolution_met_at IS NULL AND s.resolution_due < now())         AS res_breach,
            t.assignee_id
       FROM ticket_sla s
       JOIN tickets t ON t.id = s.ticket_id
      WHERE s.breach_alerted_at IS NULL
        AND t.status NOT IN ('resolved', 'closed')
        AND ( (s.first_response_met_at IS NULL AND s.first_response_due < now())
           OR (s.resolution_met_at  IS NULL AND s.resolution_due  < now()) )`,
  );

  return rows.map((r) => ({
    ticket_id: r.ticket_id,
    kind: r.fr_breach ? 'first_response' : 'resolution',
    assignee_id: r.assignee_id,
  }));
}

/** Mark breach flags + alert timestamp so the monitor doesn't re-notify. */
export async function markBreachAlerted(ticketId: number): Promise<void> {
  await query(
    `UPDATE ticket_sla
        SET breach_alerted_at = now(),
            first_response_breached =
              (first_response_met_at IS NULL AND first_response_due < now()),
            resolution_breached =
              (resolution_met_at IS NULL AND resolution_due < now())
      WHERE ticket_id = $1`,
    [ticketId],
  );
}

/**
 * Add `minutes` to `from`, skipping nights and weekends.
 *
 * Business hours: Mon–Fri, 09:00–17:00 (8h/day) in server-local time. This is
 * deliberately simple; swap in a holiday calendar / per-team timezone here
 * without touching callers.
 */
export function addBusinessMinutes(from: Date, minutes: number): Date {
  const WORK_START = 9;
  const WORK_END = 17;
  const result = new Date(from);
  let remaining = minutes;

  while (remaining > 0) {
    const day = result.getDay(); // 0 Sun .. 6 Sat
    const hour = result.getHours();

    if (day === 0 || day === 6) {
      // Weekend — jump to Monday 09:00.
      result.setDate(result.getDate() + (day === 0 ? 1 : 2));
      result.setHours(WORK_START, 0, 0, 0);
      continue;
    }
    if (hour < WORK_START) {
      result.setHours(WORK_START, 0, 0, 0);
      continue;
    }
    if (hour >= WORK_END) {
      // After hours — advance to next day 09:00.
      result.setDate(result.getDate() + 1);
      result.setHours(WORK_START, 0, 0, 0);
      continue;
    }
    // Consume up to the end of today's window.
    const minutesLeftToday = (WORK_END - hour) * 60 - result.getMinutes();
    const consume = Math.min(remaining, minutesLeftToday);
    result.setMinutes(result.getMinutes() + consume);
    remaining -= consume;
  }
  return result;
}
