import { Injectable, signal, type Signal, type WritableSignal } from '@angular/core';
import Dexie, { liveQuery, type Subscription } from 'dexie';
import { Subject } from 'rxjs';
import {
  ALL_TABLES,
  type EntityMap,
  type Profile,
  type TableName,
  type UserPreferences,
} from '../models';
import { LocalDatabase, nextSeq, uuid, type ConflictEntry, type OutboxEntry } from './local-db';

type Lists = { [K in TableName]: WritableSignal<EntityMap[K][]> };
type AnyRecord = Record<string, unknown> & { id: string };

/** Field defaults mirroring the database, so locally-created records render correctly offline. */
const DEFAULTS: Partial<Record<TableName, Record<string, unknown>>> = {
  tasks: { description: '', priority: 'medium', status: 'pending', category_id: null, due_at: null, reminder_at: null, recurrence: 'none', recurrence_interval: 1, recurrence_until: null, completed_at: null },
  events: { description: '', location: '', category_id: null, all_day: false, color: null, reminder_minutes: null, recurrence: 'none', recurrence_interval: 1, recurrence_until: null },
  notes: { title: '', content: '', category_id: null, is_pinned: false, is_favorite: false, is_archived: false },
  habits: { description: '', icon: 'leaf-outline', color: '#22C55E', frequency: 'daily', days_of_week: [], target_per_week: 7, reminder_time: null, is_archived: false },
  habit_logs: { note: '' },
  transactions: { description: '', category_id: null, payment_method: 'cash', entry_source: 'manual' },
  recurring_transactions: { description: '', category_id: null, payment_method: 'cash', interval_count: 1, end_date: null, is_active: true },
  budgets: { category_id: null },
  savings_goals: { current_amount: 0, target_date: null, color: '#635BFF' },
  goals: { description: '', category: 'personal', target_date: null, status: 'active', progress_mode: 'milestones', progress: 0, reminder_at: null, completed_at: null },
  goal_milestones: { due_date: null, is_completed: false, completed_at: null, position: 0 },
  task_categories: { color: '#635BFF', icon: 'pricetag-outline' },
  event_categories: { color: '#635BFF', icon: 'pricetag-outline' },
  note_categories: { color: '#635BFF', icon: 'pricetag-outline' },
  transaction_categories: { color: '#635BFF', icon: 'wallet-outline' },
};

/** Parent -> children relations that the server deletes via ON DELETE CASCADE. */
const CASCADES: Partial<Record<TableName, { table: TableName; fk: string }[]>> = {
  habits: [{ table: 'habit_logs', fk: 'habit_id' }],
  goals: [{ table: 'goal_milestones', fk: 'goal_id' }],
  notes: [{ table: 'note_attachments', fk: 'note_id' }],
};
/** Category tables whose deletion sets child references to null on the server. */
const SET_NULL: Partial<Record<TableName, { table: TableName; fk: string }[]>> = {
  task_categories: [{ table: 'tasks', fk: 'category_id' }],
  event_categories: [{ table: 'events', fk: 'category_id' }],
  note_categories: [{ table: 'notes', fk: 'category_id' }],
  transaction_categories: [
    { table: 'transactions', fk: 'category_id' },
    { table: 'recurring_transactions', fk: 'category_id' },
  ],
};

/**
 * Local-first data store. All reads come from IndexedDB (exposed as signals), all writes
 * go to IndexedDB first and are queued in the outbox for the SyncService to push.
 */
@Injectable({ providedIn: 'root' })
export class DataService {
  private db?: LocalDatabase;
  private dbName?: string;
  private subscriptions: Subscription[] = [];
  private readonly lists = {} as Lists;

  readonly userId = signal<string | null>(null);
  readonly ready = signal(false);
  readonly pendingCount = signal(0);
  readonly pendingKeys = signal<Set<string>>(new Set());
  readonly conflicts = signal<ConflictEntry[]>([]);
  readonly profile = signal<Profile | null>(null);
  readonly preferences = signal<UserPreferences | null>(null);
  readonly lastSyncedAt = signal<string | null>(null);

  /** Emits after every local write so the sync engine can schedule a push. */
  readonly changed$ = new Subject<void>();

