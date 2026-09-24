import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { Sentry } from '../sentry';

/**
 * Global catch-all filter.
 *
 * - HttpException: passed through with its exact status and body (so existing
 *   error contracts - `{ statusCode, code, message, action }` from assertCan,
 *   ValidationPipe arrays, etc. - are unchanged). Logged at warn for 5xx only.
 * - Anything else (unhandled/unknown, e.g. a raw Prisma error): logged at error
 *   with the stack and a request id, and returned as a generic 500 that never
 *   leaks internals.
 *
 * Every response carries an `x-request-id` so a client-reported error can be
 * matched to a server log line.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const headerId = req.headers['x-request-id'];
    const requestId = (Array.isArray(headerId) ? headerId[0] : headerId) || randomUUID();
    res.setHeader('x-request-id', requestId);

    const where = `${req.method} ${req.originalUrl}`;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (status >= 500) {
        this.logger.error(`[${requestId}] ${where} -> ${status}`, exception.stack);
        Sentry.captureException(exception, { extra: { requestId, where, status } });
      }
      res
        .status(status)
        .json(typeof body === 'string' ? { statusCode: status, message: body } : body);
      return;
    }

    const status = HttpStatus.INTERNAL_SERVER_ERROR;
    this.logger.error(
      `[${requestId}] ${where} -> ${status} ${(exception as Error)?.message ?? exception}`,
      (exception as Error)?.stack,
    );
    Sentry.captureException(exception, { extra: { requestId, where, status } });
    res.status(status).json({
      statusCode: status,
      message: 'Internal server error',
      requestId,
    });
  }
}
