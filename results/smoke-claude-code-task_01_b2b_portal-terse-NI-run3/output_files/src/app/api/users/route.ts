/**
 * GET  /api/users  — list members + pending invitations (any signed-in user).
 * POST /api/users  — invite a teammate (ADMIN+). Seat limit enforced per plan.
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { generateToken, hashToken } from "@/lib/tokens";
import { recordAudit } from "@/lib/audit";
import { sendInviteEmail } from "@/lib/email";
import { seatLimit } from "@/lib/plans";
import { env } from "@/lib/env";
import { ok, error, handle } from "@/lib/http";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const inviteSchema = z.object({
  email: z.string().email("Enter a valid email"),
  role: z.enum(["ADMIN", "VIEWER"]), // owners are not invited; they're promoted
});

export function GET() {
  return handle(async () => {
    const ctx = await getCurrentUser();
    if (!ctx) return error("Unauthorized", 401);

    const [users, invitations] = await Promise.all([
      prisma.user.findMany({
        where: { organizationId: ctx.organization.id },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          status: true,
          lastLoginAt: true,
          createdAt: true,
        },
      }),
      prisma.invitation.findMany({
        where: { organizationId: ctx.organization.id, acceptedAt: null },
        orderBy: { createdAt: "desc" },
        select: { id: true, email: true, role: true, expiresAt: true },
      }),
    ]);

    return ok({ users, invitations });
  });
}

export function POST(req: NextRequest) {
  return handle(async () => {
    const ctx = await getCurrentUser();
    if (!ctx) return error("Unauthorized", 401);
    assertCan(ctx.user.role, "users:invite");

    const { email, role } = inviteSchema.parse(await req.json());
    const normalized = email.toLowerCase();

    // Reject if already a member.
    const existing = await prisma.user.findUnique({
      where: {
        organizationId_email: {
          organizationId: ctx.organization.id,
          email: normalized,
        },
      },
    });
    if (existing && existing.status !== "DEACTIVATED") {
      return error("That person is already a member.", 409);
    }

    // Seat-limit check: active members + outstanding invites must stay under cap.
    const limit = seatLimit(ctx.organization.plan);
    if (limit !== Infinity) {
      const [activeCount, pendingCount] = await Promise.all([
        prisma.user.count({
          where: {
            organizationId: ctx.organization.id,
            status: { not: "DEACTIVATED" },
          },
        }),
        prisma.invitation.count({
          where: { organizationId: ctx.organization.id, acceptedAt: null },
        }),
      ]);
      if (activeCount + pendingCount >= limit) {
        return error(
          `Your ${ctx.organization.plan} plan is limited to ${limit} seats. Upgrade to invite more.`,
          402,
        );
      }
    }

    // Replace any earlier pending invite for this email.
    await prisma.invitation.deleteMany({
      where: {
        organizationId: ctx.organization.id,
        email: normalized,
        acceptedAt: null,
      },
    });

    const rawToken = generateToken();
    const invite = await prisma.invitation.create({
      data: {
        organizationId: ctx.organization.id,
        email: normalized,
        role,
        tokenHash: hashToken(rawToken),
        invitedById: ctx.user.id,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });

    await recordAudit({
      organizationId: ctx.organization.id,
      actorId: ctx.user.id,
      actorEmail: ctx.user.email,
      action: "user.invited",
      targetType: "invitation",
      targetId: invite.id,
      metadata: { email: normalized, role },
    });
    await sendInviteEmail(
      normalized,
      ctx.organization.name,
      ctx.user.name,
      `${env.APP_URL}/invite/${rawToken}`,
    );

    return ok({ ok: true, invitation: { id: invite.id, email: normalized, role } }, 201);
  });
}
