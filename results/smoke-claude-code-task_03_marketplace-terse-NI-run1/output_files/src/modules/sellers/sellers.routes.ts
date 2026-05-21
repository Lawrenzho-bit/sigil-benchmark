import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createSellerProfile,
  getOnboardingLink,
  syncKycFromStripe,
} from "./sellers.service.js";
import { prisma } from "../../lib/db.js";
import { notFound } from "../../lib/errors.js";

export async function sellerRoutes(app: FastifyInstance) {
  app.post(
    "/api/sellers",
    { preHandler: app.requireAuth },
    async (req) => {
      const body = z
        .object({
          storeName: z.string().min(2).max(80),
          country: z.string().length(2),
          bio: z.string().max(500).optional(),
        })
        .parse(req.body);
      return createSellerProfile(req.auth!.userId, body);
    },
  );

  app.get(
    "/api/sellers/me",
    { preHandler: app.requireAuth },
    async (req) => {
      const profile = await prisma.sellerProfile.findUnique({
        where: { userId: req.auth!.userId },
      });
      if (!profile) throw notFound("No seller profile");
      return profile;
    },
  );

  app.post(
    "/api/sellers/me/onboarding-link",
    { preHandler: app.requireAuth },
    async (req) => getOnboardingLink(req.auth!.userId),
  );

  app.post(
    "/api/sellers/me/kyc-sync",
    { preHandler: app.requireAuth },
    async (req) => syncKycFromStripe(req.auth!.userId),
  );

  app.get("/api/stores/:slug", async (req) => {
    const { slug } = z.object({ slug: z.string() }).parse(req.params);
    const store = await prisma.sellerProfile.findUnique({
      where: { storeSlug: slug },
      select: {
        id: true,
        storeName: true,
        storeSlug: true,
        bio: true,
        country: true,
        kycStatus: true,
        createdAt: true,
      },
    });
    if (!store || store.kycStatus !== "VERIFIED") throw notFound();
    return store;
  });
}
