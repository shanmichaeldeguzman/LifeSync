import { z } from 'zod';
import type { ResourceConfig } from '../config/resources.js';
import type { AuthContext } from '../middleware/auth.js';
import { HttpError, fromDbError } from '../utils/http-error.js';
import { PaginationSchema, sanitizeSearch } from '../utils/query.js';
import type { Logger } from '../utils/logger.js';

type Row = Record<string, unknown> & { id: string; updated_at?: string };
type QueryInput = Record<string, unknown>;

export interface ListResult {
  data: Row[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

const BoolParam = z.enum(['true', 'false']).transform((v) => v === 'true');
const UuidParam = z.uuid();
const IdParam = z.uuid({ message: 'Invalid id' });
const RangeParam = z.string().regex(/^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/, 'Invalid date');

/**
 * Generic, configuration-driven data access for user-owned resources.
 * All queries run through the caller's RLS-scoped Supabase client.
 */
export class CrudService {
  constructor(
    private readonly config: ResourceConfig,
    private readonly logger: Logger,
  ) {}

  async list(ctx: AuthContext, query: QueryInput): Promise<ListResult> {
    const { page, limit } = PaginationSchema.parse(query);
    const sort = typeof query.sort === 'string' && this.config.sortable.includes(query.sort) ? query.sort : this.config.defaultSort.column;
    const ascending = query.order === 'asc' ? true : query.order === 'desc' ? false : this.config.defaultSort.ascending;

    let q = ctx.db.from(this.config.table).select('*', { count: 'exact' });

    // Free-text search across configured columns
    if (typeof query.search === 'string' && query.search.trim() && this.config.searchColumns?.length) {
      const term = sanitizeSearch(query.search);
      if (term) q = q.or(this.config.searchColumns.map((c) => `${c}.ilike.*${term}*`).join(','));
    }

    // Equality filters
    for (const [field, kind] of Object.entries(this.config.filters ?? {})) {
      const raw = query[field];
      if (raw === undefined || raw === '') continue;
      if (typeof raw !== 'string') throw HttpError.badRequest(`Invalid filter: ${field}`);
      if (kind === 'boolean') q = q.eq(field, BoolParam.parse(raw));
      else if (kind === 'nullable-uuid' && raw === 'none') q = q.is(field, null);
      else if (kind === 'uuid' || kind === 'nullable-uuid') q = q.eq(field, UuidParam.parse(raw));
      else q = q.in(field, raw.split(',').slice(0, 10).map((v) => v.trim()).filter(Boolean));
    }

    // Range filters, e.g. due_from / due_to
    for (const [column, prefix] of Object.entries(this.config.ranges ?? {})) {
      const from = query[`${prefix}_from`];
      const to = query[`${prefix}_to`];
      if (typeof from === 'string' && from) q = q.gte(column, RangeParam.parse(from));
      if (typeof to === 'string' && to) q = q.lte(column, RangeParam.parse(to));
    }

    if (typeof query.updated_since === 'string' && query.updated_since) {
      q = q.gt('updated_at', z.iso.datetime({ offset: true }).parse(query.updated_since));
    }

    const from = (page - 1) * limit;
    const { data, error, count } = await q
      .order(sort, { ascending, nullsFirst: false })
      .order('id', { ascending: true })
      .range(from, from + limit - 1);
    if (error) throw fromDbError(error);

    const total = count ?? 0;
    return { data: (data ?? []) as Row[], meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
  }

  async get(ctx: AuthContext, id: string): Promise<Row> {
    const { data, error } = await ctx.db.from(this.config.table).select('*').eq('id', IdParam.parse(id)).maybeSingle();
    if (error) throw fromDbError(error);
    if (!data) throw HttpError.notFound();
    return data as Row;
  }

  /**
   * Creates a record. If the client supplied an id that already exists for this user
   * (an offline replay), the existing record is returned instead of a duplicate.
   */
  async create(ctx: AuthContext, body: unknown): Promise<{ row: Row; created: boolean }> {
    if (!this.config.createSchema) throw new HttpError(405, 'method_not_allowed', 'Records of this type cannot be created directly');
    const input = this.config.createSchema.parse(body);

    if (this.config.storageBucket) {
      await this.assertOwnedStorageObject(ctx, this.config.storageBucket, String(input.storage_path));
    }

    const { data, error } = await ctx.db.from(this.config.table).insert(input).select('*').single();
    if (!error) return { row: data as Row, created: true };

    if (error.code === '23505' && typeof input.id === 'string') {
      const existing = await ctx.db.from(this.config.table).select('*').eq('id', input.id).maybeSingle();
      if (existing.data) return { row: existing.data as Row, created: false };
    }
    throw fromDbError(error);
  }

  /**
   * Updates a record with optimistic concurrency: when `base_updated_at` is supplied the
   * write only succeeds if the server copy has not changed since. The check and the write
   * are a single conditional UPDATE, so there is no race window.
   */
  async update(ctx: AuthContext, id: string, body: unknown, force = false): Promise<Row> {
    if (!this.config.updateSchema) throw new HttpError(405, 'method_not_allowed', 'Records of this type cannot be edited');
    const recordId = IdParam.parse(id);
    const raw = (body ?? {}) as Record<string, unknown>;
    const base = raw.base_updated_at === undefined ? undefined : z.iso.datetime({ offset: true }).parse(raw.base_updated_at);
    const patch = this.config.updateSchema.parse(raw);
    if (Object.keys(patch).length === 0) throw HttpError.badRequest('No changes were provided');

    let q = ctx.db.from(this.config.table).update(patch).eq('id', recordId);
    if (base && !force) q = q.lte('updated_at', base);
    const { data, error } = await q.select('*').maybeSingle();
    if (error) throw fromDbError(error);
    if (data) return data as Row;

    const current = await ctx.db.from(this.config.table).select('*').eq('id', recordId).maybeSingle();
    if (current.error) throw fromDbError(current.error);
    if (!current.data) throw HttpError.notFound();
    throw HttpError.conflict('This record was changed on another device.', { current: current.data });
  }

  async remove(ctx: AuthContext, id: string): Promise<void> {
    const recordId = IdParam.parse(id);
    const { data, error } = await ctx.db.from(this.config.table).delete().eq('id', recordId).select('*');
    if (error) throw fromDbError(error);
    if (!data || data.length === 0) throw HttpError.notFound();

    if (this.config.storageBucket) {
      const path = (data[0] as Row).storage_path as string;
      const { error: storageError } = await ctx.db.storage.from(this.config.storageBucket).remove([path]);
      if (storageError) this.logger.warn({ table: this.config.table }, 'Stored file could not be removed after record deletion');
    }
  }

  /** Uploaded files must live in the caller's own folder and actually exist. */
  private async assertOwnedStorageObject(ctx: AuthContext, bucket: string, path: string) {
    const segments = path.split('/');
    if (segments[0] !== ctx.userId || segments.length < 2 || segments.some((s) => s === '' || s === '.' || s === '..')) {
      throw HttpError.badRequest('Invalid file location');
    }
    const { data, error } = await ctx.db.storage.from(bucket).exists(path);
    if (error || !data) throw HttpError.badRequest('The uploaded file could not be found. Please upload it again.');
  }
}
