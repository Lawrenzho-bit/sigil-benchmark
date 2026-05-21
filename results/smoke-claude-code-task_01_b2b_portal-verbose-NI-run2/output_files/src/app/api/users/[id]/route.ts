import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handleRoute, Errors } from '@/lib/errors';
import { authorize } from '@/lib/authz';
import { canAssignRole } from '@/lib/rbac';
import { audit } from '@/lib/audit';
import { revokeAllSessions } from '@/lib/session';
import { clientIp } from '@/lib/http';

const patchSchema = z.object({
  role: z.enum(['OWNER', 'ADMIN', 'VIEWER']).optional(),
  status: z.enum(['ACTIVE', 'DEACTIVATED']).optional(),
});

/** Resolves the target user and confirms it belongs to the caller's org. */
async function loadTarget(orgId: string, id: string) {
  const user = await prisma.user.findUnique({ where: { id } });
  // Returning 404 (not 403) for cross-org ids avoids leaking their existence.
  if (!user || user.orgId !== orgId) throw Errors.notFound('User not found');
  return user;
}

/**
 * PATCH /api/users/:id — change role and/or activation status.
 * Guards against privilege escalation and against removing the last Owner.
 */
export const PATCH = handleRoute(async (req) => {
  const id = req.url.split('/').pop()!.split('?')[0]!;
  const session = await authorize('roles.assign');
  const body = patchSchema.parse(await req.json());
  const target = await loadTarget(session.orgId, id);
  const ip = clientIp(req);

  const updates: { role?: typeof target.role; status?: typeof target.status } = {};

  if (body.role && body.role !== target.role) {
    if (!canAssignRole(session.role, body.role) || !canAssignRole(session.role, target.role)) {
      throw Errors.forbidden('You cannot change this user to or from that role.');
    }
    updates.role = body.role;
  }

  if (body.status && body.status !== target.status) {
    if (body.status === 'DEACTIVATED') {
      await authorize('users.deactivate');
    }
    updates.status = body.status;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ id: target.id, unchanged: true });
  }

  // Never allow the organization to lose its last active Owner.
  const losingOwner =
    (updates.role && target.role === 'OWNER' && updates.role !== 'OWNER') ||
    (updates.status === 'DEACTIVATED' && target.role === 'OWNER');
  if (losingOwner) {
    const owners = await prisma.user.count({
      where: { orgId: session.orgId, role: 'OWNER', status: 'ACTIVE' },
    });
    if (owners <= 1) {
      throw Errors.conflict('An organization must keep at least one active Owner.');
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({ where: { id: target.id }, data: updates });
    if (updates.role) {
      await audit(
        {
          orgId: session.orgId,
          actorId: session.userId,
          actorEmail: session.email,
          action: 'role.changed',
          targetType: 'user',
          targetId: target.id,
          ip,
          diff: { before: { role: target.role }, after: { role: updates.role } },
        },
        tx,
      );
    }
    if (updates.status) {
      await audit(
        {
          orgId: session.orgId,
          actorId: session.userId,
          actorEmail: session.email,
          action:
            updates.status === 'DEACTIVATED' ? 'user.deactivated' : 'user.reactivated',
          targetType: 'user',
          targetId: target.id,
          ip,
          diff: { before: { status: target.status }, after: { status: updates.status } },
        },
        tx,
      );
    }
    return u;
  });

  // Deactivation must immediately terminate the user's access.
  if (updates.status === 'DEACTIVATED') {
    await revokeAllSessions(target.id);
  }

  return NextResponse.json({ id: updated.id, role: updated.role, status: updated.status });
});
