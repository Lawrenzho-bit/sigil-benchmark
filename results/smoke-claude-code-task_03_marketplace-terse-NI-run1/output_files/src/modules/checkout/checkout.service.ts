import { prisma } from "../../lib/db.js";
import { stripe } from "../../lib/stripe.js";
import { config } from "../../config.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { computeTaxForLines, type TaxLineInput } from "../tax/tax.service.js";

interface CheckoutResult {
  orderId: string;
  clientSecret: string;
  amountCents: number;
  currency: string;
}

/**
 * Build an order from the current cart and create a Stripe PaymentIntent
 * using the "separate charges and transfers" model so we can split funds
 * across multiple connected sellers from a single payment.
 *
 * Funds are held on the platform until each SubOrder is paid out via a
 * separate Transfer (created when the seller marks the order shipped, or
 * by the weekly payouts job — whichever the platform prefers).
 */
export async function startCheckout(
  buyerId: string,
  input: { shippingAddressId: string },
): Promise<CheckoutResult> {
  const cart = await prisma.cart.findFirst({
    where: { buyerId },
    include: {
      items: {
        include: { listing: { include: { store: true } } },
      },
    },
  });
  if (!cart || cart.items.length === 0) throw badRequest("Cart is empty");

  const address = await prisma.address.findUnique({ where: { id: input.shippingAddressId } });
  if (!address || address.userId !== buyerId) throw badRequest("Invalid shipping address");

  // Validate all items first.
  const currency = cart.items[0]!.listing.currency;
  for (const i of cart.items) {
    if (i.listing.status !== "ACTIVE") throw badRequest(`"${i.listing.title}" no longer available`);
    if (i.listing.inventory < i.quantity) throw badRequest(`"${i.listing.title}" out of stock`);
    if (i.listing.currency !== currency) throw badRequest("Mixed-currency carts not supported");
    if (!i.listing.store.chargesEnabled) {
      throw badRequest(`Seller "${i.listing.store.storeName}" cannot accept payments`);
    }
  }

  // Group items per seller into SubOrders.
  const bySeller = new Map<string, typeof cart.items>();
  for (const i of cart.items) {
    const arr = bySeller.get(i.listing.sellerProfileId) ?? [];
    arr.push(i);
    bySeller.set(i.listing.sellerProfileId, arr);
  }

  const taxLines: TaxLineInput[] = cart.items.map((i) => ({
    reference: i.id,
    amountCents: i.listing.priceCents * i.quantity,
    quantity: i.quantity,
    productCategory: "general",
  }));
  const taxResult = await computeTaxForLines(taxLines, {
    country: address.country,
    region: address.region ?? undefined,
    postal: address.postal,
  }, currency);

  let subtotalCents = 0;
  let taxCents = 0;
  for (const i of cart.items) {
    subtotalCents += i.listing.priceCents * i.quantity;
    taxCents += taxResult.lineTaxByRef.get(i.id) ?? 0;
  }
  const totalCents = subtotalCents + taxCents;

  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        buyerId,
        subtotalCents,
        taxCents,
        totalCents,
        currency,
        shippingAddressId: address.id,
        status: "PENDING_PAYMENT",
      },
    });

    for (const [sellerProfileId, items] of bySeller) {
      const sub = await tx.subOrder.create({
        data: {
          orderId: order.id,
          sellerProfileId,
          subtotalCents: items.reduce((s, i) => s + i.listing.priceCents * i.quantity, 0),
          taxCents: items.reduce(
            (s, i) => s + (taxResult.lineTaxByRef.get(i.id) ?? 0),
            0,
          ),
          platformFeeCents: Math.floor(
            (items.reduce((s, i) => s + i.listing.priceCents * i.quantity, 0) *
              config.STRIPE_PLATFORM_FEE_BPS) /
              10_000,
          ),
        },
      });
      for (const i of items) {
        await tx.orderItem.create({
          data: {
            subOrderId: sub.id,
            listingId: i.listingId,
            titleSnapshot: i.listing.title,
            unitPriceCents: i.listing.priceCents,
            quantity: i.quantity,
            taxCents: taxResult.lineTaxByRef.get(i.id) ?? 0,
          },
        });
        // Decrement inventory pessimistically; refunded on order cancel.
        await tx.listing.update({
          where: { id: i.listingId },
          data: { inventory: { decrement: i.quantity } },
        });
      }
    }

    return order;
  });

  const pi = await stripe.paymentIntents.create({
    amount: totalCents,
    currency,
    automatic_payment_methods: { enabled: true },
    transfer_group: result.id,
    metadata: { orderId: result.id, buyerId },
  });

  await prisma.order.update({
    where: { id: result.id },
    data: { stripePaymentIntent: pi.id },
  });

  if (!pi.client_secret) throw new Error("Stripe did not return client_secret");

  return {
    orderId: result.id,
    clientSecret: pi.client_secret,
    amountCents: totalCents,
    currency,
  };
}

export async function confirmOrderPaid(paymentIntentId: string) {
  const order = await prisma.order.findUnique({
    where: { stripePaymentIntent: paymentIntentId },
    include: { subOrders: true },
  });
  if (!order) throw notFound("Order not found for PaymentIntent");
  if (order.status !== "PENDING_PAYMENT") return order;
  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: order.id }, data: { status: "PAID" } });
    await tx.subOrder.updateMany({
      where: { orderId: order.id },
      data: { status: "PAID" },
    });
    await tx.cart.deleteMany({ where: { buyerId: order.buyerId } });
  });
}
