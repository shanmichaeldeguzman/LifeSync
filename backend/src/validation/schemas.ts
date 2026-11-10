import { z } from 'zod';

/*
 * Request validation schemas. These mirror the database constraints so that clients get
 * precise, field-level errors before a request ever reaches Postgres. Unknown keys
 * (e.g. user_id, created_at, entry_source) are stripped, so ownership and server-managed
 * columns can never be set by a client.
 */

const text = (max: number) => z.string().max(max);
const requiredText = (max: number) =>
  z
    .string()
    .trim()
    .min(1, 'This field is required')
    .max(max, `Must be at most ${max} characters`);
const color = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a hex color like #635BFF');
const icon = z
  .string()
  .max(64)
  .regex(/^[a-z0-9-]+$/, 'Invalid icon name');
const uuid = z.uuid();
const nullableUuid = z.uuid().nullable();
const dateTime = z.iso.datetime({ offset: true });
const date = z.iso.date();
const money = z
  .number()
  .positive('Amount must be greater than zero')
  .max(999_999_999_999, 'Amount is too large')
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Use at most 2 decimal places');
const recurrence = z.enum(['none', 'daily', 'weekly', 'monthly', 'yearly']);
const paymentMethod = z.enum(['cash', 'debit_card', 'credit_card', 'bank_transfer', 'e_wallet', 'check', 'other']);
const txType = z.enum(['income', 'expense']);
const clientId = { id: uuid.optional() };

// ---- Categories -----------------------------------------------------------
export const CategoryCreate = z.object({
  ...clientId,
  name: requiredText(60),
  color: color.optional(),
  icon: icon.optional(),
});
export const CategoryUpdate = CategoryCreate.omit({ id: true }).partial();

export const TransactionCategoryCreate = CategoryCreate.extend({ type: txType });
export const TransactionCategoryUpdate = TransactionCategoryCreate.omit({ id: true }).partial();

// ---- Tasks ----------------------------------------------------------------
const taskFields = {
  title: requiredText(200),
  description: text(5000).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  status: z.enum(['pending', 'in_progress', 'completed']).optional(),
  category_id: nullableUuid.optional(),
  due_at: dateTime.nullable().optional(),
  reminder_at: dateTime.nullable().optional(),
  recurrence: recurrence.optional(),
  recurrence_interval: z.number().int().min(1).max(365).optional(),
  recurrence_until: date.nullable().optional(),
};
export const TaskCreate = z
  .object({ ...clientId, ...taskFields })
  .refine((t) => !t.recurrence || t.recurrence === 'none' || !!t.due_at, {
    message: 'Recurring tasks need a due date',
    path: ['due_at'],
  });
export const TaskUpdate = z.object(taskFields).partial();

// ---- Events ---------------------------------------------------------------
const eventFields = {
  title: requiredText(200),
  description: text(5000).optional(),
  location: text(300).optional(),
  category_id: nullableUuid.optional(),
  start_at: dateTime,
  end_at: dateTime,
  all_day: z.boolean().optional(),
  color: color.nullable().optional(),
  reminder_minutes: z.number().int().min(0).max(10080).nullable().optional(),
  recurrence: recurrence.optional(),
  recurrence_interval: z.number().int().min(1).max(365).optional(),
  recurrence_until: date.nullable().optional(),
};
const endAfterStart = (e: { start_at?: string; end_at?: string }) =>
  !e.start_at || !e.end_at || new Date(e.end_at) >= new Date(e.start_at);
export const EventCreate = z
  .object({ ...clientId, ...eventFields })
  .refine(endAfterStart, { message: 'End must be after start', path: ['end_at'] });
export const EventUpdate = z
  .object(eventFields)
  .partial()
  .refine(endAfterStart, { message: 'End must be after start', path: ['end_at'] });

// ---- Notes ----------------------------------------------------------------
const noteFields = {
  title: text(200).optional(),
  content: text(100_000).optional(),
  category_id: nullableUuid.optional(),
  is_pinned: z.boolean().optional(),
  is_favorite: z.boolean().optional(),
  is_archived: z.boolean().optional(),
};
export const NoteCreate = z.object({ ...clientId, ...noteFields });
export const NoteUpdate = z.object(noteFields).partial();

const attachmentMime = z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain']);
export const NoteAttachmentCreate = z.object({
  ...clientId,
  note_id: uuid,
  storage_path: requiredText(512),
  file_name: requiredText(255),
  mime_type: attachmentMime,
  size_bytes: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024, 'Files must be 10 MB or smaller'),
});

// ---- Habits ---------------------------------------------------------------
const habitFields = {
  name: requiredText(100),
  description: text(1000).optional(),
  icon: icon.optional(),
  color: color.optional(),
  frequency: z.enum(['daily', 'weekly', 'custom']).optional(),
  days_of_week: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  target_per_week: z.number().int().min(1).max(7).optional(),
  reminder_time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Use HH:MM')
    .nullable()
    .optional(),
  start_date: date.optional(),
  is_archived: z.boolean().optional(),
};
export const HabitCreate = z
  .object({ ...clientId, ...habitFields })
  .refine((h) => h.frequency !== 'custom' || (h.days_of_week?.length ?? 0) > 0, {
    message: 'Pick at least one day',
    path: ['days_of_week'],
  });
export const HabitUpdate = z.object(habitFields).partial();

