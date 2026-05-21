/**
 * POST /api/auth/login
 * Email + password authentication.
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { createSession } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { ok, error, handle } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";

const bodySchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export function POST(req: NextRequest) {
  return handle(async () => {
    const ip = req.headers.get("x-forwarded-for") ?? "unknown";
    const body = bodySchema.parse(await req.json());
    const email = body.email.toLowerCase();

    // Throttle by IP *and* by account to slow targeted brute force.
    const limited =
      !rateLimit(`login:ip:${ip}`, 10, 60_000).allowed ||
      !rateLimit(`login:acct:${email}`, 5, 60_000).allowed;
    if (limited) {
      return error("Too many attempts. Try again in a minute.", 429);
    }

    // A user's email is unique per-org, so there may be several rows; only
    // password-based accounts are eligible here.
    const candidates = await prisma.user.findMany({ where: { email } });

    let matched = null;
    for (const u of candidates) {
      if (u.passwordHash && (await verifyPassword(body.password, u.passwordHash))) {
        matched = u;
        break;
      }
    }

    // Uniform error — never reveal whether the email exists.
    if (!matched) return error("Invalid email or password.", 401);
    if (matched.status === "DEACTIVATED") {
      return error("This account has been deactivated.", 403);
    }

    await prisma.user.update({
      where: { id: matched.id },
      data: { lastLoginAt: new Date(), status: "ACTIVE" },
    });
    await createSession({
      userId: matched.id,
      organizationId: matched.organizationId,
    });
    await recordAudit({
      organizationId: matched.organizationId,
      actorId: matched.id,
      actorEmail: matched.email,
      action: "auth.login",
    });

    return ok({ ok: true, redirectTo: "/dashboard" });
  });
}
