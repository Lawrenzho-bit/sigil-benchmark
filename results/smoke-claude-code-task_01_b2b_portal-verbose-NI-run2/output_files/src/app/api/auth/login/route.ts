import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticator } from 'otplib';
import { prisma } from '@/lib/db';
import { handleRoute, Errors } from '@/lib/errors';
import { verifyPassword } from '@/lib/password';
import { createSession } from '@/lib/session';
import { audit } from '@/lib/audit';
import { decryptField } from '@/lib/crypto';
import { clientIp, userAgent } from '@/lib/http';
import { consume } from '@/lib/rate-limit';

const bodySchema = z.object({
  email: z.string().email().max(254).toLowerCase(),
  password: z.string().min(1).max(128),
  // Required only when the account has MFA enabled.
  totp: z.string().regex(/^\d{6}$/).optional(),
  // Disambiguates when the same email exists in multiple organizations.
  orgId: z.string().optional(),
});

/**
 * Email/password login with optional TOTP second factor.
 * Rate limited to 5 attempts / 15 min per IP, per the security spec.
 */
export const POST = handleRoute(async (req) => {
  const ip = clientIp(req);

  const rl = await consume('login', ip, 5, 900);
  if (!rl.allowed) {
    const res = NextResponse.json(
      { error: 'rate_limited', message: 'Too many attempts. Try again later.' },
      { status: 429 },
    );
    res.headers.set('Retry-After', String(rl.retryAfterSeconds));
    return res;
  }

  const body = bodySchema.parse(await req.json());

  const candidates = await prisma.user.findMany({
    where: { email: body.email, ...(body.orgId ? { orgId: body.orgId } : {}) },
  });

  if (candidates.length > 1) {
    return NextResponse.json(
      {
        error: 'org_required',
        message: 'Multiple organizations found for this email. Specify orgId.',
        organizations: candidates.map((c) => c.orgId),
      },
      { status: 409 },
    );
  }

  const user = candidates[0];

  // Generic failure for every credential problem — never reveal which part
  // (email vs password vs status) was wrong.
  const invalid = Errors.unauthorized('Invalid email or password');

  if (!user || !user.passwordHash || user.status === 'DEACTIVATED') {
    throw invalid;
  }

  const ok = await verifyPassword(user.passwordHash, body.password);
  if (!ok) throw invalid;

  // Second factor.
  if (user.mfaEnabled) {
    if (!body.totp) {
      return NextResponse.json(
        { error: 'mfa_required', message: 'A 6-digit MFA code is required.' },
        { status: 401 },
      );
    }
    const secret = user.totpSecret ? decryptField(user.totpSecret) : '';
    if (!secret || !authenticator.check(body.totp, secret)) {
      throw Errors.unauthorized('Invalid MFA code');
    }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });
  await createSession(user.id, ip, userAgent(req));
  await audit({
    orgId: user.orgId,
    actorId: user.id,
    actorEmail: user.email,
    action: 'auth.login',
    targetType: 'user',
    targetId: user.id,
    ip,
  });

  return NextResponse.json({ id: user.id, email: user.email, role: user.role });
});
