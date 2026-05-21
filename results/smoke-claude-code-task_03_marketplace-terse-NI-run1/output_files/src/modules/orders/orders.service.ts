import { prisma } from "../../lib/db.js";
import { stripe } from "../../lib/stripe.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import type { OrderStatus } from "@prisma/client";

const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING_PAYMENT: ["PAID", "CANCELLED"],
  PAID: ["FULFILLING", "REFUNDED", "DISPUTED", "CANCELLED"],
  FULFILLING: ["SHIPPED", "REFUNDED", "DISPUTED"],
  SHIPPED: ["DELIVERED", "DISPUTED"],
  DELIVERED: ["COMPLETED", "DISPUTED"],
  COMPLETED: [],
  CANCELLED: [],
  REFUNDED: [],
  DISPUTED: ["REFUNDED", "COMPLETED"],
};

export function canTransition(from: OrderStatus, to: OrderStatus) {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export async function listBuyerOrders(buyerId: string, cursor?: string, limit = 20) {
  return prisma.order.findMany({
    where: { buyerId },
    orderBy: { createdAt: "desc" },
    cursor: cursor ? { id: cursor } : undefined,
    skip: cursor ? 1 : 0,
    take: limit,
    include: {
      subOrders: {
        include: {
          seller: { select: { storeName: true, storeSlug: true } },
          items: true,
        },
      },
    },
  });
}

export async function getOrderForUser(orderId: string, userId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      subOrders: {
        include: { items: true, seller: true },
      },
      shippingAddress: true,
    },
  });
  if (!order) throw notFound();
  const isBuyer = order.buyerId === userId;
  const sellerSubs = order.subOrders.filter((s) => s.seller.userId === userId);
  if (!isBuyer && sellerSubs.length === 0) throw forbidden();
  // Sellers only see their own sub-orders.
  return isBuyer
    ? order
    : { ...order, subOrders: sellerSubs, buyerId: undefined };
}

export async function listSellerSubOrders(
  userId: string,
  status?: OrderStatus,
  cursor?: string,
  limit = 20,
) {
  const seller = await prisma.sellerProfile.findUnique({ where: { userId } });
  if (!seller) throw forbidden("Not a seller");
  return prisma.subOrder.findMany({
    where: { sellerProfileId: seller.id, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    cursor: cursor ? { id: cursor } : undefined,
    skip: cursor ? 1 : 0,
    take: limit,
    include: { items: true, order: { select: { id: true, buyerId: true } } },
  });
}

export async function markSubOrderShipped(
  userId: string,
  subOrderId: string,
  shipping: { carrier?: string; tracking?: string },
) {
  const sub = await prisma.subOrder.findUnique({
    where: { id: subOrderId },
    include: { seller: true },
  });
  if (!sub) throw notFound();
  if (sub.seller.userId !== userId) throw forbidden();
  if (sub.status !== "PAID" && sub.status !== "FULFILLING") {
    throw badRequest(`Cannot ship from status ${sub.status}`);
  }
  return prisma.subOrder.update({
    where: { id: subOrderId },
    data: {
      status: "SHIPPED",
      shippedAt: new Date(),
      shippingCarrier: shipping.carrier,
      shippingTracking: shipping.tracking,
    },
  });
}

export async function markSubOrderDelivered(userId: string, subOrderId: string) {
  const sub = await prisma.subOrder.findUnique({
    where: { id: subOrderId },
    include: { seller: true },
  });
  if (!sub) throw notFound();
  if (sub.seller.userId !== userId) throw forbidden();
  if (sub.status !== "SHIPPED") throw badRequest("Sub-order not in SHIPPED");
  return prisma.subOrder.update({
    where: { id: subOrderId },
    data: { status: "DELIVERED", deliveredAt: new Date() },
  });
}

export async function buyerConfirmDelivery(userId: string, subOrderId: string) {
  const sub = await prisma.subOrder.findUnique({
    where: { id: subOrderId },
    include: { order: true },
  });
  if (!sub) throw notFound();
  if (sub.order.buyerId !== userId) throw forbidden();
  if (sub.status !== "DELIVERED" && sub.status !== "SHIPPED") {
    throw badRequest(`Cannot complete from ${sub.status}`);
  }
  return prisma.subOrder.update({
    where: { id: subOrderId },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
}

export async function refundSubOrder(subOrderId: string, amountCents: number, reason: string) {
  const sub = await prisma.subOrder.findUnique({
    where: { id: subOrderId },
    include: { order: true },
  });
  if (!sub) throw notFound();
  if (!sub.order.stripePaymentIntent) throw badRequest("Order has no PaymentIntent");
  const totalCents = sub.subtotalCents + sub.taxCents + sub.shippingCents;
  if (amountCents > totalCents) throw badRequest("Refund exceeds sub-order total");

  await stripe.refunds.create({
    payment_intent: sub.order.stripePaymentIntent,
    amount: amountCents,
    reason: "requested_by_customer",
    metadata: { subOrderId, reason },
  });

  await prisma.subOrder.update({
    where: { id: subOrderId },
    data: { status: amountCents === totalCents ? "REFUNDED" : sub.status },
  });
}
