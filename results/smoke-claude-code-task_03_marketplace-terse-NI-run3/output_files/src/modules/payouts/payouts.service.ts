import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';

/**
 * Weekly payouts. For each active seller, aggregates every DELIVERED order
 * that is dispute-free and not yet paid out, withholds the platform fee, and
 * transfers the net to the seller's Stripe Connect account.
 *
 * Funds are released only after delivery so the platform retains them while a
 * dispute window is open. Tax is excluded — it is remitted by the platform as
 * marketplace facilitator.
 */
@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
  ) {}

  /** Runs every Monday 02:00. Idempotent per (seller, period) via unique key. */
  @Cron(CronExpression.EVERY_WEEK)
  async runWeeklyPayouts() {
    const { periodStart, periodEnd } = this.currentPeriod();
    this.logger.log(`Running weekly payouts for ${periodStart.toISOString()}`);

    const sellers = await this.prisma.sellerProfile.findMany({
      where: { status: 'ACTIVE', payoutsEnabled: true },
      select: { id: true, stripeAccountId: true, defaultCurrency: true },
    });

    for (const seller of sellers) {
      try {
        await this.payoutSeller(seller, periodStart, periodEnd);
      } catch (err) {
        this.logger.error(`Payout failed for seller ${seller.id}`, err as Error);
      }
    }
  }

  private async payoutSeller(
    seller: { id: string; stripeAccountId: string | null; defaultCurrency: string },
    periodStart: Date,
    periodEnd: Date,
  ) {
    // Eligible: delivered, dispute-free, never paid out.
    const orders = await this.prisma.order.findMany({
      where: {
        sellerId: seller.id,
        status: 'DELIVERED',
        dispute: null,
        payoutItems: { none: {} },
      },
    });
    if (orders.length === 0) return;

    const grossCents = orders.reduce((s, o) => s + o.subtotalCents, 0);
    const feeCents = orders.reduce((s, o) => s + o.platformFeeCents, 0);
    const netCents = orders.reduce((s, o) => s + o.sellerNetCents, 0);

    // Create the payout + items atomically (claims the orders).
    const payout = await this.prisma.payout.create({
      data: {
        sellerId: seller.id,
        periodStart,
        periodEnd,
        grossCents,
        feeCents,
        netCents,
        currency: seller.defaultCurrency,
        status: 'PROCESSING',
        items: {
          create: orders.map((o) => ({ orderId: o.id, netCents: o.sellerNetCents })),
        },
      },
    });

    try {
      if (!seller.stripeAccountId) throw new Error('Seller has no Stripe account');
      const transfer = await this.stripe.client.transfers.create({
        amount: netCents,
        currency: seller.defaultCurrency.toLowerCase(),
        destination: seller.stripeAccountId,
        metadata: { payoutId: payout.id, sellerId: seller.id },
      });
      await this.prisma.payout.update({
        where: { id: payout.id },
        data: { status: 'PAID', stripeTransferId: transfer.id, paidAt: new Date() },
      });
      this.logger.log(`Paid ${netCents} ${seller.defaultCurrency} to seller ${seller.id}`);
    } catch (err) {
      await this.prisma.payout.update({
        where: { id: payout.id },
        data: { status: 'FAILED', failureReason: (err as Error).message },
      });
      throw err;
    }
  }

  /** Payout period = the 7 days ending last midnight UTC. */
  private currentPeriod(): { periodStart: Date; periodEnd: Date } {
    const end = new Date();
    end.setUTCHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 7);
    return { periodStart: start, periodEnd: end };
  }

  listForSeller(sellerId: string) {
    return this.prisma.payout.findMany({
      where: { sellerId },
      orderBy: { periodStart: 'desc' },
      include: { items: true },
    });
  }
}
