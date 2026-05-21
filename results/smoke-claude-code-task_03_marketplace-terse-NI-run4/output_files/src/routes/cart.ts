// Shopping cart. A cart may contain listings from multiple sellers; checkout
// (checkout.ts) later splits it into one Order per seller.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { BadRequest, NotFound } from '../lib/errors.js';
import { publicUrl } from '../lib/s3.js';

/** Returns the user's cart, creating an empty one on first access. */
async function getOrCreateCart(userId: string) {
  return prisma.cart.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
}

export async function cartRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/cart', async (req) => {
    const auth = await requireAuth(req);
    const cart = await getOrCreateCart(auth.userId);
    const items = await prisma.cartItem.findMany({
      where: { cartId: cart.id },
      include: {
        listing: {
          include: { photos: { take: 1, orderBy: { position: 'asc' } } },
        },
      },
    });
    return {
      cartId: cart.id,
      items: items.map((i) => ({
        id: i.id,
        listingId: i.listingId,
        title: i.listing.title,
        unitAmount: i.listing.priceAmount,
        currency: i.listing.currency,
        quantity: i.quantity,
        available: i.listing.status === 'ACTIVE' && i.listing.inventory >= i.quantity,
        coverPhoto: i.listing.photos[0]
          ? publicUrl(i.listing.photos[0].objectKey)
          : null,
      })),
    };
  });

  app.post('/api/cart/items', async (req) => {
    const auth = await requireAuth(req);
    const { listingId, quantity } = z
      .object({ listingId: z.string(), quantity: z.number().int().min(1).max(99) })
      .parse(req.body);

    const listing = await prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing || listing.status !== 'ACTIVE') throw NotFound('Listing not available');
    if (listing.sellerId === auth.userId) throw BadRequest('Cannot buy your own listing');
    if (listing.inventory < quantity) throw BadRequest('Not enough inventory', 'insufficient_inventory');

    const cart = await getOrCreateCart(auth.userId);
    const item = await prisma.cartItem.upsert({
      where: { cartId_listingId: { cartId: cart.id, listingId } },
      update: { quantity },
      create: { cartId: cart.id, listingId, quantity },
    });
    return { itemId: item.id, quantity: item.quantity };
  });

  app.patch('/api/cart/items/:itemId', async (req) => {
    const auth = await requireAuth(req);
    const { itemId } = z.object({ itemId: z.string() }).parse(req.params);
    const { quantity } = z
      .object({ quantity: z.number().int().min(1).max(99) })
      .parse(req.body);
    const cart = await getOrCreateCart(auth.userId);
    const item = await prisma.cartItem.findUnique({ where: { id: itemId } });
    if (!item || item.cartId !== cart.id) throw NotFound('Cart item not found');
    return prisma.cartItem.update({ where: { id: itemId }, data: { quantity } });
  });

  app.delete('/api/cart/items/:itemId', async (req, reply) => {
    const auth = await requireAuth(req);
    const { itemId } = z.object({ itemId: z.string() }).parse(req.params);
    const cart = await getOrCreateCart(auth.userId);
    const item = await prisma.cartItem.findUnique({ where: { id: itemId } });
    if (!item || item.cartId !== cart.id) throw NotFound('Cart item not found');
    await prisma.cartItem.delete({ where: { id: itemId } });
    return reply.code(204).send();
  });
}
