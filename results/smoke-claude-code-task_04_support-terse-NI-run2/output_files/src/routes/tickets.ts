import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db.js';
import { requireAgent } from '../auth.js';
import { audit } from '../audit.js';
import { applySlaToTicket } from '../sla/policies.js';

const r = Router();

const STATUS  = ['new','open','pending','on_hold','solved','closed'] as const;
const PRIORITY = ['low','normal','high','urgent'] as const;

// GET /api/tickets — agent inbox with filters.
// Customers hit /api/portal instead; agent route requires agent.
r.get('/', requireAgent(), async (req, res) => {
  const q = z.object({
    status:    z.array(z.enum(STATUS)).or(z.enum(STATUS)).optional(),
    priority:  z.array(z.enum(PRIORITY)).or(z.enum(PRIORITY)).optional(),
    assignee:  z.string().uuid().or(z.literal('me')).or(z.literal('unassigned')).optional(),
    team:      z.string().uuid().optional(),
    tag:       z.string().optional(),
    search:    z.string().min(1).max(200).optional(),
    sort:      z.enum(['created_at','updated_at','priority']).default('updated_at'),
    order:     z.enum(['asc','desc']).default('desc'),
    limit:     z.coerce.number().int().min(1).max(200).default(50),
    cursor:    z.string().optional(),   // updated_at|id from prior page
  }).parse(req.query);

  const conds: string[] = ['t.org_id = $1', 't.merged_into_id IS NULL'];
  const args: unknown[] = [req.subject!.orgId];
  const push = (v: unknown) => { args.push(v); return `$${args.length}`; };

  if (q.status) {
    const arr = Array.isArray(q.status) ? q.status : [q.status];
    conds.push(`t.status = ANY(${push(arr)}::ticket_status[])`);
  }
  if (q.priority) {
    const arr = Array.isArray(q.priority) ? q.priority : [q.priority];
    conds.push(`t.priority = ANY(${push(arr)}::ticket_priority[])`);
  }
  if (q.assignee === 'me')           conds.push(`t.assignee_id = ${push(req.subject!.id)}`);
  else if (q.assignee === 'unassigned') conds.push(`t.assignee_id IS NULL`);
  else if (q.assignee)               conds.push(`t.assignee_id = ${push(q.assignee)}`);
  if (q.team) conds.push(`t.team_id = ${push(q.team)}`);
  if (q.tag)  conds.push(`${push(q.tag)} = ANY(t.tags)`);

  if (q.search) {
    // FTS against subject + ilike against ticket number for "12345" queries.
    const num = /^\d+$/.test(q.search) ? Number(q.search) : null;
    if (num !== null) conds.push(`(t.number = ${push(num)} OR to_tsvector('english', t.subject) @@ plainto_tsquery('english', ${push(q.search)}))`);
    else              conds.push(`to_tsvector('english', t.subject) @@ plainto_tsquery('english', ${push(q.search)})`);
  }

  if (q.cursor) {
    // Cursor encodes (sort_value, id) to break ties.
    try {
      const [sortVal, id] = JSON.parse(Buffer.from(q.cursor, 'base64url').toString());
      const op = q.order === 'desc' ? '<' : '>';
      conds.push(`(t.${q.sort}, t.id) ${op} (${push(sortVal)}::timestamptz, ${push(id)}::uuid)`);
    } catch {
      return res.status(400).json({ error: 'bad_cursor' });
    }
  }

  const sql = `
    SELECT t.id, t.number, t.subject, t.status, t.priority, t.tags,
           t.requester_id, t.assignee_id, t.team_id,
           t.created_at, t.updated_at,
           ts.first_response_due, ts.resolution_due,
           ts.first_response_breached_at, ts.resolution_breached_at,
           c.email AS requester_email, c.full_name AS requester_name
      FROM tickets t
      JOIN customers c ON c.id = t.requester_id
 LEFT JOIN ticket_sla ts ON ts.ticket_id = t.id
     WHERE ${conds.join(' AND ')}
  ORDER BY t.${q.sort} ${q.order}, t.id ${q.order}
     LIMIT ${push(q.limit + 1)}
  `;
  const rows = (await query(sql, args)).rows;
  const hasMore = rows.length > q.limit;
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  const nextCursor = hasMore && last
    ? Buffer.from(JSON.stringify([last[q.sort], last.id])).toString('base64url')
    : null;

  res.json({ tickets: page, next_cursor: nextCursor });
});

