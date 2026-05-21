import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/client.js";
import { BadRequest } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { platformFee, stripe } from "../../lib/stripe.js";
import { applyTax, recordTax, resolveTaxRate } from "../tax/tax.service.js";

// A cart may hold items from many sellers. Checkout fans the cart out into one
// Order per seller (Stripe Connect "separate charges & transfers": a single
// charge is taken on the platform account, then transferred to each seller at
// payout time). One Stripe PaymentIntent covers the whole checkout.
export async function startCheckout(
  buyerId: string,
  shippingCountry: string,
): Promise<{ checkoutId: string; clientSecret: string; totalAmount: number; currency: string }> {
  const cart = await prisma.cart.findUnique({
    where: { userId: buyerId },
    include: { items: { include: { listing: true } } },
  });
  if (!cart || cart.items.length === 0) throw BadRequest("Cart is empty");

  // Validate availability + a single currency across the cart.
  const currency = cart.items[0]!.listing.currency;
  for (const item of cart.items) {
    const l = item.listing;
    if (l.status !== "ACTIVE") throw BadRequest(`"${l.title}" is no longer available`);
    if (l.inventory < item.quantity) throw BadRequest(`"${l.title}" is out of stock`);
    if (l.currency !== currency) throw BadRequest("All cart items must share one currency");
    if (l.sellerId === buyerId) throw BadRequest("You cannot buy your own listing");
  }

  // Group cart items by seller.
  const bySeller = new Map<string, typeof cart.items>();
  for (const item of cart.items) {
    const list = bySeller.get(item.listing.sellerId) ?? [];
    list.push(item);
    bySeller.set(item.listing.sellerId, list);
  }

  // Build per-seller orders with tax + platform fee.
  interface BuiltItem {
    listingId: string;
    titleSnapshot: string;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
    taxRateBps: number;
    taxAmount: number;
  }
  interface BuiltOrder {
    sellerId: string;
    itemsAmount: number;
    taxAmount: number;
    platformFee: number;
    sellerNet: number;
    items: BuiltItem[];
  }
  const builtOrders: BuiltOrder[] = [];

  for (const [sellerId, items] of bySeller) {
    const builtItems: BuiltItem[] = [];
    for (const item of items) {
      const { rateBps } = await resolveTaxRate(shippingCountry, item.listing.categoryId);
      const lineTotal = item.listing.priceAmount * item.quantity;
      builtItems.push({
        listingId: item.listingId,
        titleSnapshot: item.listing.title,
        unitPrice: item.listing.priceAmount,
        quantity: item.quantity,
        lineTotal,
        taxRateBps: rateBps,
        taxAmount: applyTax(lineTotal, rateBps),
      });
    }
    const itemsAmount = builtItems.reduce((s, i) => s + i.lineTotal, 0);
    const taxAmount = builtItems.reduce((s, i) => s + i.taxAmount, 0);
    const fee = platformFee(itemsAmount);
    builtOrders.push({
      sellerId,
      itemsAmount,
      taxAmount,
      platformFee: fee,
      sellerNet: itemsAmount - fee,
      items: builtItems,
    });
  }

  const itemsAmount = builtOrders.reduce((s, o) => s + o.itemsAmount, 0);
  const taxAmount = builtOrders.reduce((s, o) => s + o.taxAmount, 0);
  const totalAmount = itemsAmount + taxAmount;

  // Persist the checkout, orders, items, and reserve inventory atomically.
  const checkout = await prisma.$transaction(async (tx) => {
    const co = await tx.checkout.create({
      data: {
        buyerId,
        currency,
        itemsAmount,
        taxAmount,
        totalAmount,
        status: "PENDING",
      },
    });

    for (const order of builtOrders) {
      await tx.order.create({
        data: {
          checkoutId: co.id,
          buyerId,
          sellerId: order.sellerId,
          currency,
          itemsAmount: order.itemsAmount,
          taxAmount: order.taxAmount,
          platformFee: order.platformFee,
          sellerNet: order.sellerNet,
          status: "PENDING_PAYMENT",
          items: { create: order.items },
        },
      });
    }

    // Reserve inventory. The conditional decrement guards against oversell
    // under concurrency: updateMany only matches rows that still have stock.
    for (const item of cart.items) {
      const updated = await tx.listing.updateMany({
        where: { id: item.listingId, inventory: { gte: item.quantity } },
        data: { inventory: { decrement: item.quantity } },
      });
      if (updated.count === 0) {
        throw BadRequest(`"${item.listing.title}" sold out during checkout`);
      }
    }
    return co;
  });

  // Create the Stripe PaymentIntent. Card data is collected client-side by
  // Stripe.js using this client secret — it never reaches our servers (SAQ-A).
  const intent = await stripe.paymentIntents.create(
    {
      amount: totalAmount,
      currency: currency.toLowerCase(),
      metadata: { checkoutId: checkout.id, buyerId },
      automatic_payment_methods: { enabled: true },
    },
    // Idempotency: a retry of this checkout reuses the same PaymentIntent.
    { idempotencyKey: `checkout_${checkout.id}` },
  );

  await prisma.checkout.update({
    where: { id: checkout.id },
    data: { stripePaymentIntentId: intent.id },
  });

  logger.info({ checkoutId: checkout.id, totalAmount }, "Checkout started");
  return {
    checkoutId: checkout.id,
    clientSecret: intent.client_secret!,
    totalAmount,
    currency,
  };
}

