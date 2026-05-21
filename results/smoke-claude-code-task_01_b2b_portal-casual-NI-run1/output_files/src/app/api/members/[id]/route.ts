import { NextRequest } from 'next/server';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/db';
import { currentMembership, requireMembership } from '@/lib/rbac';
import { updateRoleSchema } from '@/lib/validators';
import { audit } from '@/lib/audit';
import { badRequest, forbidden, json, notFound, unauthorized } from '@/lib/http';
import { clientIp, userAgent } from '@/lib/http';
import { toHttpResponse } from '@/lib/error';

export const runtime = 'nodejs';

type Ctx = { params: { id: string } };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const me = await currentMembership();
    if (!me) return unauthorized();
    const principal = await requireMembership(me.membership.organizationId, {
      requirePermission: 'members.update_role',
    });

    const target = await prisma.membership.findUnique({ where: { id: params.id } });
    if (!target || target.organizationId !== me.membership.organizationId) return notFound();
    if (target.role === Role.OWNER) {
      return forbidden(); // ownership transfer is a separate flow
    }
    if (target.userId === me.userId) {
      return badRequest('You cannot change your own role');
    }

    const body = await req.json().catch(() => null);
    const parsed = updateRoleSchema.safeParse(body);
    if (!parsed.success) return badRequest('Invalid role', parsed.error.flatten());

    const updated = await prisma.membership.update({
      where: { id: params.id },
      data: { role: parsed.data.role },
    });

    await audit({
      category: 'MEMBER',
      action: 'member.role_changed',
      organizationId: principal.membership.organizationId,
      actorUserId: principal.userId,
      ipAddress: clientIp(req),
      userAgent: userAgent(req),
      metadata: { targetUserId: target.userId, from: target.role, to: parsed.data.role },
    });

    return json({ membership: updated });
  } catch (err) {
    return toHttpResponse(err);
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    const me = await currentMembership();
    if (!me) return unauthorized();
    const principal = await requireMembership(me.membership.organizationId, {
      requirePermission: 'members.remove',
    });

    const target = await prisma.membership.findUnique({ where: { id: params.id } });
    if (!target || target.organizationId !== me.membership.organizationId) return notFound();
    if (target.role === Role.OWNER) {
      // Block deletion of the only owner — anywhere in the codebase.
      const ownerCount = await prisma.membership.count({
        where: { organizationId: target.organizationId, role: Role.OWNER },
      });
      if (ownerCount <= 1) return badRequest('Cannot remove the only owner');
    }
    if (target.userId === me.userId) {
      return badRequest('Use the "leave organization" flow to remove yourself');
    }

    await prisma.membership.delete({ where: { id: params.id } });

    await audit({
      category: 'MEMBER',
      action: 'member.removed',
      organizationId: principal.membership.organizationId,
      actorUserId: principal.userId,
      ipAddress: clientIp(req),
      userAgent: userAgent(req),
      metadata: { targetUserId: target.userId, role: target.role },
    });

    return json({ ok: true });
  } catch (err) {
    return toHttpResponse(err);
  }
}
