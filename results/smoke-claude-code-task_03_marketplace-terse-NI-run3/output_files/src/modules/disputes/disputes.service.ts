import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Dispute lifecycle:
 *   OPEN -> SELLER_RESPONDED -> ESCALATED -> RESOLVED_* -> CLOSED
 * A buyer opens it, the seller responds, either party (or a timeout) escalates
 * to a platform admin, who issues the final resolution.
 */
@Injectable()
export class DisputesService {
  constructor(private readonly prisma: PrismaService) {}

  async openDispute(userId: string, orderId: string, reason: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { group: true, dispute: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.group.buyerId !== userId) throw new ForbiddenException('Not your order');
    if (order.dispute) throw new ConflictException('Dispute already exists for this order');
    if (!['PAID', 'SHIPPED', 'DELIVERED'].includes(order.status)) {
      throw new BadRequestException('Order is not in a disputable state');
    }

    return this.prisma.$transaction(async (tx) => {
      const dispute = await tx.dispute.create({
        data: { orderId, raisedById: userId, reason, status: 'OPEN' },
      });
      await tx.order.update({ where: { id: orderId }, data: { status: 'DISPUTED' } });
      await tx.disputeEvent.create({
        data: { disputeId: dispute.id, actorId: userId, type: 'status_change', body: 'Dispute opened' },
      });
      return dispute;
    });
  }

  /** Either party adds a comment or evidence to the thread. */
  async addEvent(userId: string, disputeId: string, type: string, body: string) {
    const dispute = await this.loadParticipantDispute(userId, disputeId);
    const event = await this.prisma.disputeEvent.create({
      data: { disputeId: dispute.id, actorId: userId, type, body },
    });
    // First seller message advances the state.
    if (dispute.status === 'OPEN') {
      const order = await this.prisma.order.findUnique({
        where: { id: dispute.orderId },
        include: { seller: true },
      });
      if (order?.seller.userId === userId) {
        await this.prisma.dispute.update({
          where: { id: disputeId },
          data: { status: 'SELLER_RESPONDED' },
        });
      }
    }
    return event;
  }

  /** Escalate to platform admin review. */
  async escalate(userId: string, disputeId: string) {
    const dispute = await this.loadParticipantDispute(userId, disputeId);
    if (['ESCALATED', 'CLOSED'].includes(dispute.status)) {
      throw new BadRequestException('Dispute cannot be escalated from its current state');
    }
    return this.prisma.dispute.update({
      where: { id: disputeId },
      data: { status: 'ESCALATED' },
    });
  }

  /**
   * Admin resolution. RESOLVED_REFUND / RESOLVED_PARTIAL trigger a Stripe
   * refund (queued); RESOLVED_RELEASE clears the order for normal payout.
   */
  async resolve(
    adminId: string,
    disputeId: string,
    outcome: 'RESOLVED_REFUND' | 'RESOLVED_RELEASE' | 'RESOLVED_PARTIAL',
    note: string,
    refundAmountCents?: number,
  ) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) throw new NotFoundException('Dispute not found');

    const orderStatus = outcome === 'RESOLVED_RELEASE' ? 'DELIVERED' : 'REFUNDED';

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.dispute.update({
        where: { id: disputeId },
        data: {
          status: outcome,
          resolutionNote: note,
          refundAmountCents: refundAmountCents ?? null,
          resolvedByAdminId: adminId,
          resolvedAt: new Date(),
        },
      });
      await tx.order.update({ where: { id: dispute.orderId }, data: { status: orderStatus } });
      await tx.disputeEvent.create({
        data: {
          disputeId,
          actorId: adminId,
          type: 'status_change',
          body: `Resolved: ${outcome}. ${note}`,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: adminId,
          action: 'dispute.resolved',
          targetType: 'dispute',
          targetId: disputeId,
          metadata: { outcome, refundAmountCents },
        },
      });
      // NOTE: actual Stripe refund / transfer reversal is enqueued here.
      return updated;
    });
  }

  async getDispute(userId: string, disputeId: string) {
    return this.loadParticipantDispute(userId, disputeId, true);
  }

  private async loadParticipantDispute(userId: string, disputeId: string, withEvents = false) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      include: {
        events: withEvents ? { orderBy: { createdAt: 'asc' } } : false,
        order: { include: { seller: true, group: true } },
      },
    });
    if (!dispute) throw new NotFoundException('Dispute not found');

    const isBuyer = dispute.order.group.buyerId === userId;
    const isSeller = dispute.order.seller.userId === userId;
    if (!isBuyer && !isSeller) throw new ForbiddenException('Not a party to this dispute');
    return dispute;
  }
}
