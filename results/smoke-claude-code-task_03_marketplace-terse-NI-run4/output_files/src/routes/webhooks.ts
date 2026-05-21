// Stripe webhook receiver — the authoritative source for payment, identity,
// and transfer state.
//
// Two correctness rules:
//   1. Verify the signature against the raw request body (never the parsed
//      JSON) — see the rawBody content-type parser in app.ts.
//   2. Dedupe via the WebhookEvent table: Stripe retries deliveries, and we
//      must process each event at most once.
import type { FastifyInstance } from 'fastify';
import type Stripe from 'stripe';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { stripe } from '../lib/stripe.js';
import { kyc } from '../lib/kyc.js';

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/webhooks/stripe', async (req, reply) => {
    const signature = req.headers['stripe-signature'];
    const raw = (req as { rawBody?: Buffer }).rawBody;
    if (!signature || !raw) return reply.code(400).send({ error: 'missing signature' });

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        raw,
        Array.isArray(signature) ? signature[0]! : signature,
        config.STRIPE_WEBHOOK_SECRET,
      );
    } catch {
      return reply.code(400).send({ error: 'invalid signature' });
    }

    // Inbox dedupe: a duplicate delivery is ack'd without re-processing.
    const seen = await prisma.webhookEvent.findUnique({ where: { id: event.id } });
    if (seen?.processedAt) return reply.code(200).send({ received: true });
    if (!seen) {
      await prisma.webhookEvent.create({
        data: { id: event.id, type: event.type, payload: event as object },
      });
    }

    await handleEvent(event);

    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { processedAt: new Date() },
    });
    return reply.code(200).send({ received: true });
  });
}

async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'payment_intent.succeeded': {
      const pi = event.data.object as Stripe.PaymentIntent;
      const payment = await prisma.payment.findUnique({
        where: { stripePaymentIntentId: pi.id },
      });
      if (!payment) return;
      // Confirm payment and move the order to PAID atomically.
      await prisma.$transaction([
        prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: 'SUCCEEDED',
            stripeChargeId: (pi.latest_charge as string) ?? null,
          },
        }),
        prisma.order.update({
          where: { id: payment.orderId },
          data: { status: 'PAID', paidAt: new Date() },
        }),
      ]);
      break;
    }

    case 'payment_intent.payment_failed': {
      const pi = event.data.object as Stripe.PaymentIntent;
      const payment = await prisma.payment.findUnique({
        where: { stripePaymentIntentId: pi.id },
      });
      if (payment) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: 'FAILED' },
        });
        // Inventory reserved at checkout is released by a reconciliation job
        // for orders left in PENDING_PAYMENT (see README §Gaps).
      }
      break;
    }

    case 'identity.verification_session.verified':
    case 'identity.verification_session.requires_input': {
      const session = event.data.object as Stripe.Identity.VerificationSession;
      const verification = await prisma.kycVerification.findFirst({
        where: { providerRef: session.id },
        include: { seller: { include: { bankAccount: true } } },
      });
      if (!verification) return;
      const mapped = kyc.interpretStatus(session.status);
      await prisma.kycVerification.update({
        where: { id: verification.id },
        data: {
          status: mapped,
          verifiedAt: mapped === 'VERIFIED' ? new Date() : null,
          rejectionReason:
            mapped === 'REJECTED' ? (session.last_error?.reason ?? null) : null,
        },
      });
      if (mapped === 'VERIFIED' && verification.seller.bankAccount) {
        await prisma.$transaction([
          prisma.sellerProfile.update({
            where: { id: verification.sellerId },
            data: { status: 'ACTIVE', payoutsEnabled: true },
          }),
          prisma.user.update({
            where: { id: verification.seller.userId },
            data: { role: 'SELLER' },
          }),
        ]);
      }
      break;
    }

    case 'transfer.created':
    case 'transfer.reversed': {
      // `transfer.created` confirms the payout left the platform balance;
      // `transfer.reversed` means it was clawed back (e.g. failed delivery).
      const transfer = event.data.object as Stripe.Transfer;
      const payout = await prisma.payout.findFirst({
        where: { stripeTransferId: transfer.id },
      });
      if (payout) {
        const reversed = event.type === 'transfer.reversed';
        await prisma.payout.update({
          where: { id: payout.id },
          data: {
            status: reversed ? 'FAILED' : 'PAID',
            paidAt: reversed ? null : new Date(),
            failureReason: reversed ? 'transfer reversed by Stripe' : null,
          },
        });
      }
      break;
    }

    default:
      // Unhandled event types are recorded (inbox) but need no action.
      break;
  }
}
