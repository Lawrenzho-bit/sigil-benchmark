/**
 * GET /api/auth/saml/login
 * SP-initiated SSO: redirects the browser to the Identity Provider.
 */
import { NextResponse } from "next/server";
import { getSaml, ssoConfigured } from "@/lib/saml";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!ssoConfigured) {
    return NextResponse.redirect(`${env.APP_URL}/login?error=sso_unavailable`);
  }
  try {
    const url = await getSaml().getAuthorizeUrlAsync("", "", {});
    return NextResponse.redirect(url);
  } catch (err) {
    logger.error("saml authorize failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.redirect(`${env.APP_URL}/login?error=sso_failed`);
  }
}
