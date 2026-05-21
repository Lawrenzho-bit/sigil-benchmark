/**
 * Audit trail. Every state-changing admin action funnels through writeAudit().
 *
 * Design rules:
 *  - The audit_logs table is append-only; nothing here updates or deletes.
 *  - Audit writes never throw into the caller — a logging failure must not
 *    silently roll back a real action, but it is loudly logged.
 *  - Actor and target are denormalized (email/label captured at write time) so
 *    history stays readable even if the referenced rows later change.
 */
import { ActorType, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';
import type { Request } from 'express';

export interface AuditActor {
  type: ActorType;
  id: string | null;
  email: string;
}

export interface AuditInput {
  actor: AuditActor;
  action: string;
  targetType?: string;
  targetId?: string;
  targetLabel?: string;
  diff?: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonValue;
  ip?: string;
  userAgent?: string;
}

/** Derive an AuditActor from the request's resolved principal. */
export function actorFromRequest(req: Request): AuditActor {
  const a = req.actor;
  if (!a) return { type: 'SYSTEM', id: null, email: 'anonymous' };
  return {
    type: a.type === 'API_TOKEN' ? 'API_TOKEN' : 'ADMIN_USER',
    id: a.type === 'API_TOKEN' ? a.tokenId ?? null : a.adminUserId,
    email: a.email,
  };
}

export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorType: input.actor.type,
        actorId: input.actor.id,
        actorEmail: input.actor.email,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        targetLabel: input.targetLabel,
        diff: input.diff,
        metadata: input.metadata,
        ip: input.ip,
        userAgent: input.userAgent,
      },
    });
  } catch (err) {
    // Do not propagate: the action itself already happened. Alert on this.
    logger.error({ err, action: input.action }, 'AUDIT WRITE FAILED');
  }
}

/** Convenience wrapper that pulls actor + request context off an Express req. */
export async function auditFromRequest(
  req: Request,
  input: Omit<AuditInput, 'actor' | 'ip' | 'userAgent'>,
): Promise<void> {
  await writeAudit({
    ...input,
    actor: actorFromRequest(req),
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
  });
}
