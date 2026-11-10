import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../utils/http-error.js';
import type { Logger } from '../utils/logger.js';

/** Consistent JSON error envelope: { error: { code, message, details? } } */
export function errorHandler(logger: Logger) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(422).json({
        error: {
          code: 'validation_failed',
          message: 'Please check the highlighted fields.',
          details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
        },
      });
      return;
    }

    if (err instanceof HttpError) {
      if (err.status >= 500) {
        logger.error({ path: req.path, method: req.method, code: err.code, details: err.details }, err.message);
      }
      // Conflict responses carry the current server record so clients can resolve it.
      const exposeDetails = err.status < 500 ? err.details : undefined;
      res.status(err.status).json({ error: { code: err.code, message: err.message, details: exposeDetails } });
      return;
    }

    // Body-parser errors (malformed JSON / payload too large)
    const e = err as { type?: string; status?: number };
    if (e?.type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'bad_json', message: 'Request body is not valid JSON.' } });
      return;
    }
    if (e?.type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'payload_too_large', message: 'Request body is too large.' } });
      return;
    }

    logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
    res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong. Please try again.' } });
  };
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'not_found', message: 'Endpoint not found' } });
}
