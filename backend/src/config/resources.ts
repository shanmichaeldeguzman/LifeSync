import type { ZodType } from 'zod';
import * as S from '../validation/schemas.js';

export type FilterKind = 'string' | 'boolean' | 'uuid' | 'nullable-uuid';

/**
 * Declarative description of a user-owned REST resource. The generic CRUD router
 * and service use this to expose consistent list/search/filter/sort/paginate,
 * get, create (idempotent), update (optimistic concurrency) and delete endpoints.
 */
export interface ResourceConfig {
  /** URL segment, e.g. "task-categories" -> /api/task-categories */
  path: string;
  /** Postgres table (RLS-protected). */
  table: string;
  createSchema?: ZodType<Record<string, unknown>>;
  updateSchema?: ZodType<Record<string, unknown>>;
  searchColumns?: string[];
  filters?: Record<string, FilterKind>;
  /** Range filters: column -> query prefix (e.g. due_at -> due_from / due_to). */
  ranges?: Record<string, string>;
  sortable: string[];
  defaultSort: { column: string; ascending: boolean };
  /** Included in the offline sync pull. */
  syncable: boolean;
  /** Rows reference a file in this private bucket (path validated + cleaned up on delete). */
  storageBucket?: 'documents' | 'attachments';
}

const CATEGORY_SORT = { sortable: ['name', 'created_at', 'updated_at'], defaultSort: { column: 'name', ascending: true } };

