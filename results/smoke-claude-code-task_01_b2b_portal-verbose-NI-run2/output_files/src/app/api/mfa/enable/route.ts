import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticator } from 'otplib';
import { prisma } from '@/lib/db';
import { handleRoute, Errors } from '@/lib/errors';
import { requireSession } from '@/lib/session';
import { decryptField } from '@/lib/crypto';
import { audit } from '@/lib/audit';
import { clientIp } from '@/lib/http';

const bodySchema = z.object({ totp: z.string().regex(/^\d{6}$/) });

/**
 * POST /api/mfa/enable — completes TOTP enrollment by verifying a code against
 * the secret stored during /api/mfa/setup.
 */
export const POST = handleRoute(async (req) => {
  const session = await requireSession();
  const { totp } = bodySchema.parse(await req.json());

  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
  if (user.mfaEnabled) throw Errors.conflict('MFA is already enabled.');
  if (!user.totpSecret) throw Errors.badRequest('Start MFA setup first.');

  if (!authenticator.check(totp, decryptField(user.totpSecret))) {
    throw Errors.badRequest('Invalid code. Try again.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
    await audit(
      {
        orgId: session.orgId,
        actorId: user.id,
        actorEmail: user.email,
        action: 'mfa.enabled',
        targetType: 'user',
        targetId: user.id,
        ip: clientIp(req),
      },
      tx,
    );
  });

  return NextResponse.json({ ok: true });
});
