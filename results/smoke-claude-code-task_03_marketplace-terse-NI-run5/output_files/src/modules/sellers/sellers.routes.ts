import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/http.js";
import { requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import * as sellers from "./sellers.service.js";

export const sellersRouter = Router();

sellersRouter.use(requireAuth);

const createSchema = z.object({
  storeName: z.string().min(2).max(120),
  // ISO 3166-1 alpha-2 country code.
  country: z.string().length(2).toUpperCase(),
  bio: z.string().max(2000).optional(),
});

// Begin seller onboarding: creates the profile + Stripe Connect account.
sellersRouter.post(
  "/",
  validateBody(createSchema),
  asyncHandler(async (req, res) => {
    const profile = await sellers.createSellerProfile(req.auth!.userId, req.body);
    res.status(201).json(profile);
  }),
);

// Get a Stripe-hosted KYC onboarding link (identity + bank account).
sellersRouter.post(
  "/onboarding-link",
  asyncHandler(async (req, res) => {
    const url = await sellers.createOnboardingLink(req.auth!.userId);
    res.json({ onboardingUrl: url });
  }),
);

// Force a refresh of KYC/onboarding status from Stripe.
sellersRouter.post(
  "/onboarding-sync",
  asyncHandler(async (req, res) => {
    const profile = await sellers.getSellerProfile(req.auth!.userId);
    if (profile.stripeAccountId) await sellers.syncOnboardingStatus(profile.stripeAccountId);
    res.json(await sellers.getSellerProfile(req.auth!.userId));
  }),
);

// Current seller's profile + onboarding status.
sellersRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    res.json(await sellers.getSellerProfile(req.auth!.userId));
  }),
);
