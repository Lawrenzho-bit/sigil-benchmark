import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SearchQueryDto } from './dto/search-query.dto';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Search + filter + browse over active listings. Backed by the composite
   * indexes on Listing. For 1M+ listings with full-text relevance ranking the
   * production path would route to Postgres `tsvector` / OpenSearch — see the
   * note in README; this implementation uses indexed SQL filters + sort.
   */
  async search(q: SearchQueryDto) {
    const where: Prisma.ListingWhereInput = {
      status: 'ACTIVE',
      deletedAt: null,
    };

    if (q.q) {
      where.OR = [
        { title: { contains: q.q, mode: 'insensitive' } },
        { description: { contains: q.q, mode: 'insensitive' } },
      ];
    }
    if (q.categoryId) where.categoryId = q.categoryId;
    if (q.country) where.locationCountry = q.country;
    if (q.city) where.locationCity = { equals: q.city, mode: 'insensitive' };
    if (q.minPrice != null || q.maxPrice != null) {
      where.priceCents = {};
      if (q.minPrice != null) where.priceCents.gte = q.minPrice;
      if (q.maxPrice != null) where.priceCents.lte = q.maxPrice;
    }
    if (q.minRating != null) where.ratingAvg = { gte: q.minRating };

    const orderBy = this.resolveSort(q.sort);
    const take = Math.min(q.limit ?? 24, 100);
    const skip = ((q.page ?? 1) - 1) * take;

    const [total, items] = await this.prisma.$transaction([
      this.prisma.listing.count({ where }),
      this.prisma.listing.findMany({
        where,
        orderBy,
        take,
        skip,
        include: {
          photos: { orderBy: { position: 'asc' }, take: 1 },
          seller: { select: { id: true, businessName: true, ratingAvg: true } },
        },
      }),
    ]);

    return {
      total,
      page: q.page ?? 1,
      pageSize: take,
      results: items.map((l) => ({
        id: l.id,
        title: l.title,
        priceCents: l.priceCents,
        currency: l.currency,
        ratingAvg: l.ratingAvg,
        ratingCount: l.ratingCount,
        locationCity: l.locationCity,
        locationCountry: l.locationCountry,
        thumbnailUrl: l.photos[0] ? this.storage.publicUrlFor(l.photos[0].s3Key) : null,
        seller: l.seller,
      })),
    };
  }

  private resolveSort(sort?: string): Prisma.ListingOrderByWithRelationInput {
    switch (sort) {
      case 'price_asc':
        return { priceCents: 'asc' };
      case 'price_desc':
        return { priceCents: 'desc' };
      case 'rating':
        return { ratingAvg: 'desc' };
      case 'newest':
      default:
        return { createdAt: 'desc' };
    }
  }

  /** Full category tree for browse navigation. */
  async categoryTree() {
    const all = await this.prisma.category.findMany({ orderBy: { name: 'asc' } });
    const byParent = new Map<string | null, typeof all>();
    for (const c of all) {
      const key = c.parentId ?? null;
      byParent.set(key, [...(byParent.get(key) ?? []), c]);
    }
    const build = (parentId: string | null): unknown[] =>
      (byParent.get(parentId) ?? []).map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        children: build(c.id),
      }));
    return build(null);
  }
}
