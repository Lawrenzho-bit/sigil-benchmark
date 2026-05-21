import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createReview, listSellerReviews } from "./reviews.service.js";

export async function reviewRoutes(app: FastifyInstance) {
  app.post("/api/reviews", { preHandler: app.requireAuth }, async (req) => {
    const body = z
      .object({
        subOrderId: z.string(),
        rating: z.number().int().min(1).max(5),
        body: z.string().max(2000).optional(),
      })
      .parse(req.body);
    return createReview(req.auth!.userId, body);
  });

  app.get("/api/stores/:slug/reviews", async (req) => {
    const { slug } = z.object({ slug: z.string() }).parse(req.params);
    const q = z
      .object({ cursor: z.string().optional(), limit: z.coerce.number().int().max(50).optional() })
      .parse(req.query);
    return listSellerReviews(slug, q.cursor, q.limit);
  });
}
