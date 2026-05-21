/**
 * Terminal error handling. Converts AppError into structured JSON; logs and
 * masks anything unexpected as a 500 (no internals leak to clients).
 */
import { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError } from '../errors';
import { logger } from '../logger';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` } });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    if (err.status >= 500) logger.error({ err, path: req.originalUrl }, 'request failed');
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details ?? undefined },
    });
  }

  // Unknown error — log everything, tell the client nothing specific.
  logger.error({ err, path: req.originalUrl }, 'unhandled error');
  res.status(500).json({ error: { code: 'internal_error', message: 'An unexpected error occurred' } });
};