  constructor() {
    for (const t of ALL_TABLES) (this.lists as Record<string, WritableSignal<unknown[]>>)[t] = signal([]);
  }

  get database(): LocalDatabase {
    if (!this.db) throw new Error('Local database is not open');
    return this.db;
  }

  /** Opens (or creates) the signed-in user's local database and starts live queries. */
  async open(userId: string): Promise<void> {
    if (this.userId() === userId && this.db) return;
    await this.close(false);
    this.dbName = `lifesync_${userId}`;
    this.db = new LocalDatabase(this.dbName);
    await this.db.open();
    this.userId.set(userId);

    const db = this.db;
    for (const t of ALL_TABLES) {
      const target = (this.lists as Record<string, WritableSignal<unknown[]>>)[t];
      this.subscriptions.push(liveQuery(() => db.table(t).toArray()).subscribe({ next: (rows) => target.set(rows) }));
    }
    this.subscriptions.push(
      liveQuery(() => db.outbox.toArray()).subscribe({
        next: (rows) => {
          this.pendingCount.set(rows.length);
          this.pendingKeys.set(new Set(rows.map((r) => r.key)));
        },
      }),
      liveQuery(() => db.conflicts.toArray()).subscribe({ next: (rows) => this.conflicts.set(rows) }),
    );

    const [profile, prefs, last] = await Promise.all([db.meta.get('profile'), db.meta.get('preferences'), db.meta.get('lastSyncedAt')]);
    this.profile.set((profile?.value as Profile) ?? null);
    this.preferences.set((prefs?.value as UserPreferences) ?? null);
    this.lastSyncedAt.set((last?.value as string) ?? null);
    this.ready.set(true);
  }

  /** Closes the local database; `wipe` deletes all cached personal data from this device. */
  async close(wipe: boolean): Promise<void> {
    this.subscriptions.forEach((s) => s.unsubscribe());
    this.subscriptions = [];
    this.db?.close();
    if (wipe && this.dbName) await Dexie.delete(this.dbName);
    this.db = undefined;
    this.userId.set(null);
    this.ready.set(false);
    for (const t of ALL_TABLES) (this.lists as Record<string, WritableSignal<unknown[]>>)[t].set([]);
    this.profile.set(null);
    this.preferences.set(null);
    this.pendingCount.set(0);
    this.conflicts.set([]);
  }

  list<T extends TableName>(table: T): Signal<EntityMap[T][]> {
    return this.lists[table].asReadonly() as Signal<EntityMap[T][]>;
  }

  find<T extends TableName>(table: T, id: string | null | undefined): EntityMap[T] | undefined {
    if (!id) return undefined;
    return (this.lists[table]() as EntityMap[T][]).find((r) => r.id === id);
  }

  isPending(table: TableName, id: string): boolean {
    return this.pendingKeys().has(`${table}:${id}`);
  }

  // ---------------------------------------------------------------- writes

  async create<T extends TableName>(table: T, data: Partial<EntityMap[T]>): Promise<EntityMap[T]> {
    const db = this.database;
    const now = new Date().toISOString();
    const record = {
      ...(DEFAULTS[table] ?? {}),
      ...data,
      id: (data as AnyRecord).id ?? uuid(),
      user_id: this.userId(),
      created_at: now,
      updated_at: now,
      _status: 'pending',
      _base: null,
      _rev: 1,
    } as unknown as EntityMap[T];
    await db.transaction('rw', db.table(table), db.outbox, async () => {
      await db.table(table).put(record);
      await this.enqueue(table, record.id, 'create', 1);
    });
    this.changed$.next();
    return record;
  }

  async update<T extends TableName>(table: T, id: string, patch: Partial<EntityMap[T]>): Promise<EntityMap[T]> {
    const db = this.database;
    let next!: EntityMap[T];
    await db.transaction('rw', db.table(table), db.outbox, async () => {
      const current = (await db.table(table).get(id)) as EntityMap[T] | undefined;
      if (!current) throw new Error('This item no longer exists.');
      const rev = (current._rev ?? 0) + 1;
      next = {
        ...current,
        ...patch,
        id,
        updated_at: new Date().toISOString(),
        _status: current._status === 'conflict' ? 'conflict' : 'pending',
        _rev: rev,
      };
      await db.table(table).put(next);
      if (current._status !== 'conflict') await this.enqueue(table, id, 'update', rev);
    });
    this.changed$.next();
    return next;
  }

