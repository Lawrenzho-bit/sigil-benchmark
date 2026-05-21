/**
 * PATCH /api/settings/org — update organization-level settings. ADMIN+.
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { ssoConfigured } from "@/lib/saml";
import { recordAudit } from "@/lib/audit";
import { ok, error, handle } from "@/lib/http";

const bodySchema = z.object({
  name: z.string().min(2).max(80).optional(),
  timezone: z.string().min(1).max(64).optional(),
  ssoEnabled: z.boolean().optional(),
  ssoEnforced: z.boolean().optional(),
});

export function PATCH(req: NextRequest) {
  return handle(async () => {
    const ctx = await getCurrentUser();
    if (!ctx) return error("Unauthorized", 401);
    assertCan(ctx.user.role, "settings:manage_org");

    const body = bodySchema.parse(await req.json());
    if (body.ssoEnabled && !ssoConfigured) {
      return error("SAML SSO is not configured on this deployment.", 422);
    }

    const updated = await prisma.organization.update({
      where: { id: ctx.organization.id },
      data: body,
    });
    await recordAudit({
      organizationId: ctx.organization.id,
      actorId: ctx.user.id,
      actorEmail: ctx.user.email,
      action: "settings.org_updated",
      targetType: "organization",
      targetId: ctx.organization.id,
      metadata: body,
    });
    return ok({
      ok: true,
      organization: {
        name: updated.name,
        timezone: updated.timezone,
        ssoEnabled: updated.ssoEnabled,
        ssoEnforced: updated.ssoEnforced,
      },
    });
  });
}
