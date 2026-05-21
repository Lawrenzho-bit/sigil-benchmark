import type { FastifyRequest } from 'fastify';
import type { UserRole } from '@prisma/client';
import { verifyAccessToken } from './jwt';
import { forbidden, unauthorized } from '../lib/errors';

export interface AuthUser {
  id: string;
  roles: UserRole[];
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
}

// Populates request.authUser if a valid bearer token is present. Does not
// reject — use requireAuth/requireRole for that.
export function authenticate(req: FastifyRequest): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return;
  try {
    const claims = verifyAccessToken(header.slice(7));
    req.authUser = { id: claims.sub, roles: claims.roles };
  } catch {
    // Leave authUser unset; downstream guards produce the 401.
  }
}

export function requireAuth(req: FastifyRequest): AuthUser {
  if (!req.authUser) throw unauthorized();
  return req.authUser;
}

export function requireRole(req: FastifyRequest, role: UserRole): AuthUser {
  const user = requireAuth(req);
  if (!user.roles.includes(role)) {
    throw forbidden(`Requires ${role} role`);
  }
  return user;
}
