import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe Auth.js configuration. This file MUST NOT import the database,
 * bcrypt, or any Node-only module — it is loaded by the edge middleware.
 * The actual providers (which touch the DB) live in `src/auth.ts`.
 */
const PROTECTED_PREFIXES = ["/dashboard", "/users", "/billing", "/audit", "/settings"];

export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 60 * 60 * 8 }, // 8h
  trustHost: true,
  providers: [], // populated in src/auth.ts
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = Boolean(auth?.user);
      const isProtected = PROTECTED_PREFIXES.some((p) => nextUrl.pathname.startsWith(p));
      if (isProtected) return isLoggedIn;
      return true;
    },
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id as string;
        token.role = user.role;
        token.orgId = user.orgId;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.uid;
        session.user.role = token.role;
        session.user.orgId = token.orgId;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
