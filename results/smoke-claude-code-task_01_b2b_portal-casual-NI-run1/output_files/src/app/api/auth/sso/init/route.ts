import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { samlForDomain, emailDomain } from '@/lib/saml';
import { badRequest } from '@/lib/http';
import { toHttpResponse } from '@/lib/error';

export const runtime = 'nodejs';

const querySchema = z.object({
  email: z.string().email().max(320),
});

/**
 * Begin SAML SSO. Caller supplies their email; we route them to the IdP for
 * their domain. The IdP POSTs the assertion back to /api/auth/sso/callback.
 */
export async function GET(req: NextRequest) {
  try {
    const parsed = querySchema.safeParse({
      email: req.nextUrl.searchParams.get('email') ?? '',
    });
    if (!parsed.success) return badRequest('Invalid email');

    const domain = emailDomain(parsed.data.email);
    if (!domain) return badRequest('Invalid email');

    const saml = await samlForDomain(domain);
    if (!saml) return badRequest('No SSO configured for this email domain');

    const url = await saml.getAuthorizeUrlAsync(
      parsed.data.email,
      undefined,
      {},
    );
    return NextResponse.redirect(url);
  } catch (err) {
    return toHttpResponse(err);
  }
}
