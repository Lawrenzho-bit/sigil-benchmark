import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db';
import { parse } from '../../lib/validation';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { requireRole } from '../../auth/middleware';
import { createUploadUrl, createViewUrl } from '../../lib/s3';
import { audit } from '../admin/audit';

const listingSchema = z.object({
  title: z.string().min(3).max(140),
  description: z.string().min(1).max(5000),
  priceCents: z.number().int().positive(),
  currency: z.string().length(3).default('usd'),
  categoryId: z.string().uuid(),
  inventory: z.number().int().min(0).default(0),
  locationCity: z.string().max(80).optional(),
  locationCountry: z.string().length(2).default('US'),
});

export async function listingRoutes(app: FastifyInstance): Promise<void> {
  // Public: view a single listing with photo URLs.
  app.get('/listings/:id', async (req) => {
    const { id } = req.params as { id: string };
    const listing = await prisma.listing.findUnique({
      where: { id },
      include: { photos: { orderBy: { position: 'asc' } }, category: true },
    });
    if (!listing || listing.status === 'REMOVED') throw notFound('Listing not found');
    return withPhotoUrls(listing);
  });

  // Seller: create a draft listing.
  app.post('/listings', async (req) => {
    const seller = requireRole(req, 'SELLER');
    const body = parse(listingSchema, req.body);

    const category = await prisma.category.findUnique({ where: { id: body.categoryId } });
    if (!category) throw badRequest('Unknown category');

    const listing = await prisma.listing.create({
      data: {
        sellerId: seller.id,
        title: body.title,
        description: body.description,
        priceCents: body.priceCents,
        currency: body.currency,
        categoryId: body.categoryId,
        inventory: body.inventory,
        locationCity: body.locationCity,
        locationCountry: body.locationCountry.toUpperCase(),
      },
    });
    await audit(seller.id, 'listing.create', 'Listing', listing.id);
    return listing;
  });

  app.patch('/listings/:id', async (req) => {
    const seller = requireRole(req, 'SELLER');
    const { id } = req.params as { id: string };
    const listing = await ownedListing(id, seller.id);

    const body = parse(listingSchema.partial(), req.body);
    const updated = await prisma.listing.update({
      where: { id },
      data: {
        ...body,
        locationCountry: body.locationCountry?.toUpperCase(),
      },
    });
    return updated;
  });

  // Publish / pause. REMOVED can only be set by moderation.
  app.post('/listings/:id/status', async (req) => {
    const seller = requireRole(req, 'SELLER');
    const { id } = req.params as { id: string };
    await ownedListing(id, seller.id);
    const { status } = parse(
      z.object({ status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED']) }),
      req.body,
    );
    return prisma.listing.update({ where: { id }, data: { status } });
  });

  // Photo upload: returns a presigned URL; the client PUTs the bytes to S3,
  // then calls the confirm endpoint.
  app.post('/listings/:id/photos/upload-url', async (req) => {
    const seller = requireRole(req, 'SELLER');
    const { id } = req.params as { id: string };
    await ownedListing(id, seller.id);
    const { contentType } = parse(
      z.object({ contentType: z.string() }),
      req.body,
    );
    return createUploadUrl(contentType);
  });

  app.post('/listings/:id/photos', async (req) => {
    const seller = requireRole(req, 'SELLER');
    const { id } = req.params as { id: string };
    await ownedListing(id, seller.id);
    const { s3Key } = parse(z.object({ s3Key: z.string().min(1) }), req.body);

    const count = await prisma.listingPhoto.count({ where: { listingId: id } });
    return prisma.listingPhoto.create({
      data: { listingId: id, s3Key, position: count },
    });
  });

  // Seller's own listings, any status.
  app.get('/seller/listings', async (req) => {
    const seller = requireRole(req, 'SELLER');
    return prisma.listing.findMany({
      where: { sellerId: seller.id },
      orderBy: { createdAt: 'desc' },
    });
  });
}

async function ownedListing(id: string, sellerId: string) {
  const listing = await prisma.listing.findUnique({ where: { id } });
  if (!listing) throw notFound('Listing not found');
  if (listing.sellerId !== sellerId) throw forbidden('Not your listing');
  return listing;
}

async function withPhotoUrls<T extends { photos: { s3Key: string }[] }>(listing: T) {
  const photos = await Promise.all(
    listing.photos.map(async (p) => ({
      ...p,
      url: await createViewUrl(p.s3Key),
    })),
  );
  return { ...listing, photos };
}
