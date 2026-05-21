// Order management for buyers and sellers.
//   - Buyers see their purchases and can confirm delivery.
//   - Sellers see incoming orders and advance fulfilment state.
// The fulfilment state machine is deliberately narrow; illegal transitions
// are rejected rather than silently ignored.
import type { FastifyInstance } from 'fastify';
import type { OrderStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { BadRequest, Forbidden, NotFound } from '../lib/errors.js';
import { paginationQuery, buildPage } from '../lib/pagination.js';

// Allowed transitions, keyed by who may perform them.
const SELLER_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  PAID: ['FULFILLING', 'CANCELLED'],
  FULFILLING: ['SHIPPED', 'CANCELLED'],
};
const BUYER_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  SHIPPED: ['DELIVERED'],
};

export async function orderRoutes(app: FastifyInstance): Promise<void> {
  // List orders. `role=seller` returns sales; default returns purchases.
  app.get('/api/orders', async (req) => {
    const auth = await requireAuth(req);
    const q = paginationQuery
      .extend({ role: z.enum(['buyer', 'seller']).default('buyer') })
      .parse(req.query);

    const where =
      q.role === 'seller'
        ? { sellerId: auth.userId }
        : { buyerId: auth.userId };
    const rows = await prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: q.limit + 1,
      ...(q.cursor && { cursor: { id: q.cursor }, skip: 1 }),
      include: { items: true },
    });
    return buildPage(rows, q.limit);
  });

  app.get('/api/orders/:id', async (req) => {
    const auth = await requireAuth(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const order = await prisma.order.findUnique({
      where: { id },
      include: { items: true, payment: true, taxRecord: true, dispute: true },
    });
    if (!order) throw NotFound('Order not found');
    if (
      order.buyerId !== auth.userId &&
      order.sellerId !== auth.userId &&
      auth.role !== 'ADMIN'
    ) {
      throw Forbidden('Not your order');
    }
    return order;
  });

  // Advance the fulfilment state machine.
  app.post('/api/orders/:id/transition', async (req) => {
    const auth = await requireAuth(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { to } = z
      .object({
        to: z.enum(['FULFILLING', 'SHIPPED', 'DELIVERED', 'CANCELLED']),
      })
      .parse(req.body);

    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) throw NotFound('Order not found');

    const isSeller = order.sellerId === auth.userId;
    const isBuyer = order.buyerId === auth.userId;
    if (!isSeller && !isBuyer) throw Forbidden('Not your order');

    const allowed = isSeller
      ? SELLER_TRANSITIONS[order.status]
      : BUYER_TRANSITIONS[order.status];
    if (!allowed?.includes(to)) {
      throw BadRequest(
        `Cannot move order from ${order.status} to ${to}`,
        'illegal_transition',
      );
    }

    return prisma.order.update({
      where: { id },
      data: {
        status: to,
        // DELIVERED makes the order eligible for review and payout accrual.
        deliveredAt: to === 'DELIVERED' ? new Date() : undefined,
      },
    });
  });
}
