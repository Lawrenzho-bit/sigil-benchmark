import { NextResponse } from 'next/server';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { prisma } from '@/lib/db';
import { handleRoute, Errors } from '@/lib/errors';
import { requireSession } from '@/lib/session';
import { encryptField } from '@/lib/crypto';

/**
 * POST /api/mfa/setup — begins TOTP enrollment. Generates a secret, stores it
 * ENCRYPTED but leaves mfaEnabled=false until the user proves possession via
 * /api/mfa/enable. Returns a QR data-URL for authenticator apps.
 */
export const POST = handleRoute(async () => {
  const session = await requireSession();

  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
  if (user.mfaEnabled) throw Errors.conflict('MFA is already enabled.');

  const secret = authenticator.generateSecret();
  await prisma.user.update({
    where: { id: user.id },
    data: { totpSecret: encryptField(secret) },
  });

  const otpauth = authenticator.keyuri(user.email, 'B2B SaaS Portal', secret);
  const qrDataUrl = await QRCode.toDataURL(otpauth);

  // The raw secret is returned once so the user can enter it manually.
  return NextResponse.json({ secret, qrDataUrl });
});
