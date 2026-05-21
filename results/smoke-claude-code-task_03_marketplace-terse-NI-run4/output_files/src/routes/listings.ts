// Listing CRUD + photo upload presigning. Only ACTIVE sellers may create
// listings; sellers may only mutate their own.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireSeller } from '../middleware/auth.js';
import { BadRequest, Forbidden, NotFound } from '../lib/errors.js';
import { presignPhotoUpload, publicUrl, deleteObject } from '../lib/s3.js';

const listingInput = z.object({
  title: z.string().min(3).max(140),
  description: z.string().min(1).max(8000),
  categoryId: z.string().min(1),
  priceAmount: z.number().int().positive(), // minor units
  currency: z.string().length(3).default('EUR'),
  inventory: z.number().int().min(0).default(1),
  locationCity: z.string().max(120).optional(),
  locationCountry: z.string().length(2).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

async function loadOwnedListing(listingId: string, userId: string, role: string) {
  const listing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!listing) throw NotFound('Listing not found');
  if (listing.sellerId !== userId && role !== 'ADMIN') {
    throw Forbidden('Not your listing');
  }
  return listing;
}

export async function listingRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/listings', async (req, reply) => {
    const auth = await requireSeller(req);
    const body = listingInput.parse(req.body);

    const profile = await prisma.sellerProfile.findUnique({
      where: { userId: auth.userId },
    });
    if (auth.role !== 'ADMIN' && profile?.status !== 'ACTIVE') {
      throw Forbidden('Seller must complete onboarding before listing');
    }
    const category = await prisma.category.findUnique({
      where: { id: body.categoryId },
    });
    if (!category) throw BadRequest('Unknown category', 'bad_category');

    const listing = await prisma.listing.create({
      data: { ...body, sellerId: auth.userId, status: 'DRAFT' },
    });
    return reply.code(201).send(listing);
  });

  // Public listing detail.
  app.get('/api/listings/:id', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const listing = await prisma.listing.findUnique({
      where: { id },
      include: {
        photos: { orderBy: { position: 'asc' } },
        category: true,
        seller: { select: { id: true, displayName: true } },
      },
    });
    if (!listing || listing.status === 'REMOVED') throw NotFound('Listing not found');
    return {
      ...listing,
      photos: listing.photos.map((p) => ({ ...p, url: publicUrl(p.objectKey) })),
    };
  });

  app.patch('/api/listings/:id', async (req) => {
    const auth = await requireAuth(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await loadOwnedListing(id, auth.userId, auth.role);
    const patch = listingInput.partial().parse(req.body);
    return prisma.listing.update({ where: { id }, data: patch });
  });

  // Publish / pause. Publishing requires at least one photo.
  app.post('/api/listings/:id/status', async (req) => {
    const auth = await requireAuth(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { status } = z
      .object({ status: z.enum(['ACTIVE', 'PAUSED', 'DRAFT']) })
      .parse(req.body);
    await loadOwnedListing(id, auth.userId, auth.role);

    if (status === 'ACTIVE') {
      const photoCount = await prisma.listingPhoto.count({ where: { listingId: id } });
      if (photoCount === 0) {
        throw BadRequest('Add at least one photo before publishing', 'no_photos');
      }
    }
    return prisma.listing.update({
      where: { id },
      data: { status, publishedAt: status === 'ACTIVE' ? new Date() : undefined },
    });
  });

  app.delete('/api/listings/:id', async (req, reply) => {
    const auth = await requireAuth(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await loadOwnedListing(id, auth.userId, auth.role);
    // Soft-remove: orders reference listings, so we never hard-delete.
    await prisma.listing.update({ where: { id }, data: { status: 'REMOVED' } });
    return reply.code(204).send();
  });

  // --- Photos --------------------------------------------------------------
  // Returns a presigned URL; the client PUTs the image straight to S3, then
  // confirms via the POST below so we record the object key + ordering.
  app.post('/api/listings/:id/photos/presign', async (req) => {
    const auth = await requireAuth(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { contentType } = z
      .object({ contentType: z.string() })
      .parse(req.body);
    await loadOwnedListing(id, auth.userId, auth.role);
    try {
      return await presignPhotoUpload(id, contentType);
    } catch (err) {
      throw BadRequest((err as Error).message, 'bad_image_type');
    }
  });

  app.post('/api/listings/:id/photos', async (req, reply) => {
    const auth = await requireAuth(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({
        objectKey: z.string(),
        width: z.number().int().optional(),
        height: z.number().int().optional(),
      })
      .parse(req.body);
    await loadOwnedListing(id, auth.userId, auth.role);

    const count = await prisma.listingPhoto.count({ where: { listingId: id } });
    if (count >= 12) throw BadRequest('Maximum 12 photos per listing', 'photo_limit');

    const photo = await prisma.listingPhoto.create({
      data: { listingId: id, position: count, ...body },
    });
    return reply.code(201).send({ ...photo, url: publicUrl(photo.objectKey) });
  });

  app.delete('/api/listings/:id/photos/:photoId', async (req, reply) => {
    const auth = await requireAuth(req);
    const { id, photoId } = z
      .object({ id: z.string(), photoId: z.string() })
      .parse(req.params);
    await loadOwnedListing(id, auth.userId, auth.role);
    const photo = await prisma.listingPhoto.findUnique({ where: { id: photoId } });
    if (!photo || photo.listingId !== id) throw NotFound('Photo not found');
    await deleteObject(photo.objectKey);
    await prisma.listingPhoto.delete({ where: { id: photoId } });
    return reply.code(204).send();
  });
}
