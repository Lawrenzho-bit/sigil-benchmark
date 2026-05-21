import { prisma } from "../../lib/db.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";

export async function startConversation(
  userId: string,
  input: { otherUserId: string; orderId?: string; firstMessage: string },
) {
  if (userId === input.otherUserId) throw badRequest("Cannot message yourself");
  const other = await prisma.user.findUnique({ where: { id: input.otherUserId } });
  if (!other || other.status !== "ACTIVE") throw notFound("Recipient unavailable");

  // Find existing conversation between same two participants (no order context).
  const existing = await prisma.conversation.findFirst({
    where: {
      orderId: input.orderId ?? null,
      AND: [
        { participants: { some: { userId } } },
        { participants: { some: { userId: input.otherUserId } } },
      ],
    },
  });
  const convo =
    existing ??
    (await prisma.conversation.create({
      data: {
        orderId: input.orderId,
        participants: {
          create: [{ userId }, { userId: input.otherUserId }],
        },
      },
    }));

  return sendMessage(userId, convo.id, input.firstMessage);
}

export async function sendMessage(senderId: string, conversationId: string, bodyText: string) {
  const participant = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId: senderId } },
  });
  if (!participant) throw forbidden();
  const trimmed = bodyText.trim();
  if (!trimmed) throw badRequest("Empty message");
  if (trimmed.length > 4000) throw badRequest("Message too long");

  const [msg] = await prisma.$transaction([
    prisma.message.create({
      data: { conversationId, senderId, body: trimmed },
    }),
    prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    }),
  ]);
  return msg;
}

export async function listConversations(userId: string, cursor?: string, limit = 20) {
  return prisma.conversation.findMany({
    where: { participants: { some: { userId } } },
    orderBy: { lastMessageAt: "desc" },
    cursor: cursor ? { id: cursor } : undefined,
    skip: cursor ? 1 : 0,
    take: limit,
    include: {
      participants: { include: { user: { select: { id: true, displayName: true } } } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
}

export async function getMessages(userId: string, conversationId: string, cursor?: string, limit = 50) {
  const participant = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  if (!participant) throw forbidden();
  const msgs = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    cursor: cursor ? { id: cursor } : undefined,
    skip: cursor ? 1 : 0,
    take: limit,
  });
  await prisma.conversationParticipant.update({
    where: { conversationId_userId: { conversationId, userId } },
    data: { lastReadAt: new Date() },
  });
  return msgs;
}
