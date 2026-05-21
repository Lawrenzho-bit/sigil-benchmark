/** Express glue: async handler wrapping, body validation, the error responder. */
import type { NextFunction, Request, Response, RequestHandler } from 'express';
import { ZodError, ZodSchema } from 'zod';
import { AppError, badRequest } from './errors';
import { logger } from '../logger';

/** Wrap an async handler so rejected promises reach the error middleware. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

/** Parse and validate a request body, throwing a 400 on failure. */
export function parseBody<T>(schema: ZodSchema<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw badRequest('Validation failed', fieldErrors(result.error));
  }
  return result.data;
}

/** Parse and validate query parameters. */
export function parseQuery<T>(schema: ZodSchema<T>, query: unknown): T {
  const result = schema.safeParse(query);
  if (!result.success) {
    throw badRequest('Invalid query parameters', fieldErrors(result.error));
  }
  return result.data;
}

function fieldErrors(err: ZodError): Record<string, string[]> {
  return err.flatten().fieldErrors as Record<string, string[]>;
}

/** Terminal error middleware. Maps AppError to its status; everything else is a 500. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    if (err.status >= 500) logger.error({ err, path: req.path }, 'application error');
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  logger.error({ err, path: req.path }, 'unhandled error');
  res.status(500).json({ error: { code: 'internal_error', message: 'Internal server error' } });
}

/** 404 fallthrough for unmatched routes. */
export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'not_found', message: 'Route not found' } });
}
