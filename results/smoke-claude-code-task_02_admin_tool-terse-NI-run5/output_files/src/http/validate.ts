/**
 * Zod-backed request validation helpers. A validation failure becomes a clean
 * 400 with field-level details rather than a 500.
 */
import { z } from 'zod';
import { badRequest } from '../errors';

export function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw badRequest('Invalid request body', result.error.flatten().fieldErrors);
  }
  return result.data;
}

export function parseQuery<T extends z.ZodTypeAny>(schema: T, query: unknown): z.infer<T> {
  const result = schema.safeParse(query);
  if (!result.success) {
    throw badRequest('Invalid query parameters', result.error.flatten().fieldErrors);
  }
  return result.data;
}
