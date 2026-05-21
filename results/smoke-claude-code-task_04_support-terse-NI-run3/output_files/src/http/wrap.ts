/**
 * Small HTTP helpers shared by all route modules.
 */
import { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodSchema } from 'zod';
import { badRequest } from '../errors';

/**
 * Wrap an async handler so thrown/rejected errors reach the Express error
 * middleware instead of crashing the process.
 */
export function wrap(
  handler: (req: Request, res: Response) => Promise<unknown>,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}

/** Parse and validate a request body against a Zod schema. */
export function parseBody<T>(schema: ZodSchema<T>, req: Request): T {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    throw badRequest('Invalid request body', result.error.flatten());
  }
  return result.data;
}

/** Parse and validate query parameters against a Zod schema. */
export function parseQuery<T>(schema: ZodSchema<T>, req: Request): T {
  const result = schema.safeParse(req.query);
  if (!result.success) {
    throw badRequest('Invalid query parameters', result.error.flatten());
  }
  return result.data;
}
