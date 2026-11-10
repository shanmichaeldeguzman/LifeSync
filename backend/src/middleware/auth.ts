import type { NextFunction, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SupabaseFactory } from '../config/supabase.js';
import { HttpError } from '../utils/http-error.js';

export interface AuthContext {
  userId: string;
  email: string | null;
  accessToken: string;
  /** Supabase client scoped to this user: every query is subject to RLS. */
  db: SupabaseClient;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}

export type TokenVerifier = (token: string) => Promise<{ userId: string; email: string | null }>;

/** Verifies a Supabase access token (signature, expiry, audience) and returns the subject. */
export function supabaseTokenVerifier(factory: SupabaseFactory): TokenVerifier {
  return async (token) => {
    const { data, error } = await factory.anon().auth.getClaims(token);
    const claims = data?.claims;
    if (error || !claims?.sub || claims.role !== 'authenticated') {
      throw HttpError.unauthorized('Your session is invalid or has expired. Please sign in again.');
    }
    return { userId: claims.sub, email: (claims.email as string | undefined) ?? null };
  };
}

/** Requires a valid `Authorization: Bearer <token>` header and attaches `req.auth`. */
export function requireAuth(factory: SupabaseFactory, verify: TokenVerifier) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? '';
    const match = /^Bearer\s+([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)$/.exec(header);
    if (!match) {
      throw HttpError.unauthorized();
    }
    const token = match[1];
    const { userId, email } = await verify(token);
    req.auth = { userId, email, accessToken: token, db: factory.forUser(token) };
    next();
  };
}

/** Narrowing helper for handlers mounted behind requireAuth. */
export function auth(req: Request): AuthContext {
  if (!req.auth) throw HttpError.unauthorized();
  return req.auth;
}
