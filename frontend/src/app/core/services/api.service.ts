import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { environment } from '../../../environments/environment';

/** Normalised API error with the server's stable error code and field details. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  /** True for connectivity problems (offline, DNS, timeouts, server unavailable). */
  get isNetwork(): boolean {
    return this.status === 0 || this.status === 502 || this.status === 503 || this.status === 504;
  }
}

function toApiError(err: unknown): ApiError {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as { error?: { code?: string; message?: string; details?: unknown } } | null;
    if (err.status === 0) return new ApiError(0, 'network', 'You appear to be offline.');
    return new ApiError(
      err.status,
      body?.error?.code ?? 'http_error',
      body?.error?.message ?? 'Something went wrong. Please try again.',
      body?.error?.details,
    );
  }
  if ((err as { name?: string })?.name === 'TimeoutError') return new ApiError(0, 'timeout', 'The server took too long to respond.');
  return new ApiError(0, 'unknown', (err as Error)?.message ?? 'Unexpected error');
}

type Params = Record<string, string | number | boolean | null | undefined>;

/** Typed, promise-based client for the LifeSync REST API. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  readonly baseUrl = environment.apiUrl;

  private params(p?: Params): HttpParams {
    let hp = new HttpParams();
    for (const [k, v] of Object.entries(p ?? {})) if (v !== undefined && v !== null && v !== '') hp = hp.set(k, String(v));
    return hp;
  }

  async get<T>(path: string, params?: Params, ms = 20000): Promise<T> {
    try {
      return await firstValueFrom(this.http.get<T>(`${this.baseUrl}${path}`, { params: this.params(params) }).pipe(timeout(ms)));
    } catch (e) {
      throw toApiError(e);
    }
  }

  async getBlob(path: string, params?: Params): Promise<Blob> {
    try {
      return await firstValueFrom(
        this.http.get(`${this.baseUrl}${path}`, { params: this.params(params), responseType: 'blob' }).pipe(timeout(60000)),
      );
    } catch (e) {
      throw toApiError(e);
    }
  }

  async post<T>(path: string, body: unknown = {}, params?: Params): Promise<T> {
    try {
      return await firstValueFrom(this.http.post<T>(`${this.baseUrl}${path}`, body, { params: this.params(params) }).pipe(timeout(20000)));
    } catch (e) {
      throw toApiError(e);
    }
  }

  async patch<T>(path: string, body: unknown, params?: Params): Promise<T> {
    try {
      return await firstValueFrom(this.http.patch<T>(`${this.baseUrl}${path}`, body, { params: this.params(params) }).pipe(timeout(20000)));
    } catch (e) {
      throw toApiError(e);
    }
  }

  async delete(path: string, body?: unknown): Promise<void> {
    try {
      await firstValueFrom(this.http.delete(`${this.baseUrl}${path}`, { body }).pipe(timeout(20000)));
    } catch (e) {
      throw toApiError(e);
    }
  }
}
