/**
 * Authentication routes for both principal types:
 *   POST /api/auth/login            — agent (staff) login
 *   POST /api/auth/logout           — revoke the presented token
 *   POST /api/portal/auth/register  — customer self-registration
 *   POST /api/portal/auth/login     — customer portal login
 */
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { queryOne } from '../db';
import { unauthorized } from '../errors';
import { record } from '../audit/audit';
import { parseBody, wrap } from '../http/wrap';
import {
  decodeUnsafe,
  revokeToken,
  signAgentToken,
  signCustomerToken,
} from './tokens';
import { actorOf } from './middleware';

const credentials = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const authRouter = Router();

// --- Agent login -------------------------------------------------------------
authRouter.post(
  '/api/auth/login',
  wrap(async (req, res) => {
    const { email, password } = parseBody(credentials, req);
    const user = await queryOne<{
      id: string; email: string; name: string; role: 'admin' | 'agent' | 'read_only';
      password_hash: string; is_active: boolean;
    }>('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);

    if (!user || !user.is_active || !(await bcrypt.compare(password, user.password_hash))) {
      // Uniform failure: do not reveal whether the email exists.
      throw unauthorized('Invalid email or password');
    }
    const token = signAgentToken({
      id: user.id, email: user.email, name: user.name, role: user.role,
    });
    await record({
      actor: { type: 'user', id: user.id, label: user.email, ip: req.ip },
      action: 'user.login', entityType: 'user', entityId: user.id,
    });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  }),
);

// --- Logout (revoke current token) ------------------------------------------
authRouter.post(
  '/api/auth/logout',
  wrap(async (req, res) => {
    const header = req.header('authorization') ?? '';
    const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
    if (token) {
      const { jti, exp } = decodeUnsafe(token);
      if (jti && exp) await revokeToken(jti, new Date(exp * 1000));
    }
    res.json({ ok: true });
  }),
);

// --- Customer registration ---------------------------------------------------
authRouter.post(
  '/api/portal/auth/register',
  wrap(async (req, res) => {
    const body = parseBody(
      credentials.extend({ name: z.string().min(1).optional() }),
      req,
    );
    const hash = await bcrypt.hash(body.password, 12);
    // Upsert: an email-only customer (created via inbound email) may already
    // exist; registering simply attaches portal credentials to that record.
    const customer = await queryOne<{ id: string; email: string; name: string | null }>(
      `INSERT INTO customers (email, name, password_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (lower(email)) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             name = COALESCE(customers.name, EXCLUDED.name)
       RETURNING id, email, name`,
      [body.email, body.name ?? null, hash],
    );
    const token = signCustomerToken(customer!);
    await record({
      actor: actorOf(req),
      action: 'customer.register', entityType: 'customer', entityId: customer!.id,
    });
    res.status(201).json({ token, customer });
  }),
);

// --- Customer portal login ---------------------------------------------------
authRouter.post(
  '/api/portal/auth/login',
  wrap(async (req, res) => {
    const { email, password } = parseBody(credentials, req);
    const customer = await queryOne<{
      id: string; email: string; name: string | null; password_hash: string | null;
    }>('SELECT * FROM customers WHERE lower(email) = lower($1)', [email]);

    if (!customer?.password_hash || !(await bcrypt.compare(password, customer.password_hash))) {
      throw unauthorized('Invalid email or password');
    }
    const token = signCustomerToken({
      id: customer.id, email: customer.email, name: customer.name,
    });
    res.json({ token, customer: { id: customer.id, email: customer.email, name: customer.name } });
  }),
);
