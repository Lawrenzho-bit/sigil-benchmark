/**
 * SLA timing engine. One ticket_sla row per ticket, created at ticket creation.
 *
 * Targets are absolute timestamps so a later policy edit never re-times history.
 * Time spent in 'pending'/'on_hold' is excluded by sliding the due timestamps
 * forward by the paused duration when the ticket resumes.
 */
import type { PoolClient } from 'pg';
import { query } from '../../db/pool';

type Priority = 'low' | 'normal' | 'high' | 'urgent';

/** Statuses during which the SLA clock is paused (waiting on customer / deferred). */
const PAUSED_STATUSES = new Set(['pending', 'on_hold']);

interface SlaPolicyRow {
  id: number;
  first_response_mins: number;
  resolution_mins: number;
}

export interface TicketSlaRow {
  ticket_id: number;
  policy_id: number | null;
  first_response_due_at: string;
  resolution_due_at: string;
  first_response_met: boolean | null;
  resolution_met: boolean | null;
  first_response_breached_at: string | null;
  resolution_breached_at: string | null;
  paused_at: string | null;
}

const MINUTE_MS = 60_000;

/** Create the ticket_sla row for a newly created ticket. */
export async function attachSla(
  client: PoolClient,
  ticketId: number,
  priority: Priority,
  createdAt: Date,
): Promise<void> {
  const policy = await client
    .query<SlaPolicyRow>(
      `SELECT id, first_response_mins, resolution_mins
         FROM sla_policies WHERE priority = $1 AND is_active = true`,
      [priority],
    )
    .then((r) => r.rows[0]);

  // No active policy for this priority: still create a row so reporting joins
  // succeed, with far-future due times that can never breach.
  const frMins = policy?.first_response_mins ?? 100 * 365 * 24 * 60;
  const resMins = policy?.resolution_mins ?? 100 * 365 * 24 * 60;

  await client.query(
    `INSERT INTO ticket_sla (ticket_id, policy_id, first_response_due_at, resolution_due_at)
     VALUES ($1, $2, $3, $4)`,
    [
      ticketId,
      policy?.id ?? null,
      new Date(createdAt.getTime() + frMins * MINUTE_MS),
      new Date(createdAt.getTime() + resMins * MINUTE_MS),
    ],
  );
}

/**
 * Re-base the SLA targets when a ticket's priority changes. Keeps elapsed time:
 * the new target is `created + newPolicyMinutes`, so escalating to 'urgent'
 * tightens the deadline relative to the original creation time.
 */
export async function repriceSla(
  client: PoolClient,
  ticketId: number,
  priority: Priority,
  ticketCreatedAt: Date,
): Promise<void> {
  const policy = await client
    .query<SlaPolicyRow>(
      `SELECT id, first_response_mins, resolution_mins
         FROM sla_policies WHERE priority = $1 AND is_active = true`,
      [priority],
    )
    .then((r) => r.rows[0]);
  if (!policy) return;

  await client.query(
    `UPDATE ticket_sla
        SET policy_id = $2,
            first_response_due_at = CASE WHEN first_response_met IS NULL
                                         THEN $3 ELSE first_response_due_at END,
            resolution_due_at     = CASE WHEN resolution_met IS NULL
                                         THEN $4 ELSE resolution_due_at END,
            updated_at = now()
      WHERE ticket_id = $1`,
    [
      ticketId,
      policy.id,
      new Date(ticketCreatedAt.getTime() + policy.first_response_mins * MINUTE_MS),
      new Date(ticketCreatedAt.getTime() + policy.resolution_mins * MINUTE_MS),
    ],
  );
}

/** Record the first agent response. Met iff it landed on/before the due time. */
export async function markFirstResponse(client: PoolClient, ticketId: number): Promise<void> {
  await client.query(
    `UPDATE ticket_sla
        SET first_response_met = (now() <= first_response_due_at),
            updated_at = now()
      WHERE ticket_id = $1 AND first_response_met IS NULL`,
    [ticketId],
  );
}

