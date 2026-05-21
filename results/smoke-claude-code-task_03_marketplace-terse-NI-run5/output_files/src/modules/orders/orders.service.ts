import type { OrderStatus } from "@prisma/client";
import { prisma } from "../../db/client.js";
import { BadRequest, Forbidden, NotFound } from "../../lib/errors.js";

const orderInclude = {
  items: true,
  checkout: { select: { id: true, status: true, totalAmount: true } },
} as const;

// Orders the user placed as a buyer.
export async function listBuyerOrders(buyerId: string) {
  return prisma.order.findMany({
    where: { buyerId },
    include: orderInclude,
    orderBy: { createdAt: "desc" },
  });
}

// Orders the user must fulfil as a seller.
export async function listSellerOrders(sellerId: string, status?: OrderStatus) {
  return prisma.order.findMany({
    where: { sellerId, ...(status ? { status } : {}) },
    include: orderInclude,
    orderBy: { createdAt: "desc" },
  });
}

// Loads an order, enforcing that the requester is its buyer or seller.
export async function getOrderForParty(orderId: string, userId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: orderInclude });
  if (!order) throw NotFound("Order not found");
  if (order.buyerId !== userId && order.sellerId !== userId) {
    throw Forbidden("You are not a party to this order");
  }
  return order;
}

// Seller marks a paid order as shipped.
export async function markShipped(orderId: string, sellerId: string, trackingCode?: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw NotFound("Order not found");
  if (order.sellerId !== sellerId) throw Forbidden("Not your order");
  if (order.status !== "PAID") throw BadRequest("Only paid orders can be shipped");
  return prisma.order.update({
    where: { id: orderId },
    data: { status: "SHIPPED", trackingCode },
  });
}

// Buyer confirms delivery. This starts the payout-eligibility clock and unlocks
// the ability to leave a review.
export async function confirmDelivery(orderId: string, buyerId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw NotFound("Order not found");
  if (order.buyerId !== buyerId) throw Forbidden("Not your order");
  if (order.status !== "SHIPPED" && order.status !== "PAID") {
    throw BadRequest("Order is not in a deliverable state");
  }
  return prisma.order.update({
    where: { id: orderId },
    data: { status: "DELIVERED", deliveredAt: new Date() },
  });
}

// Buyer cancels an order that has not yet shipped. Restores inventory.
export async function cancelOrder(orderId: string, buyerId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order) throw NotFound("Order not found");
  if (order.buyerId !== buyerId) throw Forbidden("Not your order");
  if (order.status !== "PAID") throw BadRequest("Only unshipped paid orders can be cancelled");

  return prisma.$transaction(async (tx) => {
    for (const item of order.items) {
      await tx.listing.update({
        where: { id: item.listingId },
        data: { inventory: { increment: item.quantity } },
      });
    }
    // A refund is issued by the dispute/refund flow; here we just flag intent.
    return tx.order.update({ where: { id: orderId }, data: { status: "CANCELLED" } });
  });
}
