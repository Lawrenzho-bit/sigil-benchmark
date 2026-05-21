/** POST /api/auth/logout — clears the session cookie. */
import { getCurrentUser } from "@/lib/auth";
import { destroySession } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { ok, handle } from "@/lib/http";

export function POST() {
  return handle(async () => {
    const ctx = await getCurrentUser();
    if (ctx) {
      await recordAudit({
        organizationId: ctx.organization.id,
        actorId: ctx.user.id,
        actorEmail: ctx.user.email,
        action: "auth.logout",
      });
    }
    destroySession();
    return ok({ ok: true, redirectTo: "/login" });
  });
}