/** Record resolution. Met iff resolved on/before the due time. */
export async function markResolution(client: PoolClient, ticketId: number): Promise<void> {
  await client.query(
    `UPDATE ticket_sla
        SET resolution_met = (now() <= resolution_due_at),
            updated_at = now()
      WHERE ticket_id = $1 AND resolution_met IS NULL`,
    [ticketId],
  );
}

/**
 * Adjust SLA timing on a ticket status transition. Entering a paused status
 * stamps paused_at; leaving one slides the unmet due times forward by the
 * elapsed pause so the customer-wait time is not counted against the agent.
 */
export async function applyStatusTransition(
  client: PoolClient,
  ticketId: number,
  fromStatus: string,
  toStatus: string,
): Promise<void> {
  const wasPaused = PAUSED_STATUSES.has(fromStatus);
  const nowPaused = PAUSED_STATUSES.has(toStatus);

  if (!wasPaused && nowPaused) {
    await client.query(
      `UPDATE ticket_sla SET paused_at = now(), updated_at = now()
         WHERE ticket_id = $1 AND paused_at IS NULL`,
      [ticketId],
    );
  } else if (wasPaused && !nowPaused) {
    await client.query(
      `UPDATE ticket_sla
          SET first_response_due_at = CASE WHEN first_response_met IS NULL AND paused_at IS NOT NULL
                                           THEN first_response_due_at + (now() - paused_at)
                                           ELSE first_response_due_at END,
              resolution_due_at     = CASE WHEN resolution_met IS NULL AND paused_at IS NOT NULL
                                           THEN resolution_due_at + (now() - paused_at)
                                           ELSE resolution_due_at END,
              paused_at = NULL,
              updated_at = now()
        WHERE ticket_id = $1`,
      [ticketId],
    );
  }
}

export interface SlaBreach {
  ticketId: number;
  ticketNumber: number;
  kind: 'first_response' | 'resolution';
  dueAt: string;
}

/**
 * Find tickets whose SLA target is unmet and overdue, and that have not already
 * had a breach recorded. Stamps the breach timestamp and returns the new breaches
 * so the worker can alert on them. Excludes paused and closed tickets.
 */
export async function detectAndRecordBreaches(): Promise<SlaBreach[]> {
  const firstResponse = await query<{ ticket_id: number; number: number; due: string }>(
    `UPDATE ticket_sla s
        SET first_response_breached_at = now(), updated_at = now()
       FROM tickets t
      WHERE s.ticket_id = t.id
        AND s.first_response_met IS NULL
        AND s.first_response_breached_at IS NULL
        AND s.paused_at IS NULL
        AND s.first_response_due_at < now()
        AND t.status NOT IN ('resolved', 'closed')
      RETURNING s.ticket_id, t.number, s.first_response_due_at AS due`,
  );

  const resolution = await query<{ ticket_id: number; number: number; due: string }>(
    `UPDATE ticket_sla s
        SET resolution_breached_at = now(), updated_at = now()
       FROM tickets t
      WHERE s.ticket_id = t.id
        AND s.resolution_met IS NULL
        AND s.resolution_breached_at IS NULL
        AND s.paused_at IS NULL
        AND s.resolution_due_at < now()
        AND t.status NOT IN ('resolved', 'closed')
      RETURNING s.ticket_id, t.number, s.resolution_due_at AS due`,
  );

  return [
    ...firstResponse.map((r) => ({
      ticketId: r.ticket_id,
      ticketNumber: r.number,
      kind: 'first_response' as const,
      dueAt: r.due,
    })),
    ...resolution.map((r) => ({
      ticketId: r.ticket_id,
      ticketNumber: r.number,
      kind: 'resolution' as const,
      dueAt: r.due,
    })),
  ];
}

/** Read the SLA row for a ticket (for API responses). */
export async function getTicketSla(ticketId: number): Promise<TicketSlaRow | null> {
  const rows = await query<TicketSlaRow>(`SELECT * FROM ticket_sla WHERE ticket_id = $1`, [
    ticketId,
  ]);
  return rows[0] ?? null;
}
