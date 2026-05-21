import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/client.js";
import { asyncHandler, paginated, parsePagination } from "../../lib/http.js";
import { publicUrl } from "../../lib/s3.js";

export const searchRouter = Router();

const searchSchema = z.object({
  q: z.string().max(200).optional(),
  categoryId: z.string().uuid().optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  country: z.string().length(2).toUpperCase().optional(),
  city: z.string().max(120).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  // Result ordering.
  sort: z.enum(["relevance", "price_asc", "price_desc", "rating", "newest"]).default("relevance"),
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
});

// Catalog search with category / price / location / rating filters.
searchRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const params = searchSchema.parse(req.query);
    const { page, pageSize, skip, take } = parsePagination(req.query);

    // Only published listings are searchable.
    const where: Prisma.ListingWhereInput = { status: "ACTIVE" };
    if (params.categoryId) where.categoryId = params.categoryId;
    if (params.country) where.locationCountry = params.country;
    if (params.city) where.locationCity = { contains: params.city, mode: "insensitive" };
    if (params.minRating !== undefined) where.ratingAvg = { gte: params.minRating };
    if (params.minPrice !== undefined || params.maxPrice !== undefined) {
      where.priceAmount = {};
      if (params.minPrice !== undefined) where.priceAmount.gte = params.minPrice;
      if (params.maxPrice !== undefined) where.priceAmount.lte = params.maxPrice;
    }
    if (params.q) {
      // Case-insensitive match across title + description. For 1M+ listings a
      // Postgres GIN tsvector index (or a dedicated search engine) should back
      // this; see prisma/migrations notes in the README.
      where.OR = [
        { title: { contains: params.q, mode: "insensitive" } },
        { description: { contains: params.q, mode: "insensitive" } },
      ];
    }

    const orderBy: Prisma.ListingOrderByWithRelationInput =
      params.sort === "price_asc"
        ? { priceAmount: "asc" }
        : params.sort === "price_desc"
          ? { priceAmount: "desc" }
          : params.sort === "rating"
            ? { ratingAvg: "desc" }
            : { createdAt: "desc" };

    const [rows, total] = await Promise.all([
      prisma.listing.findMany({
        where,
        orderBy,
        skip,
        take,
        include: { photos: { orderBy: { position: "asc" }, take: 1 }, category: true },
      }),
      prisma.listing.count({ where }),
    ]);

    const items = rows.map((l) => ({
      id: l.id,
      title: l.title,
      priceAmount: l.priceAmount,
      currency: l.currency,
      ratingAvg: l.ratingAvg,
      ratingCount: l.ratingCount,
      category: l.category.name,
      location: { city: l.locationCity, country: l.locationCountry },
      thumbnail: l.photos[0] ? publicUrl(l.photos[0].s3Key) : null,
    }));
    res.json(paginated(items, total, page, pageSize));
  }),
);
