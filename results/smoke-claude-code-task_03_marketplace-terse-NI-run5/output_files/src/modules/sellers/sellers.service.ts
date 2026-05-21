import type { SellerProfile } from "@prisma/client";
import { prisma } from "../../db/client.js";
import { env } from "../../config/env.js";
import { BadRequest, Conflict, NotFound } from "../../lib/errors.js";
import { stripe } from "../../lib/stripe.js";
import { logger } from "../../lib/logger.js";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// Step 1 — create the seller profile and a Stripe Connect express account.
export async function createSellerProfile(
  userId: string,
  input: { storeName: string; country: string; bio?: string },
): Promise<SellerProfile> {
  const existing = await prisma.sellerProfile.findUnique({ where: { userId } });
  if (existing) throw Conflict("Seller profile already exists");

  // Unique store slug.
  let slug = slugify(input.storeName);
  if (await prisma.sellerProfile.findUnique({ where: { storeSlug: slug } })) {
    slug = `${slug}-${userId.slice(0, 6)}`;
  }

  const account = await stripe.accounts.create({
    type: "express",
    country: input.country,
    capabilities: { transfers: { requested: true }, card_payments: { requested: true } },
    business_type: "individual",
    metadata: { userId },
  });

  const profile = await prisma.sellerProfile.create({
    data: {
      userId,
      storeName: input.storeName,
      storeSlug: slug,
      bio: input.bio,
      country: input.country,
      stripeAccountId: account.id,
      kycStatus: "NOT_STARTED",
    },
  });

  // Grant the SELLER role if the user does not yet have it.
  await prisma.user.update({
    where: { id: userId },
    data: { roles: { set: ["BUYER", "SELLER"] } },
  });

  return profile;
}

// Step 2 — generate a Stripe-hosted onboarding link. Stripe collects identity
// documents and bank-account details (KYC); we never handle that PII directly.
export async function createOnboardingLink(userId: string): Promise<string> {
  const profile = await prisma.sellerProfile.findUnique({ where: { userId } });
  if (!profile?.stripeAccountId) throw NotFound("Seller profile not found");

  const link = await stripe.accountLinks.create({
    account: profile.stripeAccountId,
    refresh_url: `${env.WEB_URL}/seller/onboarding/refresh`,
    return_url: `${env.WEB_URL}/seller/onboarding/complete`,
    type: "account_onboarding",
  });

  await prisma.sellerProfile.update({
    where: { id: profile.id },
    data: { kycStatus: "PENDING" },
  });
  return link.url;
}

// Step 3 — reconcile KYC/onboarding state from Stripe. Called on demand and by
// the `account.updated` webhook.
export async function syncOnboardingStatus(stripeAccountId: string): Promise<void> {
  const profile = await prisma.sellerProfile.findUnique({ where: { stripeAccountId } });
  if (!profile) return;

  const account = await stripe.accounts.retrieve(stripeAccountId);
  const onboarded = Boolean(account.charges_enabled && account.payouts_enabled);
  const verified = account.requirements?.disabled_reason == null && onboarded;
  const bankVerified = (account.external_accounts?.total_count ?? 0) > 0;

  await prisma.$transaction(async (tx) => {
    await tx.sellerProfile.update({
      where: { id: profile.id },
      data: {
        stripeOnboarded: onboarded,
        kycStatus: verified ? "VERIFIED" : profile.kycStatus === "REJECTED" ? "REJECTED" : "PENDING",
        // A seller becomes active only with full KYC + a linked bank account.
        active: verified && bankVerified,
      },
    });
    await tx.kycVerification.create({
      data: {
        sellerProfileId: profile.id,
        vendorRef: stripeAccountId,
        status: verified ? "VERIFIED" : "PENDING",
        bankAccountVerified: bankVerified,
      },
    });
  });
  logger.info({ stripeAccountId, onboarded, verified }, "Seller onboarding synced");
}

export async function getSellerProfile(userId: string): Promise<SellerProfile> {
  const profile = await prisma.sellerProfile.findUnique({ where: { userId } });
  if (!profile) throw NotFound("Seller profile not found");
  return profile;
}

// Guard used by listing/order flows: a seller must be fully active to trade.
export async function assertActiveSeller(userId: string): Promise<SellerProfile> {
  const profile = await getSellerProfile(userId);
  if (!profile.active) {
    throw BadRequest("Complete KYC verification and bank setup before selling");
  }
  return profile;
}
