import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handleRoute, Errors } from '@/lib/errors';
import { passwordSchema, hashPassword, isBreached } from '@/lib/password';
import { sha256 } from '@/lib/crypto';
import { revokeAllSessions } from '@/lib/session';
import { audit } from '@/lib/audit';
import { clientIp } from '@/lib/http';

const bodySchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

/**
 * Completes a password reset. Validates the single-use token, sets the new
 * argon2 hash, and revokes ALL existing sessions so a stolen session cannot
 * outlive the reset.
 */
export const POST = handleRoute(async (req) => {
  const body = bodySchema.parse(await req.json());

  if (await isBreached(body.password)) {
    throw Errors.badRequest(
      'This password has appeared in a known data breach. Choose another.',
    );
  }

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: sha256(body.token) },
    include: { user: true },
  });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw Errors.badRequest('This reset link is invalid or has expired.');
  }

  const passwordHash = await hashPassword(body.password);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: record.userId },
      data: { passwordHash },
    });
    await tx.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });
    await audit(
      {
        orgId: record.user.orgId,
        actorId: record.userId,
        actorEmail: record.user.email,
        action: 'auth.password_reset',
        targetType: 'user',
        targetId: record.userId,
        ip: clientIp(req),
      },
      tx,
    );
  });

  await revokeAllSessions(record.userId);

  return NextResponse.json({ ok: true });
});
