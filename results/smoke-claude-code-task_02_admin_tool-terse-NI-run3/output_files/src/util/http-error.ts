/** A typed error carrying an HTTP status code, thrown by route handlers. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg: string, details?: unknown) =>
  new HttpError(400, 'bad_request', msg, details);
export const unauthorized = (msg = 'Authentication required') =>
  new HttpError(401, 'unauthorized', msg);
export const forbidden = (msg = 'Insufficient permissions') =>
  new HttpError(403, 'forbidden', msg);
export const notFound = (msg = 'Resource not found') =>
  new HttpError(404, 'not_found', msg);
export const conflict = (msg: string) => new HttpError(409, 'conflict', msg);