  async remove(table: TableName, id: string): Promise<void> {
    const db = this.database;
    const tables = [db.table(table), db.outbox, db.conflicts, ...(CASCADES[table] ?? []).map((c) => db.table(c.table)), ...(SET_NULL[table] ?? []).map((c) => db.table(c.table))];
    await db.transaction('rw', tables, async () => {
      await db.table(table).delete(id);
      await db.conflicts.delete(`${table}:${id}`);
      const key = `${table}:${id}`;
      const existing = await db.outbox.get(key);
      if (existing?.op === 'create') {
        await db.outbox.delete(key); // never reached the server: nothing to delete remotely
      } else {
        await db.outbox.put({ key, table, recordId: id, op: 'delete', rev: 0, seq: nextSeq(), attempts: 0 });
      }
      // Mirror server-side cascades locally so the UI is consistent immediately.
      for (const c of CASCADES[table] ?? []) {
        const children = await db.table(c.table).filter((r) => r[c.fk] === id).toArray();
        for (const child of children) {
          await db.table(c.table).delete(child.id);
          await db.outbox.delete(`${c.table}:${child.id}`);
        }
      }
      for (const c of SET_NULL[table] ?? []) {
        await db.table(c.table).toCollection().filter((r) => r[c.fk] === id).modify({ [c.fk]: null });
      }
    });
    this.changed$.next();
  }

  private async enqueue(table: TableName, recordId: string, op: 'create' | 'update', rev: number) {
    const db = this.database;
    const key = `${table}:${recordId}`;
    const existing = await db.outbox.get(key);
    if (existing) {
      // Coalesce: a pending create stays a create (it will send the latest data).
      await db.outbox.put({ ...existing, op: existing.op === 'create' ? 'create' : op, rev, attempts: 0, lastError: undefined });
    } else {
      await db.outbox.put({ key, table, recordId, op, rev, seq: nextSeq(), attempts: 0 });
    }
  }

  // ------------------------------------------------- server-originated writes

  /** Merges authoritative server rows; local records with unsynced edits are left untouched. */
  async applyServerRows(table: TableName, rows: AnyRecord[]): Promise<void> {
    if (!rows.length) return;
    const db = this.database;
    await db.transaction('rw', db.table(table), async () => {
      const existing = (await db.table(table).bulkGet(rows.map((r) => r.id))) as (AnyRecord | undefined)[];
      const toPut = rows
        .map((row, i) => ({ row, local: existing[i] }))
        .filter(({ local }) => !local || local['_status'] === 'synced' || local['_status'] === undefined)
        .map(({ row, local }) => ({ ...row, _status: 'synced', _base: row['updated_at'], _rev: (local?.['_rev'] as number) ?? 0 }));
      if (toPut.length) await db.table(table).bulkPut(toPut);
    });
  }

  /** Stores a single row the server just confirmed (e.g. after an online-only create). */
  async putServerRow(table: TableName, row: { id: string; updated_at?: string }): Promise<void> {
    await this.database.table(table).put({ ...row, _status: 'synced', _base: row.updated_at ?? null, _rev: 0 });
  }

  /** Applies remote deletions, except where the user has unsynced local edits. */
  async applyServerDeletes(deleted: { table: string; id: string }[]): Promise<void> {
    if (!deleted.length) return;
    const db = this.database;
    for (const d of deleted) {
      if (!ALL_TABLES.includes(d.table as TableName)) continue;
      const local = (await db.table(d.table).get(d.id)) as AnyRecord | undefined;
      if (local && (local['_status'] === 'synced' || local['_status'] === undefined)) await db.table(d.table).delete(d.id);
    }
  }

  async setMeta(key: string, value: unknown) {
    await this.database.meta.put({ key, value });
    if (key === 'profile') this.profile.set(value as Profile);
    if (key === 'preferences') this.preferences.set(value as UserPreferences);
    if (key === 'lastSyncedAt') this.lastSyncedAt.set(value as string);
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.database.meta.get(key))?.value as T | undefined;
  }

  async outboxEntries(): Promise<OutboxEntry[]> {
    return this.database.outbox.orderBy('seq').toArray();
  }
}
