import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/db.js";
import { publicUrl } from "../../lib/s3.js";

export interface SearchInput {
  q?: string;
  categorySlug?: string;
  minPriceCents?: number;
  maxPriceCents?: number;
  country?: string;
  city?: string;
  minRating?: number;
  sort?: "relevance" | "price_asc" | "price_desc" | "rating_desc" | "newest";
  limit?: number;
  cursor?: string; // listing id
}

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 60;

interface ListingRow {
  id: string;
  slug: string;
  title: string;
  price_cents: number;
  currency: string;
  avg_rating: number;
  rating_count: number;
  created_at: Date;
  thumb_key: string | null;
}

export async function searchListings(input: SearchInput) {
  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const where: Prisma.Sql[] = [Prisma.sql`l."status" = 'ACTIVE'`];

  if (input.q) {
    // websearch_to_tsquery accepts user-facing syntax with quotes / OR / -.
    where.push(
      Prisma.sql`l."search" @@ websearch_to_tsquery('simple', ${input.q})`,
    );
  }
  if (input.categorySlug) {
    where.push(Prisma.sql`c."slug" = ${input.categorySlug}`);
  }
  if (input.minPriceCents != null) {
    where.push(Prisma.sql`l."priceCents" >= ${input.minPriceCents}`);
  }
  if (input.maxPriceCents != null) {
    where.push(Prisma.sql`l."priceCents" <= ${input.maxPriceCents}`);
  }
  if (input.country) {
    where.push(Prisma.sql`l."locCountry" = ${input.country}`);
  }
  if (input.city) {
    where.push(Prisma.sql`l."locCity" = ${input.city}`);
  }
  if (input.minRating != null) {
    where.push(Prisma.sql`l."avgRating" >= ${input.minRating}`);
  }
  if (input.cursor) {
    where.push(Prisma.sql`l."id" > ${input.cursor}`);
  }

  const whereSql = Prisma.sql`WHERE ${Prisma.join(where, ` AND `)}`;

  const orderSql = (() => {
    switch (input.sort) {
      case "price_asc":
        return Prisma.sql`ORDER BY l."priceCents" ASC, l."id" ASC`;
      case "price_desc":
        return Prisma.sql`ORDER BY l."priceCents" DESC, l."id" ASC`;
      case "rating_desc":
        return Prisma.sql`ORDER BY l."avgRating" DESC, l."ratingCount" DESC, l."id" ASC`;
      case "newest":
        return Prisma.sql`ORDER BY l."createdAt" DESC, l."id" ASC`;
      case "relevance":
      default:
        if (input.q) {
          return Prisma.sql`ORDER BY ts_rank(l."search", websearch_to_tsquery('simple', ${input.q})) DESC, l."id" ASC`;
        }
        return Prisma.sql`ORDER BY l."createdAt" DESC, l."id" ASC`;
    }
  })();

  const rows = await prisma.$queryRaw<ListingRow[]>(Prisma.sql`
    SELECT
      l."id" AS id,
      l."slug" AS slug,
      l."title" AS title,
      l."priceCents" AS price_cents,
      l."currency" AS currency,
      l."avgRating" AS avg_rating,
      l."ratingCount" AS rating_count,
      l."createdAt" AS created_at,
      (
        SELECT p."s3Key" FROM "ListingPhoto" p
        WHERE p."listingId" = l."id"
        ORDER BY p."position" ASC, p."createdAt" ASC
        LIMIT 1
      ) AS thumb_key
    FROM "Listing" l
    JOIN "Category" c ON c."id" = l."categoryId"
    ${whereSql}
    ${orderSql}
    LIMIT ${limit + 1}
  `);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return {
    items: page.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      priceCents: r.price_cents,
      currency: r.currency,
      avgRating: r.avg_rating,
      ratingCount: r.rating_count,
      createdAt: r.created_at,
      thumbnailUrl: r.thumb_key ? publicUrl(r.thumb_key) : null,
    })),
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
  };
}
