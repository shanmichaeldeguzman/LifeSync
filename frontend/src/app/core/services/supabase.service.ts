import { Injectable } from '@angular/core';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';

/**
 * Owns the single Supabase client used for authentication and private file storage.
 * Data reads/writes go through the LifeSync REST API (see ApiService).
 */
@Injectable({ providedIn: 'root' })
export class SupabaseService {
  readonly configured = !!(environment.supabaseUrl && environment.supabaseAnonKey);
  private readonly _client: SupabaseClient | null = this.configured
    ? createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: 'implicit',
          storageKey: 'lifesync-auth',
        },
      })
    : null;

  get client(): SupabaseClient {
    if (!this._client) throw new Error('LifeSync is not configured (missing Supabase settings).');
    return this._client;
  }
}
