import { NextRequest } from 'next/server';
import { InviteStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { currentMembership, requireMembership } from '@/lib/rbac';
import { inviteSchema } from '@/lib/validators';
import { audit } from '@/lib/audit';
import { sendInvite } from '@/lib/email';
import { generateToken, sha256Hex } from '@/lib/crypto';
import { inviteLimiter, check } from '@/lib/rate-limit';
import { badRequest, clientIp, json, tooMany, unauthorized, userAgent } from '@/lib/http';
import { toHttpResponse } from '@/lib/error';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const me = await currentMembership();
    if (!me) return unauthorized();
    await requireMembership(me.membership.organizationId, { requirePermission: 'members.read' });

    const invites = await prisma.invitation.findMany({
      where: {
        organizationId: me.membership.organizationId,
        status: InviteStatus.PENDING,
      },
      select: {
        id: true, email: true, role: true, expiresAt: true, createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return json({ invites });
  } catch (err) {
    return toHttpResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const me = await currentMembership();
    if (!me) return unauthorized();
    const principal = await requireMembership(me.membership.organizationId, {
      requirePermission: 'members.invite',
    });

    const limit = await check(inviteLimiter, principal.membership.organizationId);
    if (!limit.success) return tooMany(limit.reset);

    const body = await req.json().catch(() => null);
    const parsed = inviteSchema.safeParse(body);
    if (!parsed.success) return badRequest('Invalid invite', parsed.error.flatten());

    // Already a member?
    const existingMember = await prisma.user.findUnique({
      where: { email: parsed.data.email },
      select: {
        id: true,
        memberships: { where: { organizationId: me.membership.organizationId }, select: { id: true } },
      },
    });
    if (existingMember?.memberships.length) {
      return badRequest('User is already a member of this organization');
    }

    const rawToken = generateToken(32);
    const tokenHash = sha256Hex(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const invite = await prisma.invitation.create({
      data: {
        organizationId: principal.membership.organizationId,
        email: parsed.data.email,
        role: parsed.data.role,
        tokenHash,
        expiresAt,
        invitedById: principal.userId,
      },
    });

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: principal.membership.organizationId },
      select: { name: true },
    });
    const actor = await prisma.user.findUniqueOrThrow({
      where: { id: principal.userId },
      select: { name: true, email: true },
    });

    const acceptUrl = `${env.APP_URL}/invite/accept?token=${rawToken}`;

    await sendInvite({
      to: parsed.data.email,
      orgName: org.name,
      inviterName: actor.name ?? actor.email,
      acceptUrl,
    });

    await audit({
      category: 'MEMBER',
      action: 'member.invited',
      organizationId: principal.membership.organizationId,
      actorUserId: principal.userId,
      ipAddress: clientIp(req),
      userAgent: userAgent(req),
      metadata: { invitedEmail: parsed.data.email, role: parsed.data.role },
    });

    return json({
      invite: {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt,
      },
    });
  } catch (err) {
    return toHttpResponse(err);
  }
}
