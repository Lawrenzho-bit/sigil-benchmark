/** Typed application errors. Anything else reaching the handler is treated as a 500. */

export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (msg: string, details?: unknown) =>
  new AppError(400, msg, 'bad_request', details);
export const unauthorized = (msg = 'Authentication required') =>
  new AppError(401, msg, 'unauthorized');
export const forbidden = (msg = 'Insufficient permissions') =>
  new AppError(403, msg, 'forbidden');
export const notFound = (msg = 'Resource not found') => new AppError(404, msg, 'not_found');
export const conflict = (msg: string) => new AppError(409, msg, 'conflict');
export const unprocessable = (msg: string, details?: unknown) =>
  new AppError(422, msg, 'unprocessable', details);