export const HabitLogCreate = z.object({
  ...clientId,
  habit_id: uuid,
  log_date: date,
  note: text(500).optional(),
});
export const HabitLogUpdate = z.object({ note: text(500) }).partial();

// ---- Finance --------------------------------------------------------------
const transactionFields = {
  type: txType,
  amount: money,
  category_id: nullableUuid.optional(),
  description: text(300).optional(),
  transaction_date: date.optional(),
  payment_method: paymentMethod.optional(),
};
export const TransactionCreate = z.object({ ...clientId, ...transactionFields });
export const TransactionUpdate = z.object(transactionFields).partial();

const recurringFields = {
  type: txType,
  amount: money,
  category_id: nullableUuid.optional(),
  description: text(300).optional(),
  payment_method: paymentMethod.optional(),
  frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  interval_count: z.number().int().min(1).max(365).optional(),
  next_run_date: date,
  end_date: date.nullable().optional(),
  is_active: z.boolean().optional(),
};
export const RecurringTransactionCreate = z.object({ ...clientId, ...recurringFields });
export const RecurringTransactionUpdate = z.object(recurringFields).partial();

const budgetFields = {
  month: date.refine((d) => d.endsWith('-01'), 'Budgets are set per month (use the first day)'),
  category_id: nullableUuid.optional(),
  limit_amount: money,
};
export const BudgetCreate = z.object({ ...clientId, ...budgetFields });
export const BudgetUpdate = z.object({ limit_amount: money }).partial();

const savingsFields = {
  name: requiredText(100),
  target_amount: money,
  current_amount: z.number().min(0).max(999_999_999_999).optional(),
  target_date: date.nullable().optional(),
  color: color.optional(),
};
export const SavingsGoalCreate = z.object({ ...clientId, ...savingsFields });
export const SavingsGoalUpdate = z.object(savingsFields).partial();

// ---- Documents ------------------------------------------------------------
const documentCategory = z.enum([
  'identification',
  'medical',
  'financial',
  'education',
  'legal',
  'insurance',
  'travel',
  'work',
  'home',
  'other',
]);
export const DocumentCreate = z.object({
  ...clientId,
  title: requiredText(200),
  description: text(2000).optional(),
  category: documentCategory.optional(),
  storage_path: requiredText(512),
  file_name: requiredText(255),
  mime_type: z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], {
    message: 'Only PDF, JPEG, PNG and WebP files are supported',
  }),
  size_bytes: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024, 'Files must be 10 MB or smaller'),
  expires_at: date.nullable().optional(),
  remind_days_before: z.number().int().min(0).max(365).optional(),
});
export const DocumentUpdate = z
  .object({
    title: requiredText(200),
    description: text(2000),
    category: documentCategory,
    expires_at: date.nullable(),
    remind_days_before: z.number().int().min(0).max(365),
  })
  .partial();

// ---- Goals ----------------------------------------------------------------
const goalFields = {
  title: requiredText(200),
  description: text(5000).optional(),
  category: z.enum(['academic', 'personal', 'professional', 'financial', 'health', 'other']).optional(),
  target_date: date.nullable().optional(),
  status: z.enum(['active', 'completed', 'abandoned']).optional(),
  progress_mode: z.enum(['manual', 'milestones']).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  reminder_at: dateTime.nullable().optional(),
};
export const GoalCreate = z.object({ ...clientId, ...goalFields });
export const GoalUpdate = z.object(goalFields).partial();

const milestoneFields = {
  goal_id: uuid,
  title: requiredText(200),
  due_date: date.nullable().optional(),
  is_completed: z.boolean().optional(),
  position: z.number().int().min(0).max(10_000).optional(),
};
export const MilestoneCreate = z.object({ ...clientId, ...milestoneFields });
export const MilestoneUpdate = z.object(milestoneFields).omit({ goal_id: true }).partial();

// ---- Notifications --------------------------------------------------------
export const NotificationUpdate = z.object({ read_at: dateTime.nullable() });

// ---- Profile & preferences -----------------------------------------------
export const ProfileUpdate = z
  .object({
    full_name: text(120).transform((s) => s.trim()),
    avatar_path: text(512).nullable(),
    timezone: z
      .string()
      .max(64)
      .refine((tz) => {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      }, 'Unknown timezone'),
    currency: z.string().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code'),
  })
  .partial();

export const PreferencesUpdate = z
  .object({
    theme: z.enum(['system', 'light', 'dark']),
    week_starts_on: z.number().int().min(0).max(6),
    notify_tasks: z.boolean(),
    notify_events: z.boolean(),
    notify_habits: z.boolean(),
    notify_budgets: z.boolean(),
    notify_documents: z.boolean(),
    notify_goals: z.boolean(),
    push_enabled: z.boolean(),
    default_event_reminder_minutes: z.number().int().min(0).max(10080),
    document_reminder_days: z.number().int().min(0).max(365),
    hide_amounts: z.boolean(),
    dashboard_widgets: z
      .array(z.enum(['tasks', 'events', 'habits', 'finance', 'goals', 'notes', 'reminders']))
      .max(7),
  })
  .partial();

/** Optimistic-concurrency envelope accepted on PATCH requests. */
export const ConcurrencyFields = z.object({
  base_updated_at: z.iso.datetime({ offset: true }).optional(),
});
