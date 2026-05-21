import { query } from '../db.js';
import { config } from '../config.js';

// Match conditions against a ticket. Conditions are intentionally tiny —
// extend as needed; the goal here is unambiguous matching with no rule engine.
interface Conditions {
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  channel?:  'email' | 'web' | 'slack' | 'api';
  tag?:      string;
}

interface PolicyRow {
  id: string;
  conditions: Conditions;
  first_response_minutes: number;
  resolution_minutes: number;
}

interface TicketRow {
  priority: string;
  tags: string[];
  channel_kind: string | null;
}

function policyMatches(p: PolicyRow, t: TicketRow): boolean {
  const c = p.conditions ?? {};
  if (c.priority && c.priority !== t.priority) return false;
  if (c.channel  && c.channel  !== t.channel_kind) return false;
  if (c.tag      && !t.tags.includes(c.tag)) return false;
  return true;
}

// Pick the highest-priority matching policy, or fall back to the env default.
export async function applySlaToTicket(ticketId: string, orgId: string): Promise<void> {
  const t = await query<TicketRow & { created_at: Date }>(
    `SELECT t.priority::text AS priority, t.tags, ch.kind::text AS channel_kind, t.created_at
       FROM tickets t LEFT JOIN channels ch ON ch.id = t.channel_id
      WHERE t.id = $1`,
    [ticketId],
  );
  if (t.rowCount === 0) return;
  const ticket = t.rows[0];

  const policies = (await query<PolicyRow>(
    `SELECT id, conditions, first_response_minutes, resolution_minutes
       FROM sla_policies
      WHERE org_id = $1 AND active = true
   ORDER BY priority DESC`,
    [orgId],
  )).rows;

  const matched = policies.find(p => policyMatches(p, ticket));
  const firstResp = matched?.first_response_minutes ?? config.sla.firstResponseMin;
  const resolve   = matched?.resolution_minutes    ?? config.sla.resolutionMin;
  const policyId  = matched?.id ?? null;

  const base = ticket.created_at;
  const firstDue = new Date(base.getTime() + firstResp * 60_000);
  const resDue   = new Date(base.getTime() + resolve   * 60_000);

  await query(
    `INSERT INTO ticket_sla (ticket_id, policy_id, first_response_due, resolution_due)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (ticket_id) DO UPDATE
       SET policy_id          = EXCLUDED.policy_id,
           first_response_due = EXCLUDED.first_response_due,
           resolution_due     = EXCLUDED.resolution_due`,
    [ticketId, policyId, firstDue, resDue],
  );
}
