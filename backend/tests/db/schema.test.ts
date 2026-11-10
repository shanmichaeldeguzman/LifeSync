import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDb, createUser, asUser } from './harness';

let db: PGlite;
let alice: string;
let bob: string;

beforeAll(async () => {
  db = await createTestDb();
  alice = await createUser(db, 'alice@example.com', 'Alice Doe');
  bob = await createUser(db, 'bob@example.com', 'Bob Roe');
}, 60_000);

describe('new user bootstrap', () => {
  it('creates profile, preferences and starter categories', async () => {
    const rows = await asUser(db, alice, async (tx) => ({
      profile: (await tx.query<{ full_name: string }>('select full_name from profiles')).rows,
      prefs: (await tx.query('select * from user_preferences')).rows,
      taskCats: (await tx.query('select * from task_categories')).rows,
      txCats: (await tx.query('select * from transaction_categories')).rows,
    }));
    expect(rows.profile).toEqual([{ full_name: 'Alice Doe' }]);
    expect(rows.prefs).toHaveLength(1);
    expect(rows.taskCats.length).toBeGreaterThan(0);
    expect(rows.txCats.length).toBeGreaterThan(5);
  });
});

describe('row level security / data isolation', () => {
  let aliceTaskId: string;

  beforeAll(async () => {
    aliceTaskId = await asUser(db, alice, async (tx) =>
      (await tx.query<{ id: string }>(`insert into tasks (title) values ('Alice private task') returning id`)).rows[0].id,
    );
  });

  it('defaults user_id to the caller', async () => {
    const owner = (await db.query<{ user_id: string }>('select user_id from tasks where id = $1', [aliceTaskId])).rows[0];
    expect(owner.user_id).toBe(alice);
  });

  it('hides other users rows', async () => {
    const seen = await asUser(db, bob, async (tx) => (await tx.query('select * from tasks')).rows);
    expect(seen).toHaveLength(0);
  });

  it('blocks updates and deletes of other users rows', async () => {
    await asUser(db, bob, async (tx) => {
      const upd = await tx.query(`update tasks set title = 'hacked' where id = $1`, [aliceTaskId]);
      expect(upd.affectedRows).toBe(0);
      const del = await tx.query(`delete from tasks where id = $1`, [aliceTaskId]);
      expect(del.affectedRows).toBe(0);
    });
    const title = (await db.query<{ title: string }>('select title from tasks where id = $1', [aliceTaskId])).rows[0].title;
    expect(title).toBe('Alice private task');
  });

  it('blocks inserting rows on behalf of another user', async () => {
    await expect(
      asUser(db, bob, (tx) => tx.query(`insert into tasks (user_id, title) values ($1, 'spoof')`, [alice])),
    ).rejects.toThrow(/row-level security/);
  });

  it('blocks re-assigning a row to another user', async () => {
    const bobTask = await asUser(db, bob, async (tx) =>
      (await tx.query<{ id: string }>(`insert into tasks (title) values ('Bob task') returning id`)).rows[0].id,
    );
    await expect(
      asUser(db, bob, (tx) => tx.query(`update tasks set user_id = $1 where id = $2`, [alice, bobTask])),
    ).rejects.toThrow(/row-level security/);
  });

  it('prevents linking to another users parent rows (FK ownership)', async () => {
    const aliceHabit = await asUser(db, alice, async (tx) =>
      (await tx.query<{ id: string }>(`insert into habits (name) values ('Read') returning id`)).rows[0].id,
    );
    await expect(
      asUser(db, bob, (tx) => tx.query(`insert into habit_logs (habit_id, log_date) values ($1, current_date)`, [aliceHabit])),
    ).rejects.toThrow(/not found/);
    const aliceCat = await asUser(db, alice, async (tx) =>
      (await tx.query<{ id: string }>(`select id from transaction_categories limit 1`)).rows[0].id,
    );
    await expect(
      asUser(db, bob, (tx) =>
        tx.query(`insert into transactions (type, amount, category_id) values ('expense', 5, $1)`, [aliceCat]),
      ),
    ).rejects.toThrow(/not found/);
  });

  it('gives anonymous users no access', async () => {
    await expect(asUser(db, null, (tx) => tx.query('select * from tasks'))).rejects.toThrow(/permission denied/);
  });

  it('isolates profiles and preferences', async () => {
    const profiles = await asUser(db, bob, async (tx) => (await tx.query('select id from profiles')).rows);
    expect(profiles).toEqual([{ id: bob }]);
    const upd = await asUser(db, bob, (tx) => tx.query(`update user_preferences set theme = 'dark' where user_id = $1`, [alice]));
    expect(upd.affectedRows).toBe(0);
  });

  it('restricts storage objects to the owners folder', async () => {
    await asUser(db, alice, (tx) =>
      tx.query(`insert into storage.objects (bucket_id, name) values ('documents', $1)`, [`${alice}/passport.pdf`]),
    );
    await expect(
      asUser(db, bob, (tx) =>
        tx.query(`insert into storage.objects (bucket_id, name) values ('documents', $1)`, [`${alice}/evil.pdf`]),
      ),
    ).rejects.toThrow(/row-level security/);
    const bobSees = await asUser(db, bob, async (tx) => (await tx.query('select * from storage.objects')).rows);
    expect(bobSees).toHaveLength(0);
  });

  it('exports only the callers data', async () => {
    const exported = await asUser(db, bob, async (tx) =>
      (await tx.query<{ data: { tasks: { title: string }[] } }>('select export_my_data() as data')).rows[0].data,
    );
    expect(exported.tasks.map((t) => t.title)).toEqual(['Bob task']);
  });

  it('does not let users call scheduler-only functions', async () => {
    await expect(asUser(db, bob, (tx) => tx.query('select generate_all_notifications()'))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, bob, (tx) => tx.query(`select generate_notifications_for($1)`, [alice]))).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe('domain logic', () => {
  it('spawns exactly one next occurrence when a recurring task is completed', async () => {
    await asUser(db, alice, async (tx) => {
      const id = (
        await tx.query<{ id: string }>(
          `insert into tasks (title, due_at, recurrence) values ('Water plants', '2026-01-05T09:00:00Z', 'weekly') returning id`,
        )
      ).rows[0].id;
      const done = await tx.query<{ completed_at: string; recurrence_spawned: boolean }>(
        `update tasks set status = 'completed' where id = $1 returning completed_at, recurrence_spawned`,
        [id],
      );
      expect(done.rows[0].completed_at).not.toBeNull();
      expect(done.rows[0].recurrence_spawned).toBe(true);
      // Toggling back and forth must not create duplicates.
      await tx.query(`update tasks set status = 'pending' where id = $1`, [id]);
      await tx.query(`update tasks set status = 'completed' where id = $1`, [id]);
      const all = await tx.query<{ due_at: Date }>(`select due_at from tasks where title = 'Water plants' order by due_at`);
      expect(all.rows).toHaveLength(2);
      expect(new Date(all.rows[1].due_at).toISOString()).toBe('2026-01-12T09:00:00.000Z');
    });
  });

  it('raises budget alerts at 80% and 100%, once each', async () => {
    await asUser(db, alice, async (tx) => {
      const cat = (await tx.query<{ id: string }>(`select id from transaction_categories where name = 'Food & Dining'`)).rows[0].id;
      const month = new Date();
      const monthStart = `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, '0')}-01`;
      await tx.query(`insert into budgets (month, category_id, limit_amount) values ($1, $2, 100)`, [monthStart, cat]);
      await tx.query(`insert into transactions (type, amount, category_id, transaction_date) values ('expense', 85, $1, $2)`, [cat, monthStart]);
      await tx.query(`insert into transactions (type, amount, category_id, transaction_date) values ('expense', 5, $1, $2)`, [cat, monthStart]);
      await tx.query(`insert into transactions (type, amount, category_id, transaction_date) values ('expense', 20, $1, $2)`, [cat, monthStart]);
      const notes = await tx.query<{ dedupe_key: string }>(`select dedupe_key from notifications where type = 'budget' order by dedupe_key`);
      expect(notes.rows.map((r) => r.dedupe_key.split(':')[2])).toEqual(['100', '80']);
    });
  });

  it('generates reminders idempotently', async () => {
    await asUser(db, alice, async (tx) => {
      await tx.query(`insert into tasks (title, reminder_at) values ('Call dentist', now() - interval '5 minutes')`);
      await tx.query(
        `insert into documents (title, storage_path, file_name, mime_type, size_bytes, expires_at)
         values ('Passport', $1, 'passport.pdf', 'application/pdf', 1000, current_date + 10)`,
        [`${alice}/passport.pdf`],
      );
      await tx.query(`insert into events (title, start_at, end_at, reminder_minutes) values ('Standup', now() + interval '10 minutes', now() + interval '40 minutes', 15)`);
      const first = (await tx.query<{ n: number }>('select refresh_my_notifications() as n')).rows[0].n;
      const second = (await tx.query<{ n: number }>('select refresh_my_notifications() as n')).rows[0].n;
      expect(first).toBeGreaterThanOrEqual(3);
      expect(second).toBe(0);
      const types = (await tx.query<{ type: string }>(`select distinct type from notifications order by type`)).rows.map((r) => r.type);
      expect(types).toEqual(expect.arrayContaining(['task', 'document', 'event']));
    });
  });

  it('respects notification preferences', async () => {
    await asUser(db, bob, async (tx) => {
      await tx.query(`update user_preferences set notify_tasks = false`);
      await tx.query(`insert into tasks (title, reminder_at) values ('Muted', now() - interval '1 minute')`);
      await tx.query('select refresh_my_notifications()');
      const n = await tx.query(`select * from notifications where type = 'task'`);
      expect(n.rows).toHaveLength(0);
    });
  });

  it('computes the next occurrence of recurring events', async () => {
    const res = await db.query<{ occ: Date }>(`
      select event_next_occurrence(row(gen_random_uuid(), gen_random_uuid(), null, 't', '', '',
        '2026-01-01T10:00:00Z'::timestamptz, '2026-01-01T11:00:00Z'::timestamptz, false, null, 10,
        'weekly', 1, null, now(), now())::events, '2026-03-02T00:00:00Z') as occ`);
    expect(new Date(res.rows[0].occ).toISOString()).toBe('2026-03-05T10:00:00.000Z');
  });

  it('materialises recurring transactions idempotently', async () => {
    await asUser(db, alice, async (tx) => {
      await tx.query(
        `insert into recurring_transactions (type, amount, description, frequency, next_run_date)
         values ('expense', 12.5, 'Streaming', 'monthly', current_date - interval '2 months')`,
      );
      const a = (await tx.query<{ n: number }>('select run_my_recurring_transactions() as n')).rows[0].n;
      const b = (await tx.query<{ n: number }>('select run_my_recurring_transactions() as n')).rows[0].n;
      expect(a).toBe(3);
      expect(b).toBe(0);
      const rows = await tx.query<{ entry_source: string }>(`select entry_source from transactions where description = 'Streaming'`);
      expect(rows.rows.every((r) => r.entry_source === 'recurring_rule')).toBe(true);
    });
  });

  it('records tombstones for deletions and keeps updated_at authoritative', async () => {
    await asUser(db, alice, async (tx) => {
      const note = (await tx.query<{ id: string; updated_at: Date }>(`insert into notes (title) values ('tmp') returning id, updated_at`)).rows[0];
      const upd = (
        await tx.query<{ updated_at: Date }>(`update notes set title = 'tmp2', updated_at = '2000-01-01' where id = $1 returning updated_at`, [note.id])
      ).rows[0];
      expect(new Date(upd.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(note.updated_at).getTime());
      await tx.query('delete from notes where id = $1', [note.id]);
      const tomb = await tx.query(`select * from sync_tombstones where record_id = $1 and table_name = 'notes'`, [note.id]);
      expect(tomb.rows).toHaveLength(1);
    });
  });

  it('rejects invalid data via constraints', async () => {
    await expect(asUser(db, alice, (tx) => tx.query(`insert into tasks (title, priority) values ('x', 'critical')`))).rejects.toThrow();
    await expect(asUser(db, alice, (tx) => tx.query(`insert into transactions (type, amount) values ('expense', -5)`))).rejects.toThrow();
    await expect(asUser(db, alice, (tx) => tx.query(`insert into events (title, start_at, end_at) values ('x', now(), now() - interval '1 hour')`))).rejects.toThrow();
    await expect(asUser(db, alice, (tx) => tx.query(`insert into tasks (title) values ('   ')`))).rejects.toThrow();
  });

  it('removes every personal record when the account is deleted', async () => {
    await db.query('delete from auth.users where id = $1', [alice]);
    for (const table of ['tasks', 'notes', 'transactions', 'documents', 'habits', 'notifications', 'profiles', 'sync_tombstones']) {
      const col = table === 'profiles' ? 'id' : 'user_id';
      const left = await db.query(`select 1 from ${table} where ${col} = $1`, [alice]);
      expect(left.rows, table).toHaveLength(0);
    }
  });
});
