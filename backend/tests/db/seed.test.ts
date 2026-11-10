import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestDb } from './harness';

const SEED = join(dirname(fileURLToPath(import.meta.url)), '../../../supabase/seed.sql');

describe('development seed', () => {
  it('applies cleanly and populates every module for the demo user', async () => {
    const db = await createTestDb();
    // Minimal stand-ins for Supabase-provided objects the seed touches.
    await db.exec(`
      alter table auth.users add column instance_id uuid, add column aud text, add column role text,
        add column encrypted_password text, add column email_confirmed_at timestamptz,
        add column raw_app_meta_data jsonb, add column created_at timestamptz, add column updated_at timestamptz,
        add column confirmation_token text, add column recovery_token text,
        add column email_change_token_new text, add column email_change text;
      create table auth.identities (id uuid primary key, user_id uuid, provider_id text, identity_data jsonb,
        provider text, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);
      create schema if not exists extensions;
      create function extensions.gen_salt(text) returns text language sql as $$ select 'salt' $$;
      create function extensions.crypt(text, text) returns text language sql as $$ select md5($1 || $2) $$;
    `);
    await db.exec(readFileSync(SEED, 'utf8'));
    await db.exec(readFileSync(SEED, 'utf8')); // idempotent
    const uid = '00000000-0000-4000-8000-000000000001';
    for (const table of ['tasks', 'events', 'notes', 'habits', 'habit_logs', 'transactions', 'budgets', 'savings_goals', 'goals', 'goal_milestones']) {
      const r = await db.query<{ n: number }>(`select count(*)::int as n from ${table} where user_id = $1`, [uid]);
      expect(r.rows[0].n, table).toBeGreaterThan(0);
    }
  }, 60_000);
});
