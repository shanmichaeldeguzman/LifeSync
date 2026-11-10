/** An error that maps directly onto an HTTP response. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }

  static badRequest(message: string, details?: unknown) {
    return new HttpError(400, 'bad_request', message, details);
  }
  static unauthorized(message = 'Authentication required') {
    return new HttpError(401, 'unauthorized', message);
  }
  static forbidden(message = 'You do not have access to this resource') {
    return new HttpError(403, 'forbidden', message);
  }
  static notFound(message = 'Resource not found') {
    return new HttpError(404, 'not_found', message);
  }
  static conflict(message: string, details?: unknown) {
    return new HttpError(409, 'conflict', message, details);
  }
}

export interface PostgrestLikeError {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}

/**
 * Translates Postgres / PostgREST errors into safe client-facing HTTP errors.
 * Internal details are never leaked; only stable, user-meaningful messages are returned.
 */
export function fromDbError(err: PostgrestLikeError): HttpError {
  switch (err.code) {
    case '23505':
      return HttpError.conflict('A record with these details already exists');
    case '23503':
      return HttpError.badRequest('A referenced record was not found');
    case '23514':
    case '22P02':
    case '22007':
    case '22008':
    case '22003':
    case '23502':
      return HttpError.badRequest('One or more fields are invalid');
    case '42501':
      return HttpError.forbidden();
    case 'PGRST116':
      return HttpError.notFound();
    case 'PGRST301':
    case 'PGRST302':
    case 'PGRST303':
    case '28000':
      return HttpError.unauthorized('Your session has expired. Please sign in again.');
    default:
      return new HttpError(500, 'internal_error', 'Something went wrong. Please try again.', { dbCode: err.code });
  }
}
