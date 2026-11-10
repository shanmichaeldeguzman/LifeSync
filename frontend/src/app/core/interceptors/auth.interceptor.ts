import { HttpErrorResponse, type HttpInterceptorFn, type HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { from, switchMap, catchError, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../services/auth.service';

const withToken = (req: HttpRequest<unknown>, token: string | null) =>
  token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

/**
 * Attaches the Supabase access token to LifeSync API requests and transparently
 * retries once with a refreshed token when the API reports an expired session.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.apiUrl)) return next(req);
  const auth = inject(AuthService);

  return from(auth.accessToken()).pipe(
    switchMap((token) => next(withToken(req, token))),
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && err.status === 401) {
        return from(auth.refresh()).pipe(
          switchMap((fresh) => (fresh ? next(withToken(req, fresh)) : throwError(() => err))),
        );
      }
      return throwError(() => err);
    }),
  );
};
