import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query, queryOne } from '../db';
import { conflict, notFound } from '../errors';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireAgent } from '../middleware/auth';
import { requireAdmin } from '../middleware/rbac';
import { audit } from '../lib/audit';

/**
 * Administration API: agents, teams, and SLA policies. Admin-only
 * (SOC2 access controls) — every mutation is written to the audit log.
 */
export const adminRouter = Router();
adminRouter.use(requireAgent, requireAdmin);

// --- Agents ---

adminRouter.get(
  '/agents',
  asyncHandler(async (_req, res) => {
    res.json({
      agents: await query(
        'SELECT id, email, name, role, team_id, active, created_at FROM agents ORDER BY name',
      ),
    });
  }),
);

adminRouter.post(
  '/agents',
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        email: z.string().email(),
        name: z.string().min(1).max(200),
        password: z.string().min(8).max(200),
        role: z.enum(['agent', 'team_lead', 'admin']).default('agent'),
        teamId: z.string().uuid().nullable().optional(),
      })
      .parse(req.body);

    if (await queryOne('SELECT 1 FROM agents WHERE email = $1', [input.email])) {
      throw conflict('An agent with this email already exists');
    }
    const agent = await queryOne<{ id: string }>(
      `INSERT INTO agents (email, name, password_hash, role, team_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [input.email, input.name, await bcrypt.hash(input.password, 10), input.role, input.teamId ?? null],
    );
    await audit({
      actorType: 'agent',
      actorId: req.principal!.id,
      action: 'agent.create',
      entityType: 'agent',
      entityId: agent!.id,
      metadata: { role: input.role },
      ip: req.ip,
    });
    res.status(201).json({ id: agent!.id });
  }),
);

adminRouter.patch(
  '/agents/:id',
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const changes = z
      .object({
        name: z.string().min(1).max(200).optional(),
        role: z.enum(['agent', 'team_lead', 'admin']).optional(),
        teamId: z.string().uuid().nullable().optional(),
        active: z.boolean().optional(),
      })
      .parse(req.body);

    const sets: string[] = [];
    const values: unknown[] = [];
    const map: Record<string, string> = { teamId: 'team_id' };
    for (const [key, val] of Object.entries(changes)) {
      if (val === undefined) continue;
      values.push(val);
      sets.push(`${map[key] ?? key} = $${values.length}`);
    }
    if (sets.length === 0) throw notFound('No fields to update');
    values.push(id);
    const updated = await query(
      `UPDATE agents SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING id`,
      values,
    );
    if (updated.length === 0) throw notFound('Agent not found');
    await audit({
      actorType: 'agent',
      actorId: req.principal!.id,
      action: 'agent.update',
      entityType: 'agent',
      entityId: id,
      metadata: { fields: Object.keys(changes) },
      ip: req.ip,
    });
    res.json({ ok: true });
  }),
);

// --- Teams ---

adminRouter.get(
  '/teams',
  asyncHandler(async (_req, res) => {
    res.json({ teams: await query('SELECT * FROM teams ORDER BY name') });
  }),
);

adminRouter.post(
  '/teams',
  asyncHandler(async (req, res) => {
    const { name } = z.object({ name: z.string().min(1).max(120) }).parse(req.body);
    const team = await queryOne<{ id: string }>(
      'INSERT INTO teams (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING id',
      [name],
    );
    if (!team) throw conflict('A team with this name already exists');
    res.status(201).json({ id: team.id });
  }),
);

// --- SLA policies ---

adminRouter.get(
  '/sla-policies',
  asyncHandler(async (_req, res) => {
    res.json({ policies: await query('SELECT * FROM sla_policies ORDER BY priority') });
  }),
);

/**
 * Update an SLA policy's targets. Existing tickets keep their frozen targets;
 * only tickets created (or re-prioritised) afterwards use the new values.
 */
adminRouter.patch(
  '/sla-policies/:id',
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const changes = z
      .object({
        first_response_minutes: z.number().int().positive().optional(),
        resolution_minutes: z.number().int().positive().optional(),
      })
      .parse(req.body);

    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, val] of Object.entries(changes)) {
      if (val === undefined) continue;
      values.push(val);
      sets.push(`${key} = $${values.length}`);
    }
    if (sets.length === 0) throw notFound('No fields to update');
    values.push(id);
    const updated = await query(
      `UPDATE sla_policies SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING id`,
      values,
    );
    if (updated.length === 0) throw notFound('SLA policy not found');
    await audit({
      actorType: 'agent',
      actorId: req.principal!.id,
      action: 'sla_policy.update',
      entityType: 'sla_policy',
      entityId: id,
      metadata: changes,
      ip: req.ip,
    });
    res.json({ ok: true });
  }),
);

/** Read the audit log (SOC2) — filterable by entity. */
adminRouter.get(
  '/audit-log',
  asyncHandler(async (req, res) => {
    const q = z
      .object({
        entityType: z.string().max(50).optional(),
        entityId: z.string().max(100).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      })
      .parse(req.query);
    const rows = await query(
      `SELECT * FROM audit_log
        WHERE ($1::text IS NULL OR entity_type = $1)
          AND ($2::text IS NULL OR entity_id = $2)
        ORDER BY created_at DESC
        LIMIT $3`,
      [q.entityType ?? null, q.entityId ?? null, q.limit],
    );
    res.json({ entries: rows });
  }),
);

export default adminRouter;
