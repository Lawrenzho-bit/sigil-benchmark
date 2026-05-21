import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handleRoute, Errors } from '@/lib/errors';
import { authorize } from '@/lib/authz';
import { canAssignRole } from '@/lib/rbac';
import { audit } from '@/lib/audit';
import { randomToken, sha256 } from '@/lib/crypto';
import { sendInvitationEmail } from '@/lib/email';
import { PLANS } from '@/lib/stripe';
import { env } from '@/lib/env';
import { clientIp } from '@/lib/http';

/** GET /api/users — list users in the caller's organization. */
export const GET = handleRoute(async () => {
  const session = await authorize('users.view');
  const users = await prisma.user.findMany({
    where: { orgId: session.orgId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      mfaEnabled: true,
      lastLoginAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  return NextResponse.json({ users });
});

const inviteSchema = z.object({
  email: z.string().email().max(254).toLowerCase(),
  role: z.enum(['ADMIN', 'VIEWER', 'OWNER']),
});

/**
 * POST /api/users — invite a user by email. Creates a signed, hashed invite
 * token (7-day expiry) and enforces the plan's user limit.
 */
export const POST = handleRoute(async (req) => {
  const session = await authorize('users.invite');
  const body = inviteSchema.parse(await req.json());

  if (!canAssignRole(session.role, body.role)) {
    throw Errors.forbidden('You cannot assign a role higher than your own.');
  }

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: session.orgId },
  });

  // Enforce the plan seat limit (active users + outstanding invitations).
  const limit = PLANS[org.plan].userLimit;
  if (limit !== null) {
    const [activeUsers, pendingInvites] = await Promise.all([
      prisma.user.count({ where: { orgId: org.id, status: 'ACTIVE' } }),
      prisma.invitation.count({
        where: { orgId: org.id, acceptedAt: null, expiresAt: { gt: new Date() } },
      }),
    ]);
    if (activeUsers + pendingInvites >= limit) {
      throw Errors.conflict(
        `Your ${PLANS[org.plan].label} plan allows up to ${limit} users. Upgrade to invite more.`,
      );
    }
  }

  const existing = await prisma.user.findUnique({
    where: { orgId_email: { orgId: org.id, email: body.email } },
  });
  if (existing) throw Errors.conflict('That user is already in your organization.');

  const token = randomToken(32);
  const invitation = await prisma.$transaction(async (tx) => {
    const inv = await tx.invitation.create({
      data: {
        orgId: org.id,
        email: body.email,
        role: body.role,
        tokenHash: sha256(token),
        invitedById: session.userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    });
    await audit(
      {
        orgId: org.id,
        actorId: session.userId,
        actorEmail: session.email,
        action: 'user.invited',
        targetType: 'invitation',
        targetId: inv.id,
        ip: clientIp(req),
        metadata: { email: body.email, role: body.role },
      },
      tx,
    );
    return inv;
  });

  await sendInvitationEmail(
    body.email,
    org.name,
    `${env.APP_URL}/accept-invite?token=${token}`,
  );

  return NextResponse.json({ id: invitation.id, email: body.email }, { status: 201 });
});
