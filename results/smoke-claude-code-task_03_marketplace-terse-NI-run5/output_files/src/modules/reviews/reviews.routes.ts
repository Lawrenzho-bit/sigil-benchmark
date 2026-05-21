import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/http.js";
import { requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import * as reviews from "./reviews.service.js";

export const reviewsRouter = Router();

// Public: a seller's reviews and aggregate rating.
reviewsRouter.get(
  "/sellers/:sellerId",
  asyncHandler(async (req, res) => {
    res.json(await reviews.listSellerReviews(req.params.sellerId));
  }),
);

const createSchema = z.object({
  orderId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  body: z.string().max(5000).optional(),
});

// Buyer posts a review for a delivered order.
reviewsRouter.post(
  "/",
  requireAuth,
  validateBody(createSchema),
  asyncHandler(async (req, res) => {
    const review = await reviews.createReview(
      req.auth!.userId,
      req.body.orderId,
      req.body.rating,
      req.body.body,
    );
    res.status(201).json(review);
  }),
);
