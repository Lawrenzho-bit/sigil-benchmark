import { query } from '../db';

/**
 * Reporting queries. All accept an inclusive date window [from, to).
 * These run aggregations directly; at 1M+ tickets/year, move the heavier
 * ones to a nightly materialized view (`REFRESH MATERIALIZED VIEW`).
 */

export interface DateRange {
  from: Date;
  to: Date;
}

/** Per-agent performance: volume handled, responsiveness, CSAT. */
export async function agentPerformance(range: DateRange): Promise<Array<Record<string, unknown>>> {
  return query(
    `SELECT a.id                AS agent_id,
            a.name              AS agent_name,
            count(DISTINCT t.id) FILTER (WHERE t.status IN ('resolved','closed'))
                                AS tickets_resolved,
            avg(EXTRACT(EPOCH FROM (t.first_response_at - t.created_at)) / 60)
              FILTER (WHERE t.first_response_at IS NOT NULL)
                                AS avg_first_response_min,
            avg(EXTRACT(EPOCH FROM (t.resolved_at - t.created_at)) / 3600)
              FILTER (WHERE t.resolved_at IS NOT NULL)
                                AS avg_resolution_hours,
            avg(cs.score)       AS avg_csat
       FROM agents a
       LEFT JOIN tickets t
         ON t.assignee_id = a.id AND t.created_at >= $1 AND t.created_at < $2
       LEFT JOIN csat_surveys cs ON cs.ticket_id = t.id AND cs.score IS NOT NULL
      WHERE a.active = true
      GROUP BY a.id, a.name
      ORDER BY tickets_resolved DESC NULLS LAST`,
    [range.from, range.to],
  );
}

/** SLA compliance: share of tickets that met first-response / resolution. */
export async function slaCompliance(range: DateRange): Promise<Record<string, unknown>> {
  const rows = await query<{
    total: string;
    fr_met: string;
    res_met: string;
    fr_breached: string;
    res_breached: string;
  }>(
    `SELECT count(*)                                            AS total,
            count(*) FILTER (WHERE s.first_response_met_at IS NOT NULL
                               AND s.first_response_met_at <= s.first_response_due) AS fr_met,
            count(*) FILTER (WHERE s.resolution_met_at IS NOT NULL
                               AND s.resolution_met_at <= s.resolution_due)         AS res_met,
            count(*) FILTER (WHERE s.first_response_breached)   AS fr_breached,
            count(*) FILTER (WHERE s.resolution_breached)       AS res_breached
       FROM ticket_sla s
       JOIN tickets t ON t.id = s.ticket_id
      WHERE t.created_at >= $1 AND t.created_at < $2`,
    [range.from, range.to],
  );
  const r = rows[0];
  const total = Number(r.total) || 0;
  const pct = (n: string) => (total === 0 ? null : Math.round((Number(n) / total) * 1000) / 10);
  return {
    total_tickets: total,
    first_response_met: Number(r.fr_met),
    first_response_compliance_pct: pct(r.fr_met),
    resolution_met: Number(r.res_met),
    resolution_compliance_pct: pct(r.res_met),
    first_response_breaches: Number(r.fr_breached),
    resolution_breaches: Number(r.res_breached),
  };
}

/** Daily ticket volume — created vs. resolved — for trend charts. */
export async function ticketVolumeTrend(range: DateRange): Promise<Array<Record<string, unknown>>> {
  return query(
    `WITH days AS (
       SELECT generate_series($1::date, $2::date - 1, '1 day')::date AS day
     )
     SELECT d.day,
            count(c.id) AS created,
            count(r.id) AS resolved
       FROM days d
       LEFT JOIN tickets c ON c.created_at::date = d.day
       LEFT JOIN tickets r ON r.resolved_at::date = d.day
      GROUP BY d.day
      ORDER BY d.day`,
    [range.from, range.to],
  );
}

/** Snapshot of the current open backlog by status + priority. */
export async function backlogSnapshot(): Promise<Array<Record<string, unknown>>> {
  return query(
    `SELECT status, priority, count(*) AS count
       FROM tickets
      WHERE status NOT IN ('resolved','closed') AND merged_into_id IS NULL
      GROUP BY status, priority
      ORDER BY status, priority`,
  );
}
