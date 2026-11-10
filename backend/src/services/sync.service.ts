import { z } from 'zod';
import { SYNC_TABLES } from '../config/resources.js';
import type { AuthContext } from '../middleware/auth.js';
import { fromDbError } from '../utils/http-error.js';

/** PostgREST returns at most 1000 rows per request on Supabase by default. */
export const SYNC_PAGE_SIZE = 1000;
/**
 * Overlap window re-sent on every pull. Rows are stamped with the statement time, so a
 * transaction that commits slightly after a pull could otherwise be skipped. Re-sending
 * a short window is harmless because clients merge idempotently by id.
 */
const OVERLAP_MS = 30_000;

export interface SyncPullResult {
  cursor: string;
  hasMore: boolean;
  serverTime: string;
  profile: unknown;
  preferences: unknown;
  changes: Record<string, unknown[]>;
  deleted: { table: string; id: string }[];
}

/**
 * Incremental pull for offline-first clients: every row changed since `since`
 * across all modules, plus tombstones for rows deleted elsewhere.
 */
export async function pullChanges(ctx: AuthContext, sinceRaw: unknown, now = new Date()): Promise<SyncPullResult> {
  const since = sinceRaw ? z.iso.datetime({ offset: true }).parse(sinceRaw) : null;

  const tableQueries = SYNC_TABLES.map(async (table) => {
    let q = ctx.db.from(table).select('*');
    if (since) q = q.gt('updated_at', since);
    const { data, error } = await q.order('updated_at', { ascending: true }).limit(SYNC_PAGE_SIZE);
    if (error) throw fromDbError(error);
    return [table, data ?? []] as const;
  });

  let tq = ctx.db.from('sync_tombstones').select('table_name, record_id, deleted_at');
  if (since) tq = tq.gt('deleted_at', since);

  const [tables, tombstones, profile, preferences] = await Promise.all([
    Promise.all(tableQueries),
    since ? tq.order('deleted_at', { ascending: true }).limit(SYNC_PAGE_SIZE) : Promise.resolve({ data: [], error: null }),
    ctx.db.from('profiles').select('*').maybeSingle(),
    ctx.db.from('user_preferences').select('*').maybeSingle(),
  ]);
  for (const r of [tombstones, profile, preferences]) if (r.error) throw fromDbError(r.error);

  const changes: Record<string, unknown[]> = {};
  const truncatedCursors: string[] = [];
  for (const [table, rows] of tables) {
    changes[table] = rows;
    if (rows.length === SYNC_PAGE_SIZE) {
      truncatedCursors.push((rows[rows.length - 1] as { updated_at: string }).updated_at);
    }
  }
  const tombRows = (tombstones.data ?? []) as { table_name: string; record_id: string; deleted_at: string }[];
  if (tombRows.length === SYNC_PAGE_SIZE) truncatedCursors.push(tombRows[tombRows.length - 1].deleted_at);

  const hasMore = truncatedCursors.length > 0;
  const cursor = hasMore
    ? truncatedCursors.sort()[0]
    : new Date(now.getTime() - OVERLAP_MS).toISOString();

  return {
    cursor,
    hasMore,
    serverTime: now.toISOString(),
    profile: profile.data,
    preferences: preferences.data,
    changes,
    deleted: tombRows.map((t) => ({ table: t.table_name, id: t.record_id })),
  };
}
