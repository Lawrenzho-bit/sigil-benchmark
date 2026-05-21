// Checkout: turns a cart into one Order per seller and a Stripe PaymentIntent
// per order (destination charge — see lib/stripe.ts).
//
// Inventory is decremented inside the same transaction that creates the
// orders, under a row lock, so two concurrent checkouts cannot oversell.
// Orders stay PENDING_PAYMENT until the Stripe webhook confirms payment.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { BadRequest, NotFound, UnprocessableEntity } from '../lib/errors.js';
import { calculateTax } from '../lib/tax.js';
import { platformFee, createOrderPaymentIntent } from '../lib/stripe.js';

export async function checkoutRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/checkout', async (req) => {
    const auth = await requireAuth(req);
    const { shippingAddressId } = z
      .object({ shippingAddressId: z.string() })
      .parse(req.body);

    const address = await prisma.address.findUnique({
      where: { id: shippingAddressId },
    });
    if (!address || address.userId !== auth.userId) {
      throw BadRequest('Invalid shipping address', 'bad_address');
    }

    const cart = await prisma.cart.findUnique({
      where: { userId: auth.userId },
      include: { items: { include: { listing: true } } },
    });
    if (!cart || cart.items.length === 0) throw BadRequest('Cart is empty');

    // Group cart items by seller — one Order per seller.
    const bySeller = new Map<string, typeof cart.items>();
    for (const item of cart.items) {
      const list = bySeller.get(item.listing.sellerId) ?? [];
      list.push(item);
      bySeller.set(item.listing.sellerId, list);
    }

    // Create all orders + reserve inventory atomically.
    const orders = await prisma.$transaction(async (tx) => {
      const created: { id: string; sellerId: string }[] = [];
      for (const [sellerId, items] of bySeller) {
        let subtotal = 0;
        const orderItems = items.map((i) => {
          if (i.listing.status !== 'ACTIVE') {
            throw UnprocessableEntity(`"${i.listing.title}" is no longer available`);
          }
          if (i.listing.inventory < i.quantity) {
            throw UnprocessableEntity(`"${i.listing.title}" is out of stock`);
          }
          subtotal += i.listing.priceAmount * i.quantity;
          return {
            listingId: i.listingId,
            titleSnapshot: i.listing.title,
            unitAmount: i.listing.priceAmount,
            quantity: i.quantity,
          };
        });

        const currency = items[0]!.listing.currency;
        const tax = calculateTax(subtotal, address.countryCode);
        const fee = platformFee(subtotal);

        const order = await tx.order.create({
          data: {
            buyerId: auth.userId,
            sellerId,
            currency,
            subtotalAmount: subtotal,
            taxAmount: tax.taxAmount,
            platformFee: fee,
            totalAmount: subtotal + tax.taxAmount,
            shippingAddressId,
            items: { create: orderItems },
            taxRecord: {
              create: {
                jurisdiction: tax.jurisdiction,
                taxType: tax.taxType,
                ratePpm: tax.ratePpm,
                taxableAmount: tax.taxableAmount,
                taxAmount: tax.taxAmount,
                facilitator: true,
              },
            },
          },
        });

        // Decrement inventory; the conditional `where` makes it a no-op if a
        // concurrent checkout already took the stock — caught below.
        for (const i of items) {
          const updated = await tx.listing.updateMany({
            where: { id: i.listingId, inventory: { gte: i.quantity } },
            data: { inventory: { decrement: i.quantity } },
          });
          if (updated.count === 0) {
            throw UnprocessableEntity(`"${i.listing.title}" sold out during checkout`);
          }
        }
        created.push({ id: order.id, sellerId });
      }
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      return created;
    });

    // Create a PaymentIntent per order (outside the DB transaction — network
    // calls must not hold a Postgres transaction open).
    const payments = [];
    for (const { id, sellerId } of orders) {
      const order = await prisma.order.findUniqueOrThrow({ where: { id } });
      const sellerProfile = await prisma.sellerProfile.findUnique({
        where: { userId: sellerId },
      });
      if (!sellerProfile?.stripeAccountId || !sellerProfile.payoutsEnabled) {
        throw UnprocessableEntity('Seller is not able to accept payments');
      }
      const pi = await createOrderPaymentIntent({
        orderId: order.id,
        totalMinor: order.totalAmount,
        feeMinor: order.platformFee,
        currency: order.currency,
        sellerStripeAccountId: sellerProfile.stripeAccountId,
      });
      await prisma.payment.create({
        data: {
          orderId: order.id,
          status: 'REQUIRES_ACTION',
          stripePaymentIntentId: pi.id,
          amount: order.totalAmount,
          currency: order.currency,
        },
      });
      payments.push({
        orderId: order.id,
        amount: order.totalAmount,
        currency: order.currency,
        clientSecret: pi.client_secret, // browser confirms via Stripe.js
      });
    }

    return { orders: payments };
  });
}
