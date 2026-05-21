import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query, queryOne } from '../db';
import { badRequest, conflict, unauthorized } from '../errors';
import { asyncHandler } from '../middleware/asyncHandler';
import { signToken } from '../middleware/auth';
import { audit } from '../lib/audit';
import { AgentRole } from '../types';

export const authRouter = Router();

const credentials = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

/**
 * Agent login. On success returns a JWT carrying the agent's role + team,
 * which downstream RBAC middleware reads.
 *
 * The same generic error is returned for "no such agent" and "wrong password"
 * so the endpoint can't be used to enumerate valid agent emails.
 */
authRouter.post(
  '/agent/login',
  asyncHandler(async (req, res) => {
    const { email, password } = credentials.parse(req.body);
    const agent = await queryOne<{
      id: string;
      password_hash: string;
      role: AgentRole;
      team_id: string | null;
      active: boolean;
    }>('SELECT id, password_hash, role, team_id, active FROM agents WHERE email = $1', [email]);

    if (!agent || !agent.active || !(await bcrypt.compare(password, agent.password_hash))) {
      throw unauthorized('Invalid email or password');
    }
    await audit({
      actorType: 'agent',
      actorId: agent.id,
      action: 'agent.login',
      entityType: 'agent',
      entityId: agent.id,
      ip: req.ip,
    });
    res.json({
      token: signToken({ kind: 'agent', id: agent.id, role: agent.role, teamId: agent.team_id }),
    });
  }),
);

/** Customer portal registration. */
authRouter.post(
  '/customer/register',
  asyncHandler(async (req, res) => {
    const { email, password } = credentials.parse(req.body);
    const name = z.string().max(200).optional().parse(req.body?.name);

    const existing = await queryOne<{ id: string; portal_password_hash: string | null }>(
      'SELECT id, portal_password_hash FROM customers WHERE email = $1',
      [email],
    );
    if (existing?.portal_password_hash) {
      throw conflict('An account with this email already exists');
    }

    const hash = await bcrypt.hash(password, 10);
    let customerId: string;
    if (existing) {
      // Customer already known from inbound email — attach a password.
      await query('UPDATE customers SET portal_password_hash = $1, name = COALESCE(name,$2) WHERE id = $3', [
        hash,
        name ?? null,
        existing.id,
      ]);
      customerId = existing.id;
    } else {
      const created = await queryOne<{ id: string }>(
        'INSERT INTO customers (email, name, portal_password_hash) VALUES ($1,$2,$3) RETURNING id',
        [email, name ?? null, hash],
      );
      customerId = created!.id;
    }
    res.status(201).json({ token: signToken({ kind: 'customer', id: customerId }) });
  }),
);

/** Customer portal login. */
authRouter.post(
  '/customer/login',
  asyncHandler(async (req, res) => {
    const { email, password } = credentials.parse(req.body);
    const customer = await queryOne<{ id: string; portal_password_hash: string | null }>(
      'SELECT id, portal_password_hash FROM customers WHERE email = $1',
      [email],
    );
    if (
      !customer?.portal_password_hash ||
      !(await bcrypt.compare(password, customer.portal_password_hash))
    ) {
      throw unauthorized('Invalid email or password');
    }
    res.json({ token: signToken({ kind: 'customer', id: customer.id }) });
  }),
);

export default authRouter;
