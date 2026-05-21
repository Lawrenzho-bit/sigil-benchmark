"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import { requireStripe } from "@/lib/stripe";
import { prisma } from "@/lib/db";
import { PLANS } from "@/lib/plans";
import { recordAudit } from "@/lib/audit";
import { env } from "@/lib/env";

const planSchema = z.enum(["STARTER", "PRO", "ENTERPRISE"]);

/** Start a Stripe Checkout session to subscribe to / change a plan. */
export async function startCheckout(formData: FormData): Promise<void> {
  const actor = await requireRole("OWNER");
  const plan = planSchema.parse(formData.get("plan"));
  const def = PLANS[plan];

  if (!def.priceId) redirect("/billing?error=noprice");
  const stripe = requireStripe();

  // Ensure the org has a Stripe customer.
  let customerId = actor.organization.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      name: actor.organization.name,
      email: actor.email,
      metadata: { orgId: actor.orgId },
    });
    customerId = customer.id;
    await prisma.organization.update({
      where: { id: actor.orgId },
      data: { stripeCustomerId: customerId },
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: def.priceId!, quantity: 1 }],
    success_url: `${env.NEXT_PUBLIC_APP_URL}/billing?status=success`,
    cancel_url: `${env.NEXT_PUBLIC_APP_URL}/billing?status=cancelled`,
    metadata: { orgId: actor.orgId, plan },
    subscription_data: { metadata: { orgId: actor.orgId } },
  });

  await recordAudit({
    orgId: actor.orgId,
    actorId: actor.id,
    actorEmail: actor.email,
    action: "billing.checkout_started",
    targetType: "organization",
    targetId: actor.orgId,
    metadata: { plan },
  });

  if (!session.url) redirect("/billing?error=checkout");
  redirect(session.url);
}

/** Open the Stripe customer portal to manage payment method / cancel. */
export async function openBillingPortal(): Promise<void> {
  const actor = await requireRole("OWNER");
  const stripe = requireStripe();

  if (!actor.organization.stripeCustomerId) redirect("/billing?error=nocustomer");

  const portal = await stripe.billingPortal.sessions.create({
    customer: actor.organization.stripeCustomerId!,
    return_url: `${env.NEXT_PUBLIC_APP_URL}/billing`,
  });
  redirect(portal.url);
}
