import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { stripe, planForPriceId, mapSubscriptionStatus } from '@/lib/stripe';
import { sendBillingReceiptEmail, sendPaymentFailedEmail } from '@/lib/email';

// The raw request body is required for signature verification — do not let
// Next.js parse it.
export const dynamic = 'force-dynamic';

/**
 * Stripe webhook handler.
 *
 *  - Verifies the signature against STRIPE_WEBHOOK_SECRET (constructEvent
 *    throws on mismatch / replay outside the tolerance window).
 *  - Idempotent: every event id is recorded in WebhookEvent; a duplicate
 *    delivery is acknowledged with 200 and skipped.
 *  - Always returns 2xx once the event is safely persisted/handled so Stripe
 *    stops retrying; returns 4xx/5xx only when it is safe to retry.
 */
export async function POST(req: Request) {
  const sig = req.headers.get('stripe-signature');
  if (!sig) {
    return NextResponse.json({ error: 'missing_signature' }, { status: 400 });
  }

  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    logger.warn({ err }, 'Stripe webhook signature verification failed');
    return NextResponse.json({ error: 'invalid_signature' }, { status: 400 });
  }

  // Idempotency guard — claim the event id; if it already exists, we're done.
  try {
    await prisma.webhookEvent.create({
      data: { id: event.id, type: event.type },
    });
  } catch {
    logger.info({ eventId: event.id }, 'Duplicate Stripe event ignored');
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    await handleEvent(event);
  } catch (err) {
    // Unexpected processing failure — remove the idempotency record so Stripe's
    // retry can reprocess, and return 500.
    logger.error({ err, eventId: event.id }, 'Failed to process Stripe event');
    await prisma.webhookEvent.delete({ where: { id: event.id } }).catch(() => {});
    return NextResponse.json({ error: 'processing_failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      const priceId = sub.items.data[0]?.price.id;
      const plan = planForPriceId(priceId);
      await prisma.organization.updateMany({
        where: { stripeCustomerId: String(sub.customer) },
        data: {
          stripeSubscriptionId: sub.id,
          subscriptionStatus: mapSubscriptionStatus(sub.status),
          ...(plan ? { plan } : {}),
          currentPeriodEnd: new Date(sub.current_period_end * 1000),
        },
      });
      break;
    }

    case 'invoice.paid': {
      const invoice = event.data.object as Stripe.Invoice;
      if (invoice.customer_email && invoice.amount_paid > 0) {
        await sendBillingReceiptEmail(
          invoice.customer_email,
          formatAmount(invoice.amount_paid, invoice.currency),
        );
      }
      break;
    }

    case 'invoice.payment_failed': {
      // Dunning — Stripe drives the retry schedule; we mark the org and notify.
      const invoice = event.data.object as Stripe.Invoice;
      await prisma.organization.updateMany({
        where: { stripeCustomerId: String(invoice.customer) },
        data: { subscriptionStatus: 'PAST_DUE' },
      });
      if (invoice.customer_email) {
        await sendPaymentFailedEmail(invoice.customer_email);
      }
      break;
    }

    default:
      logger.debug({ type: event.type }, 'Unhandled Stripe event type');
  }
}

function formatAmount(minorUnits: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(minorUnits / 100);
}
