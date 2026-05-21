/**
 * POST /api/auth/signup
 * Creates a new organization and its first user (the OWNER).
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword, passwordSchema } from "@/lib/password";
import { createSession } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { sendWelcomeEmail } from "@/lib/email";
import { ok, error, handle } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";

const bodySchema = z.object({
  orgName: z.string().min(2, "Organization name is too short").max(80),
  name: z.string().min(1, "Name is required").max(80),
  email: z.string().email("Enter a valid email"),
  password: passwordSchema,
});

/** "Acme Inc." -> "acme-inc"; collisions get a numeric suffix. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

async function uniqueSlug(base: string): Promise<string> {
  const root = base.length > 0 ? base : "org";
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i}`;
    const exists = await prisma.organization.findUnique({
      where: { slug: candidate },
    });
    if (!exists) return candidate;
  }
  return `${root}-${Date.now()}`;
}

export function POST(req: NextRequest) {
  return handle(async () => {
    const ip = req.headers.get("x-forwarded-for") ?? "unknown";
    if (!rateLimit(`signup:${ip}`, 5, 60_000).allowed) {
      return error("Too many signups, please wait a minute.", 429);
    }

    const body = bodySchema.parse(await req.json());
    const email = body.email.toLowerCase();

    const passwordHash = await hashPassword(body.password);
    const slug = await uniqueSlug(slugify(body.orgName));

    // Org + owner are created together so we never have an org with no owner.
    const user = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { name: body.orgName, slug },
      });
      return tx.user.create({
        data: {
          organizationId: org.id,
          email,
          name: body.name,
          passwordHash,
          role: "OWNER",
          status: "ACTIVE",
          lastLoginAt: new Date(),
        },
      });
    });

    await createSession({ userId: user.id, organizationId: user.organizationId });
    await recordAudit({
      organizationId: user.organizationId,
      actorId: user.id,
      actorEmail: user.email,
      action: "auth.signup",
      targetType: "organization",
      targetId: user.organizationId,
    });
    await sendWelcomeEmail(user.email, user.name);

    return ok({ ok: true, redirectTo: "/dashboard" }, 201);
  });
}
