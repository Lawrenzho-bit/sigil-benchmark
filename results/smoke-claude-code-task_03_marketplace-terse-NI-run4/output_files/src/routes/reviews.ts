// Reviews & ratings. A buyer may review the seller exactly once per order,
// and only after that order is DELIVERED. The seller's denormalised rating
// aggregate is recomputed in the same transaction.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { BadRequest, Conflict, Forbidden, NotFound } from '../lib/errors.js';
import { paginationQuery, buildPage } from '../lib/pagination.js';

export async function reviewRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/orders/:orderId/review', async (req, reply) => {
    const auth = await requireAuth(req);
    const { orderId } = z.object({ orderId: z.string() }).parse(req.params);
    const body = z
      .object({
        rating: z.number().int().min(1).max(5),
        comment: z.string().max(4000).optional(),
      })
      .parse(req.body);

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { review: true },
    });
    if (!order) throw NotFound('Order not found');
    if (order.buyerId !== auth.userId) throw Forbidden('Only the buyer may review');
    if (order.status !== 'DELIVERED') {
      throw BadRequest('Order must be delivered before reviewing', 'not_delivered');
    }
    if (order.review) throw Conflict('Order already reviewed');

    // Create review + bump the seller's rating aggregate atomically.
    const review = await prisma.$transaction(async (tx) => {
      const created = await tx.review.create({
        data: {
          orderId,
          authorId: auth.userId,
          subjectId: order.sellerId,
          rating: body.rating,
          body: body.comment,
        },
      });
      const agg = await tx.review.aggregate({
        where: { subjectId: order.sellerId },
        _avg: { rating: true },
        _count: true,
      });
      // Mirror onto every listing of that seller so search can filter by it.
      await tx.listing.updateMany({
        where: { sellerId: order.sellerId },
        data: {
          ratingAvg: agg._avg.rating ?? 0,
          ratingCount: agg._count,
        },
      });
      return created;
    });
    return reply.code(201).send(review);
  });

  // Seller's public reply to a review.
  app.post('/api/reviews/:id/reply', async (req) => {
    const auth = await requireAuth(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { reply } = z.object({ reply: z.string().min(1).max(2000) }).parse(req.body);
    const review = await prisma.review.findUnique({ where: { id } });
    if (!review) throw NotFound('Review not found');
    if (review.subjectId !== auth.userId) throw Forbidden('Not your review to answer');
    return prisma.review.update({ where: { id }, data: { sellerReply: reply } });
  });

  // Public: reviews received by a seller.
  app.get('/api/sellers/:sellerId/reviews', async (req) => {
    const { sellerId } = z.object({ sellerId: z.string() }).parse(req.params);
    const q = paginationQuery.parse(req.query);
    const rows = await prisma.review.findMany({
      where: { subjectId: sellerId },
      orderBy: { createdAt: 'desc' },
      take: q.limit + 1,
      ...(q.cursor && { cursor: { id: q.cursor }, skip: 1 }),
      include: { author: { select: { displayName: true } } },
    });
    return buildPage(rows, q.limit);
  });
}
