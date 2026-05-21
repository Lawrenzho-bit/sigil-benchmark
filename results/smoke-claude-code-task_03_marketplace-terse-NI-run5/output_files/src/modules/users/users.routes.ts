import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/client.js";
import { asyncHandler } from "../../lib/http.js";
import { NotFound } from "../../lib/errors.js";
import { requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";

export const usersRouter = Router();

usersRouter.use(requireAuth);

// Current user profile.
usersRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        roles: true,
        status: true,
        emailVerified: true,
        createdAt: true,
        sellerProfile: { select: { id: true, storeName: true, storeSlug: true, kycStatus: true, active: true } },
      },
    });
    if (!user) throw NotFound("User not found");
    res.json(user);
  }),
);

const updateSchema = z.object({ displayName: z.string().min(1).max(120).optional() });

usersRouter.patch(
  "/me",
  validateBody(updateSchema),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.update({
      where: { id: req.auth!.userId },
      data: { displayName: req.body.displayName },
      select: { id: true, email: true, displayName: true, roles: true },
    });
    res.json(user);
  }),
);

// GDPR Article 20 — data portability. Exports all personal data the platform
// holds about the requesting user as a single JSON document.
usersRouter.get(
  "/me/data-export",
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const [user, listings, orders, reviews, messages, disputes] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, include: { sellerProfile: true, oauthAccounts: true } }),
      prisma.listing.findMany({ where: { sellerId: userId } }),
      prisma.order.findMany({ where: { buyerId: userId }, include: { items: true } }),
      prisma.review.findMany({ where: { authorId: userId } }),
      prisma.message.findMany({ where: { senderId: userId } }),
      prisma.dispute.findMany({ where: { openedById: userId } }),
    ]);
    res.setHeader("Content-Disposition", 'attachment; filename="my-data.json"');
    res.json({ exportedAt: new Date().toISOString(), user, listings, orders, reviews, messages, disputes });
  }),
);

// GDPR Article 17 — right to erasure. PII is scrubbed but financial records
// (orders, payouts, tax) are retained in anonymised form to satisfy
// bookkeeping and tax-law retention obligations.
usersRouter.delete(
  "/me",
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    await prisma.$transaction([
      prisma.message.updateMany({ where: { senderId: userId }, data: { body: "[deleted]" } }),
      prisma.review.updateMany({ where: { authorId: userId }, data: { body: null } }),
      prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
      prisma.oAuthAccount.deleteMany({ where: { userId } }),
      prisma.user.update({
        where: { id: userId },
        data: {
          status: "DELETED",
          email: `deleted+${userId}@marketplace.invalid`,
          displayName: "Deleted user",
          passwordHash: null,
          emailVerified: false,
        },
      }),
    ]);
    res.status(202).json({ message: "Account scheduled for erasure; personal data removed." });
  }),
);
