import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { query } from '../db.js';
import { requireAgent } from '../auth.js';
import { audit } from '../audit.js';

const r = Router();

r.get('/', async (req, res) => {
  const rows = (await query(
    `SELECT id, email, full_name, role, is_active, created_at
       FROM agents
      WHERE org_id = $1 AND deleted_at IS NULL
   ORDER BY full_name`,
    [req.subject!.orgId],
  )).rows;
  res.json({ agents: rows });
});

r.post('/', requireAgent('admin'), async (req, res) => {
  const body = z.object({
    email:     z.string().email(),
    full_name: z.string().min(1).max(200),
    role:      z.enum(['admin','manager','agent','viewer']).default('agent'),
    password:  z.string().min(12).max(200),
  }).parse(req.body);

  const hash = await bcrypt.hash(body.password, 12);
  const a = await query<{ id: string }>(
    `INSERT INTO agents (org_id, email, full_name, role, password_hash)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [req.subject!.orgId, body.email, body.full_name, body.role, hash],
  );
  audit({ actor: req.subject!, action: 'agent.create',
          target: { kind: 'agent', id: a.rows[0].id },
          meta: { email: body.email, role: body.role }, req });
  res.status(201).json({ id: a.rows[0].id });
});

r.patch('/:id', requireAgent('admin'), async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const patch = z.object({
    role:      z.enum(['admin','manager','agent','viewer']).optional(),
    is_active: z.boolean().optional(),
    full_name: z.string().min(1).max(200).optional(),
  }).parse(req.body);

  const sets: string[] = [];
  const args: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    args.push(v);
    sets.push(`${k} = $${args.length}`);
  }
  if (sets.length === 0) return res.status(400).json({ error: 'no_changes' });
  args.push(id, req.subject!.orgId);
  await query(
    `UPDATE agents SET ${sets.join(', ')} WHERE id = $${args.length - 1} AND org_id = $${args.length}`,
    args,
  );
  audit({ actor: req.subject!, action: 'agent.update', target: { kind: 'agent', id }, meta: patch, req });
  res.json({ ok: true });
});

export default r;
