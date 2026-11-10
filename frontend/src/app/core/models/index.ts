/*
 * Shared domain models. These mirror the Postgres schema
 * (supabase/migrations) and the API payloads.
 */

export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskStatus = 'pending' | 'in_progress' | 'completed';
export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export type TxType = 'income' | 'expense';
export type PaymentMethod = 'cash' | 'debit_card' | 'credit_card' | 'bank_transfer' | 'e_wallet' | 'check' | 'other';
export type GoalCategory = 'academic' | 'personal' | 'professional' | 'financial' | 'health' | 'other';
export type DocumentCategory =
  | 'identification' | 'medical' | 'financial' | 'education' | 'legal'
  | 'insurance' | 'travel' | 'work' | 'home' | 'other';
export type NotificationType = 'task' | 'event' | 'habit' | 'budget' | 'document' | 'goal' | 'system';

/** Local sync bookkeeping stored alongside each cached record. */
export type SyncStatus = 'synced' | 'pending' | 'conflict';

export interface BaseRecord {
  id: string;
  user_id?: string;
  created_at: string;
  updated_at: string;
  /** Local only: synchronisation state. */
  _status?: SyncStatus;
  /** Local only: server `updated_at` the local copy is based on (for conflict detection). */
  _base?: string | null;
  /** Local only: monotonically increasing local edit counter. */
  _rev?: number;
}

export interface Category extends BaseRecord {
  name: string;
  color: string;
  icon: string;
}
export interface TransactionCategory extends Category {
  type: TxType;
}

export interface Task extends BaseRecord {
  title: string;
  description: string;
  priority: Priority;
  status: TaskStatus;
  category_id: string | null;
  due_at: string | null;
  reminder_at: string | null;
  recurrence: Recurrence;
  recurrence_interval: number;
  recurrence_until: string | null;
  recurrence_spawned?: boolean;
  completed_at: string | null;
}

export interface CalendarEvent extends BaseRecord {
  title: string;
  description: string;
  location: string;
  category_id: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean;
  color: string | null;
  reminder_minutes: number | null;
  recurrence: Recurrence;
  recurrence_interval: number;
  recurrence_until: string | null;
}

export interface Note extends BaseRecord {
  title: string;
  content: string;
  category_id: string | null;
  is_pinned: boolean;
  is_favorite: boolean;
  is_archived: boolean;
}

export interface NoteAttachment extends BaseRecord {
  note_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
}

export interface Habit extends BaseRecord {
  name: string;
  description: string;
  icon: string;
  color: string;
  frequency: 'daily' | 'weekly' | 'custom';
  days_of_week: number[];
  target_per_week: number;
  reminder_time: string | null;
  start_date: string;
  is_archived: boolean;
}

export interface HabitLog extends BaseRecord {
  habit_id: string;
  log_date: string;
  note: string;
}

export interface Transaction extends BaseRecord {
  type: TxType;
  amount: number | string;
  category_id: string | null;
  recurring_transaction_id?: string | null;
  description: string;
  transaction_date: string;
  payment_method: PaymentMethod;
  entry_source?: 'manual' | 'recurring_rule';
}

export interface RecurringTransaction extends BaseRecord {
  type: TxType;
  amount: number | string;
  category_id: string | null;
  description: string;
  payment_method: PaymentMethod;
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval_count: number;
  next_run_date: string;
  end_date: string | null;
  is_active: boolean;
}

export interface Budget extends BaseRecord {
  month: string;
  category_id: string | null;
  limit_amount: number | string;
}

export interface SavingsGoal extends BaseRecord {
  name: string;
  target_amount: number | string;
  current_amount: number | string;
  target_date: string | null;
  color: string;
}

export interface LifeDocument extends BaseRecord {
  title: string;
  description: string;
  category: DocumentCategory;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  expires_at: string | null;
  remind_days_before: number;
}

export interface Goal extends BaseRecord {
  title: string;
  description: string;
  category: GoalCategory;
  target_date: string | null;
  status: 'active' | 'completed' | 'abandoned';
  progress_mode: 'manual' | 'milestones';
  progress: number;
  reminder_at: string | null;
  completed_at: string | null;
}

export interface GoalMilestone extends BaseRecord {
  goal_id: string;
  title: string;
  due_date: string | null;
  is_completed: boolean;
  completed_at: string | null;
  position: number;
}

export interface AppNotification extends BaseRecord {
  type: NotificationType;
  title: string;
  body: string;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
}

export interface Profile {
  id: string;
  full_name: string;
  avatar_path: string | null;
  timezone: string;
  currency: string;
  created_at: string;
  updated_at: string;
}

export type DashboardWidget = 'tasks' | 'events' | 'habits' | 'finance' | 'goals' | 'notes' | 'reminders';

export interface UserPreferences {
  user_id: string;
  theme: 'system' | 'light' | 'dark';
  week_starts_on: number;
  notify_tasks: boolean;
  notify_events: boolean;
  notify_habits: boolean;
  notify_budgets: boolean;
  notify_documents: boolean;
  notify_goals: boolean;
  push_enabled: boolean;
  default_event_reminder_minutes: number;
  document_reminder_days: number;
  hide_amounts: boolean;
  dashboard_widgets: DashboardWidget[];
  updated_at: string;
}

/** Map of local table name -> record type. Table names match Postgres tables. */
export interface EntityMap {
  task_categories: Category;
  event_categories: Category;
  note_categories: Category;
  transaction_categories: TransactionCategory;
  tasks: Task;
  events: CalendarEvent;
  notes: Note;
  note_attachments: NoteAttachment;
  habits: Habit;
  habit_logs: HabitLog;
  transactions: Transaction;
  recurring_transactions: RecurringTransaction;
  budgets: Budget;
  savings_goals: SavingsGoal;
  documents: LifeDocument;
  goals: Goal;
  goal_milestones: GoalMilestone;
  notifications: AppNotification;
}
export type TableName = keyof EntityMap;

/** Table name -> REST path segment. */
export const TABLE_PATHS: Record<TableName, string> = {
  task_categories: 'task-categories',
  event_categories: 'event-categories',
  note_categories: 'note-categories',
  transaction_categories: 'transaction-categories',
  tasks: 'tasks',
  events: 'events',
  notes: 'notes',
  note_attachments: 'note-attachments',
  habits: 'habits',
  habit_logs: 'habit-logs',
  transactions: 'transactions',
  recurring_transactions: 'recurring-transactions',
  budgets: 'budgets',
  savings_goals: 'savings-goals',
  documents: 'documents',
  goals: 'goals',
  goal_milestones: 'goal-milestones',
  notifications: 'notifications',
};

/** Tables whose records are uploaded files: created online only, never via the offline outbox. */
export const ONLINE_ONLY_CREATE: TableName[] = ['documents', 'note_attachments'];

export const ALL_TABLES = Object.keys(TABLE_PATHS) as TableName[];
