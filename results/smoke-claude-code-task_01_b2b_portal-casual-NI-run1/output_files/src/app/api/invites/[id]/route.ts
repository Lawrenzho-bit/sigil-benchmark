import { NextRequest } from 'next/server';
import { InviteStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { currentMembership, requireMembership } from '@/lib/rbac';
import { audit } from '@/lib/audit';
import { clientIp, json, notFound, unauthorized, userAgent } from '@/lib/http';
import { toHttpResponse } from '@/lib/error';

export const runtime = 'nodejs';

type Ctx = { params: { id: string } };

export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    const me = await currentMembership();
    if (!me) return unauthorized();
    const principal = await requireMembership(me.membership.organizationId, {
      requirePermission: 'members.invite',
    });

    const invite = await prisma.invitation.findUnique({ where: { id: params.id } });
    if (!invite || invite.organizationId !== principal.membership.organizationId) {
      return notFound();
    }

    await prisma.invitation.update({
      where: { id: invite.id },
      data: { status: InviteStatus.REVOKED },
    });

    await audit({
      category: 'MEMBER',
      action: 'invite.revoked',
      organizationId: principal.membership.organizationId,
      actorUserId: principal.userId,
      ipAddress: clientIp(req),
      userAgent: userAgent(req),
      metadata: { inviteId: invite.id, email: invite.email },
    });

    return json({ ok: true });
  } catch (err) {
    return toHttpResponse(err);
  }
}
