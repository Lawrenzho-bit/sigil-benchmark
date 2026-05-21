import { prisma } from "../../db/client.js";
import { BadRequest, Forbidden, NotFound } from "../../lib/errors.js";

// Opens (or reuses) a conversation between a buyer and a seller. Conversations
// are keyed by (buyer, seller, listing) so the same pair can hold separate
// threads per listing.
export async function openConversation(
  userId: string,
  sellerId: string,
  listingId?: string,
) {
  if (userId === sellerId) throw BadRequest("Cannot message yourself");
  const seller = await prisma.user.findUnique({ where: { id: sellerId } });
  if (!seller) throw NotFound("Seller not found");

  return prisma.conversation.upsert({
    where: {
      buyerId_sellerId_listingId: { buyerId: userId, sellerId, listingId: listingId ?? null },
    },
    update: {},
    create: { buyerId: userId, sellerId, listingId: listingId ?? null },
  });
}

// Conversations the user participates in, as either buyer or seller.
export async function listConversations(userId: string) {
  const convos = await prisma.conversation.findMany({
    where: { OR: [{ buyerId: userId }, { sellerId: userId }] },
    include: {
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
      buyer: { select: { id: true, displayName: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  return convos.map((c) => ({
    id: c.id,
    listingId: c.listingId,
    counterpartIsBuyer: c.sellerId === userId,
    lastMessage: c.messages[0]?.body ?? null,
    updatedAt: c.updatedAt,
  }));
}

async function assertParticipant(conversationId: string, userId: string) {
  const convo = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!convo) throw NotFound("Conversation not found");
  if (convo.buyerId !== userId && convo.sellerId !== userId) {
    throw Forbidden("You are not part of this conversation");
  }
  return convo;
}

export async function getMessages(conversationId: string, userId: string) {
  await assertParticipant(conversationId, userId);
  // Mark messages from the counterpart as read.
  await prisma.message.updateMany({
    where: { conversationId, senderId: { not: userId }, readAt: null },
    data: { readAt: new Date() },
  });
  return prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
  });
}

export async function sendMessage(conversationId: string, senderId: string, body: string) {
  await assertParticipant(conversationId, senderId);
  const [message] = await prisma.$transaction([
    prisma.message.create({ data: { conversationId, senderId, body } }),
    // Bump the conversation so it sorts to the top of the inbox.
    prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } }),
  ]);
  return message;
}
