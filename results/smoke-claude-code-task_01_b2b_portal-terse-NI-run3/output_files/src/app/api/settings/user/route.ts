/**
 * PATCH /api/settings/user — update the signed-in user's own profile,
 * notification preferences and (optionally) password.
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { hashPassword, verifyPassword, passwordSchema } from "@/lib/password";
import { recordAudit } from "@/lib/audit";
import { ok, error, handle } from "@/lib/http";

const bodySchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    notifyBilling: z.boolean().optional(),
    notifyProduct: z.boolean().optional(),
    currentPassword: z.string().optional(),
    newPassword: passwordSchema.optional(),
  })
  .refine((d) => !d.newPassword || !!d.currentPassword, {
    message: "Current password is required to set a new password",
    path: ["currentPassword"],
  });

export function PATCH(req: NextRequest) {
  return handle(async () => {
    const ctx = await getCurrentUser();
    if (!ctx) return error("Unauthorized", 401);

    const body = bodySchema.parse(await req.json());
    const data: Record<string, unknown> = {};

    if (body.name !== undefined) data.name = body.name;
    if (body.notifyBilling !== undefined) data.notifyBilling = body.notifyBilling;
    if (body.notifyProduct !== undefined) data.notifyProduct = body.notifyProduct;

    if (body.newPassword) {
      if (!ctx.user.passwordHash) {
        return error("This account signs in via SSO and has no password.", 422);
      }
      const valid = await verifyPassword(
        body.currentPassword!,
        ctx.user.passwordHash,
      );
      if (!valid) return error("Current password is incorrect.", 403);
      data.passwordHash = await hashPassword(body.newPassword);
    }

    await prisma.user.update({ where: { id: ctx.user.id }, data });
    await recordAudit({
      organizationId: ctx.organization.id,
      actorId: ctx.user.id,
      actorEmail: ctx.user.email,
      action: "settings.user_updated",
      targetType: "user",
      targetId: ctx.user.id,
      metadata: { passwordChanged: !!body.newPassword },
    });
    return ok({ ok: true });
  });
}
