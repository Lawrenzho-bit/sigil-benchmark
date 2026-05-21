/**
 * Wraps an async route handler so rejected promises are forwarded to Express's
 * error middleware instead of becoming unhandled rejections.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

export function asyncHandler(fn: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
