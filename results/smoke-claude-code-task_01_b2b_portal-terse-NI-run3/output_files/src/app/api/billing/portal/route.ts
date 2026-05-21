/**
 * POST /api/billing/portal
 * Opens the Stripe customer billing portal (update card, change/cancel plan).
 * OWNER only.
 */
import { getCurrentUser } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { stripe, billingEnabled } from "@/lib/stripe";
import { env } from "@/lib/env";
import { ok, error, handle } from "@/lib/http";

export function POST() {
  return handle(async () => {
    const ctx = await getCurrentUser();
    if (!ctx) return error("Unauthorized", 401);
    assertCan(ctx.user.role, "billing:manage");
    if (!billingEnabled) return error("Billing is not configured.", 503);
    if (!ctx.organization.stripeCustomerId) {
      return error("No billing account yet — start a subscription first.", 409);
    }

    const session = await stripe().billingPortal.sessions.create({
      customer: ctx.organization.stripeCustomerId,
      return_url: `${env.APP_URL}/billing`,
    });
    return ok({ ok: true, url: session.url });
  });
}
