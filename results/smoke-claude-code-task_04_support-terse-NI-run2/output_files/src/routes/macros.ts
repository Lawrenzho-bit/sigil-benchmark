import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db.js';
import { audit } from '../audit.js';

const r = Router();

r.get('/', async (req, res) => {
  const agentId = req.subject!.id;
  const orgId = req.subject!.orgId;
  // Org-wide + team macros for the agent's teams + personal.
  const rows = (await query(
    `SELECT m.id, m.name, m.body, m.actions, m.visibility, m.team_id, m.owner_id
       FROM macros m
  LEFT JOIN team_members tm ON tm.team_id = m.team_id AND tm.agent_id = $1
      WHERE m.org_id = $2
        AND (m.visibility = 'org'
          OR (m.visibility = 'team'     AND tm.agent_id IS NOT NULL)
          OR (m.visibility = 'personal' AND m.owner_id = $1))
   ORDER BY m.name`,
    [agentId, orgId],
  )).rows;
  res.json({ macros: rows });
});

r.post('/', async (req, res) => {
  const body = z.object({
    name:       z.string().min(1).max(200),
    body:       z.string().min(1),
    actions:    z.object({
      status:      z.enum(['new','open','pending','on_hold','solved','closed']).optional(),
      priority:    z.enum(['low','normal','high','urgent']).optional(),
      add_tags:    z.array(z.string()).optional(),
      assignee_id: z.string().uuid().nullable().optional(),
    }).optional(),
    visibility: z.enum(['org','team','personal']).default('personal'),
    team_id:    z.string().uuid().optional(),
  }).parse(req.body);

  const m = await query<{ id: string }>(
    `INSERT INTO macros (org_id, name, body, actions, visibility, team_id, owner_id)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7) RETURNING id`,
    [req.subject!.orgId, body.name, body.body, JSON.stringify(body.actions ?? {}),
     body.visibility, body.team_id ?? null, req.subject!.id],
  );
  audit({ actor: req.subject!, action: 'macro.create', target: { kind: 'macro', id: m.rows[0].id }, req });
  res.status(201).json({ id: m.rows[0].id });
});

// POST /api/macros/:id/apply — render + (optionally) apply actions to a ticket.
r.post('/:id/apply', async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const { ticket_id, apply_actions } = z.object({
    ticket_id:     z.string().uuid(),
    apply_actions: z.boolean().default(true),
  }).parse(req.body);

  const result = await tx(async (client) => {
    const m = await client.query(`SELECT body, actions FROM macros WHERE id = $1`, [id]);
    if (m.rowCount === 0) throw Object.assign(new Error('not_found'), { status: 404 });
    const t = await client.query(
      `SELECT t.id, t.number, t.subject, t.priority, t.status,
              c.email, c.full_name
         FROM tickets t JOIN customers c ON c.id = t.requester_id
        WHERE t.id = $1`, [ticket_id]);
    if (t.rowCount === 0) throw Object.assign(new Error('ticket_not_found'), { status: 404 });
    const ticket = t.rows[0];

    // Variable substitution: {{customer.full_name}}, {{ticket.number}}, etc.
    const vars: Record<string, string> = {
      'customer.email':     ticket.email ?? '',
      'customer.full_name': ticket.full_name ?? '',
      'ticket.number':      String(ticket.number),
      'ticket.subject':     ticket.subject ?? '',
      'agent.email':        req.subject!.kind === 'agent' ? (req.subject as any).email : '',
    };
    const body = (m.rows[0].body as string).replace(
      /{{\s*([a-zA-Z0-9_.]+)\s*}}/g,
      (_, k: string) => vars[k] ?? '',
    );

    const actions = m.rows[0].actions ?? {};
    if (apply_actions && Object.keys(actions).length > 0) {
      const sets: string[] = [];
      const args: unknown[] = [];
      const push = (v: unknown) => { args.push(v); return `$${args.length}`; };

      if (actions.status)   sets.push(`status   = ${push(actions.status)}::ticket_status`);
      if (actions.priority) sets.push(`priority = ${push(actions.priority)}::ticket_priority`);
      if (actions.assignee_id !== undefined) sets.push(`assignee_id = ${push(actions.assignee_id)}`);
      if (Array.isArray(actions.add_tags) && actions.add_tags.length > 0) {
        sets.push(`tags = array(SELECT DISTINCT unnest(tags || ${push(actions.add_tags)}::text[]))`);
      }
      if (sets.length > 0) {
        args.push(ticket_id);
        await client.query(`UPDATE tickets SET ${sets.join(', ')} WHERE id = $${args.length}`, args);
      }
    }
    return { body, actions };
  });

  audit({ actor: req.subject!, action: 'macro.apply',
          target: { kind: 'ticket', id: ticket_id }, meta: { macro_id: id }, req });
  res.json(result);
});

export default r;
