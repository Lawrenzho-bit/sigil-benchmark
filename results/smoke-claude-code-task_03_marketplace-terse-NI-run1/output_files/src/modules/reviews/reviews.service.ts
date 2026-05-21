import { prisma } from "../../lib/db.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";

export async function createReview(
  buyerId: string,
  input: { subOrderId: string; rating: number; body?: string },
) {
  if (input.rating < 1 || input.rating > 5) throw badRequest("Rating must be 1..5");
  const sub = await prisma.subOrder.findUnique({
    where: { id: input.subOrderId },
    include: { order: true },
  });
  if (!sub) throw notFound();
  if (sub.order.buyerId !== buyerId) throw forbidden();
  if (sub.status !== "DELIVERED" && sub.status !== "COMPLETED") {
    throw badRequest("Can only review delivered orders");
  }
  const existing = await prisma.review.findUnique({ where: { subOrderId: sub.id } });
  if (existing) throw conflict("Already reviewed");

  return prisma.$transaction(async (tx) => {
    const review = await tx.review.create({
      data: {
        subOrderId: sub.id,
        sellerProfileId: sub.sellerProfileId,
        authorUserId: buyerId,
        rating: input.rating,
        body: input.body,
      },
    });
    // Recompute seller aggregate across their listings via materialized counters
    // on the listing rows the buyer purchased.
    for (const item of await tx.orderItem.findMany({ where: { subOrderId: sub.id } })) {
      const agg = await tx.review.aggregate({
        where: { subOrder: { items: { some: { listingId: item.listingId } } } },
        _avg: { rating: true },
        _count: { rating: true },
      });
      await tx.listing.update({
        where: { id: item.listingId },
        data: {
          avgRating: agg._avg.rating ?? 0,
          ratingCount: agg._count.rating,
        },
      });
    }
    return review;
  });
}

export async function listSellerReviews(storeSlug: string, cursor?: string, limit = 20) {
  const store = await prisma.sellerProfile.findUnique({ where: { storeSlug } });
  if (!store) throw notFound();
  return prisma.review.findMany({
    where: { sellerProfileId: store.id },
    orderBy: { createdAt: "desc" },
    cursor: cursor ? { id: cursor } : undefined,
    skip: cursor ? 1 : 0,
    take: limit,
    select: {
      id: true,
      rating: true,
      body: true,
      createdAt: true,
      author: { select: { displayName: true } },
    },
  });
}
