import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A buyer reviews the seller of a delivered order. One review per order;
   * seller and listing rating aggregates are recomputed in the same tx.
   */
  async createReview(userId: string, orderId: string, rating: number, comment?: string) {
    if (rating < 1 || rating > 5) throw new BadRequestException('Rating must be 1-5');

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { group: true, items: true, review: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.group.buyerId !== userId) throw new ForbiddenException('Not your order');
    if (order.status !== 'DELIVERED') {
      throw new BadRequestException('You can only review a delivered order');
    }
    if (order.review) throw new ConflictException('Order already reviewed');

    // Attribute the review to the first listing on the order.
    const listingId = order.items[0]?.listingId;
    if (!listingId) throw new BadRequestException('Order has no items');

    return this.prisma.$transaction(async (tx) => {
      const review = await tx.review.create({
        data: {
          orderId,
          authorId: userId,
          sellerId: order.sellerId,
          listingId,
          rating,
          comment,
        },
      });
      await this.recomputeSellerRating(tx, order.sellerId);
      await this.recomputeListingRating(tx, listingId);
      return review;
    });
  }

  /** Public seller reply to a review. */
  async addSellerReply(userId: string, reviewId: string, reply: string) {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      include: { seller: true },
    });
    if (!review) throw new NotFoundException('Review not found');
    if (review.seller.userId !== userId) throw new ForbiddenException('Not your review');
    return this.prisma.review.update({
      where: { id: reviewId },
      data: { sellerReply: reply },
    });
  }

  listForSeller(sellerId: string) {
    return this.prisma.review.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
      include: { author: { select: { displayName: true } } },
    });
  }

  listForListing(listingId: string) {
    return this.prisma.review.findMany({
      where: { listingId },
      orderBy: { createdAt: 'desc' },
      include: { author: { select: { displayName: true } } },
    });
  }

  private async recomputeSellerRating(tx: any, sellerId: string) {
    const agg = await tx.review.aggregate({
      where: { sellerId },
      _avg: { rating: true },
      _count: true,
    });
    await tx.sellerProfile.update({
      where: { id: sellerId },
      data: { ratingAvg: agg._avg.rating ?? 0, ratingCount: agg._count },
    });
  }

  private async recomputeListingRating(tx: any, listingId: string) {
    const agg = await tx.review.aggregate({
      where: { listingId },
      _avg: { rating: true },
      _count: true,
    });
    await tx.listing.update({
      where: { id: listingId },
      data: { ratingAvg: agg._avg.rating ?? 0, ratingCount: agg._count },
    });
  }
}
