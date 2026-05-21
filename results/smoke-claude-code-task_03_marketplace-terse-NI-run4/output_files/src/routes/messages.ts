// Buyer<->seller messaging. Conversations are uniquely keyed by
// (buyer, seller, listing) so re-opening a thread about the same listing
// returns the existing conversation.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { BadRequest, Forbidden, NotFound } from '../lib/errors.js';
import { paginationQuery, buildPage } from '../lib/pagination.js';

export async function messageRoutes(app: FastifyInstance): Promise<void> {
  // Start (or fetch) a conversation. The caller is always the buyer side here;
  // sellers reply within an existing conversation.
  app.post('/api/conversations', async (req) => {
    const auth = await requireAuth(req);
    const { sellerId, listingId } = z
      .object({ sellerId: z.string(), listingId: z.string().optional() })
      .parse(req.body);
    if (sellerId === auth.userId) throw BadRequest('Cannot message yourself');

    const seller = await prisma.user.findUnique({ where: { id: sellerId } });
    if (!seller) throw NotFound('Seller not found');

    const conversation = await prisma.conversation.upsert({
      where: {
        buyerId_sellerId_listingId: {
          buyerId: auth.userId,
          sellerId,
          listingId: listingId ?? '',
        },
      },
      update: {},
      create: { buyerId: auth.userId, sellerId, listingId: listingId ?? null },
    });
    return conversation;
  });

  app.get('/api/conversations', async (req) => {
    const auth = await requireAuth(req);
    const rows = await prisma.conversation.findMany({
      where: { OR: [{ buyerId: auth.userId }, { sellerId: auth.userId }] },
      orderBy: { updatedAt: 'desc' },
      include: { messages: { take: 1, orderBy: { createdAt: 'desc' } } },
    });
    return { data: rows };
  });

  app.get('/api/conversations/:id/messages', async (req) => {
    const auth = await requireAuth(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const convo = await prisma.conversation.findUnique({ where: { id } });
    if (!convo) throw NotFound('Conversation not found');
    if (convo.buyerId !== auth.userId && convo.sellerId !== auth.userId) {
      throw Forbidden('Not a participant');
    }
    const q = paginationQuery.parse(req.query);
    const rows = await prisma.message.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'desc' },
      take: q.limit + 1,
      ...(q.cursor && { cursor: { id: q.cursor }, skip: 1 }),
    });
    return buildPage(rows, q.limit);
  });

  app.post('/api/conversations/:id/messages', async (req, reply) => {
    const auth = await requireAuth(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { body } = z.object({ body: z.string().min(1).max(8000) }).parse(req.body);
    const convo = await prisma.conversation.findUnique({ where: { id } });
    if (!convo) throw NotFound('Conversation not found');
    if (convo.buyerId !== auth.userId && convo.sellerId !== auth.userId) {
      throw Forbidden('Not a participant');
    }
    const [message] = await prisma.$transaction([
      prisma.message.create({
        data: { conversationId: id, senderId: auth.userId, body },
      }),
      prisma.conversation.update({
        where: { id },
        data: { updatedAt: new Date() },
      }),
    ]);
    return reply.code(201).send(message);
  });
}
