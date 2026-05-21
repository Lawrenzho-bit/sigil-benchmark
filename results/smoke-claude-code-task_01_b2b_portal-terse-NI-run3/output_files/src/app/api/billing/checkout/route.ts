/**
 * POST /api/billing/checkout
 * Creates a Stripe Checkout session for the selected plan. OWNER only.
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { stripe, billingEnabled } from "@/lib/stripe";
import { PLANS } from "@/lib/plans";
import { recordAudit } from "@/lib/audit";
import { env } from "@/lib/env";
import { ok, error, handle } from "@/lib/http";

const bodySchema = z.object({
  plan: z.enum(["STARTER", "PRO", "ENTERPRISE"]),
});

export function POST(req: NextRequest) {
  return handle(async () => {
    const ctx = await getCurrentUser();
    if (!ctx) return error("Unauthorized", 401);
    assertCan(ctx.user.role, "billing:manage");
    if (!billingEnabled) return error("Billing is not configured.", 503);

    const { plan } = bodySchema.parse(await req.json());
    const priceId = PLANS[plan].stripePriceId;
    if (!priceId) return error(`No Stripe price configured for ${plan}.`, 503);

    const s = stripe();

    // Reuse the org's Stripe customer, or create one on first checkout.
    let customerId = ctx.organization.stripeCustomerId;
    if (!customerId) {
      const customer = await s.customers.create({
        name: ctx.organization.name,
        email: ctx.user.email,
        metadata: { organizationId: ctx.organization.id },
      });
      customerId = customer.id;
      await prisma.organization.update({
        where: { id: ctx.organization.id },
        data: { stripeCustomerId: customerId },
      });
    }

    const session = await s.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${env.APP_URL}/billing?status=success`,
      cancel_url: `${env.APP_URL}/billing?status=canceled`,
      // The webhook uses this to map the subscription back to the org.
      subscription_data: {
        metadata: { organizationId: ctx.organization.id, plan },
      },
      metadata: { organizationId: ctx.organization.id, plan },
    });

    await recordAudit({
      organizationId: ctx.organization.id,
      actorId: ctx.user.id,
      actorEmail: ctx.user.email,
      action: "billing.checkout_started",
      metadata: { plan },
    });

    return ok({ ok: true, url: session.url });
  });
}
