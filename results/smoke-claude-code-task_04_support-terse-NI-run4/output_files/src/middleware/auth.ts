import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { unauthorized } from '../errors';
import { Principal } from '../types';

interface TokenClaims {
  sub: string;
  kind: 'agent' | 'customer';
  role?: Principal['role'];
  teamId?: string | null;
}

/** Sign a JWT for an authenticated principal. */
export function signToken(principal: Principal): string {
  const claims: TokenClaims = {
    sub: principal.id,
    kind: principal.kind,
    role: principal.role,
    teamId: principal.teamId,
  };
  return jwt.sign(claims, config.jwtSecret, { expiresIn: config.jwtTtlSeconds });
}

function principalFromHeader(req: Request): Principal | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  try {
    const claims = jwt.verify(header.slice(7), config.jwtSecret) as TokenClaims;
    return {
      kind: claims.kind,
      id: claims.sub,
      role: claims.role,
      teamId: claims.teamId,
    };
  } catch {
    return null; // expired / tampered — treated as unauthenticated
  }
}

/** Require any authenticated principal (agent OR customer). */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const principal = principalFromHeader(req);
  if (!principal) return next(unauthorized());
  req.principal = principal;
  next();
}

/** Require an authenticated agent; rejects customer tokens. */
export function requireAgent(req: Request, _res: Response, next: NextFunction): void {
  const principal = principalFromHeader(req);
  if (!principal) return next(unauthorized());
  if (principal.kind !== 'agent') return next(unauthorized('Agent access required'));
  req.principal = principal;
  next();
}

/** Require a customer token specifically (used by the web portal). */
export function requireCustomer(req: Request, _res: Response, next: NextFunction): void {
  const principal = principalFromHeader(req);
  if (!principal) return next(unauthorized());
  if (principal.kind !== 'customer') return next(unauthorized('Customer access required'));
  req.principal = principal;
  next();
}
