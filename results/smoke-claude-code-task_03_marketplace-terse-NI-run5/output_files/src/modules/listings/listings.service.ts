import type { ListingStatus, Prisma } from "@prisma/client";
import { prisma } from "../../db/client.js";
import { BadRequest, Forbidden, NotFound } from "../../lib/errors.js";
import { presignListingPhotoUpload, publicUrl } from "../../lib/s3.js";
import { assertActiveSeller } from "../sellers/sellers.service.js";

export interface ListingInput {
  categoryId: string;
  title: string;
  description: string;
  priceAmount: number;
  currency: string;
  inventory: number;
  locationCity?: string;
  locationCountry?: string;
  latitude?: number;
  longitude?: number;
}

// Listing visible to the public, with resolved photo URLs.
function serialize(listing: Prisma.ListingGetPayload<{ include: { photos: true; category: true } }>) {
  return {
    ...listing,
    photos: listing.photos
      .sort((a, b) => a.position - b.position)
      .map((p) => ({ id: p.id, url: publicUrl(p.s3Key), position: p.position })),
  };
}

export async function createListing(sellerId: string, input: ListingInput) {
  // Only fully KYC-verified sellers may list.
  await assertActiveSeller(sellerId);
  const category = await prisma.category.findUnique({ where: { id: input.categoryId } });
  if (!category) throw BadRequest("Unknown category");

  const listing = await prisma.listing.create({
    data: { ...input, sellerId, status: "DRAFT" },
    include: { photos: true, category: true },
  });
  return serialize(listing);
}

export async function getListing(id: string) {
  const listing = await prisma.listing.findUnique({
    where: { id },
    include: { photos: true, category: true },
  });
  if (!listing || listing.status === "REMOVED") throw NotFound("Listing not found");
  return serialize(listing);
}

async function loadOwned(id: string, sellerId: string) {
  const listing = await prisma.listing.findUnique({ where: { id } });
  if (!listing) throw NotFound("Listing not found");
  if (listing.sellerId !== sellerId) throw Forbidden("You do not own this listing");
  return listing;
}

export async function updateListing(id: string, sellerId: string, input: Partial<ListingInput>) {
  await loadOwned(id, sellerId);
  const listing = await prisma.listing.update({
    where: { id },
    data: input,
    include: { photos: true, category: true },
  });
  return serialize(listing);
}

// Publish/pause transitions. REMOVED listings can only be changed by an admin.
export async function setListingStatus(id: string, sellerId: string, status: ListingStatus) {
  const listing = await loadOwned(id, sellerId);
  if (listing.status === "REMOVED") throw Forbidden("This listing was removed by moderation");
  if (status === "ACTIVE" && listing.inventory <= 0) {
    throw BadRequest("Cannot publish a listing with zero inventory");
  }
  return prisma.listing.update({ where: { id }, data: { status } });
}

export async function deleteListing(id: string, sellerId: string) {
  await loadOwned(id, sellerId);
  // Soft-remove so existing orders keep their listing reference intact.
  await prisma.listing.update({ where: { id }, data: { status: "REMOVED" } });
}

// Returns a presigned S3 PUT URL; the photo row is recorded immediately so
// position/order is stable even before the client finishes uploading.
export async function addPhoto(id: string, sellerId: string, contentType: string) {
  await loadOwned(id, sellerId);
  const count = await prisma.listingPhoto.count({ where: { listingId: id } });
  if (count >= 10) throw BadRequest("A listing may have at most 10 photos");
  const { uploadUrl, key } = await presignListingPhotoUpload(id, contentType);
  const photo = await prisma.listingPhoto.create({
    data: { listingId: id, s3Key: key, position: count },
  });
  return { photoId: photo.id, uploadUrl, publicUrl: publicUrl(key) };
}

export async function removePhoto(listingId: string, sellerId: string, photoId: string) {
  await loadOwned(listingId, sellerId);
  await prisma.listingPhoto.deleteMany({ where: { id: photoId, listingId } });
}

// Seller's own listings, including drafts.
export async function listSellerListings(sellerId: string) {
  const listings = await prisma.listing.findMany({
    where: { sellerId, status: { not: "REMOVED" } },
    include: { photos: true, category: true },
    orderBy: { createdAt: "desc" },
  });
  return listings.map(serialize);
}
