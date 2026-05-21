/**
 * PATCH  /api/users/:id  — change role, deactivate or reactivate a member.
 * DELETE /api/users/:id  — revoke a pending invitation (id = invitation id).
 *
 * Guard rails:
 *   - Only ADMIN+ may mutate members.
 *   - You cannot change your own role or deactivate yourself.
 *   - The last active OWNER can never be demoted or deactivated.
 *   - An ADMIN cannot act on an OWNER (only an OWNER can).
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { assertCan, outranks } from "@/lib/rbac";
import { recordAudit } from "@/lib/audit";
import { ok, error, handle } from "@/lib/http";

const patchSchema = z.union([
  z.object({ role: z.enum(["OWNER", "ADMIN", "VIEWER"]) }),
  z.object({ status: z.enum(["ACTIVE", "DEACTIVATED"]) }),
]);

async function lastOwnerWouldBeLost(
  orgId: string,
  targetUserId: string,
): Promise<boolean> {
  const owners = await prisma.user.findMany({
    where: { organizationId: orgId, role: "OWNER", status: "ACTIVE" },
    select: { id: true },
  });
  return owners.length === 1 && owners[0]!.id === targetUserId;
}

export function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  return handle(async () => {
    const ctx = await getCurrentUser();
    if (!ctx) return error("Unauthorized", 401);

    const target = await prisma.user.findUnique({ where: { id: params.id } });
    if (!target || target.organizationId !== ctx.organization.id) {
      return error("User not found.", 404);
    }
    if (target.id === ctx.user.id) {
      return error("You cannot change your own membership.", 403);
    }
    // Admins may not act on owners.
    if (target.role === "OWNER" && ctx.user.role !== "OWNER") {
      return error("Only an owner can modify another owner.", 403);
    }

    const body = patchSchema.parse(await req.json());

    if ("role" in body) {
      assertCan(ctx.user.role, "users:change_role");
      // Only an owner can grant the OWNER role.
      if (body.role === "OWNER" && ctx.user.role !== "OWNER") {
        return error("Only an owner can promote someone to owner.", 403);
      }
      if (
        target.role === "OWNER" &&
        body.role !== "OWNER" &&
        (await lastOwnerWouldBeLost(ctx.organization.id, target.id))
      ) {
        return error("The organization must keep at least one owner.", 409);
      }
      const updated = await prisma.user.update({
        where: { id: target.id },
        data: { role: body.role },
      });
      await recordAudit({
        organizationId: ctx.organization.id,
        actorId: ctx.user.id,
        actorEmail: ctx.user.email,
        action: "user.role_changed",
        targetType: "user",
        targetId: target.id,
        metadata: { from: target.role, to: body.role },
      });
      return ok({ ok: true, user: { id: updated.id, role: updated.role } });
    }

    // status change
    assertCan(ctx.user.role, "users:deactivate");
    if (
      body.status === "DEACTIVATED" &&
      (await lastOwnerWouldBeLost(ctx.organization.id, target.id))
    ) {
      return error("You cannot deactivate the last owner.", 409);
    }
    if (!outranks(ctx.user.role, target.role) && ctx.user.role !== "OWNER") {
      return error("You cannot deactivate someone of equal or higher role.", 403);
    }
    const updated = await prisma.user.update({
      where: { id: target.id },
      data: { status: body.status },
    });
    await recordAudit({
      organizationId: ctx.organization.id,
      actorId: ctx.user.id,
      actorEmail: ctx.user.email,
      action: body.status === "DEACTIVATED" ? "user.deactivated" : "user.reactivated",
      targetType: "user",
      targetId: target.id,
    });
    return ok({ ok: true, user: { id: updated.id, status: updated.status } });
  });
}

export function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  return handle(async () => {
    const ctx = await getCurrentUser();
    if (!ctx) return error("Unauthorized", 401);
    assertCan(ctx.user.role, "users:invite");

    const invite = await prisma.invitation.findUnique({
      where: { id: params.id },
    });
    if (!invite || invite.organizationId !== ctx.organization.id) {
      return error("Invitation not found.", 404);
    }
    await prisma.invitation.delete({ where: { id: invite.id } });
    await recordAudit({
      organizationId: ctx.organization.id,
      actorId: ctx.user.id,
      actorEmail: ctx.user.email,
      action: "user.invite_revoked",
      targetType: "invitation",
      targetId: invite.id,
      metadata: { email: invite.email },
    });
    return ok({ ok: true });
  });
}
