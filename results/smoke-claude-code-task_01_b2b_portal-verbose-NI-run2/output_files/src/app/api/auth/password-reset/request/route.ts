import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handleRoute, Errors } from '@/lib/errors';
import { randomToken, sha256 } from '@/lib/crypto';
import { sendPasswordResetEmail } from '@/lib/email';
import { env } from '@/lib/env';
import { clientIp } from '@/lib/http';
import { consume } from '@/lib/rate-limit';

const bodySchema = z.object({
  email: z.string().email().max(254).toLowerCase(),
});

/**
 * Initiates a password reset. ALWAYS returns 200 with the same body regardless
 * of whether the email exists — this prevents account enumeration. The token
 * is single-use, hashed at rest, and expires in 1 hour.
 */
export const POST = handleRoute(async (req) => {
  const ip = clientIp(req);
  const rl = await consume('pwreset', ip, 5, 900);
  if (!rl.allowed) throw Errors.rateLimited();

  const { email } = bodySchema.parse(await req.json());

  const users = await prisma.user.findMany({
    where: { email, status: 'ACTIVE' },
  });

  for (const user of users) {
    const token = randomToken(32);
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    const link = `${env.APP_URL}/reset-password?token=${token}`;
    await sendPasswordResetEmail(user.email, link);
  }

  return NextResponse.json({
    ok: true,
    message: 'If an account exists for that email, a reset link has been sent.',
  });
});