// POST /api/tickets — create from web/api. Email creation goes through email inbound.
const createSchema = z.object({
  subject:        z.string().min(1).max(500),
  body:           z.string().min(1),
  priority:       z.enum(PRIORITY).optional(),
  tags:           z.array(z.string().min(1).max(40)).max(20).optional(),
  requester_email: z.string().email().optional(),   // agents may create on behalf of someone
});

r.post('/', async (req, res) => {
  const body = createSchema.parse(req.body);
  const subj = req.subject!;
  const orgId = subj.orgId;
  if (!orgId) return res.status(400).json({ error: 'org_required' });

  // Resolve requester. Customers always file as themselves.
  let requesterId: string;
  if (subj.kind === 'customer') {
    requesterId = subj.id;
  } else if (body.requester_email) {
    const c = await query<{ id: string }>(
      `INSERT INTO customers (org_id, email) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET org_id = COALESCE(customers.org_id, EXCLUDED.org_id)
       RETURNING id`,
      [orgId, body.requester_email],
    );
    requesterId = c.rows[0].id;
  } else {
    return res.status(400).json({ error: 'requester_email_required' });
  }

  const channel = subj.kind === 'customer' ? 'web' : 'api';

  const ticket = await tx(async (client) => {
    const t = await client.query<{ id: string; number: number }>(
      `INSERT INTO tickets (org_id, subject, priority, tags, requester_id, channel_id)
       VALUES ($1, $2, $3::ticket_priority, COALESCE($4, '{}'), $5,
               (SELECT id FROM channels WHERE org_id = $1 AND kind = $6::channel_kind LIMIT 1))
       RETURNING id, number`,
      [orgId, body.subject, body.priority ?? 'normal', body.tags ?? null, requesterId, channel],
    );
    await client.query(
      `INSERT INTO messages (ticket_id, kind, body_text, author_customer_id, author_agent_id)
       VALUES ($1, 'reply', $2, $3, $4)`,
      [t.rows[0].id, body.body,
       subj.kind === 'customer' ? subj.id : null,
       subj.kind === 'agent'    ? subj.id : null],
    );
    return t.rows[0];
  });

  // SLA evaluation runs out-of-band but we trigger immediately so the row is
  // populated by the time the agent inbox queries it.
  await applySlaToTicket(ticket.id, orgId);

  audit({ actor: subj, action: 'ticket.create',
          target: { kind: 'ticket', id: ticket.id }, meta: { number: ticket.number }, req });

  res.status(201).json({ ticket_id: ticket.id, number: ticket.number });
});

// GET /api/tickets/:id — full ticket with messages.
r.get('/:id', async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const subj = req.subject!;

  const t = await query(
    `SELECT t.*, c.email AS requester_email, c.full_name AS requester_name
       FROM tickets t JOIN customers c ON c.id = t.requester_id
      WHERE t.id = $1`,
    [id],
  );
  if (t.rowCount === 0) return res.status(404).json({ error: 'not_found' });
  const ticket = t.rows[0];

  // Customers can only read tickets they requested.
  if (subj.kind === 'customer' && ticket.requester_id !== subj.id) {
    return res.status(403).json({ error: 'forbidden' });
  }
  // Internal notes are agent-only.
  const msgFilter = subj.kind === 'customer' ? `AND is_internal = false` : '';
  const msgs = await query(
    `SELECT id, kind, is_internal, body_text, body_html, author_agent_id, author_customer_id,
            attachments, created_at
       FROM messages
      WHERE ticket_id = $1 ${msgFilter}
   ORDER BY created_at ASC`,
    [id],
  );
  const sla = await query(`SELECT * FROM ticket_sla WHERE ticket_id = $1`, [id]);

  res.json({ ticket, messages: msgs.rows, sla: sla.rows[0] ?? null });
});

