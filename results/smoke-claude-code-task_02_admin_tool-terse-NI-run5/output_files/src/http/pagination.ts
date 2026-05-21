/**
 * Shared pagination contract for list endpoints.
 */
import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export interface Page {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

export function toPage(input: { page: number; pageSize: number }): Page {
  return {
    page: input.page,
    pageSize: input.pageSize,
    skip: (input.page - 1) * input.pageSize,
    take: input.pageSize,
  };
}

export function paginated<T>(items: T[], total: number, page: Page) {
  return {
    items,
    pagination: {
      page: page.page,
      pageSize: page.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / page.pageSize)),
    },
  };
}
