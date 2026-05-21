// Authentication / authorization helpers for Fastify routes.
import type { FastifyRequest } from 'fastify';
import { verifyAccessToken } from '../lib/tokens.js';
import { Forbidden, Unauthorized } from '../lib/errors.js';
import { prisma } from '../db.js';

export interface AuthContext {
  userId: string;
  role: 'BUYER' | 'SELLER' | 'ADMIN';
  sessionId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

/** Extracts and verifies the bearer token; throws 401 if absent/invalid. */
export async function requireAuth(req: FastifyRequest): Promise<AuthContext> {
  if (req.auth) return req.auth;

  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw Unauthorized();

  let claims;
  try {
    claims = await verifyAccessToken(header.slice(7));
  } catch {
    throw Unauthorized('Invalid or expired token');
  }

  // A revoked or expired session invalidates otherwise-valid access tokens.
  const session = await prisma.session.findUnique({
    where: { id: claims.sid },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    throw Unauthorized('Session is no longer active');
  }

  req.auth = { userId: claims.sub, role: claims.role, sessionId: claims.sid };
  return req.auth;
}

export async function requireRole(
  req: FastifyRequest,
  ...roles: AuthContext['role'][]
): Promise<AuthContext> {
  const auth = await requireAuth(req);
  if (!roles.includes(auth.role)) throw Forbidden(`Requires role: ${roles.join('/')}`);
  return auth;
}

export const requireAdmin = (req: FastifyRequest) => requireRole(req, 'ADMIN');
export const requireSeller = (req: FastifyRequest) =>
  requireRole(req, 'SELLER', 'ADMIN');