// PATCH /api/tickets/:id — assign, prioritize, tag, status.
const patchSchema = z.object({
  status:      z.enum(STATUS).optional(),
  priority:    z.enum(PRIORITY).optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  team_id:     z.string().uuid().nullable().optional(),
  tags:        z.array(z.string().min(1).max(40)).max(20).optional(),
  subject:     z.string().min(1).max(500).optional(),
});

r.patch('/:id', requireAgent('admin','manager','agent'), async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const patch = patchSchema.parse(req.body);
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'no_changes' });

  const sets: string[] = [];
  const args: unknown[] = [];
  const push = (v: unknown) => { args.push(v); return `$${args.length}`; };

  // Track resolution/closed timestamps inline so we don't need a separate
  // status-history table for SLA reporting.
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (k === 'status') {
      sets.push(`status = ${push(v)}::ticket_status`);
      if (v === 'solved') sets.push(`resolved_at = COALESCE(resolved_at, now())`);
      if (v === 'closed') sets.push(`closed_at   = COALESCE(closed_at, now())`);
    } else if (k === 'priority') {
      sets.push(`priority = ${push(v)}::ticket_priority`);
    } else {
      sets.push(`${k} = ${push(v)}`);
    }
  }
  args.push(id);
  const result = await query(
    `UPDATE tickets SET ${sets.join(', ')} WHERE id = $${args.length} RETURNING *`,
    args,
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'not_found' });

  audit({ actor: req.subject!, action: 'ticket.update',
          target: { kind: 'ticket', id }, meta: patch, req });
  res.json({ ticket: result.rows[0] });
});

// POST /api/tickets/:id/merge — fold this ticket into another.
r.post('/:id/merge', requireAgent('admin','manager','agent'), async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const { into } = z.object({ into: z.string().uuid() }).parse(req.body);
  if (id === into) return res.status(400).json({ error: 'cannot_merge_into_self' });

  await tx(async (client) => {
    // Move all messages to the target, leave a system trail.
    await client.query(`UPDATE messages SET ticket_id = $1 WHERE ticket_id = $2`, [into, id]);
    await client.query(
      `UPDATE tickets SET merged_into_id = $1, status = 'closed', closed_at = COALESCE(closed_at, now())
       WHERE id = $2`,
      [into, id],
    );
    await client.query(
      `INSERT INTO messages (ticket_id, kind, body_text, author_agent_id)
       VALUES ($1, 'system', $2, $3)`,
      [into, `Merged ticket ${id} into this one.`, req.subject!.id],
    );
  });

  audit({ actor: req.subject!, action: 'ticket.merge',
          target: { kind: 'ticket', id }, meta: { into }, req });
  res.json({ ok: true });
});

// POST /api/tickets/:id/split — create a new ticket from a subset of messages.
const splitSchema = z.object({
  message_ids: z.array(z.string().uuid()).min(1),
  subject:     z.string().min(1).max(500),
});

r.post('/:id/split', requireAgent('admin','manager','agent'), async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const body = splitSchema.parse(req.body);

  const newId = await tx(async (client) => {
    const src = await client.query(
      `SELECT org_id, requester_id, priority FROM tickets WHERE id = $1`, [id],
    );
    if (src.rowCount === 0) throw new Error('not_found');
    const { org_id, requester_id, priority } = src.rows[0];

    const t = await client.query<{ id: string }>(
      `INSERT INTO tickets (org_id, subject, priority, requester_id, split_from_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [org_id, body.subject, priority, requester_id, id],
    );
    await client.query(
      `UPDATE messages SET ticket_id = $1
        WHERE ticket_id = $2 AND id = ANY($3::uuid[])`,
      [t.rows[0].id, id, body.message_ids],
    );
    return t.rows[0].id;
  });

  audit({ actor: req.subject!, action: 'ticket.split',
          target: { kind: 'ticket', id }, meta: { new_id: newId }, req });
  await applySlaToTicket(newId, req.subject!.orgId!);
  res.status(201).json({ new_ticket_id: newId });
});

export default r;
