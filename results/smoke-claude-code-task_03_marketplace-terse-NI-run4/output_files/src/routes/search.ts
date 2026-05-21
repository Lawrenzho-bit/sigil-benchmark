// Browse, search & filter over ACTIVE listings.
//
// At 1M+ listings, offset pagination and ILIKE scans do not hold up. This
// endpoint uses cursor pagination and a Postgres full-text index on
// title+description (created in a migration; see schema.prisma). Filters map
// to the composite indexes declared on the Listing model.
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { paginationQuery, buildPage } from '../lib/pagination.js';
import { publicUrl } from '../lib/s3.js';

const searchQuery = paginationQuery.extend({
  q: z.string().trim().max(200).optional(),
  categoryId: z.string().optional(),
  country: z.string().length(2).optional(),
  city: z.string().optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  sort: z.enum(['recent', 'price_asc', 'price_desc', 'rating']).default('recent'),
});

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/search', async (req) => {
    const q = searchQuery.parse(req.query);

    const where: Prisma.ListingWhereInput = {
      status: 'ACTIVE',
      ...(q.categoryId && { categoryId: q.categoryId }),
      ...(q.country && { locationCountry: q.country }),
      ...(q.city && { locationCity: { contains: q.city, mode: 'insensitive' } }),
      ...(q.minRating && { ratingAvg: { gte: q.minRating } }),
      ...((q.minPrice != null || q.maxPrice != null) && {
        priceAmount: {
          ...(q.minPrice != null && { gte: q.minPrice }),
          ...(q.maxPrice != null && { lte: q.maxPrice }),
        },
      }),
      // Full-text term. `search` uses the GIN tsvector index in production;
      // it degrades gracefully to a planner scan if the index is absent.
      ...(q.q && {
        OR: [
          { title: { search: q.q.split(/\s+/).join(' & ') } },
          { description: { search: q.q.split(/\s+/).join(' & ') } },
        ],
      }),
    };

    const orderBy: Prisma.ListingOrderByWithRelationInput =
      q.sort === 'price_asc' ? { priceAmount: 'asc' }
      : q.sort === 'price_desc' ? { priceAmount: 'desc' }
      : q.sort === 'rating' ? { ratingAvg: 'desc' }
      : { createdAt: 'desc' };

    const rows = await prisma.listing.findMany({
      where,
      orderBy: [orderBy, { id: 'desc' }], // id tiebreaker keeps the cursor stable
      take: q.limit + 1,
      ...(q.cursor && { cursor: { id: q.cursor }, skip: 1 }),
      include: { photos: { take: 1, orderBy: { position: 'asc' } } },
    });

    const page = buildPage(rows, q.limit);
    return {
      ...page,
      data: page.data.map((l) => ({
        id: l.id,
        title: l.title,
        priceAmount: l.priceAmount,
        currency: l.currency,
        ratingAvg: l.ratingAvg,
        ratingCount: l.ratingCount,
        locationCity: l.locationCity,
        locationCountry: l.locationCountry,
        coverPhoto: l.photos[0] ? publicUrl(l.photos[0].objectKey) : null,
      })),
    };
  });

  // Category tree for browse navigation.
  app.get('/api/categories', async () => {
    const categories = await prisma.category.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, slug: true, name: true, parentId: true },
    });
    return { data: categories };
  });
}
