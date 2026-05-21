import { NextRequest } from 'next/server';
import { Role, BillingPlan, SubscriptionStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { signupSchema } from '@/lib/validators';
import { signupLimiter, check } from '@/lib/rate-limit';
import { badRequest, json, tooMany } from '@/lib/http';
import { clientIp, userAgent } from '@/lib/http';
import { toHttpResponse } from '@/lib/error';
import { slugify } from '@/lib/utils';
import { sendWelcome } from '@/lib/email';
import { emailDomain } from '@/lib/saml';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);
    const limit = await check(signupLimiter, ip);
    if (!limit.success) return tooMany(limit.reset);

    const body = await req.json().catch(() => null);
    const parsed = signupSchema.safeParse(body);
    if (!parsed.success) return badRequest('Invalid input', parsed.error.flatten());

    const { email, password, name, orgName } = parsed.data;

    // Refuse password signup if SSO is enforced for this email's domain.
    const domain = emailDomain(email);
    if (domain) {
      const sso = await prisma.ssoConnection.findUnique({ where: { emailDomain: domain } });
      if (sso?.enforced) {
        return badRequest('Your organization requires SSO sign-in.');
      }
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      // Always return 200 to avoid user enumeration. If they actually have an
      // account, the welcome email won't be re-sent.
      return json({ ok: true });
    }

    const passwordHash = await hashPassword(password);

    // Slug collisions get a numeric suffix.
    let slug = slugify(orgName);
    let n = 0;
    while (await prisma.organization.findUnique({ where: { slug } })) {
      n += 1;
      slug = `${slugify(orgName)}-${n}`;
      if (n > 50) return badRequest('Could not allocate org slug; pick a different name.');
    }

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, name, passwordHash, emailVerified: new Date() },
      });
      const org = await tx.organization.create({
        data: {
          name: orgName,
          slug,
          plan: BillingPlan.STARTER,
          subscriptionStatus: SubscriptionStatus.TRIALING,
          trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          memberships: { create: { userId: user.id, role: Role.OWNER } },
        },
      });
      return { user, org };
    });

    await audit({
      category: 'AUTH',
      action: 'user.signup',
      organizationId: result.org.id,
      actorUserId: result.user.id,
      ipAddress: ip,
      userAgent: userAgent(req),
      metadata: { method: 'password' },
    });

    // Fire-and-forget; don't block signup on email delivery.
    sendWelcome(email, name).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[signup] welcome email failed', err);
    });

    return json({ ok: true });
  } catch (err) {
    return toHttpResponse(err);
  }
}
