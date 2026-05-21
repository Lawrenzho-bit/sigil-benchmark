import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class MessagingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Opens (or reuses) a 1:1 conversation between the caller and another user,
   * optionally scoped to a listing or order.
   */
  async startConversation(
    userId: string,
    otherUserId: string,
    scope: { listingId?: string; orderId?: string },
  ) {
    if (userId === otherUserId) throw new ForbiddenException('Cannot message yourself');

    // Reuse an existing conversation for the same scope + participants.
    const existing = await this.prisma.conversation.findFirst({
      where: {
        listingId: scope.listingId ?? null,
        orderId: scope.orderId ?? null,
        participants: { every: { userId: { in: [userId, otherUserId] } } },
        AND: [
          { participants: { some: { userId } } },
          { participants: { some: { userId: otherUserId } } },
        ],
      },
    });
    if (existing) return existing;

    return this.prisma.conversation.create({
      data: {
        listingId: scope.listingId,
        orderId: scope.orderId,
        participants: {
          create: [{ userId }, { userId: otherUserId }],
        },
      },
    });
  }

  async listConversations(userId: string) {
    return this.prisma.conversation.findMany({
      where: { participants: { some: { userId } } },
      orderBy: { updatedAt: 'desc' },
      include: {
        participants: { include: { user: { select: { id: true, displayName: true } } } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
  }

  private async assertParticipant(userId: string, conversationId: string) {
    const part = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!part) throw new ForbiddenException('Not a participant in this conversation');
  }

  async getMessages(userId: string, conversationId: string) {
    await this.assertParticipant(userId, conversationId);
    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
    // Mark read.
    await this.prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { lastReadAt: new Date() },
    });
    return messages;
  }

  async sendMessage(userId: string, conversationId: string, body: string) {
    await this.assertParticipant(userId, conversationId);
    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: { conversationId, senderId: userId, body },
      }),
      this.prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      }),
    ]);
    return message;
  }
}
