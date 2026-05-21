import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { searchListings } from "./search.service.js";
import { prisma } from "../../lib/db.js";

export async function searchRoutes(app: FastifyInstance) {
  app.get("/api/search", async (req) => {
    const q = z
      .object({
        q: z.string().optional(),
        category: z.string().optional(),
        minPrice: z.coerce.number().int().nonnegative().optional(),
        maxPrice: z.coerce.number().int().nonnegative().optional(),
        country: z.string().length(2).optional(),
        city: z.string().optional(),
        minRating: z.coerce.number().min(0).max(5).optional(),
        sort: z.enum(["relevance", "price_asc", "price_desc", "rating_desc", "newest"]).optional(),
        limit: z.coerce.number().int().min(1).max(60).optional(),
        cursor: z.string().optional(),
      })
      .parse(req.query);
    return searchListings({
      q: q.q,
      categorySlug: q.category,
      minPriceCents: q.minPrice,
      maxPriceCents: q.maxPrice,
      country: q.country,
      city: q.city,
      minRating: q.minRating,
      sort: q.sort,
      limit: q.limit,
      cursor: q.cursor,
    });
  });

  app.get("/api/categories", async () => {
    return prisma.category.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true, parentId: true },
    });
  });
}
