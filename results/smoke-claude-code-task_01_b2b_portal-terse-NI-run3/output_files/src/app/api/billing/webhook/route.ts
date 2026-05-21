/**
 * POST /api/billing/webhook
 * Receives Stripe events. This is the *authoritative* path for subscription
 * state — the checkout success page is just a UX redirect and is never trusted.
 *
 * The signature is verified against STRIPE_WEBHOOK_SECRET; unsigned or
 * mismatched payloads are rejected.
 */
import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import { stripe, billingEnabled } from "@/lib/stripe";
import { planFromPriceId } from "@/lib/plans";
import { env } from "@/lib/env";
import { recordAudit } from "@/lib/audit";
import { sendBillingEmail } from "@/lib/email";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
// Stripe signature verification needs the raw, unparsed body.
export const runtime = "nodejs";

type SubStatus =
  | "TRIALING"
  | "ACTIVE"
  | "PAST_DUE"
  | "CANCELED"
  | "INCOMPLETE";

function mapStatus(s: Stripe.Subscription.Status): SubStatus {
  switch (s) {
    case "trialing":
      return "TRIALING";
    case "active":
      return "ACTIVE";
    case "past_due":
    case "unpaid":
      return "PAST_DUE";
    case "canceled":
    case "incomplete_expired":
      return "CANCELED";
    default:
      return "INCOMPLETE";
  }
}

/** Applies a subscription's current state to the matching organization. */
async function syncSubscription(sub: Stripe.Subscription) {
  const orgId = sub.metadata?.organizationId;
  if (!orgId) {
    logger.warn("stripe subscription without organizationId", { sub: sub.id });
    return;
  }
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) {
    logger.warn("stripe webhook for unknown org", { orgId });
    return;
  }

  const priceId = sub.items.data[0]?.price.id ?? "";
  const plan = planFromPriceId(priceId) ?? org.plan;
  const status = mapStatus(sub.status);
  const periodEnd = sub.current_period_end
    ? new Date(sub.current_period_end * 1000)
    : null;

  const planChanged = plan !== org.plan;

  await prisma.organization.update({
    where: { id: org.id },
    data: {
      plan,
      subscriptionStatus: status,
      stripeSubscriptionId: sub.id,
      currentPeriodEnd: periodEnd,
    },
  });

  if (planChanged) {
    await recordAudit({
      organizationId: org.id,
      actorId: null,
      actorEmail: "stripe-webhook",
      action: "billing.plan_changed",
      targetType: "organization",
      targetId: org.id,
      metadata: { from: org.plan, to: plan },
    });
    await notifyBillingContacts(
      org.id,
      "Your plan has changed",
      `Your subscription is now on the ${plan} plan.`,
    );
  }

  if (status === "PAST_DUE") {
    await notifyBillingContacts(
      org.id,
      "Payment failed",
      "We could not process your latest payment. Please update your billing details.",
    );
  }
}

/** Emails owners/admins who opted in to billing notifications. */
async function notifyBillingContacts(
  orgId: string,
  subject: string,
  message: string,
) {
  const recipients = await prisma.user.findMany({
    where: {
      organizationId: orgId,
      status: "ACTIVE",
      role: { in: ["OWNER", "ADMIN"] },
      notifyBilling: true,
    },
    select: { email: true },
  });
  await Promise.all(
    recipients.map((r) => sendBillingEmail(r.email, subject, message)),
  );
}

export async function POST(req: NextRequest) {
  if (!billingEnabled || !env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Billing not configured" }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(
      rawBody,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    logger.warn("stripe signature verification failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await syncSubscription(event.data.object as Stripe.Subscription);
        break;
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const orgId = sub.metadata?.organizationId;
        if (orgId) {
          await prisma.organization.updateMany({
            where: { id: orgId },
            data: { subscriptionStatus: "CANCELED" },
          });
          await recordAudit({
            organizationId: orgId,
            actorId: null,
            actorEmail: "stripe-webhook",
            action: "billing.subscription_canceled",
          });
        }
        break;
      }
      case "checkout.session.completed": {
        // The subscription.* events carry the detail; nothing extra needed here.
        logger.info("checkout completed", { id: event.id });
        break;
      }
      default:
        logger.debug("unhandled stripe event", { type: event.type });
    }
  } catch (err) {
    logger.error("stripe webhook handler failed", {
      type: event.type,
      error: err instanceof Error ? err.message : String(err),
    });
    // 500 makes Stripe retry — desirable for a transient DB blip.
    return NextResponse.json({ error: "Handler error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
