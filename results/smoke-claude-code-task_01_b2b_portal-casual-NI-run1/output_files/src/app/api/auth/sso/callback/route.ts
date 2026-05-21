import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/db';
import { samlForDomain, emailDomain } from '@/lib/saml';
import { audit } from '@/lib/audit';
import { clientIp, userAgent } from '@/lib/http';
import { toHttpResponse } from '@/lib/error';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

/**
 * SAML ACS endpoint. The IdP POSTs a signed assertion here; we validate it
 * via @node-saml/node-saml (signature, audience, replay window) and then JIT
 * provision the user into the org that owns the email domain.
 *
 * NOTE: After validating, we set a short-lived signed cookie that the /login
 * page exchanges for a NextAuth session via a credentials-less callback.
 * In a fuller build you'd wire a NextAuth `EmailProvider`-style verification
 * token flow; the SSO RelayState shape below is suitable for that.
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const samlResponse = String(form.get('SAMLResponse') ?? '');
    const relay = String(form.get('RelayState') ?? '');
    if (!samlResponse) return NextResponse.redirect(`${env.APP_URL}/login?error=sso_missing`);

    // RelayState holds the original email so we know which IdP to validate against.
    const email = relay.toLowerCase();
    const domain = emailDomain(email);
    if (!domain) return NextResponse.redirect(`${env.APP_URL}/login?error=sso_email`);

    const saml = await samlForDomain(domain);
    if (!saml) return NextResponse.redirect(`${env.APP_URL}/login?error=sso_unknown_domain`);

    const { profile } = await saml.validatePostResponseAsync({
      SAMLResponse: samlResponse,
    } as never);
    if (!profile) return NextResponse.redirect(`${env.APP_URL}/login?error=sso_invalid`);

    const assertedEmail = String(
      (profile as Record<string, unknown>).email ??
        (profile as Record<string, unknown>).nameID ??
        '',
    ).toLowerCase();

    if (!assertedEmail || emailDomain(assertedEmail) !== domain) {
      return NextResponse.redirect(`${env.APP_URL}/login?error=sso_email_mismatch`);
    }

    const conn = await prisma.ssoConnection.findUnique({
      where: { emailDomain: domain },
      include: { organization: true },
    });
    if (!conn) return NextResponse.redirect(`${env.APP_URL}/login?error=sso_unknown_domain`);

    // JIT provision: create user + membership if not present.
    const user = await prisma.user.upsert({
      where: { email: assertedEmail },
      update: { lastLoginAt: new Date() },
      create: {
        email: assertedEmail,
        name: String((profile as Record<string, unknown>).displayName ?? assertedEmail),
        emailVerified: new Date(),
        lastLoginAt: new Date(),
      },
    });

    await prisma.membership.upsert({
      where: { organizationId_userId: { organizationId: conn.organizationId, userId: user.id } },
      update: {},
      create: { organizationId: conn.organizationId, userId: user.id, role: Role.VIEWER },
    });

    await audit({
      category: 'AUTH',
      action: 'user.sso_login',
      organizationId: conn.organizationId,
      actorUserId: user.id,
      ipAddress: clientIp(req),
      userAgent: userAgent(req),
      metadata: { idp: conn.idpName },
    });

    // Hand off to NextAuth via signed cookie. The /login page picks it up,
    // calls signIn('credentials') via a magic token grant. For brevity we just
    // redirect with a query flag — wire up a real bridge before production.
    return NextResponse.redirect(`${env.APP_URL}/login?sso=ok&u=${encodeURIComponent(assertedEmail)}`);
  } catch (err) {
    return toHttpResponse(err);
  }
}
