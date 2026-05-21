/**
 * Reporting: agent performance, SLA compliance, and ticket volume trends.
 * All queries accept an inclusive [from, to] window of ISO timestamps.
 */
import { query } from '../../db/pool';

interface Window {
  from: string;
  to: string;
}

/** Default window: trailing 30 days. */
export function defaultWindow(): Window {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export interface AgentPerformanceRow {
  agent_id: number;
  agent_name: string;
  assigned: number;
  resolved: number;
  avg_first_response_mins: number | null;
  avg_resolution_mins: number | null;
  csat_average: number | null;
}

/** Per-agent productivity over the window, keyed on ticket created_at. */
export async function agentPerformance(w: Window): Promise<AgentPerformanceRow[]> {
  const rows = await query<{
    agent_id: number;
    agent_name: string;
    assigned: string;
    resolved: string;
    avg_fr: string | null;
    avg_res: string | null;
    csat: string | null;
  }>(
    `SELECT a.id AS agent_id,
            a.name AS agent_name,
            count(t.id)::text AS assigned,
            count(t.id) FILTER (WHERE t.resolved_at IS NOT NULL)::text AS resolved,
            avg(EXTRACT(EPOCH FROM (t.first_response_at - t.created_at)) / 60)
              FILTER (WHERE t.first_response_at IS NOT NULL)::numeric(10,1)::text AS avg_fr,
            avg(EXTRACT(EPOCH FROM (t.resolved_at - t.created_at)) / 60)
              FILTER (WHERE t.resolved_at IS NOT NULL)::numeric(10,1)::text AS avg_res,
            avg(s.score)::numeric(3,2)::text AS csat
       FROM agents a
       LEFT JOIN tickets t ON t.assignee_id = a.id
            AND t.created_at >= $1 AND t.created_at <= $2
       LEFT JOIN csat_surveys s ON s.ticket_id = t.id AND s.score IS NOT NULL
      WHERE a.is_active = true
      GROUP BY a.id, a.name
      ORDER BY resolved DESC`,
    [w.from, w.to],
  );
  return rows.map((r) => ({
    agent_id: r.agent_id,
    agent_name: r.agent_name,
    assigned: Number(r.assigned),
    resolved: Number(r.resolved),
    avg_first_response_mins: r.avg_fr ? Number(r.avg_fr) : null,
    avg_resolution_mins: r.avg_res ? Number(r.avg_res) : null,
    csat_average: r.csat ? Number(r.csat) : null,
  }));
}

export interface SlaComplianceReport {
  first_response: { met: number; breached: number; pending: number; compliance_pct: number };
  resolution: { met: number; breached: number; pending: number; compliance_pct: number };
}

/** SLA met/breached/pending counts and compliance % over the window. */
export async function slaCompliance(w: Window): Promise<SlaComplianceReport> {
  const r = (
    await query<Record<string, string>>(
      `SELECT
         count(*) FILTER (WHERE s.first_response_met IS TRUE)::text  AS fr_met,
         count(*) FILTER (WHERE s.first_response_met IS FALSE OR s.first_response_breached_at IS NOT NULL)::text AS fr_breached,
         count(*) FILTER (WHERE s.first_response_met IS NULL AND s.first_response_breached_at IS NULL)::text AS fr_pending,
         count(*) FILTER (WHERE s.resolution_met IS TRUE)::text      AS res_met,
         count(*) FILTER (WHERE s.resolution_met IS FALSE OR s.resolution_breached_at IS NOT NULL)::text AS res_breached,
         count(*) FILTER (WHERE s.resolution_met IS NULL AND s.resolution_breached_at IS NULL)::text AS res_pending
       FROM ticket_sla s
       JOIN tickets t ON t.id = s.ticket_id
      WHERE t.created_at >= $1 AND t.created_at <= $2`,
      [w.from, w.to],
    )
  )[0]!;

  const pct = (met: number, breached: number): number => {
    const decided = met + breached;
    return decided > 0 ? Number(((met / decided) * 100).toFixed(1)) : 100;
  };
  const frMet = Number(r.fr_met);
  const frBreached = Number(r.fr_breached);
  const resMet = Number(r.res_met);
  const resBreached = Number(r.res_breached);

  return {
    first_response: {
      met: frMet,
      breached: frBreached,
      pending: Number(r.fr_pending),
      compliance_pct: pct(frMet, frBreached),
    },
    resolution: {
      met: resMet,
      breached: resBreached,
      pending: Number(r.res_pending),
      compliance_pct: pct(resMet, resBreached),
    },
  };
}

export interface VolumePoint {
  day: string;
  created: number;
  resolved: number;
}

/** Daily ticket volume: created vs resolved, one row per day in the window. */
export async function ticketVolume(w: Window): Promise<VolumePoint[]> {
  const rows = await query<{ day: string; created: string; resolved: string }>(
    `WITH days AS (
       SELECT generate_series(date_trunc('day', $1::timestamptz),
                              date_trunc('day', $2::timestamptz),
                              interval '1 day') AS day
     )
     SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
            count(DISTINCT c.id)::text AS created,
            count(DISTINCT r.id)::text AS resolved
       FROM days d
       LEFT JOIN tickets c ON date_trunc('day', c.created_at) = d.day
       LEFT JOIN tickets r ON date_trunc('day', r.resolved_at) = d.day
      GROUP BY d.day
      ORDER BY d.day ASC`,
    [w.from, w.to],
  );
  return rows.map((r) => ({
    day: r.day,
    created: Number(r.created),
    resolved: Number(r.resolved),
  }));
}
