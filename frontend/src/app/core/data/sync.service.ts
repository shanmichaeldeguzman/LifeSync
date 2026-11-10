import { Injectable, inject, signal } from '@angular/core';
import { App } from '@capacitor/app';
import { debounceTime, type Subscription } from 'rxjs';
import { ApiError, ApiService } from '../services/api.service';
import { NetworkService } from '../services/network.service';
import { TABLE_PATHS, type Profile, type TableName, type UserPreferences } from '../models';
import { DataService } from './data.service';
import type { ConflictEntry, OutboxEntry } from './local-db';

type AnyRecord = Record<string, unknown> & { id: string };

interface PullResponse {
  cursor: string;
  hasMore: boolean;
  serverTime: string;
  profile: Profile | null;
  preferences: UserPreferences | null;
  changes: Record<string, AnyRecord[]>;
  deleted: { table: string; id: string }[];
}

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error';

const NUMERIC_FIELDS = ['amount', 'limit_amount', 'target_amount', 'current_amount'];
const HOUSEKEEPING_INTERVAL = 10 * 60 * 1000;

/** Removes local bookkeeping and server-managed fields before sending a record. */
export function toPayload(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (k.startsWith('_') || k === 'user_id' || k === 'created_at' || k === 'updated_at') continue;
    out[k] = NUMERIC_FIELDS.includes(k) && v !== null && v !== undefined ? Number(v) : v;
  }
  return out;
}

