#!/usr/bin/env node
/**
 * Production smoke + data-isolation test for a deployed LifeSync.
 *
 *   SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… API_URL=https://…/api \
 *   node scripts/isolation-check.mjs
 *
 * Creates two temporary confirmed users, exercises every module through the REST API as
 * user A, then verifies user B can neither read, modify, delete nor download A's data
 * (via the API, via Supabase REST directly, and via Storage). Finally deletes both users
 * through the real account-deletion endpoint. Exits non-zero on any failure.
 */
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, API_URL } = process.env;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY || !API_URL) {
  console.error('Missing SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY or API_URL');
  process.exit(2);
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, opts);
let passed = 0;
let failed = 0;
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${detail && !ok ? `: ${detail}` : ''}`);
}

async function api(token, method, path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

async function makeUser(label) {
  const email = `lifesync-check-${label}-${Date.now()}@example.com`;
  const password = `Check-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `Check ${label}` } });
  if (error) throw new Error(`createUser ${label}: ${error.message}`);
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, opts);
  const { data: s, error: e2 } = await client.auth.signInWithPassword({ email, password });
  if (e2) throw new Error(`signIn ${label}: ${e2.message}`);
  return { id: data.user.id, email, password, token: s.session.access_token, client };
}

const today = new Date().toISOString().slice(0, 10);
const month = `${today.slice(0, 7)}-01`;

