import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { authConfig } from "@/auth.config";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { verifySamlTicket } from "@/lib/saml";
import { recordAudit } from "@/lib/audit";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/** Shared post-authentication bookkeeping. */
async function onLogin(
  userId: string,
  orgId: string,
  email: string,
  method: "password" | "saml",
) {
  await prisma.user.update({
    where: { id: userId },
    data: { lastLoginAt: new Date() },
  });
  await recordAudit({
    orgId,
    actorId: userId,
    actorEmail: email,
    action: "auth.login",
    targetType: "user",
    targetId: userId,
    metadata: { method },
  });
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    // --- Email + password -------------------------------------------------
    Credentials({
      id: "credentials",
      name: "Email and password",
      credentials: { email: {}, password: {} },
      authorize: async (raw) => {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email.toLowerCase() },
          include: { organization: { select: { requireSsoOnly: true } } },
        });
        if (!user || !user.passwordHash || !user.active) return null;
        if (user.organization.requireSsoOnly) return null; // org enforces SSO

        const ok = await verifyPassword(parsed.data.password, user.passwordHash);
        if (!ok) return null;

        await onLogin(user.id, user.orgId, user.email, "password");
        return { id: user.id, email: user.email, name: user.name, role: user.role, orgId: user.orgId };
      },
    }),

    // --- SAML SSO bridge --------------------------------------------------
    // The SAML ACS endpoint verifies the IdP assertion, then mints a short-
    // lived signed ticket. This provider only trusts that ticket.
    Credentials({
      id: "saml",
      name: "SSO",
      credentials: { ticket: {} },
      authorize: async (raw) => {
        const ticket = typeof raw?.ticket === "string" ? raw.ticket : null;
        if (!ticket) return null;

        const claims = await verifySamlTicket(ticket);
        if (!claims) return null;

        const user = await prisma.user.findUnique({
          where: { email: claims.email.toLowerCase() },
        });
        if (!user || !user.active) return null;

        await onLogin(user.id, user.orgId, user.email, "saml");
        return { id: user.id, email: user.email, name: user.name, role: user.role, orgId: user.orgId };
      },
    }),
  ],
});
