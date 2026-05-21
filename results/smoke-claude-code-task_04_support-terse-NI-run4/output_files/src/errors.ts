/**
 * Typed application errors. Routes throw these; the error middleware
 * (src/middleware/error.ts) maps them to HTTP responses. Anything that is
 * NOT an AppError is treated as a 500 and its detail is hidden from clients.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (msg: string) => new AppError(400, msg, 'bad_request');
export const unauthorized = (msg = 'Authentication required') =>
  new AppError(401, msg, 'unauthorized');
export const forbidden = (msg = 'Not permitted') => new AppError(403, msg, 'forbidden');
export const notFound = (msg = 'Not found') => new AppError(404, msg, 'not_found');
export const conflict = (msg: string) => new AppError(409, msg, 'conflict');
