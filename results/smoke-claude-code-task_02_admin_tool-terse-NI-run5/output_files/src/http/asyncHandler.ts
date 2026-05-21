import { RequestHandler } from 'express';

/**
 * Wraps an async route handler so a rejected promise is forwarded to the
 * Express error middleware instead of becoming an unhandled rejection.
 */
export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
