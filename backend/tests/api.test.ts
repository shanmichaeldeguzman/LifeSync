import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createApp } from '../src/app';
import type { Env } from '../src/config/env';
import type { SupabaseFactory } from '../src/config/supabase';
import { HttpError } from '../src/utils/http-error';
import { createLogger } from '../src/utils/logger';
import { toCsv } from '../src/utils/csv';
import { sanitizeSearch } from '../src/utils/query';

/**
 * A scriptable stand-in for the Supabase query builder. Every awaited query pops the
 * next queued result and records the chain of calls, so tests can assert both the
 * HTTP behaviour and the exact database operations issued.
 */
type Result = { data?: unknown; error?: unknown; count?: number };
let queue: Result[];
let calls: { table: string; chain: [string, unknown[]][] }[];
let storageExists: boolean;

function builder(table: string) {
  const entry = { table, chain: [] as [string, unknown[]][] };
  calls.push(entry);
  const proxy: unknown = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === 'then') {
          const result = queue.shift() ?? { data: null, error: null };
          return (resolve: (v: unknown) => void) => resolve({ error: null, ...result });
        }
        return (...args: unknown[]) => {
          entry.chain.push([prop, args]);
          return proxy;
        };
      },
    },
  );
  return proxy;
}

const fakeClient = {
  from: (table: string) => builder(table),
  rpc: (fn: string) => builder(`rpc:${fn}`),
  storage: {
    from: () => ({
      exists: async () => ({ data: storageExists, error: null }),
      remove: async () => ({ data: [], error: null }),
      createSignedUrl: async () => ({ data: { signedUrl: 'https://signed.example/x' }, error: null }),
    }),
  },
} as unknown as SupabaseClient;

const factory: SupabaseFactory = { forUser: () => fakeClient, anon: () => fakeClient, admin: () => fakeClient };
const USER = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'aaa.bbb.ccc';
const env: Env = {
  NODE_ENV: 'test',
  PORT: 0,
  LOG_LEVEL: 'silent',
  CORS_ORIGINS: ['http://localhost:8100'],
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'x'.repeat(30),
};
const app = createApp({
  env,
  factory,
  logger: createLogger('silent'),
  verifyToken: async (token) => {
    if (token !== TOKEN) throw HttpError.unauthorized();
    return { userId: USER, email: 'user@example.com' };
  },
});
const authed = (r: request.Test) => r.set('Authorization', `Bearer ${TOKEN}`);

beforeEach(() => {
  queue = [];
  calls = [];
  storageExists = true;
});

