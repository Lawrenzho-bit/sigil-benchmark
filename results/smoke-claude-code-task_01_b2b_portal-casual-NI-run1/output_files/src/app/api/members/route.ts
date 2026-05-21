import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { currentMembership, requireMembership } from '@/lib/rbac';
import { json, unauthorized } from '@/lib/http';
import { toHttpResponse } from '@/lib/error';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest) {
  try {
    const me = await currentMembership();
    if (!me) return unauthorized();
    await requireMembership(me.membership.organizationId, { requirePermission: 'members.read' });

    const members = await prisma.membership.findMany({
      where: { organizationId: me.membership.organizationId },
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: { select: { id: true, email: true, name: true, lastLoginAt: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return json({ members });
  } catch (err) {
    return toHttpResponse(err);
  }
}
