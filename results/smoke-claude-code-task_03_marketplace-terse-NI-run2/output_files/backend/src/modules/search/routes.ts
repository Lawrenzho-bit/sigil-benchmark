import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { parse, pagination, paginated } from '../../lib/validation';
import { badRequest } from '../../lib/errors';

// NOTE: this is plain Postgres filtering. It is correct and fast for tens of
// thousands of listings. At 1M+ listings, move to Postgres full-text search
// (tsvector + GIN) or a dedicated engine. See STATUS.md.

const searchSchema = pagination.extend({
  q: z.string().trim().max(140).optional(),
  categoryId: z.string().uuid().optional(),
  minPriceCents: z.coerce.number().int().min(0).optional(),
  maxPriceCents: z.coerce.number().int().min(0).optional(),
  country: z.string().length(2).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  sort: z.enum(['recent', 'price_asc', 'price_desc', 'rating']).default('recent'),
});

const SORTS: Record<string, Prisma.ListingOrderByWithRelationInput> = {
  recent: { createdAt: 'desc' },
  price_asc: { priceCents: 'asc' },
  price_desc: { priceCents: 'desc' },
  rating: { ratingAvg: 'desc' },
};

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get('/search', async (req) => {
    const params = parse(searchSchema, req.query);

    if (
      params.minPriceCents !== undefined &&
      params.maxPriceCents !== undefined &&
      params.minPriceCents > params.maxPriceCents
    ) {
      throw badRequest('minPriceCents cannot exceed maxPriceCents');
    }

    const where: Prisma.ListingWhereInput = {
      status: 'ACTIVE',
      categoryId: params.categoryId,
      locationCountry: params.country?.toUpperCase(),
      ratingAvg: params.minRating ? { gte: params.minRating } : undefined,
    };

    if (params.minPriceCents !== undefined || params.maxPriceCents !== undefined) {
      where.priceCents = {
        gte: params.minPriceCents,
        lte: params.maxPriceCents,
      };
    }

    if (params.q) {
      where.OR = [
        { title: { contains: params.q, mode: 'insensitive' } },
        { description: { contains: params.q, mode: 'insensitive' } },
      ];
    }

    const skip = (params.page - 1) * params.pageSize;
    const [items, total] = await Promise.all([
      prisma.listing.findMany({
        where,
        orderBy: SORTS[params.sort],
        skip,
        take: params.pageSize,
        include: { photos: { take: 1, orderBy: { position: 'asc' } } },
      }),
      prisma.listing.count({ where }),
    ]);

    return paginated(items, total, params.page, params.pageSize);
  });

  // Category tree for browse navigation.
  app.get('/categories', async () => {
    return prisma.category.findMany({ orderBy: { name: 'asc' } });
  });
}