/**
 * Offline-first synchronisation engine.
 *
 *  push: replays the outbox in order. Creates are idempotent (client-generated UUIDs),
 *        updates carry `base_updated_at` for optimistic concurrency. Conflicts,
 *        remote deletions and rejected changes are parked for the user to resolve,
 *        never silently overwritten.
 *  pull: fetches everything changed since the last cursor, plus remote deletions.
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly api = inject(ApiService);
  private readonly data = inject(DataService);
  private readonly network = inject(NetworkService);

  readonly state = signal<SyncState>('idle');
  readonly lastError = signal<string | null>(null);

  private running: Promise<void> | null = null;
  private rerun = false;
  private timer?: ReturnType<typeof setInterval>;
  private changeSub?: Subscription;
  private lastHousekeeping = 0;
  private started = false;
  private listenersBound = false;

  start() {
    if (this.started) return;
    this.started = true;
    this.changeSub = this.data.changed$.pipe(debounceTime(1200)).subscribe(() => void this.sync());
    this.timer = setInterval(() => {
      if (document.visibilityState === 'visible') void this.sync();
    }, 60_000);
    if (!this.listenersBound) {
      this.listenersBound = true;
      this.network.onReconnect(() => this.started && void this.sync());
      App.addListener('resume', () => this.started && void this.sync()).catch(() => undefined);
      document.addEventListener('visibilitychange', () => {
        if (this.started && document.visibilityState === 'visible') void this.sync();
      });
    }
    void this.sync({ housekeeping: true });
  }

  stop() {
    this.started = false;
    this.changeSub?.unsubscribe();
    clearInterval(this.timer);
  }

  /** Runs one push+pull cycle (coalescing concurrent requests). */
  sync(opts: { housekeeping?: boolean } = {}): Promise<void> {
    if (!this.data.ready()) return Promise.resolve();
    if (!this.network.online()) {
      this.state.set('offline');
      return Promise.resolve();
    }
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = (async () => {
      this.state.set('syncing');
      try {
        do {
          this.rerun = false;
          const pushed = await this.push();
          await this.pull();
          const due = opts.housekeeping || Date.now() - this.lastHousekeeping > HOUSEKEEPING_INTERVAL;
          if (due && pushed) {
            this.lastHousekeeping = Date.now();
            if (await this.housekeeping()) await this.pull();
          }
        } while (this.rerun && this.network.online());
        this.state.set(this.network.online() ? 'idle' : 'offline');
        this.lastError.set(null);
      } catch (e) {
        const err = e as ApiError;
        this.state.set(err?.isNetwork || !this.network.online() ? 'offline' : 'error');
        this.lastError.set(err?.message ?? 'Sync failed');
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  // ------------------------------------------------------------------ push

  /** Returns true when the whole outbox was processed. */
  private async push(): Promise<boolean> {
    const entries = await this.data.outboxEntries();
    for (const entry of entries) {
      const ok = await this.pushEntry(entry);
      if (!ok) return false;
    }
    return true;
  }

  private async pushEntry(entry: OutboxEntry): Promise<boolean> {
    const db = this.data.database;
    const path = `/${TABLE_PATHS[entry.table]}`;
    const record = (await db.table(entry.table).get(entry.recordId)) as AnyRecord | undefined;

    try {
      if (entry.op === 'delete') {
        await this.api.delete(`${path}/${entry.recordId}`).catch((e: ApiError) => {
          if (e.status !== 404) throw e; // already gone: fine
        });
        await db.outbox.delete(entry.key);
        return true;
      }
      if (!record) {
        await db.outbox.delete(entry.key);
        return true;
      }
      const res =
        entry.op === 'create'
          ? await this.api.post<{ data: AnyRecord }>(path, toPayload(record))
          : await this.api.patch<{ data: AnyRecord }>(`${path}/${entry.recordId}`, {
              ...toPayload(record),
              base_updated_at: (record['_base'] as string | null) ?? undefined,
            });
      await this.confirm(entry, res.data);
      return true;
    } catch (e) {
      const err = e as ApiError;
      if (err.isNetwork || err.status === 0 || err.status >= 500 || err.status === 429 || err.status === 401) {
        await db.outbox.update(entry.key, { attempts: entry.attempts + 1, lastError: err.message });
        throw err; // stop this cycle; retry later
      }
      await this.park(entry, record, err);
      return true;
    }
  }

  /** Server accepted the change: adopt its authoritative copy unless edited again meanwhile. */
  private async confirm(entry: OutboxEntry, row: AnyRecord) {
    const db = this.data.database;
    await db.transaction('rw', db.table(entry.table), db.outbox, async () => {
      const current = await db.outbox.get(entry.key);
      const local = (await db.table(entry.table).get(entry.recordId)) as AnyRecord | undefined;
      if (current && current.rev !== entry.rev) {
        // Edited while the request was in flight: keep local data, rebase on the new server version.
        if (local) await db.table(entry.table).put({ ...local, _base: row['updated_at'] });
        await db.outbox.put({ ...current, op: 'update' });
      } else {
        await db.table(entry.table).put({ ...row, _status: 'synced', _base: row['updated_at'], _rev: local?.['_rev'] ?? 0 });
        await db.outbox.delete(entry.key);
      }
    });
  }

  /** Records a change that needs the user's attention. */
  private async park(entry: OutboxEntry, record: AnyRecord | undefined, err: ApiError) {
    const db = this.data.database;
    // Two devices checking the same habit on the same day: the server copy already exists.
    if (entry.op === 'create' && err.status === 409 && entry.table === 'habit_logs') {
      await db.table(entry.table).delete(entry.recordId);
      await db.outbox.delete(entry.key);
      return;
    }

    const details = err.details as { current?: AnyRecord } | { field: string; message: string }[] | undefined;
    let conflict: ConflictEntry;
    const base = {
      key: entry.key,
      table: entry.table,
      recordId: entry.recordId,
      op: entry.op === 'create' ? ('create' as const) : ('update' as const),
      local: record ?? {},
      createdAt: new Date().toISOString(),
    };

    if (err.status === 409 && entry.op === 'update' && details && !Array.isArray(details) && details.current) {
      conflict = { ...base, kind: 'conflict', server: details.current, message: 'Changed on another device' };
    } else if (err.status === 404 && entry.op === 'update') {
      conflict = { ...base, kind: 'deleted', server: null, message: 'Deleted on another device' };
    } else {
      const fieldMsg = Array.isArray(details) && details.length ? `: ${details.map((d) => d.message).join(', ')}` : '';
      conflict = { ...base, kind: 'rejected', server: null, message: `${err.message}${fieldMsg}` };
    }

    await db.transaction('rw', db.table(entry.table), db.outbox, db.conflicts, async () => {
      await db.conflicts.put(conflict);
      await db.outbox.delete(entry.key);
      if (record) await db.table(entry.table).put({ ...record, _status: 'conflict' });
    });
  }

  // ------------------------------------------------------------------ pull

  private async pull() {
    let cursor = await this.data.getMeta<string>('cursor');
    for (let page = 0; page < 50; page++) {
      const res = await this.api.get<PullResponse>('/sync/pull', { since: cursor }, 45000);
      for (const [table, rows] of Object.entries(res.changes)) {
        await this.data.applyServerRows(table as TableName, rows);
      }
      await this.data.applyServerDeletes(res.deleted);
      if (res.profile) await this.data.setMeta('profile', res.profile);
      if (res.preferences) await this.data.setMeta('preferences', res.preferences);
      cursor = res.cursor;
      await this.data.setMeta('cursor', cursor);
      if (!res.hasMore) break;
    }
    await this.data.setMeta('lastSyncedAt', new Date().toISOString());
  }

  /** Server-side jobs: materialise recurring transactions and due reminders. */
  private async housekeeping(): Promise<boolean> {
    const [rec, notif] = await Promise.all([
      this.api.post<{ data: { created: number } }>('/finance/recurring/run').catch(() => null),
      this.api.post<{ data: { created: number } }>('/notifications/refresh').catch(() => null),
    ]);
    return (rec?.data.created ?? 0) + (notif?.data.created ?? 0) > 0;
  }

  // ------------------------------------------------------- conflict resolution

  /** Keep this device's version and overwrite the server copy. */
  async keepLocal(c: ConflictEntry) {
    const db = this.data.database;
    await db.transaction('rw', db.table(c.table), db.outbox, db.conflicts, async () => {
      const local = ((await db.table(c.table).get(c.recordId)) as AnyRecord | undefined) ?? (c.local as AnyRecord);
      const rev = ((local['_rev'] as number) ?? 0) + 1;
      const base = c.kind === 'conflict' ? (c.server?.['updated_at'] as string) : null;
      await db.table(c.table).put({ ...local, _status: 'pending', _base: base, _rev: rev });
      await db.outbox.put({
        key: c.key,
        table: c.table,
        recordId: c.recordId,
        op: c.kind === 'deleted' ? 'create' : c.op,
        rev,
        seq: Date.now() * 1000,
        attempts: 0,
      });
      await db.conflicts.delete(c.key);
    });
    void this.sync();
  }

  /** Discard this device's change and use the server's version (or deletion). */
  async keepServer(c: ConflictEntry) {
    const db = this.data.database;
    let server = c.server as AnyRecord | null;
    if (c.kind === 'rejected') {
      server = await this.api
        .get<{ data: AnyRecord }>(`/${TABLE_PATHS[c.table]}/${c.recordId}`)
        .then((r) => r.data)
        .catch(() => null);
    }
    await db.transaction('rw', db.table(c.table), db.conflicts, async () => {
      if (server) await db.table(c.table).put({ ...server, _status: 'synced', _base: server['updated_at'], _rev: 0 });
      else await db.table(c.table).delete(c.recordId);
      await db.conflicts.delete(c.key);
    });
  }

  /** Notes only: keep the server version and save this device's text as a separate note. */
  async keepBoth(c: ConflictEntry) {
    const local = c.local as Record<string, unknown>;
    await this.keepServer(c);
    await this.data.create('notes', {
      title: `${(local['title'] as string) || 'Untitled'} (conflicted copy)`,
      content: (local['content'] as string) ?? '',
      category_id: (local['category_id'] as string | null) ?? null,
    });
  }
}
