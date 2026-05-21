import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/http.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import * as listings from "./listings.service.js";

export const listingsRouter = Router();

const listingSchema = z.object({
  categoryId: z.string().uuid(),
  title: z.string().min(3).max(200),
  description: z.string().min(10).max(10000),
  // Price in minor units (e.g. cents). Must be positive.
  priceAmount: z.number().int().positive(),
  currency: z.string().length(3).toUpperCase().default("EUR"),
  inventory: z.number().int().min(0),
  locationCity: z.string().max(120).optional(),
  locationCountry: z.string().length(2).toUpperCase().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

// ---- Public reads ----

listingsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json(await listings.getListing(req.params.id));
  }),
);

// ---- Seller-owned operations ----

listingsRouter.use(requireAuth, requireRole("SELLER"));

listingsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(await listings.listSellerListings(req.auth!.userId));
  }),
);

listingsRouter.post(
  "/",
  validateBody(listingSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await listings.createListing(req.auth!.userId, req.body));
  }),
);

listingsRouter.patch(
  "/:id",
  validateBody(listingSchema.partial()),
  asyncHandler(async (req, res) => {
    res.json(await listings.updateListing(req.params.id, req.auth!.userId, req.body));
  }),
);

const statusSchema = z.object({
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "SOLD_OUT"]),
});

listingsRouter.post(
  "/:id/status",
  validateBody(statusSchema),
  asyncHandler(async (req, res) => {
    res.json(await listings.setListingStatus(req.params.id, req.auth!.userId, req.body.status));
  }),
);

listingsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await listings.deleteListing(req.params.id, req.auth!.userId);
    res.status(204).end();
  }),
);

// ---- Photos ----

const photoSchema = z.object({
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
});

// Returns a presigned URL the client uses to PUT the image straight to S3.
listingsRouter.post(
  "/:id/photos",
  validateBody(photoSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(
      await listings.addPhoto(req.params.id, req.auth!.userId, req.body.contentType),
    );
  }),
);

listingsRouter.delete(
  "/:id/photos/:photoId",
  asyncHandler(async (req, res) => {
    await listings.removePhoto(req.params.id, req.auth!.userId, req.params.photoId);
    res.status(204).end();
  }),
);
