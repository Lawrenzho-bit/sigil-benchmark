import { prisma } from "../../db/client.js";
import { BadRequest, Conflict, Forbidden, NotFound } from "../../lib/errors.js";

// Recomputes a seller's denormalised rating aggregate from visible reviews.
async function refreshSellerRating(sellerId: string): Promise<void> {
  const agg = await prisma.review.aggregate({
    where: { sellerId, hidden: false },
    _avg: { rating: true },
    _count: true,
  });
  // The seller's rating is mirrored onto each of their listings for filtering.
  await prisma.listing.updateMany({
    where: { sellerId },
    data: { ratingAvg: agg._avg.rating ?? 0, ratingCount: agg._count },
  });
}

// A buyer may review the seller only after the order is delivered/completed,
// and only once per order.
export async function createReview(
  buyerId: string,
  orderId: string,
  rating: number,
  body?: string,
) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw NotFound("Order not found");
  if (order.buyerId !== buyerId) throw Forbidden("You can only review your own orders");
  if (order.status !== "DELIVERED" && order.status !== "COMPLETED") {
    throw BadRequest("You can review only after the order is delivered");
  }
  const existing = await prisma.review.findUnique({ where: { orderId } });
  if (existing) throw Conflict("This order has already been reviewed");

  const review = await prisma.review.create({
    data: { orderId, authorId: buyerId, sellerId: order.sellerId, rating, body },
  });
  await refreshSellerRating(order.sellerId);
  return review;
}

// Public, non-hidden reviews for a seller.
export async function listSellerReviews(sellerId: string) {
  const reviews = await prisma.review.findMany({
    where: { sellerId, hidden: false },
    include: { author: { select: { displayName: true } } },
    orderBy: { createdAt: "desc" },
  });
  const agg = await prisma.review.aggregate({
    where: { sellerId, hidden: false },
    _avg: { rating: true },
    _count: true,
  });
  return {
    ratingAvg: agg._avg.rating ?? 0,
    ratingCount: agg._count,
    reviews: reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      body: r.body,
      author: r.author.displayName,
      createdAt: r.createdAt,
    })),
  };
}

// Used by the moderation flow to hide/unhide a flagged review.
export async function setReviewHidden(reviewId: string, hidden: boolean) {
  const review = await prisma.review.update({ where: { id: reviewId }, data: { hidden } });
  await refreshSellerRating(review.sellerId);
  return review;
}