describe('platform', () => {
  it('serves an unauthenticated health check', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('only allows configured CORS origins', async () => {
    const ok = await request(app).get('/api/health').set('Origin', 'http://localhost:8100');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:8100');
    const bad = await request(app).get('/api/health').set('Origin', 'https://evil.example');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('returns JSON 404 for unknown endpoints', async () => {
    const res = await authed(request(app).get('/api/nope'));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
});

describe('authentication', () => {
  it('rejects requests without a token', async () => {
    const res = await request(app).get('/api/tasks');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('rejects malformed and invalid tokens', async () => {
    expect((await request(app).get('/api/tasks').set('Authorization', 'Bearer nope')).status).toBe(401);
    expect((await request(app).get('/api/tasks').set('Authorization', 'Bearer x.y.z')).status).toBe(401);
  });
});

describe('generic CRUD', () => {
  it('lists with pagination, search, filters and sorting', async () => {
    queue.push({ data: [{ id: 'a' }], count: 51 });
    const res = await authed(
      request(app).get('/api/tasks?page=2&limit=25&search=milk,(x)&status=pending,in_progress&sort=priority&order=desc&due_from=2026-01-01'),
    );
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ page: 2, limit: 25, total: 51, totalPages: 3 });
    const chain = calls[0].chain.map(([m]) => m);
    expect(chain).toEqual(expect.arrayContaining(['select', 'or', 'in', 'gte', 'order', 'range']));
    const or = calls[0].chain.find(([m]) => m === 'or')![1][0] as string;
    expect(or).toBe('title.ilike.*milk x*,description.ilike.*milk x*');
    expect(calls[0].chain.find(([m]) => m === 'range')![1]).toEqual([25, 49]);
  });

  it('ignores unknown sort columns', async () => {
    queue.push({ data: [], count: 0 });
    await authed(request(app).get('/api/tasks?sort=password'));
    const order = calls[0].chain.find(([m]) => m === 'order')![1];
    expect(order[0]).toBe('due_at');
  });

  it('validates input and reports field errors', async () => {
    const res = await authed(request(app).post('/api/tasks').send({ title: '   ', priority: 'critical' }));
    expect(res.status).toBe(422);
    const fields = res.body.error.details.map((d: { field: string }) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['title', 'priority']));
    expect(calls).toHaveLength(0);
  });

  it('strips server-controlled fields such as user_id', async () => {
    queue.push({ data: { id: 'n1', title: 'x' } });
    const res = await authed(request(app).post('/api/tasks').send({ title: 'Buy milk', user_id: 'someone-else', completed_at: 'x' }));
    expect(res.status).toBe(201);
    const inserted = calls[0].chain.find(([m]) => m === 'insert')![1][0] as Record<string, unknown>;
    expect(inserted).toEqual({ title: 'Buy milk' });
  });

  it('treats a replayed create with an existing id as idempotent', async () => {
    const id = '22222222-2222-4222-8222-222222222222';
    queue.push({ data: null, error: { code: '23505' } }, { data: { id, title: 'Buy milk' } });
    const res = await authed(request(app).post('/api/tasks').send({ id, title: 'Buy milk' }));
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(id);
  });

  it('applies optimistic concurrency on update', async () => {
    const id = '33333333-3333-4333-8333-333333333333';
    queue.push({ data: { id, title: 'New' } });
    const ok = await authed(request(app).patch(`/api/tasks/${id}`).send({ title: 'New', base_updated_at: '2026-11-10T10:00:00.123456+00:00' }));
    expect(ok.status).toBe(200);
    expect(calls[0].chain).toContainEqual(['lte', ['updated_at', '2026-11-10T10:00:00.123456+00:00']]);
  });

  it('returns 409 with the current server copy on conflict', async () => {
    const id = '44444444-4444-4444-8444-444444444444';
    queue.push({ data: null }, { data: { id, title: 'Changed elsewhere' } });
    const res = await authed(request(app).patch(`/api/tasks/${id}`).send({ title: 'Mine', base_updated_at: '2026-01-01T00:00:00Z' }));
    expect(res.status).toBe(409);
    expect(res.body.error.details.current.title).toBe('Changed elsewhere');
  });

  it('skips the concurrency check when forced', async () => {
    const id = '55555555-5555-4555-8555-555555555555';
    queue.push({ data: { id } });
    await authed(request(app).patch(`/api/tasks/${id}?force=true`).send({ title: 'Mine', base_updated_at: '2026-01-01T00:00:00Z' }));
    expect(calls[0].chain.some(([m]) => m === 'lte')).toBe(false);
  });

  it('returns 404 for updates/deletes of missing (or foreign) records', async () => {
    const id = '66666666-6666-4666-8666-666666666666';
    queue.push({ data: null }, { data: null });
    expect((await authed(request(app).patch(`/api/tasks/${id}`).send({ title: 'x' }))).status).toBe(404);
    queue.push({ data: [] });
    expect((await authed(request(app).delete(`/api/tasks/${id}`))).status).toBe(404);
  });

  it('rejects invalid ids', async () => {
    expect((await authed(request(app).get('/api/tasks/not-a-uuid'))).status).toBe(422);
  });

  it('does not allow creating notifications directly', async () => {
    expect((await authed(request(app).post('/api/notifications').send({ title: 'x' }))).status).toBe(405);
  });

  it('maps database errors without leaking internals', async () => {
    queue.push({ data: null, error: { code: '23503', message: 'insert or update on table "tasks" violates foreign key constraint "secret_name"' } });
    const res = await authed(request(app).post('/api/tasks').send({ title: 'x', category_id: '77777777-7777-4777-8777-777777777777' }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain('secret_name');
  });
});

describe('documents', () => {
  const doc = {
    title: 'Passport',
    storage_path: `${USER}/abc-passport.pdf`,
    file_name: 'passport.pdf',
    mime_type: 'application/pdf',
    size_bytes: 2048,
  };

  it('accepts files stored in the users own folder', async () => {
    queue.push({ data: { id: 'd1', ...doc } });
    expect((await authed(request(app).post('/api/documents').send(doc))).status).toBe(201);
  });

  it('rejects files in another users folder or with path traversal', async () => {
    const other = await authed(request(app).post('/api/documents').send({ ...doc, storage_path: 'someone/abc.pdf' }));
    expect(other.status).toBe(400);
    const traversal = await authed(request(app).post('/api/documents').send({ ...doc, storage_path: `${USER}/../x.pdf` }));
    expect(traversal.status).toBe(400);
  });

  it('rejects unsupported types and oversized files', async () => {
    expect((await authed(request(app).post('/api/documents').send({ ...doc, mime_type: 'application/x-msdownload' }))).status).toBe(422);
    expect((await authed(request(app).post('/api/documents').send({ ...doc, size_bytes: 11 * 1024 * 1024 }))).status).toBe(422);
  });

  it('requires the uploaded object to exist', async () => {
    storageExists = false;
    expect((await authed(request(app).post('/api/documents').send(doc))).status).toBe(400);
  });

  it('issues short-lived signed URLs only', async () => {
    queue.push({ data: { id: 'd1', ...doc } });
    const res = await authed(request(app).get('/api/documents/88888888-8888-4888-8888-888888888888/file-url'));
    expect(res.status).toBe(200);
    expect(res.body.data.expiresIn).toBe(60);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('finance and account', () => {
  it('validates money amounts', async () => {
    const bad = await authed(request(app).post('/api/transactions').send({ type: 'expense', amount: 10.555 }));
    expect(bad.status).toBe(422);
    const neg = await authed(request(app).post('/api/transactions').send({ type: 'expense', amount: -1 }));
    expect(neg.status).toBe(422);
  });

  it('exports CSV with formula-injection protection', async () => {
    queue.push({
      data: [
        { transaction_date: '2026-11-01', type: 'expense', amount: '12.5', description: '=HYPERLINK("x")', payment_method: 'credit_card', entry_source: 'manual', category: { name: 'Food' } },
      ],
    });
    const res = await authed(request(app).get('/api/finance/export.csv'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain(`"'=HYPERLINK(""x"")"`);
    expect(res.text).toContain('Manual entry');
  });

  it('builds a monthly summary', async () => {
    queue.push(
      { data: [
        { type: 'income', amount: '1000', category_id: null, transaction_date: '2026-11-02' },
        { type: 'expense', amount: '250.25', category_id: 'c1', transaction_date: '2026-11-03' },
        { type: 'expense', amount: '40', category_id: 'c1', transaction_date: '2026-10-03' },
      ] },
      { data: [{ id: 'b1', category_id: 'c1', limit_amount: '500', month: '2026-11-01' }] },
      { data: [{ id: 'c1', name: 'Food', color: '#F97316', type: 'expense' }] },
    );
    const res = await authed(request(app).get('/api/finance/summary?month=2026-11'));
    expect(res.status).toBe(200);
    expect(res.body.data.totals).toEqual({ income: 1000, expense: 250.25, net: 749.75 });
    expect(res.body.data.budgets[0]).toMatchObject({ spent: 250.25, percent: 50, category_name: 'Food' });
    expect(res.body.data.trend).toHaveLength(6);
    expect(res.body.data.trend[4]).toMatchObject({ month: '2026-10', expense: 40 });
  });

  it('requires explicit confirmation to delete an account', async () => {
    const res = await authed(request(app).delete('/api/account').send({ password: 'x', confirm: 'yes' }));
    expect(res.status).toBe(422);
  });

  it('rejects invalid profile data', async () => {
    const res = await authed(request(app).patch('/api/profile').send({ timezone: 'Mars/Olympus', currency: 'dollars' }));
    expect(res.status).toBe(422);
  });

  it('rejects avatars outside the users folder', async () => {
    const res = await authed(request(app).patch('/api/profile').send({ avatar_path: 'other-user/a.png' }));
    expect(res.status).toBe(400);
  });
});

describe('utilities', () => {
  it('encodes CSV per RFC 4180', () => {
    expect(toCsv(['a', 'b'], [['x,y', 'he said "hi"'], [-5, null]])).toBe('a,b\r\n"x,y","he said ""hi"""\r\n-5,\r\n');
  });
  it('sanitizes search terms for PostgREST filters', () => {
    expect(sanitizeSearch('a,b(c)%_*')).toBe('a b c');
  });
});
