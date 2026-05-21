/**
 * POST /api/auth/accept-invite
 * Turns a pending Invitation into an active User with a password.
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword, passwordSchema } from "@/lib/password";
import { hashToken } from "@/lib/tokens";
import { createSession } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { ok, error, handle } from "@/lib/http";

const bodySchema = z.object({
  token: z.string().min(1),
  name: z.string().min(1, "Name is required").max(80),
  password: passwordSchema,
});

export function POST(req: NextRequest) {
  return handle(async () => {
    const body = bodySchema.parse(await req.json());

    const invite = await prisma.invitation.findUnique({
      where: { tokenHash: hashToken(body.token) },
    });
    if (!invite) return error("This invitation is invalid.", 404);
    if (invite.acceptedAt) return error("This invitation was already used.", 409);
    if (invite.expiresAt < new Date()) {
      return error("This invitation has expired.", 410);
    }

    const passwordHash = await hashPassword(body.password);

    // Create the user and mark the invite consumed atomically.
    const user = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({
        where: {
          organizationId_email: {
            organizationId: invite.organizationId,
            email: invite.email,
          },
        },
      });

      const created = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: {
              name: body.name,
              passwordHash,
              role: invite.role,
              status: "ACTIVE",
            },
          })
        : await tx.user.create({
            data: {
              organizationId: invite.organizationId,
              email: invite.email,
              name: body.name,
              passwordHash,
              role: invite.role,
              status: "ACTIVE",
              lastLoginAt: new Date(),
            },
          });

      await tx.invitation.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });
      return created;
    });

    await createSession({
      userId: user.id,
      organizationId: user.organizationId,
    });
    await recordAudit({
      organizationId: user.organizationId,
      actorId: user.id,
      actorEmail: user.email,
      action: "user.invite_accepted",
      targetType: "user",
      targetId: user.id,
    });

    return ok({ ok: true, redirectTo: "/dashboard" }, 201);
  });
}
