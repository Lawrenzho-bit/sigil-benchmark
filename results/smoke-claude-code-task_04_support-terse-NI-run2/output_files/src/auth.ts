import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { query, tx } from './db.js';

export type AgentRole = 'admin' | 'manager' | 'agent' | 'viewer';

export interface AuthAgent {
  kind: 'agent';
  id: string;
  orgId: string;
  role: AgentRole;
  email: string;
}
export interface AuthCustomer {
  kind: 'customer';
  id: string;
  orgId: string | null;
  email: string;
}
export type AuthSubject = AuthAgent | AuthCustomer;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      subject?: AuthSubject;
    }
  }
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 12;   // 12h
const TOKEN_BYTES    = 32;

function hashToken(token: string): Buffer {
  return crypto.createHash('sha256').update(token).digest();
}

export async function createSession(
  subjectId: string,
  subjectKind: 'agent' | 'customer',
): Promise<{ token: string; expiresAt: Date }> {
  const raw = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await query(
    `INSERT INTO sessions (token_hash, subject_id, subject_kind, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [hashToken(raw), subjectId, subjectKind, expiresAt],
  );
  return { token: raw, expiresAt };
}

export async function revokeSession(token: string): Promise<void> {
  await query(
    `UPDATE sessions SET revoked_at = now() WHERE token_hash = $1`,
    [hashToken(token)],
  );
}

async function lookupSubject(token: string): Promise<AuthSubject | null> {
  const sess = await query<{ subject_id: string; subject_kind: 'agent' | 'customer' }>(
    `SELECT subject_id, subject_kind FROM sessions
     WHERE token_hash = $1
       AND revoked_at IS NULL
       AND expires_at > now()`,
    [hashToken(token)],
  );
  if (sess.rowCount === 0) return null;
  const { subject_id, subject_kind } = sess.rows[0];

  if (subject_kind === 'agent') {
    const r = await query<{ id: string; org_id: string; role: AgentRole; email: string }>(
      `SELECT id, org_id, role, email FROM agents
       WHERE id = $1 AND is_active = true AND deleted_at IS NULL`,
      [subject_id],
    );
    if (r.rowCount === 0) return null;
    return { kind: 'agent', id: r.rows[0].id, orgId: r.rows[0].org_id,
             role: r.rows[0].role, email: r.rows[0].email };
  }

  const r = await query<{ id: string; org_id: string | null; email: string }>(
    `SELECT id, org_id, email FROM customers
     WHERE id = $1 AND deleted_at IS NULL`,
    [subject_id],
  );
  if (r.rowCount === 0) return null;
  return { kind: 'customer', id: r.rows[0].id, orgId: r.rows[0].org_id,
           email: r.rows[0].email };
}

// Extract token from Authorization: Bearer <token> or cookie.
function extractToken(req: Request): string | null {
  const auth = req.header('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice('Bearer '.length).trim();
  const cookie = req.header('cookie') ?? '';
  const m = /(?:^|;\s*)sd_session=([^;]+)/.exec(cookie);
  return m?.[1] ?? null;
}

export function authenticate(opts: { required?: boolean; kinds?: Array<'agent' | 'customer'> } = {}) {
  const { required = true, kinds = ['agent', 'customer'] } = opts;
  return async function (req: Request, res: Response, next: NextFunction) {
    const token = extractToken(req);
    if (!token) {
      if (required) return res.status(401).json({ error: 'unauthenticated' });
      return next();
    }
    const subj = await lookupSubject(token);
    if (!subj) {
      if (required) return res.status(401).json({ error: 'invalid_session' });
      return next();
    }
    if (!kinds.includes(subj.kind)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    req.subject = subj;
    next();
  };
}

export function requireAgent(...roles: AgentRole[]) {
  return function (req: Request, res: Response, next: NextFunction) {
    if (req.subject?.kind !== 'agent') return res.status(403).json({ error: 'agent_only' });
    if (roles.length && !roles.includes(req.subject.role)) {
      return res.status(403).json({ error: 'insufficient_role' });
    }
    next();
  };
}

// Auth flows.

export async function loginAgent(email: string, password: string): Promise<{ token: string; agent: AuthAgent } | null> {
  const r = await query<{ id: string; org_id: string; role: AgentRole; email: string; password_hash: string }>(
    `SELECT id, org_id, role, email, password_hash FROM agents
     WHERE email = $1 AND is_active = true AND deleted_at IS NULL`,
    [email],
  );
  if (r.rowCount === 0) {
    // Constant-time-ish: still perform a bcrypt comparison to avoid leaking
    // existence via timing.
    await bcrypt.compare(password, '$2b$12$' + 'a'.repeat(53));
    return null;
  }
  const row = r.rows[0];
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) return null;
  const { token } = await createSession(row.id, 'agent');
  return {
    token,
    agent: { kind: 'agent', id: row.id, orgId: row.org_id, role: row.role, email: row.email },
  };
}

export async function loginCustomer(email: string, password: string): Promise<{ token: string; customer: AuthCustomer } | null> {
  const r = await query<{ id: string; org_id: string | null; email: string; portal_password_hash: string | null }>(
    `SELECT id, org_id, email, portal_password_hash FROM customers
     WHERE email = $1 AND deleted_at IS NULL`,
    [email],
  );
  if (r.rowCount === 0 || !r.rows[0].portal_password_hash) return null;
  const ok = await bcrypt.compare(password, r.rows[0].portal_password_hash);
  if (!ok) return null;
  const { token } = await createSession(r.rows[0].id, 'customer');
  return {
    token,
    customer: { kind: 'customer', id: r.rows[0].id, orgId: r.rows[0].org_id, email: r.rows[0].email },
  };
}

export async function registerCustomer(orgId: string | null, email: string, password: string, fullName?: string): Promise<AuthCustomer> {
  const hash = await bcrypt.hash(password, 12);
  return tx(async (client) => {
    const r = await client.query<{ id: string; org_id: string | null; email: string }>(
      `INSERT INTO customers (org_id, email, full_name, portal_password_hash)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE
         SET portal_password_hash = COALESCE(customers.portal_password_hash, EXCLUDED.portal_password_hash),
             full_name            = COALESCE(customers.full_name, EXCLUDED.full_name)
       RETURNING id, org_id, email`,
      [orgId, email, fullName ?? null, hash],
    );
    const row = r.rows[0];
    return { kind: 'customer', id: row.id, orgId: row.org_id, email: row.email };
  });
}
