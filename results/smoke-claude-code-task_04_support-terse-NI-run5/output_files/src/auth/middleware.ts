/** Authentication + RBAC middleware. */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { forbidden, unauthorized } from '../http/errors';
import { Principal, verifyToken } from './tokens';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: Principal;
    }
  }
}

type AgentRole = 'admin' | 'manager' | 'agent' | 'read_only';

function extractBearer(req: Request): string {
  const header = req.header('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw unauthorized('Missing Bearer token');
  return token;
}

/** Require any authenticated principal (agent or customer). */
export const requireAuth: RequestHandler = (req, _res, next) => {
  req.principal = verifyToken(extractBearer(req));
  next();
};

/** Require an authenticated agent, optionally with one of the given roles. */
export function requireAgent(...roles: AgentRole[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const principal = verifyToken(extractBearer(req));
    if (principal.type !== 'agent') throw forbidden('Agent access required');
    if (roles.length > 0 && !roles.includes(principal.role)) {
      throw forbidden(`Requires role: ${roles.join(' | ')}`);
    }
    req.principal = principal;
    next();
  };
}

/** Require an authenticated customer (portal). */
export const requireCustomer: RequestHandler = (req, _res, next) => {
  const principal = verifyToken(extractBearer(req));
  if (principal.type !== 'customer') throw forbidden('Customer portal access required');
  req.principal = principal;
  next();
};

/** Roles permitted to mutate state. `read_only` agents are blocked. */
export const requireWriteAgent = requireAgent('admin', 'manager', 'agent');

export function principalOf(req: Request): Principal {
  if (!req.principal) throw unauthorized();
  return req.principal;
}
