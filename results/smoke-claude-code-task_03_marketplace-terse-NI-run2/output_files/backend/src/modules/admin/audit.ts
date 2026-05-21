import { prisma } from '../../db';

// Append-only audit trail for sensitive actions. Failures here must not
// break the calling request, but they are logged.
export async function audit(
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: { actorId, action, entityType, entityId, metadata: metadata ?? undefined },
    });
  } catch (err) {
    console.error('audit log write failed', { action, entityId, err });
  }
}
