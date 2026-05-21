import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Normalises every error into a consistent JSON envelope and ensures internal
 * errors never leak stack traces or DB details to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = isHttp ? exception.getResponse() : 'Internal server error';

    if (!isHttp) {
      this.logger.error(`Unhandled error on ${req.method} ${req.url}`, exception as Error);
    }

    res.status(status).json({
      statusCode: status,
      error: typeof payload === 'string' ? payload : (payload as Record<string, unknown>),
      path: req.url,
      timestamp: new Date().toISOString(),
    });
  }
}