export const RESOURCES: ResourceConfig[] = [
  { path: 'task-categories', table: 'task_categories', createSchema: S.CategoryCreate, updateSchema: S.CategoryUpdate, searchColumns: ['name'], syncable: true, ...CATEGORY_SORT },
  { path: 'event-categories', table: 'event_categories', createSchema: S.CategoryCreate, updateSchema: S.CategoryUpdate, searchColumns: ['name'], syncable: true, ...CATEGORY_SORT },
  { path: 'note-categories', table: 'note_categories', createSchema: S.CategoryCreate, updateSchema: S.CategoryUpdate, searchColumns: ['name'], syncable: true, ...CATEGORY_SORT },
  {
    path: 'transaction-categories', table: 'transaction_categories',
    createSchema: S.TransactionCategoryCreate, updateSchema: S.TransactionCategoryUpdate,
    searchColumns: ['name'], filters: { type: 'string' }, syncable: true, ...CATEGORY_SORT,
  },
  {
    path: 'tasks', table: 'tasks', createSchema: S.TaskCreate, updateSchema: S.TaskUpdate,
    searchColumns: ['title', 'description'],
    filters: { status: 'string', priority: 'string', category_id: 'nullable-uuid', recurrence: 'string' },
    ranges: { due_at: 'due' },
    sortable: ['due_at', 'priority', 'created_at', 'updated_at', 'title', 'status'],
    defaultSort: { column: 'due_at', ascending: true }, syncable: true,
  },
  {
    path: 'events', table: 'events', createSchema: S.EventCreate, updateSchema: S.EventUpdate,
    searchColumns: ['title', 'description', 'location'], filters: { category_id: 'nullable-uuid', all_day: 'boolean' },
    ranges: { start_at: 'start' },
    sortable: ['start_at', 'created_at', 'updated_at', 'title'], defaultSort: { column: 'start_at', ascending: true }, syncable: true,
  },
  {
    path: 'notes', table: 'notes', createSchema: S.NoteCreate, updateSchema: S.NoteUpdate,
    searchColumns: ['title', 'content'],
    filters: { category_id: 'nullable-uuid', is_pinned: 'boolean', is_favorite: 'boolean', is_archived: 'boolean' },
    sortable: ['updated_at', 'created_at', 'title'], defaultSort: { column: 'updated_at', ascending: false }, syncable: true,
  },
  {
    path: 'note-attachments', table: 'note_attachments', createSchema: S.NoteAttachmentCreate,
    filters: { note_id: 'uuid' }, sortable: ['created_at'], defaultSort: { column: 'created_at', ascending: true },
    syncable: true, storageBucket: 'attachments',
  },
  {
    path: 'habits', table: 'habits', createSchema: S.HabitCreate, updateSchema: S.HabitUpdate,
    searchColumns: ['name', 'description'], filters: { frequency: 'string', is_archived: 'boolean' },
    sortable: ['name', 'created_at', 'updated_at'], defaultSort: { column: 'created_at', ascending: true }, syncable: true,
  },
  {
    path: 'habit-logs', table: 'habit_logs', createSchema: S.HabitLogCreate, updateSchema: S.HabitLogUpdate,
    filters: { habit_id: 'uuid' }, ranges: { log_date: 'date' },
    sortable: ['log_date', 'created_at'], defaultSort: { column: 'log_date', ascending: false }, syncable: true,
  },
  {
    path: 'transactions', table: 'transactions', createSchema: S.TransactionCreate, updateSchema: S.TransactionUpdate,
    searchColumns: ['description'],
    filters: { type: 'string', category_id: 'nullable-uuid', payment_method: 'string', entry_source: 'string' },
    ranges: { transaction_date: 'date' },
    sortable: ['transaction_date', 'amount', 'created_at', 'updated_at'],
    defaultSort: { column: 'transaction_date', ascending: false }, syncable: true,
  },
  {
    path: 'recurring-transactions', table: 'recurring_transactions',
    createSchema: S.RecurringTransactionCreate, updateSchema: S.RecurringTransactionUpdate,
    searchColumns: ['description'], filters: { type: 'string', is_active: 'boolean' },
    sortable: ['next_run_date', 'amount', 'created_at'], defaultSort: { column: 'next_run_date', ascending: true }, syncable: true,
  },
  {
    path: 'budgets', table: 'budgets', createSchema: S.BudgetCreate, updateSchema: S.BudgetUpdate,
    filters: { month: 'string', category_id: 'nullable-uuid' },
    sortable: ['month', 'limit_amount'], defaultSort: { column: 'month', ascending: false }, syncable: true,
  },
  {
    path: 'savings-goals', table: 'savings_goals', createSchema: S.SavingsGoalCreate, updateSchema: S.SavingsGoalUpdate,
    searchColumns: ['name'], sortable: ['target_date', 'created_at', 'name'], defaultSort: { column: 'created_at', ascending: true }, syncable: true,
  },
  {
    path: 'documents', table: 'documents', createSchema: S.DocumentCreate, updateSchema: S.DocumentUpdate,
    searchColumns: ['title', 'description', 'file_name'], filters: { category: 'string', mime_type: 'string' },
    ranges: { expires_at: 'expires' },
    sortable: ['created_at', 'updated_at', 'title', 'expires_at'], defaultSort: { column: 'created_at', ascending: false },
    syncable: true, storageBucket: 'documents',
  },
  {
    path: 'goals', table: 'goals', createSchema: S.GoalCreate, updateSchema: S.GoalUpdate,
    searchColumns: ['title', 'description'], filters: { status: 'string', category: 'string' },
    sortable: ['target_date', 'created_at', 'updated_at', 'title'], defaultSort: { column: 'created_at', ascending: false }, syncable: true,
  },
  {
    path: 'goal-milestones', table: 'goal_milestones', createSchema: S.MilestoneCreate, updateSchema: S.MilestoneUpdate,
    filters: { goal_id: 'uuid', is_completed: 'boolean' },
    sortable: ['position', 'due_date', 'created_at'], defaultSort: { column: 'position', ascending: true }, syncable: true,
  },
  {
    path: 'notifications', table: 'notifications', updateSchema: S.NotificationUpdate,
    searchColumns: ['title', 'body'], filters: { type: 'string' },
    sortable: ['created_at'], defaultSort: { column: 'created_at', ascending: false }, syncable: true,
  },
];

export const SYNC_TABLES = RESOURCES.filter((r) => r.syncable).map((r) => r.table);
