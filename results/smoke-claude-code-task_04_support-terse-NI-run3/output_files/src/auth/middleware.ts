/**
 * Express auth middleware. Populates `req.principal` and exposes guards:
 *   - requireAgent: any authenticated staff user
 *   - requireRole('admin'): staff with at least the given role
 *   - requireCustomer: an authenticated portal customer
 */
import { NextFunction, Request, Response } from 'express';
import { forbidden, unauthorized } from '../errors';
import {
  AgentPrincipal,
  CustomerPrincipal,
  Principal,
  Role,
  verifyAgentToken,
  verifyCustomerToken,
} from './tokens';
import { AuditActor } from '../audit/audit';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: Principal;
    }
  }
}

function bearer(req: Request): string | undefined {
  const h = req.header('authorization');
  if (!h || !h.toLowerCase().startsWith('bearer ')) return undefined;
  return h.slice(7).trim();
}

/** Build an AuditActor from the current request principal. */
export function actorOf(req: Request): AuditActor {
  const p = req.principal;
  const ip = req.ip;
  const userAgent = req.header('user-agent') ?? undefined;
  if (!p) return { type: 'system', ip, userAgent };
  return {
    type: p.kind === 'agent' ? 'user' : 'customer',
    id: p.id,
    label: p.email,
    ip,
    userAgent,
  };
}

/** Require a valid agent (staff) token. */
export function requireAgent(req: Request, _res: Response, next: NextFunction): void {
  const token = bearer(req);
  if (!token) return next(unauthorized());
  verifyAgentToken(token)
    .then((principal) => {
      req.principal = principal;
      next();
    })
    .catch(() => next(unauthorized('Invalid or expired token')));
}

const ROLE_RANK: Record<Role, number> = { read_only: 0, agent: 1, admin: 2 };

/** Require an agent token whose role is >= `min`. Use after requireAgent. */
export function requireRole(min: Role) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const p = req.principal;
    if (!p || p.kind !== 'agent') return next(unauthorized());
    if (ROLE_RANK[p.role] < ROLE_RANK[min]) {
      return next(forbidden(`Requires ${min} role`));
    }
    next();
  };
}

/** Reject mutating verbs for read_only agents. */
export function denyReadOnlyWrites(req: Request, _res: Response, next: NextFunction): void {
  const p = req.principal;
  const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (p && p.kind === 'agent' && p.role === 'read_only' && mutating) {
    return next(forbidden('Read-only agents cannot make changes'));
  }
  next();
}

/** Require a valid customer (portal) token. */
export function requireCustomer(req: Request, _res: Response, next: NextFunction): void {
  const token = bearer(req);
  if (!token) return next(unauthorized());
  verifyCustomerToken(token)
    .then((principal) => {
      req.principal = principal;
      next();
    })
    .catch(() => next(unauthorized('Invalid or expired token')));
}

export function asAgent(req: Request): AgentPrincipal {
  if (!req.principal || req.principal.kind !== 'agent') throw unauthorized();
  return req.principal;
}

export function asCustomer(req: Request): CustomerPrincipal {
  if (!req.principal || req.principal.kind !== 'customer') throw unauthorized();
  return req.principal;
}
