import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';

const r = Router();

const rangeSchema = z.object({
  from: z.coerce.date().optional(),
  to:   z.coerce.date().optional(),
});

function rangeWhere(from?: Date, to?: Date): { sql: string; args: unknown[] } {
  const args: unknown[] = [];
  let sql = '';
  if (from) { args.push(from); sql += ` AND created_at >= $${args.length}`; }
  if (to)   { args.push(to);   sql += ` AND created_at < $${args.length}`;  }
  return { sql, args };
}

// /api/reports/volume — daily ticket volume.
r.get('/volume', async (req, res) => {
  const { from, to } = rangeSchema.parse(req.query);
  const { sql, args } = rangeWhere(from, to);
  args.unshift(req.subject!.orgId);
  const rows = (await query(
    `SELECT date_trunc('day', created_at) AS day,
            count(*) FILTER (WHERE merged_into_id IS NULL) AS created,
            count(*) FILTER (WHERE resolved_at IS NOT NULL
                              AND resolved_at >= date_trunc('day', created_at)
                              AND resolved_at <  date_trunc('day', created_at) + interval '1 day') AS resolved
       FROM tickets
      WHERE org_id = $1 ${sql}
   GROUP BY day
   ORDER BY day`,
    args,
  )).rows;
  res.json({ volume: rows });
});

// /api/reports/sla — first-response and resolution compliance.
r.get('/sla', async (req, res) => {
  const { from, to } = rangeSchema.parse(req.query);
  const { sql, args } = rangeWhere(from, to);
  args.unshift(req.subject!.orgId);
  const rows = (await query(
    `SELECT
        count(*) AS tickets,
        count(*) FILTER (WHERE ts.first_response_breached_at IS NULL
                           AND t.first_response_at IS NOT NULL) AS first_response_met,
        count(*) FILTER (WHERE ts.first_response_breached_at IS NOT NULL) AS first_response_breached,
        count(*) FILTER (WHERE ts.resolution_breached_at IS NULL
                           AND t.resolved_at IS NOT NULL) AS resolution_met,
        count(*) FILTER (WHERE ts.resolution_breached_at IS NOT NULL) AS resolution_breached
      FROM tickets t
 LEFT JOIN ticket_sla ts ON ts.ticket_id = t.id
      WHERE t.org_id = $1 AND t.merged_into_id IS NULL ${sql}`,
    args,
  )).rows[0];
  res.json({ sla: rows });
});

// /api/reports/agents — performance per agent.
r.get('/agents', async (req, res) => {
  const { from, to } = rangeSchema.parse(req.query);
  // Performance windows by ticket.resolved_at; created_at is irrelevant.
  const args: unknown[] = [req.subject!.orgId];
  let where = `t.org_id = $1`;
  if (from) { args.push(from); where += ` AND t.resolved_at >= $${args.length}`; }
  if (to)   { args.push(to);   where += ` AND t.resolved_at <  $${args.length}`; }

  const rows = (await query(
    `SELECT
        a.id, a.full_name, a.email,
        count(*) FILTER (WHERE t.resolved_at IS NOT NULL) AS resolved,
        avg(EXTRACT(EPOCH FROM (t.first_response_at - t.created_at))) FILTER (WHERE t.first_response_at IS NOT NULL) AS avg_first_response_s,
        avg(EXTRACT(EPOCH FROM (t.resolved_at      - t.created_at))) FILTER (WHERE t.resolved_at      IS NOT NULL) AS avg_resolution_s,
        avg(cs.rating) FILTER (WHERE cs.rating IS NOT NULL) AS avg_csat
       FROM agents a
  LEFT JOIN tickets t      ON t.assignee_id = a.id AND ${where}
  LEFT JOIN csat_surveys cs ON cs.ticket_id = t.id AND cs.responded_at IS NOT NULL
      WHERE a.org_id = $1 AND a.deleted_at IS NULL
   GROUP BY a.id
   ORDER BY resolved DESC NULLS LAST`,
    args,
  )).rows;
  res.json({ agents: rows });
});

export default r;