async function main() {
  console.log(`LifeSync production check against ${API_URL}\n`);
  const health = await fetch(`${API_URL}/health`).then((r) => r.json()).catch(() => null);
  check('API health endpoint responds', health?.status === 'ok');
  check('API rejects unauthenticated requests', (await fetch(`${API_URL}/tasks`)).status === 401);

  const A = await makeUser('a');
  const B = await makeUser('b');
  try {
    // ---------------------------------------------------------------- user A: every module
    console.log('\nUser A, CRUD across modules');
    const prof = await api(A.token, 'GET', '/profile');
    check('profile + preferences bootstrapped on sign-up', prof.status === 200 && prof.body.data.profile.full_name === 'Check a' && !!prof.body.data.preferences);
    const cats = await api(A.token, 'GET', '/transaction-categories?limit=100');
    check('starter categories created', cats.status === 200 && cats.body.data.length >= 5);
    const food = cats.body.data.find((c) => c.type === 'expense');

    const created = {};
    const payloads = {
      'task-categories': { name: 'Check category', color: '#635BFF', icon: 'pricetag-outline' },
      tasks: { id: randomUUID(), title: 'Check task', priority: 'high', due_at: new Date(Date.now() + 86400000).toISOString() },
      events: { title: 'Check event', start_at: new Date(Date.now() + 3600000).toISOString(), end_at: new Date(Date.now() + 7200000).toISOString(), reminder_minutes: 15 },
      notes: { title: 'Check note', content: '# Private\n- [ ] item' },
      habits: { name: 'Check habit', frequency: 'daily' },
      budgets: { month, category_id: food.id, limit_amount: 10 },
      transactions: { type: 'expense', amount: 12.34, category_id: food.id, description: 'Check expense', transaction_date: today },
      'recurring-transactions': { type: 'expense', amount: 9.99, frequency: 'monthly', next_run_date: today, description: 'Check subscription' },
      'savings-goals': { name: 'Check savings', target_amount: 1000 },
      goals: { title: 'Check goal', category: 'personal' },
    };
    for (const [path, body] of Object.entries(payloads)) {
      const r = await api(A.token, 'POST', `/${path}`, body);
      check(`create ${path}`, r.status === 201, JSON.stringify(r.body));
      created[path] = r.body?.data;
    }
    const replay = await api(A.token, 'POST', '/tasks', payloads.tasks);
    check('replayed create is idempotent (no duplicate)', replay.status === 200 && replay.body.data.id === payloads.tasks.id);
    const log = await api(A.token, 'POST', '/habit-logs', { habit_id: created.habits.id, log_date: today });
    check('create habit log', log.status === 201);
    const ms = await api(A.token, 'POST', '/goal-milestones', { goal_id: created.goals.id, title: 'Step 1' });
    check('create goal milestone', ms.status === 201);

    const upd = await api(A.token, 'PATCH', `/tasks/${created.tasks.id}`, { status: 'completed', base_updated_at: created.tasks.updated_at });
    check('update with optimistic concurrency', upd.status === 200 && upd.body.data.status === 'completed' && !!upd.body.data.completed_at);
    const stale = await api(A.token, 'PATCH', `/tasks/${created.tasks.id}`, { title: 'stale', base_updated_at: created.tasks.updated_at });
    check('stale update returns 409 with server copy', stale.status === 409 && !!stale.body.error.details.current);

    const search = await api(A.token, 'GET', '/notes?search=Check&limit=5');
    check('search + pagination', search.status === 200 && search.body.data.length === 1 && search.body.meta.total === 1);
    const invalid = await api(A.token, 'POST', '/tasks', { title: '', priority: 'critical' });
    check('validation errors are field-level (422)', invalid.status === 422 && invalid.body.error.details.length >= 2);

    const notif = await api(A.token, 'GET', '/notifications?type=budget');
    check('budget alert generated when expense exceeds budget', notif.status === 200 && notif.body.data.some((n) => n.type === 'budget'));
    check('reminder refresh works', (await api(A.token, 'POST', '/notifications/refresh')).status === 200);
    const rec = await api(A.token, 'POST', '/finance/recurring/run');
    check('recurring transactions materialise', rec.status === 200 && rec.body.data.created >= 1);
    const summary = await api(A.token, 'GET', `/finance/summary?month=${today.slice(0, 7)}`);
    check('finance summary', summary.status === 200 && summary.body.data.totals.expense >= 12.34);
    const csv = await fetch(`${API_URL}/finance/export.csv`, { headers: { Authorization: `Bearer ${A.token}` } });
    const csvText = await csv.text();
    check('CSV export', csv.status === 200 && csvText.includes('Check expense') && csvText.includes('Manual entry'));
    const dash = await api(A.token, 'GET', `/dashboard/summary?today=${today}`);
    check('dashboard summary', dash.status === 200);
    const pull = await api(A.token, 'GET', '/sync/pull');
    check('sync pull returns all modules', pull.status === 200 && pull.body.changes.tasks.length >= 1 && pull.body.changes.notes.length === 1);

    // Storage: upload a document into A's private folder and register it
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
    const path = `${A.id}/${randomUUID()}-check.pdf`;
    const up = await A.client.storage.from('documents').upload(path, pdf, { contentType: 'application/pdf' });
    check('upload to own private folder', !up.error, up.error?.message);
    const doc = await api(A.token, 'POST', '/documents', { title: 'Check doc', storage_path: path, file_name: 'check.pdf', mime_type: 'application/pdf', size_bytes: pdf.length, expires_at: today });
    check('register document', doc.status === 201, JSON.stringify(doc.body));
    const signed = await api(A.token, 'GET', `/documents/${doc.body.data.id}/file-url`);
    check('owner gets short-lived signed URL', signed.status === 200 && signed.body.data.expiresIn === 60);
    const dl = await fetch(signed.body.data.url);
    check('signed URL downloads the file', dl.status === 200);
    const publicUrl = await fetch(`${SUPABASE_URL}/storage/v1/object/public/documents/${path}`);
    check('no public URL access to documents', publicUrl.status >= 400);
    const wrongPath = await api(A.token, 'POST', '/documents', { title: 'x', storage_path: `${B.id}/x.pdf`, file_name: 'x.pdf', mime_type: 'application/pdf', size_bytes: 10 });
    check("cannot register a file in another user's folder", wrongPath.status === 400);

    // ---------------------------------------------------------------- user B: isolation
    console.log('\nUser B, data isolation');
    for (const p of ['tasks', 'notes', 'transactions', 'documents', 'habits', 'goals', 'budgets', 'events']) {
      const r = await api(B.token, 'GET', `/${p}?limit=200`);
      const leaked = r.body?.data?.some((row) => row.user_id === A.id);
      check(`B cannot list A's ${p}`, r.status === 200 && !leaked);
    }
    check("B cannot read A's task by id", (await api(B.token, 'GET', `/tasks/${created.tasks.id}`)).status === 404);
    check("B cannot update A's note", (await api(B.token, 'PATCH', `/notes/${created.notes.id}`, { title: 'hacked' })).status === 404);
    check("B cannot delete A's transaction", (await api(B.token, 'DELETE', `/transactions/${created.transactions.id}`)).status === 404);
    check("B cannot get A's document URL", (await api(B.token, 'GET', `/documents/${doc.body.data.id}/file-url`)).status === 404);
    const bPull = await api(B.token, 'GET', '/sync/pull');
    check("B's sync pull contains none of A's rows", bPull.status === 200 && !Object.values(bPull.body.changes).flat().some((r) => r.user_id === A.id));
    const direct = await B.client.from('tasks').select('*').eq('id', created.tasks.id);
    check('RLS blocks direct Supabase REST reads', !direct.error && direct.data.length === 0);
    const directUpd = await B.client.from('notes').update({ title: 'hacked' }).eq('id', created.notes.id).select();
    check('RLS blocks direct Supabase REST writes', (directUpd.data ?? []).length === 0);
    const spoof = await B.client.from('tasks').insert({ user_id: A.id, title: 'spoof' });
    check('RLS blocks inserting rows for another user', !!spoof.error);
    const bDl = await B.client.storage.from('documents').download(path);
    check("Storage blocks B from downloading A's file", !!bDl.error);
    const bUp = await B.client.storage.from('documents').upload(`${A.id}/evil.pdf`, pdf, { contentType: 'application/pdf' });
    check("Storage blocks B from writing into A's folder", !!bUp.error);
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, opts);
    const anonRead = await anon.from('notes').select('*');
    check('anonymous clients see no data', !!anonRead.error || anonRead.data.length === 0);

    const intact = await api(A.token, 'GET', `/notes/${created.notes.id}`);
    check("A's data is untouched after B's attempts", intact.body.data.title === 'Check note');

    // ---------------------------------------------------------------- cleanup via real endpoints
    console.log('\nCleanup');
    const del = await api(A.token, 'DELETE', `/documents/${doc.body.data.id}`);
    check('delete document removes record', del.status === 204);
    const gone = await A.client.storage.from('documents').download(path);
    check('…and its stored file', !!gone.error);
    const exp = await api(A.token, 'GET', '/account/export');
    check('personal data export', exp.status === 200 && Array.isArray(exp.body.tasks));
    const badPw = await api(A.token, 'DELETE', '/account', { password: 'wrong', confirm: 'DELETE' });
    check('account deletion requires the correct password', badPw.status === 403);
    for (const u of [A, B]) {
      const r = await api(u.token, 'DELETE', '/account', { password: u.password, confirm: 'DELETE' });
      check(`account deletion (${u === A ? 'A' : 'B'})`, r.status === 204, JSON.stringify(r.body));
    }
    const leftovers = await admin.from('tasks').select('id').eq('user_id', A.id);
    check('all of A\'s rows removed', (leftovers.data ?? []).length === 0);
  } finally {
    for (const u of [A, B]) await admin.auth.admin.deleteUser(u.id).catch(() => undefined);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
