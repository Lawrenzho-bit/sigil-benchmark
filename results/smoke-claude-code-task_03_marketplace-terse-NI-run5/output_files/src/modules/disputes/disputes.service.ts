import type { DisputeStatus } from "@prisma/client";
import { prisma } from "../../db/client.js";
import { BadRequest, Conflict, Forbidden, NotFound } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { stripe } from "../../lib/stripe.js";

// A buyer opens a dispute against a delivered/shipped order. One per order.
export async function openDispute(buyerId: string, orderId: string, reason: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw NotFound("Order not found");
  if (order.buyerId !== buyerId) throw Forbidden("You can only dispute your own orders");
  if (!["PAID", "SHIPPED", "DELIVERED"].includes(order.status)) {
    throw BadRequest("This order cannot be disputed in its current state");
  }
  const existing = await prisma.dispute.findUnique({ where: { orderId } });
  if (existing) throw Conflict("A dispute already exists for this order");

  const dispute = await prisma.dispute.create({
    data: {
      orderId,
      openedById: buyerId,
      reason,
      status: "OPEN",
      messages: { create: { senderId: buyerId, senderRole: "buyer", body: reason } },
    },
  });
  logger.info({ disputeId: dispute.id, orderId }, "Dispute opened");
  return dispute;
}

async function loadParty(disputeId: string, userId: string) {
  const dispute = await prisma.dispute.findUnique({
    where: { id: disputeId },
    include: { order: true, messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!dispute) throw NotFound("Dispute not found");
  const isBuyer = dispute.order.buyerId === userId;
  const isSeller = dispute.order.sellerId === userId;
  if (!isBuyer && !isSeller) throw Forbidden("You are not a party to this dispute");
  return { dispute, role: isBuyer ? "buyer" : "seller" };
}

export async function getDispute(disputeId: string, userId: string) {
  const { dispute } = await loadParty(disputeId, userId);
  return dispute;
}

// Either party adds a message; the seller's first reply advances the status.
export async function addDisputeMessage(disputeId: string, userId: string, body: string) {
  const { dispute, role } = await loadParty(disputeId, userId);
  if (["RESOLVED_BUYER", "RESOLVED_SELLER", "CLOSED"].includes(dispute.status)) {
    throw BadRequest("This dispute is already resolved");
  }
  await prisma.disputeMessage.create({
    data: { disputeId, senderId: userId, senderRole: role, body },
  });
  if (role === "seller" && dispute.status === "OPEN") {
    await prisma.dispute.update({
      where: { id: disputeId },
      data: { status: "SELLER_RESPONDED" },
    });
  }
  return getDispute(disputeId, userId);
}

// A party (typically the buyer) escalates the dispute to platform admins.
export async function escalateDispute(disputeId: string, userId: string) {
  const { dispute } = await loadParty(disputeId, userId);
  if (["RESOLVED_BUYER", "RESOLVED_SELLER", "CLOSED"].includes(dispute.status)) {
    throw BadRequest("This dispute is already resolved");
  }
  return prisma.dispute.update({ where: { id: disputeId }, data: { status: "ESCALATED" } });
}

// Admin resolution. A buyer-favoured outcome issues a Stripe refund for the
// agreed amount and marks the order REFUNDED.
export async function resolveDispute(input: {
  disputeId: string;
  outcome: "buyer" | "seller";
  resolution: string;
  refundAmount?: number;
}) {
  const dispute = await prisma.dispute.findUnique({
    where: { id: input.disputeId },
    include: { order: { include: { checkout: true } } },
  });
  if (!dispute) throw NotFound("Dispute not found");

  let status: DisputeStatus = "RESOLVED_SELLER";
  if (input.outcome === "buyer") {
    status = "RESOLVED_BUYER";
    const refund = input.refundAmount ?? dispute.order.itemsAmount + dispute.order.taxAmount;
    const paymentIntentId = dispute.order.checkout.stripePaymentIntentId;
    if (paymentIntentId) {
      await stripe.refunds.create(
        { payment_intent: paymentIntentId, amount: refund },
        { idempotencyKey: `dispute_refund_${dispute.id}` },
      );
    }
    await prisma.order.update({
      where: { id: dispute.orderId },
      data: { status: "REFUNDED" },
    });
  }

  return prisma.dispute.update({
    where: { id: input.disputeId },
    data: {
      status,
      resolution: input.resolution,
      refundAmount: input.outcome === "buyer" ? input.refundAmount : null,
    },
  });
}
