/** Shared offset-pagination parsing for list endpoints. */
import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export interface PageParams {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

export function parsePagination(query: unknown): PageParams {
  const { page, pageSize } = paginationSchema.parse(query);
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function pageMeta(total: number, params: PageParams) {
  return {
    page: params.page,
    pageSize: params.pageSize,
    total,
    totalPages: Math.ceil(total / params.pageSize) || 1,
  };
}
