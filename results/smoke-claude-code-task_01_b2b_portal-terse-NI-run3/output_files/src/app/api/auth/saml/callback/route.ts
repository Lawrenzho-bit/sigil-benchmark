/**
 * POST /api/auth/saml/callback
 * The Identity Provider POSTs a signed SAML assertion here.
 *
 * SSO signs in an existing user whose organization has SSO enabled. Accounts
 * are not auto-created from an assertion — a user must first be invited, which
 * keeps org membership an explicit, auditable decision.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSaml, ssoConfigured, profileToIdentity } from "@/lib/saml";
import { createSession } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

function fail(reason: string) {
  return NextResponse.redirect(`${env.APP_URL}/login?error=${reason}`);
}

export async function POST(req: NextRequest) {
  if (!ssoConfigured) return fail("sso_unavailable");

  try {
    const form = await req.formData();
    const samlResponse = form.get("SAMLResponse");
    if (typeof samlResponse !== "string") return fail("sso_failed");

    const { profile } = await getSaml().validatePostResponseAsync({
      SAMLResponse: samlResponse,
    });
    const identity = profileToIdentity(profile as Record<string, unknown> | null);
    if (!identity) return fail("sso_no_email");

    // Match an SSO-enabled org membership for this email.
    const user = await prisma.user.findFirst({
      where: {
        email: identity.email,
        status: { not: "DEACTIVATED" },
        organization: { ssoEnabled: true },
      },
      include: { organization: true },
    });
    if (!user) return fail("sso_no_account");

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), name: user.name || identity.name },
    });
    await createSession({
      userId: user.id,
      organizationId: user.organizationId,
    });
    await recordAudit({
      organizationId: user.organizationId,
      actorId: user.id,
      actorEmail: user.email,
      action: "auth.login_sso",
    });

    return NextResponse.redirect(`${env.APP_URL}/dashboard`);
  } catch (err) {
    logger.error("saml callback failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return fail("sso_failed");
  }
}
