import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  attachListingPhoto,
  createListing,
  deleteListing,
  getListing,
  presignListingPhoto,
  updateListing,
} from "./listings.service.js";

const listingInputSchema = z.object({
  title: z.string().min(3).max(160),
  description: z.string().min(10).max(8000),
  categoryId: z.string(),
  priceCents: z.number().int().positive(),
  currency: z.string().length(3).optional(),
  inventory: z.number().int().min(0),
  weightGrams: z.number().int().positive().optional(),
  location: z
    .object({
      country: z.string().length(2).optional(),
      region: z.string().max(80).optional(),
      city: z.string().max(80).optional(),
    })
    .optional(),
});

export async function listingRoutes(app: FastifyInstance) {
  app.post(
    "/api/listings",
    { preHandler: app.requireAuth },
    async (req) => createListing(req.auth!.userId, listingInputSchema.parse(req.body)),
  );

  app.patch(
    "/api/listings/:id",
    { preHandler: app.requireAuth },
    async (req) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const patch = listingInputSchema
        .partial()
        .extend({ status: z.enum(["DRAFT", "ACTIVE", "PAUSED"]).optional() })
        .parse(req.body);
      return updateListing(req.auth!.userId, id, patch);
    },
  );

  app.delete(
    "/api/listings/:id",
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      await deleteListing(req.auth!.userId, id);
      return reply.code(204).send();
    },
  );

  app.post(
    "/api/listings/:id/photos/presign",
    { preHandler: app.requireAuth },
    async (req) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const { contentType } = z
        .object({ contentType: z.string() })
        .parse(req.body);
      return presignListingPhoto(req.auth!.userId, id, contentType);
    },
  );

  app.post(
    "/api/listings/:id/photos/attach",
    { preHandler: app.requireAuth },
    async (req) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const { s3Key, position } = z
        .object({ s3Key: z.string(), position: z.number().int().optional() })
        .parse(req.body);
      return attachListingPhoto(req.auth!.userId, id, s3Key, position);
    },
  );

  app.get("/api/listings/:slugOrId", async (req) => {
    const { slugOrId } = z.object({ slugOrId: z.string() }).parse(req.params);
    return getListing(slugOrId);
  });
}
