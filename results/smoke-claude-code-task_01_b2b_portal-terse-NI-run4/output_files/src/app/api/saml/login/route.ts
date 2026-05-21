import { NextResponse } from "next/server";
import { getSamlClient } from "@/lib/saml";

export const dynamic = "force-dynamic";

/** Start the SAML flow: redirect the browser to the identity provider. */
export async function GET() {
  const saml = getSamlClient();
  if (!saml) {
    return NextResponse.redirect(new URL("/login?error=sso", process.env.NEXT_PUBLIC_APP_URL));
  }

  try {
    const url = await saml.getAuthorizeUrlAsync("", undefined as never, {});
    return NextResponse.redirect(url);
  } catch (err) {
    console.error("[saml] failed to build authorize URL:", err);
    return NextResponse.redirect(new URL("/login?error=sso", process.env.NEXT_PUBLIC_APP_URL));
  }
}
