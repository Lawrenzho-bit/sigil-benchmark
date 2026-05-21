import { prisma } from "../../db/client.js";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { stripe } from "../../lib/stripe.js";

// Orders become payout-eligible once the buyer has had this long to dispute
// after delivery. Funds are held until then.
const DISPUTE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

// Orders eligible to be paid out to a seller: delivered, dispute window
// elapsed, not already attached to a payout, and free of an open dispute.
async function eligibleOrders(sellerId: string) {
  const cutoff = new Date(Date.now() - DISPUTE_WINDOW_MS);
  return prisma.order.findMany({
    where: {
      sellerId,
      status: "DELIVERED",
      deliveredAt: { lte: cutoff },
      payoutId: null,
      dispute: { is: null },
    },
  });
}

// Runs one weekly payout cycle for every active seller. Idempotent per cycle:
// orders already attached to a payout are skipped.
export async function runWeeklyPayouts(): Promise<{ created: number; skipped: number }> {
  const sellers = await prisma.sellerProfile.findMany({
    where: { active: true, payoutSchedule: "WEEKLY", stripeOnboarded: true },
  });

  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
  let created = 0;
  let skipped = 0;

  for (const seller of sellers) {
    const orders = await eligibleOrders(seller.userId);
    if (orders.length === 0) {
      skipped++;
      continue;
    }

    const grossAmount = orders.reduce((s, o) => s + o.sellerNet, 0);
    const feeAmount = orders.reduce((s, o) => s + o.platformFee, 0);

    // Skip dust payouts below the configured minimum; orders roll to next week.
    if (grossAmount < env.PAYOUT_MIN_AMOUNT) {
      skipped++;
      continue;
    }

    try {
      const payout = await prisma.$transaction(async (tx) => {
        const p = await tx.payout.create({
          data: {
            sellerProfileId: seller.id,
            currency: orders[0]!.currency,
            grossAmount,
            feeAmount,
            amount: grossAmount,
            status: "PENDING",
            periodStart,
            periodEnd,
          },
        });
        // Attach orders and mark them COMPLETED.
        await tx.order.updateMany({
          where: { id: { in: orders.map((o) => o.id) } },
          data: { payoutId: p.id, status: "COMPLETED" },
        });
        return p;
      });

      // Stripe Connect transfer to the seller's connected account.
      const transfer = await stripe.transfers.create(
        {
          amount: grossAmount,
          currency: payout.currency.toLowerCase(),
          destination: seller.stripeAccountId!,
          metadata: { payoutId: payout.id, sellerProfileId: seller.id },
        },
        { idempotencyKey: `payout_${payout.id}` },
      );

      await prisma.payout.update({
        where: { id: payout.id },
        data: { status: "PAID", stripeTransferId: transfer.id, paidAt: new Date() },
      });
      created++;
      logger.info({ payoutId: payout.id, sellerId: seller.userId, grossAmount }, "Payout sent");
    } catch (err) {
      logger.error({ err, sellerId: seller.userId }, "Payout failed");
      // The payout row (if created) is left PENDING for retry next cycle.
    }
  }
  return { created, skipped };
}

// A seller's payout history.
export async function listSellerPayouts(userId: string) {
  const profile = await prisma.sellerProfile.findUnique({ where: { userId } });
  if (!profile) return [];
  return prisma.payout.findMany({
    where: { sellerProfileId: profile.id },
    orderBy: { createdAt: "desc" },
  });
}

// Current unpaid balance: eligible-but-not-yet-paid plus pending-window orders.
export async function sellerBalance(userId: string) {
  const profile = await prisma.sellerProfile.findUnique({ where: { userId } });
  if (!profile) return { available: 0, pending: 0, currency: "EUR" };

  const orders = await prisma.order.findMany({
    where: { sellerId: userId, payoutId: null, status: { in: ["DELIVERED", "PAID", "SHIPPED"] } },
  });
  const cutoff = new Date(Date.now() - DISPUTE_WINDOW_MS);
  let available = 0;
  let pending = 0;
  for (const o of orders) {
    if (o.status === "DELIVERED" && o.deliveredAt && o.deliveredAt <= cutoff) {
      available += o.sellerNet;
    } else {
      pending += o.sellerNet;
    }
  }
  return { available, pending, currency: orders[0]?.currency ?? "EUR" };
}
