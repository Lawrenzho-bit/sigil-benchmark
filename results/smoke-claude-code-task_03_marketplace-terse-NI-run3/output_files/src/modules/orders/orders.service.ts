import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  /** All checkouts placed by a buyer. */
  listForBuyer(buyerId: string) {
    return this.prisma.orderGroup.findMany({
      where: { buyerId },
      orderBy: { createdAt: 'desc' },
      include: { orders: { include: { items: true } }, taxRecord: true },
    });
  }

  /** All seller-side orders, optionally filtered by status. */
  async listForSeller(userId: string, status?: string) {
    const profile = await this.prisma.sellerProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Not a seller');
    return this.prisma.order.findMany({
      where: { sellerId: profile.id, ...(status ? { status: status as any } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { items: true, group: { select: { shippingAddress: true, buyerId: true } } },
    });
  }

  async getOrder(userId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, group: true, seller: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    const isBuyer = order.group.buyerId === userId;
    const isSeller = order.seller.userId === userId;
    if (!isBuyer && !isSeller) throw new ForbiddenException('Not your order');
    return order;
  }

  /** Seller marks an order shipped and records tracking. */
  async markShipped(userId: string, orderId: string, carrier: string, trackingNumber: string) {
    const order = await this.assertSellerOrder(userId, orderId);
    if (order.status !== 'PAID') {
      throw new BadRequestException('Only paid orders can be shipped');
    }
    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'SHIPPED',
        trackingCarrier: carrier,
        trackingNumber,
        shippedAt: new Date(),
      },
    });
  }

  /**
   * Buyer confirms delivery. This is the trigger that makes the order eligible
   * for a seller review and for inclusion in the next weekly payout.
   */
  async confirmDelivery(userId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { group: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.group.buyerId !== userId) throw new ForbiddenException('Not your order');
    if (order.status !== 'SHIPPED') {
      throw new BadRequestException('Order is not in a shippable state');
    }
    return this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'DELIVERED', deliveredAt: new Date() },
    });
  }

  /** Seller cancels an unshipped paid order; payment refund is queued. */
  async cancel(userId: string, orderId: string) {
    const order = await this.assertSellerOrder(userId, orderId);
    if (!['PAID', 'PENDING_PAYMENT'].includes(order.status)) {
      throw new BadRequestException('Order can no longer be cancelled');
    }
    return this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'CANCELLED' },
    });
  }

  private async assertSellerOrder(userId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { seller: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.seller.userId !== userId) throw new ForbiddenException('Not your order');
    return order;
  }
}
