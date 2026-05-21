import { nanoid } from "nanoid";
import { prisma } from "../../lib/db.js";
import { presignUpload, publicUrl } from "../../lib/s3.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import { requireVerifiedSeller } from "../sellers/sellers.service.js";

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

const ALLOWED_PHOTO_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PHOTOS_PER_LISTING = 12;

export interface ListingInput {
  title: string;
  description: string;
  categoryId: string;
  priceCents: number;
  currency?: string;
  inventory: number;
  weightGrams?: number;
  location?: { country?: string; region?: string; city?: string };
}

export async function createListing(userId: string, input: ListingInput) {
  const seller = await requireVerifiedSeller(userId);
  const cat = await prisma.category.findUnique({ where: { id: input.categoryId } });
  if (!cat) throw badRequest("Invalid category");
  if (input.priceCents < 1) throw badRequest("Price must be positive");
  if (input.inventory < 0) throw badRequest("Inventory cannot be negative");

  const slug = `${slugify(input.title)}-${nanoid(6)}`;
  return prisma.listing.create({
    data: {
      sellerUserId: userId,
      sellerProfileId: seller.id,
      title: input.title,
      slug,
      description: input.description,
      categoryId: input.categoryId,
      priceCents: input.priceCents,
      currency: input.currency ?? seller.defaultCurrency,
      inventory: input.inventory,
      weightGrams: input.weightGrams,
      locCountry: input.location?.country ?? seller.country,
      locRegion: input.location?.region,
      locCity: input.location?.city,
      status: "DRAFT",
    },
  });
}

export async function updateListing(
  userId: string,
  listingId: string,
  patch: Partial<ListingInput> & { status?: "DRAFT" | "ACTIVE" | "PAUSED" },
) {
  const listing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!listing) throw notFound();
  if (listing.sellerUserId !== userId) throw forbidden();
  if (listing.status === "HIDDEN_BY_ADMIN" || listing.status === "REMOVED") {
    throw forbidden("Listing locked by moderation");
  }
  return prisma.listing.update({
    where: { id: listingId },
    data: {
      title: patch.title,
      description: patch.description,
      categoryId: patch.categoryId,
      priceCents: patch.priceCents,
      inventory: patch.inventory,
      weightGrams: patch.weightGrams,
      locCountry: patch.location?.country,
      locRegion: patch.location?.region,
      locCity: patch.location?.city,
      status: patch.status,
    },
  });
}

export async function deleteListing(userId: string, listingId: string) {
  const listing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!listing) throw notFound();
  if (listing.sellerUserId !== userId) throw forbidden();
  await prisma.listing.update({
    where: { id: listingId },
    data: { status: "REMOVED" },
  });
}

export async function presignListingPhoto(
  userId: string,
  listingId: string,
  contentType: string,
) {
  if (!ALLOWED_PHOTO_MIME.has(contentType)) {
    throw badRequest(`Unsupported content-type: ${contentType}`);
  }
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: { _count: { select: { photos: true } } },
  });
  if (!listing) throw notFound();
  if (listing.sellerUserId !== userId) throw forbidden();
  if (listing._count.photos >= MAX_PHOTOS_PER_LISTING) {
    throw badRequest("Photo limit reached");
  }
  const ext = contentType.split("/")[1];
  const key = `listings/${listing.id}/${nanoid(16)}.${ext}`;
  const uploadUrl = await presignUpload(key, contentType);
  return { uploadUrl, key, publicUrl: publicUrl(key) };
}

export async function attachListingPhoto(
  userId: string,
  listingId: string,
  s3Key: string,
  position?: number,
) {
  const listing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!listing) throw notFound();
  if (listing.sellerUserId !== userId) throw forbidden();
  if (!s3Key.startsWith(`listings/${listing.id}/`)) {
    throw badRequest("Key does not belong to this listing");
  }
  return prisma.listingPhoto.create({
    data: { listingId, s3Key, position: position ?? 0 },
  });
}

export async function getListing(slugOrId: string) {
  const listing = await prisma.listing.findFirst({
    where: {
      OR: [{ slug: slugOrId }, { id: slugOrId }],
      status: { in: ["ACTIVE", "PAUSED"] },
    },
    include: {
      photos: { orderBy: { position: "asc" } },
      category: true,
      store: {
        select: {
          id: true,
          storeName: true,
          storeSlug: true,
          kycStatus: true,
        },
      },
    },
  });
  if (!listing) throw notFound();
  return {
    ...listing,
    photos: listing.photos.map((p) => ({ ...p, url: publicUrl(p.s3Key) })),
  };
}
