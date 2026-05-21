/**
 * Resolves the request principal into `req.actor`.
 *
 * Two authentication paths converge here:
 *   1. Browser session — Passport has already deserialized an AdminUser onto
 *      `req.user`. The actor's permissions come straight from its role.
 *   2. `Authorization: Bearer <token>` — an API token. Its effective
 *      permissions are the intersection of the creator's role permissions and
 *      the token's declared scopes. A token can never out-rank its creator.
 *
 * This middleware never rejects a request; it only populates `req.actor` when
 * it can. Enforcement is the job of requireAuth / requirePermission.
 */
import { RequestHandler } from 'express';
import { AdminUser } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';
import { permissionsForRole, effectiveTokenPermissions } from '../rbac/permissions';
import { hashToken, hashesEqual, looksLikeToken } from './apiToken';
import type { Actor } from '../types';

function actorFromAdminUser(user: AdminUser): Actor {
  return {
    type: 'ADMIN_USER',
    adminUserId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    permissions: permissionsForRole(user.role),
  };
}

async function actorFromBearer(token: string): Promise<Actor | null> {
  const hash = hashToken(token);
  const record = await prisma.apiToken.findUnique({
    where: { tokenHash: hash },
    include: { createdBy: true },
  });
  if (!record) return null;

  // Defense in depth: confirm the hash matches in constant time even though
  // the unique lookup already did an equality match.
  if (!hashesEqual(record.tokenHash, hash)) return null;
  if (record.revokedAt) return null;
  if (record.expiresAt && record.expiresAt.getTime() < Date.now()) return null;
  if (!record.createdBy.isActive) return null; // creator deactivated → token dead

  return {
    type: 'API_TOKEN',
    adminUserId: record.createdById,
    email: record.createdBy.email,
    name: `${record.name} (token)`,
    role: record.createdBy.role,
    permissions: effectiveTokenPermissions(record.createdBy.role, record.scopes),
    tokenId: record.id,
    orgScopeId: record.orgId,
  };
}

export const attachActor: RequestHandler = async (req, _res, next) => {
  try {
    // Path 1: established browser session.
    if (req.isAuthenticated?.() && req.user) {
      req.actor = actorFromAdminUser(req.user as AdminUser);
      return next();
    }

    // Path 2: bearer token.
    const header = req.get('authorization');
    if (header?.startsWith('Bearer ')) {
      const token = header.slice('Bearer '.length).trim();
      if (looksLikeToken(token)) {
        const actor = await actorFromBearer(token);
        if (actor) {
          req.actor = actor;
          // Record usage without blocking the response.
          recordTokenUsage(req, actor.tokenId!);
        }
      }
    }
    next();
  } catch (err) {
    logger.error({ err }, 'failed to resolve request actor');
    next();
  }
};

/** Fire-and-forget usage tracking for the API token usage view. */
function recordTokenUsage(req: { method: string; path: string; res?: unknown }, tokenId: string): void {
  const res = (req as { res?: { on: (e: string, cb: () => void) => void; statusCode: number } }).res;
  const finalize = async (statusCode: number) => {
    try {
      await prisma.$transaction([
        prisma.apiToken.update({ where: { id: tokenId }, data: { lastUsedAt: new Date() } }),
        prisma.apiTokenUsage.create({
          data: { tokenId, endpoint: req.path, method: req.method, statusCode },
        }),
      ]);
    } catch (err) {
      logger.warn({ err, tokenId }, 'failed to record api token usage');
    }
  };
  if (res?.on) {
    res.on('finish', () => void finalize(res.statusCode));
  } else {
    void finalize(0);
  }
}
