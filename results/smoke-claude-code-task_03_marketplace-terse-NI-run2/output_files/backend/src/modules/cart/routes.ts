import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db';
import { parse } from '../../lib/validation';
import { badRequest, notFound } from '../../lib/errors';
import { requireAuth } from '../../auth/middleware';

export async function cartRoutes(app: FastifyInstance): Promise<void> {
  app.get('/cart', async (req) => {
    const auth = requireAuth(req);
    return loadCart(auth.id);
  });

  app.post('/cart/items', async (req) => {
    const auth = requireAuth(req);
    const body = parse(
      z.object({
        listingId: z.string().uuid(),
        quantity: z.number().int().min(1).max(99).default(1),
      }),
      req.body,
    );

    const listing = await prisma.listing.findUnique({ where: { id: body.listingId } });
    if (!listing || listing.status !== 'ACTIVE') throw notFound('Listing not available');
    if (listing.sellerId === auth.id) throw badRequest('Cannot buy your own listing');
    if (listing.inventory < body.quantity) throw badRequest('Insufficient inventory');

    await prisma.cartItem.upsert({
      where: { userId_listingId: { userId: auth.id, listingId: body.listingId } },
      create: { userId: auth.id, listingId: body.listingId, quantity: body.quantity },
      update: { quantity: body.quantity },
    });
    return loadCart(auth.id);
  });

  app.delete('/cart/items/:listingId', async (req) => {
    const auth = requireAuth(req);
    const { listingId } = req.params as { listingId: string };
    await prisma.cartItem.deleteMany({ where: { userId: auth.id, listingId } });
    return loadCart(auth.id);
  });

  app.delete('/cart', async (req) => {
    const auth = requireAuth(req);
    await prisma.cartItem.deleteMany({ where: { userId: auth.id } });
    return { items: [], subtotalCents: 0 };
  });
}

async function loadCart(userId: string) {
  const items = await prisma.cartItem.findMany({
    where: { userId },
    include: { listing: { include: { photos: { take: 1 } } } },
  });
  const priced = items.map((it) => ({
    listingId: it.listingId,
    title: it.listing.title,
    unitPriceCents: it.listing.priceCents,
    quantity: it.quantity,
    lineCents: it.listing.priceCents * it.quantity,
    available: it.listing.status === 'ACTIVE' && it.listing.inventory >= it.quantity,
  }));
  return {
    items: priced,
    subtotalCents: priced.reduce((sum, it) => sum + it.lineCents, 0),
  };
}
