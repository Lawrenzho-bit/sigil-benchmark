import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import type { SubscriptionStatus } from "@prisma/client";
import { stripe } from "@/lib/stripe";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import { planForPriceId } from "@/lib/plans";
import { recordAudit } from "@/lib/audit";
import { sendBillingEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

/** Map Stripe subscription status onto our internal enum. */
function mapStatus(s: Stripe.Subscription.Status): SubscriptionStatus {
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
      return "NONE";
  }
}

/** Reconcile our Organization row with a Stripe subscription. */
async function syncSubscription(sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const org = await prisma.organization.findUnique({ where: { stripeCustomerId: customerId } });
  if (!org) {
    console.warn("[stripe] no org for customer", customerId);
    return;
  }

  const priceId = sub.items.data[0]?.price.id;
  const plan = planForPriceId(priceId) ?? org.plan;
  const status = mapStatus(sub.status);
  // current_period_end is seconds since epoch.
  const periodEndSec =
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    sub.items.data[0]?.current_period_end;

  await prisma.organization.update({
    where: { id: org.id },
    data: {
      plan,
      subscriptionStatus: status,
      stripeSubscriptionId: sub.id,
      currentPeriodEnd: periodEndSec ? new Date(periodEndSec * 1000) : null,
    },
  });

  await recordAudit({
    orgId: org.id,
    actorEmail: "system@stripe",
    action: "billing.subscription_synced",
    targetType: "organization",
    targetId: org.id,
    metadata: { plan, status },
  });

  // Notify owners of meaningful billing changes.
  if (status === "PAST_DUE" || status === "CANCELED") {
    const owners = await prisma.user.findMany({
      where: { orgId: org.id, role: "OWNER", active: true, notifyBilling: true },
      select: { email: true },
    });
    for (const o of owners) {
      await sendBillingEmail(
        o.email,
        status === "PAST_DUE" ? "Payment past due" : "Subscription cancelled",
        status === "PAST_DUE"
          ? "We could not process your latest payment. Please update your payment method."
          : "Your subscription has been cancelled. Reactivate any time from the billing page.",
      );
    }
  }
}

/** Stripe webhook receiver. Signature is verified before any processing. */
export async function POST(req: NextRequest) {
  if (!stripe || !env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "billing not configured" }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "missing signature" }, { status: 400 });

  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[stripe] signature verification failed:", err);
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await syncSubscription(event.data.object as Stripe.Subscription);
        break;
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.subscription) {
          const subId =
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription.id;
          await syncSubscription(await stripe.subscriptions.retrieve(subId));
        }
        break;
      }
      default:
        // Unhandled event types are acknowledged but ignored.
        break;
    }
  } catch (err) {
    console.error(`[stripe] handler error for ${event.type}:`, err);
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
