import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from './env.js';

const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } } as const;

/**
 * Factory for Supabase clients. Request-scoped clients forward the caller's JWT so that
 * Postgres Row Level Security is enforced on every query (defence in depth on top of
 * the API's own authorization checks).
 */
export interface SupabaseFactory {
  /** Client acting as the signed-in user (RLS enforced). */
  forUser(accessToken: string): SupabaseClient;
  /** Anonymous client (token verification and password re-checks). */
  anon(): SupabaseClient;
  /** Privileged client: ONLY for account deletion. Throws if not configured. */
  admin(): SupabaseClient;
}

export function createSupabaseFactory(env: Env): SupabaseFactory {
  const anonClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, NO_SESSION);
  let adminClient: SupabaseClient | undefined;
  return {
    forUser(accessToken) {
      return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
        ...NO_SESSION,
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
      });
    },
    anon: () => anonClient,
    admin() {
      if (!env.SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
      }
      adminClient ??= createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, NO_SESSION);
      return adminClient;
    },
  };
}
