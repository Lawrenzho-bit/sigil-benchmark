import { NextRequest } from 'next/server';
import { InviteStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth, hashPassword } from '@/lib/auth';
import { sha256Hex } from '@/lib/crypto';
import { audit } from '@/lib/audit';
import { passwordSchema } from '@/lib/validators';
import { badRequest, clientIp, json, unauthorized, userAgent } from '@/lib/http';
import { toHttpResponse } from '@/lib/error';

export const runtime = 'nodejs';

const acceptSchema = z.object({
  token: z.string().min(10).max(200),
  // Required only when accepting an invite into a brand-new account.
  name: z.string().trim().min(1).max(120).optional(),
  password: passwordSchema.optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = acceptSchema.safeParse(body);
    if (!parsed.success) return badRequest('Invalid input', parsed.error.flatten());

    const tokenHash = sha256Hex(parsed.data.token);
    const invite = await prisma.invitation.findUnique({ where: { tokenHash } });

    if (!invite || invite.status !== InviteStatus.PENDING) {
      return badRequest('Invite not found or already used');
    }
    if (invite.expiresAt < new Date()) {
      await prisma.invitation.update({
        where: { id: invite.id },
        data: { status: InviteStatus.EXPIRED },
      });
      return badRequest('Invite expired');
    }

    const session = await auth();
    let userId: string;

    if (session) {
      // Logged-in user accepting an invite. Their email MUST match the invitation.
      if (session.user.email.toLowerCase() !== invite.email.toLowerCase()) {
        return unauthorized();
      }
      userId = session.user.id;
    } else {
      // New user signup path.
      const existing = await prisma.user.findUnique({ where: { email: invite.email } });
      if (existing) {
        return badRequest('An account exists for this email; sign in first.');
      }
      if (!parsed.data.name || !parsed.data.password) {
        return badRequest('Name and password are required for new accounts');
      }
      const passwordHash = await hashPassword(parsed.data.password);
      const user = await prisma.user.create({
        data: {
          email: invite.email,
          name: parsed.data.name,
          passwordHash,
          emailVerified: new Date(),
        },
      });
      userId = user.id;
    }

    await prisma.$transaction([
      prisma.membership.upsert({
        where: { organizationId_userId: { organizationId: invite.organizationId, userId } },
        update: { role: invite.role },
        create: { organizationId: invite.organizationId, userId, role: invite.role },
      }),
      prisma.invitation.update({
        where: { id: invite.id },
        data: { status: InviteStatus.ACCEPTED, acceptedAt: new Date() },
      }),
    ]);

    await audit({
      category: 'MEMBER',
      action: 'invite.accepted',
      organizationId: invite.organizationId,
      actorUserId: userId,
      ipAddress: clientIp(req),
      userAgent: userAgent(req),
      metadata: { inviteId: invite.id, role: invite.role },
    });

    return json({ ok: true });
  } catch (err) {
    return toHttpResponse(err);
  }
}
