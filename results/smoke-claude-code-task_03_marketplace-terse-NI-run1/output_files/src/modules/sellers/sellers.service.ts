import { prisma } from "../../lib/db.js";
import { stripe } from "../../lib/stripe.js";
import { config } from "../../config.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export async function createSellerProfile(
  userId: string,
  input: { storeName: string; country: string; bio?: string },
) {
  const existing = await prisma.sellerProfile.findUnique({ where: { userId } });
  if (existing) throw conflict("Seller profile already exists");

  const baseSlug = slugify(input.storeName);
  let slug = baseSlug;
  for (let n = 0; n < 5; n++) {
    const collision = await prisma.sellerProfile.findUnique({ where: { storeSlug: slug } });
    if (!collision) break;
    slug = `${baseSlug}-${Math.floor(Math.random() * 9000 + 1000)}`;
  }
  const account = await stripe.accounts.create({
    type: "express",
    country: input.country,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
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
    },
  });
  await prisma.user.update({
    where: { id: userId },
    data: { roles: { set: ["BUYER", "SELLER"] } },
  });
  return profile;
}

export async function getOnboardingLink(userId: string) {
  const seller = await prisma.sellerProfile.findUnique({ where: { userId } });
  if (!seller?.stripeAccountId) throw notFound("Seller profile not initialized");
  const link = await stripe.accountLinks.create({
    account: seller.stripeAccountId,
    refresh_url: `${config.APP_BASE_URL}/seller/onboarding/refresh`,
    return_url: `${config.APP_BASE_URL}/seller/onboarding/complete`,
    type: "account_onboarding",
    collect: "eventually_due",
  });
  return { url: link.url, expiresAt: new Date(link.expires_at * 1000) };
}

export async function syncKycFromStripe(userId: string) {
  const seller = await prisma.sellerProfile.findUnique({ where: { userId } });
  if (!seller?.stripeAccountId) throw notFound("Seller profile not initialized");
  const acct = await stripe.accounts.retrieve(seller.stripeAccountId);
  const kycStatus =
    acct.requirements?.disabled_reason
      ? "REJECTED"
      : acct.details_submitted && acct.payouts_enabled
        ? "VERIFIED"
        : acct.details_submitted
          ? "PENDING"
          : "NOT_STARTED";
  await prisma.sellerProfile.update({
    where: { id: seller.id },
    data: {
      kycStatus,
      chargesEnabled: !!acct.charges_enabled,
      payoutsEnabled: !!acct.payouts_enabled,
    },
  });
  return prisma.sellerProfile.findUnique({ where: { id: seller.id } });
}

export async function requireVerifiedSeller(userId: string) {
  const seller = await prisma.sellerProfile.findUnique({ where: { userId } });
  if (!seller) throw badRequest("Not a seller");
  if (seller.kycStatus !== "VERIFIED" || !seller.chargesEnabled) {
    throw badRequest("Seller KYC not verified");
  }
  return seller;
}
