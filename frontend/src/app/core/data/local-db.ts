import Dexie, { type Table } from 'dexie';
import { ALL_TABLES, type EntityMap, type TableName } from '../models';

/** A pending change waiting to be pushed to the server (one entry per record, coalesced). */
export interface OutboxEntry {
  key: string; // `${table}:${recordId}`
  table: TableName;
  recordId: string;
  op: 'create' | 'update' | 'delete';
  /** Local revision of the record when this entry was last updated. */
  rev: number;
  /** Ordering: earlier changes are pushed first (so parents precede children). */
  seq: number;
  attempts: number;
  lastError?: string;
}

/** A change the server could not apply automatically and that needs the user's decision. */
export interface ConflictEntry {
  key: string;
  table: TableName;
  recordId: string;
  kind: 'conflict' | 'deleted' | 'rejected';
  /** Operation that was being synchronised when the problem occurred. */
  op: 'create' | 'update';
  local: Record<string, unknown>;
  server: Record<string, unknown> | null;
  message: string;
  createdAt: string;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

/**
 * Per-user IndexedDB database. Each server table has a local mirror; records carry
 * `_status` / `_base` / `_rev` bookkeeping used by the sync engine. Data persists
 * across app restarts, so unsynchronised changes are never lost.
 */
export class LocalDatabase extends Dexie {
  outbox!: Table<OutboxEntry, string>;
  conflicts!: Table<ConflictEntry, string>;
  meta!: Table<MetaEntry, string>;

  constructor(name: string) {
    super(name);
    const stores: Record<string, string> = { outbox: 'key, seq', conflicts: 'key', meta: 'key' };
    for (const t of ALL_TABLES) stores[t] = 'id, updated_at, _status';
    this.version(1).stores(stores);
  }

  entity<T extends TableName>(table: T): Table<EntityMap[T], string> {
    return this.table(table) as Table<EntityMap[T], string>;
  }
}

let seqCounter = 0;
/** Monotonic ordering key that survives restarts (time-based) and is unique within a session. */
export function nextSeq(): number {
  seqCounter = (seqCounter + 1) % 1000;
  return Date.now() * 1000 + seqCounter;
}

export function uuid(): string {
  const c: Crypto = globalThis.crypto;
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  // RFC 4122 v4 fallback for older WebViews / insecure contexts
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
