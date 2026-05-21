// Seller-facing payout endpoints. Payout *records* are created by the weekly
// worker (src/workers/payouts.ts); these endpoints are read-only plus a
// balance preview of not-yet-paid earnings.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireSeller } from '../middleware/auth.js';
import { NotFound } from '../lib/errors.js';
import { paginationQuery, buildPage } from '../lib/pagination.js';

export async function payoutRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/payouts', async (req) => {
    const auth = await requireSeller(req);
    const profile = await prisma.sellerProfile.findUnique({
      where: { userId: auth.userId },
    });
    if (!profile) throw NotFound('No seller profile');

    const q = paginationQuery.parse(req.query);
    const rows = await prisma.payout.findMany({
      where: { sellerId: profile.id },
      orderBy: { createdAt: 'desc' },
      take: q.limit + 1,
      ...(q.cursor && { cursor: { id: q.cursor }, skip: 1 }),
    });
    return buildPage(rows, q.limit);
  });

  // Pending balance: net proceeds from DELIVERED orders not yet covered by a
  // payout. This mirrors the worker's accrual query.
  app.get('/api/payouts/balance', async (req) => {
    const auth = await requireSeller(req);
    const profile = await prisma.sellerProfile.findUnique({
      where: { userId: auth.userId },
    });
    if (!profile) throw NotFound('No seller profile');

    const lastPayout = await prisma.payout.findFirst({
      where: { sellerId: profile.id },
      orderBy: { periodEnd: 'desc' },
    });
    const since = lastPayout?.periodEnd ?? new Date(0);

    const orders = await prisma.order.findMany({
      where: {
        sellerId: auth.userId,
        status: 'DELIVERED',
        deliveredAt: { gt: since },
      },
      select: { subtotalAmount: true, platformFee: true, currency: true },
    });
    const gross = orders.reduce((s, o) => s + o.subtotalAmount, 0);
    const fees = orders.reduce((s, o) => s + o.platformFee, 0);
    return {
      currency: orders[0]?.currency ?? 'EUR',
      orderCount: orders.length,
      grossAmount: gross,
      feeAmount: fees,
      netAmount: gross - fees,
      nextPayoutAfter: since,
    };
  });
}