// Invoked by the Stripe webhook on payment_intent.succeeded. Idempotent.
export async function finalizePaidCheckout(paymentIntentId: string): Promise<void> {
  const checkout = await prisma.checkout.findUnique({
    where: { stripePaymentIntentId: paymentIntentId },
    include: { orders: true },
  });
  if (!checkout || checkout.status === "PAID") return;

  await prisma.$transaction(async (tx) => {
    await tx.checkout.update({ where: { id: checkout.id }, data: { status: "PAID" } });
    await tx.order.updateMany({
      where: { checkoutId: checkout.id },
      data: { status: "PAID" },
    });
    // Empty the buyer's cart now that the purchase is committed.
    const cart = await tx.cart.findUnique({ where: { userId: checkout.buyerId } });
    if (cart) await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
  });

  // Record tax for facilitator remittance (outside the txn — derived data).
  for (const order of checkout.orders) {
    const items = await prisma.orderItem.findMany({ where: { orderId: order.id } });
    for (const item of items) {
      if (item.taxAmount <= 0) continue;
      const listing = await prisma.listing.findUnique({ where: { id: item.listingId } });
      const { kind } = await resolveTaxRate(
        listing?.locationCountry ?? "EU",
        listing?.categoryId ?? "",
      );
      await recordTax({
        checkoutId: checkout.id,
        country: listing?.locationCountry ?? "EU",
        kind: kind ?? "VAT",
        taxableAmount: item.lineTotal,
        taxAmount: item.taxAmount,
        currency: checkout.currency,
      });
    }
  }
  logger.info({ checkoutId: checkout.id }, "Checkout finalized as PAID");
}

// Invoked on payment failure/cancellation: release reserved inventory.
export async function failCheckout(paymentIntentId: string): Promise<void> {
  const checkout = await prisma.checkout.findUnique({
    where: { stripePaymentIntentId: paymentIntentId },
    include: { orders: { include: { items: true } } },
  });
  if (!checkout || checkout.status !== "PENDING") return;

  await prisma.$transaction(async (tx) => {
    await tx.checkout.update({ where: { id: checkout.id }, data: { status: "FAILED" } });
    await tx.order.updateMany({
      where: { checkoutId: checkout.id },
      data: { status: "CANCELLED" },
    });
    // Return reserved units to inventory.
    for (const order of checkout.orders) {
      for (const item of order.items) {
        await tx.listing.update({
          where: { id: item.listingId },
          data: { inventory: { increment: item.quantity } },
        });
      }
    }
  });
  logger.info({ checkoutId: checkout.id }, "Checkout failed, inventory released");
}
