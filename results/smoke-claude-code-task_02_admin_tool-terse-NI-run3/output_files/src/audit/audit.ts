/**
 * Audit logging. Every state-changing admin action must call `recordAudit`.
 * The log is append-only — there is no update or delete path — so it can be
 * trusted as the system of record for "who did what".
 */
import type { Request } from 'express';
import { ActorType, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';
import type { FieldDiff } from '../util/diff';

export interface AuditInput {
  /** Dotted action name, e.g. "user.deactivate", "flag.toggle". */
  action: string;
  /** The kind of entity affected, e.g. "ManagedUser". */
  targetType: string;
  targetId?: string;
  /** Human-readable one-line description shown in the audit UI. */
  summary: string;
  diff?: FieldDiff;
  metadata?: Record<string, unknown>;
}

/** Extracts the originating client IP, honoring a trusted proxy. */
function clientIp(req: Request): string | undefined {
  return req.ip ?? req.socket.remoteAddress ?? undefined;
}

/**
 * Persist one audit entry, attributed to the request's authenticated
 * principal. Throws if there is no principal — an unattributable mutation is
 * a bug and must not silently succeed.
 */
export async function recordAudit(req: Request, input: AuditInput): Promise<void> {
  const principal = req.principal;
  if (!principal) {
    throw new Error(`recordAudit called without an authenticated principal for "${input.action}"`);
  }

  const actorType =
    principal.type === 'api_token' ? ActorType.API_TOKEN : ActorType.ADMIN_USER;

  await prisma.auditLog.create({
    data: {
      actorType,
      // For tokens we record the responsible human's id so the trail still
      // points at an accountable person.
      actorId: principal.adminUserId,
      actorEmail: principal.email,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      summary: input.summary,
      diff: (input.diff ?? undefined) as Prisma.InputJsonValue | undefined,
      metadata: {
        ...(input.metadata ?? {}),
        ...(principal.type === 'api_token'
          ? { viaApiToken: principal.id, tokenName: principal.tokenName }
          : {}),
        requestId: req.requestId,
      } as Prisma.InputJsonValue,
      ip: clientIp(req),
      userAgent: req.get('user-agent') ?? undefined,
    },
  });

  logger.info(
    { action: input.action, actor: principal.email, target: input.targetId },
    'audit',
  );
}

/** Records an action performed by the system itself (e.g. scheduled jobs). */
export async function recordSystemAudit(input: AuditInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorType: ActorType.SYSTEM,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      summary: input.summary,
      diff: (input.diff ?? undefined) as Prisma.InputJsonValue | undefined,
      metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
