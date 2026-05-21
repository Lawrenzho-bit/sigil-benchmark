import { NextRequest, NextResponse } from "next/server";
import { getSamlClient, issueSamlTicket } from "@/lib/saml";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * SAML Assertion Consumer Service. The IdP POSTs the signed assertion here;
 * we verify it, extract the user's email, and hand off a short-lived bridge
 * ticket to the SSO completion page.
 */
export async function POST(req: NextRequest) {
  const saml = getSamlClient();
  const loginError = NextResponse.redirect(new URL("/login?error=sso", env.NEXT_PUBLIC_APP_URL));
  if (!saml) return loginError;

  try {
    const form = await req.formData();
    const samlResponse = String(form.get("SAMLResponse") ?? "");
    if (!samlResponse) return loginError;

    const { profile } = await saml.validatePostResponseAsync({
      SAMLResponse: samlResponse,
      RelayState: String(form.get("RelayState") ?? ""),
    });

    const email =
      (profile?.email as string | undefined) ??
      (profile?.nameID as string | undefined) ??
      (profile?.["urn:oid:0.9.2342.19200300.100.1.3"] as string | undefined);

    if (!email) {
      console.error("[saml] assertion contained no email/nameID");
      return loginError;
    }

    const ticket = await issueSamlTicket(email.toLowerCase());
    return NextResponse.redirect(
      new URL(`/login/sso?ticket=${encodeURIComponent(ticket)}`, env.NEXT_PUBLIC_APP_URL),
    );
  } catch (err) {
    console.error("[saml] assertion validation failed:", err);
    return loginError;
  }
}
