import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// Edge middleware uses only the DB-free config. Route protection is driven
// by the `authorized` callback in auth.config.ts.
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  // Run on everything except Next internals, static assets, and webhooks
  // (Stripe/SAML endpoints authenticate via their own signature checks).
  matcher: ["/((?!api/stripe|api/saml|api/auth|api/health|_next/static|_next/image|favicon.ico).*)"],
};
