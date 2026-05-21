// Dispute resolution workflow.
//
// A buyer opens a dispute against a delivered/shipped order. The parties
// exchange messages; either side can escalate to an admin, who resolves it
// with a refund or by releasing funds to the seller (see admin.ts).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { BadRequest, Conflict, Forbidden, NotFound } from '../lib/errors.js';

export async function disputeRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/orders/:orderId/dispute', async (req, reply) => {
    const auth = await requireAuth(req);
    const { orderId } = z.object({ orderId: z.string() }).parse(req.params);
    const { reason } = z
      .object({ reason: z.string().min(5).max(2000) })
      .parse(req.body);

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { dispute: true },
    });
    if (!order) throw NotFound('Order not found');
    if (order.buyerId !== auth.userId) throw Forbidden('Only the buyer may open a dispute');
    if (order.dispute) throw Conflict('A dispute already exists for this order');
    if (!['PAID', 'FULFILLING', 'SHIPPED', 'DELIVERED'].includes(order.status)) {
      throw BadRequest('Order is not in a disputable state', 'not_disputable');
    }

    const dispute = await prisma.dispute.create({
      data: {
        orderId,
        openerId: auth.userId,
        reason,
        status: 'AWAITING_SELLER',
        messages: { create: { senderId: auth.userId, body: reason } },
      },
    });
    return reply.code(201).send(dispute);
  });

  app.get('/api/disputes/:id', async (req) => {
    const auth = await requireAuth(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const dispute = await prisma.dispute.findUnique({
      where: { id },
      include: { order: true, messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!dispute) throw NotFound('Dispute not found');
    const isParty =
      dispute.order.buyerId === auth.userId ||
      dispute.order.sellerId === auth.userId;
    if (!isParty && auth.role !== 'ADMIN') throw Forbidden('Not a party to this dispute');

    // Hide internal admin notes from the buyer/seller.
    const messages =
      auth.role === 'ADMIN'
        ? dispute.messages
        : dispute.messages.filter((m) => !m.internal);
    return { ...dispute, messages };
  });

  app.post('/api/disputes/:id/messages', async (req, reply) => {
    const auth = await requireAuth(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { body } = z.object({ body: z.string().min(1).max(8000) }).parse(req.body);

    const dispute = await prisma.dispute.findUnique({
      where: { id },
      include: { order: true },
    });
    if (!dispute) throw NotFound('Dispute not found');
    const isBuyer = dispute.order.buyerId === auth.userId;
    const isSeller = dispute.order.sellerId === auth.userId;
    if (!isBuyer && !isSeller) throw Forbidden('Not a party to this dispute');
    if (['RESOLVED_REFUND', 'RESOLVED_RELEASE', 'CLOSED'].includes(dispute.status)) {
      throw BadRequest('Dispute is closed', 'dispute_closed');
    }

    const [message] = await prisma.$transaction([
      prisma.disputeMessage.create({
        data: { disputeId: id, senderId: auth.userId, body },
      }),
      prisma.dispute.update({
        where: { id },
        data: { status: isBuyer ? 'AWAITING_SELLER' : 'AWAITING_BUYER' },
      }),
    ]);
    return reply.code(201).send(message);
  });

  // Either party can escalate a stalled dispute to admin review.
  app.post('/api/disputes/:id/escalate', async (req) => {
    const auth = await requireAuth(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const dispute = await prisma.dispute.findUnique({
      where: { id },
      include: { order: true },
    });
    if (!dispute) throw NotFound('Dispute not found');
    if (
      dispute.order.buyerId !== auth.userId &&
      dispute.order.sellerId !== auth.userId
    ) {
      throw Forbidden('Not a party to this dispute');
    }
    return prisma.dispute.update({
      where: { id },
      data: { status: 'ESCALATED' },
    });
  });
}
