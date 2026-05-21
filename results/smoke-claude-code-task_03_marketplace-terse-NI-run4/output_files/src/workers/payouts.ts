// Weekly payout worker.
//
// For each ACTIVE seller with payouts enabled, sums the net proceeds of orders
// DELIVERED since their last payout, creates a Payout row, and issues a Stripe
// Connect transfer. The transfer uses an idempotency key derived from the
// payout id, so a crash-and-retry never double-pays.
//
// Run from cron / a scheduler:  npm run worker:payouts
import { prisma } from '../db.js';
import { createPayoutTransfer } from '../lib/stripe.js';

// A delivered order is only paid out after this buffer, leaving a window for
// disputes/refunds before funds leave the platform.
const DISPUTE_HOLD_DAYS = 3;

export async function runPayouts(now = new Date()): Promise<void> {
  const periodEnd = new Date(now.getTime() - DISPUTE_HOLD_DAYS * 86_400_000);

  const sellers = await prisma.sellerProfile.findMany({
    where: { status: 'ACTIVE', payoutsEnabled: true, stripeAccountId: { not: null } },
  });

  for (const seller of sellers) {
    const lastPayout = await prisma.payout.findFirst({
      where: { sellerId: seller.id },
      orderBy: { periodEnd: 'desc' },
    });
    const periodStart = lastPayout?.periodEnd ?? new Date(0);

    // Net of any refunds: refunded orders never reach this query (status moves
    // to REFUNDED), and partial refunds are handled via Stripe balance.
    const orders = await prisma.order.findMany({
      where: {
        sellerId: seller.userId,
        status: 'DELIVERED',
        deliveredAt: { gt: periodStart, lte: periodEnd },
      },
      select: { subtotalAmount: true, platformFee: true, currency: true },
    });
    if (orders.length === 0) continue;

    const currency = orders[0]!.currency;
    const gross = orders.reduce((s, o) => s + o.subtotalAmount, 0);
    const fees = orders.reduce((s, o) => s + o.platformFee, 0);
    const net = gross - fees;
    if (net <= 0) continue;

    const payout = await prisma.payout.create({
      data: {
        sellerId: seller.id,
        status: 'PROCESSING',
        currency,
        grossAmount: gross,
        feeAmount: fees,
        netAmount: net,
        periodStart,
        periodEnd,
      },
    });

    try {
      const transfer = await createPayoutTransfer({
        payoutId: payout.id,
        netMinor: net,
        currency,
        sellerStripeAccountId: seller.stripeAccountId!,
      });
      await prisma.payout.update({
        where: { id: payout.id },
        data: { stripeTransferId: transfer.id }, // status -> PAID via webhook
      });
      console.log(`payout ${payout.id}: ${net} ${currency} -> seller ${seller.id}`);
    } catch (err) {
      await prisma.payout.update({
        where: { id: payout.id },
        data: { status: 'FAILED', failureReason: (err as Error).message },
      });
      console.error(`payout ${payout.id} failed:`, err);
    }
  }
}

// Allow direct invocation: `tsx src/workers/payouts.ts`.
if (import.meta.url === `file://${process.argv[1]}`) {
  runPayouts()
    .then(() => prisma.$disconnect())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
