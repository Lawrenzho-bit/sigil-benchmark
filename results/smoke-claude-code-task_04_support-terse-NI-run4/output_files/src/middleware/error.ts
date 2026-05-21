import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors';
import { logger } from '../logger';

/** 404 handler for unmatched routes. */
export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'not_found', message: 'Route not found' } });
}

/**
 * Terminal error middleware. Maps known error types to clean JSON responses;
 * unknown errors become an opaque 500 so internals never leak to clients.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'validation_error',
        message: 'Request validation failed',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }

  logger.error({ err, path: req.path, method: req.method }, 'unhandled request error');
  res.status(500).json({ error: { code: 'internal_error', message: 'Internal server error' } });
}
