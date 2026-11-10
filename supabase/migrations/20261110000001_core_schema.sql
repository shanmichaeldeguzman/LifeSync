-- =============================================================================
-- LifeSync — core schema
-- Every user-owned table carries user_id -> auth.users(id) with ON DELETE CASCADE,
-- so deleting an account removes all of its personal data.
-- Row Level Security policies are defined in a later migration.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------

-- Keeps updated_at authoritative on the server (used for sync + conflict detection).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

-- Records deletions so offline clients can learn about rows removed elsewhere.
create table public.sync_tombstones (
  id          bigint generated always as identity primary key,
  user_id     uuid        not null,
  table_name  text        not null,
  record_id   uuid        not null,
  deleted_at  timestamptz not null default clock_timestamp()
);
create index sync_tombstones_user_deleted_idx on public.sync_tombstones (user_id, deleted_at);

create or replace function public.record_tombstone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Skip when the owning account itself is being deleted (cascade).
  if exists (select 1 from auth.users u where u.id = old.user_id) then
    insert into public.sync_tombstones (user_id, table_name, record_id)
    values (old.user_id, tg_table_name, old.id);
  end if;
  return old;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles & preferences  (auth.users is the "users" table, managed by Supabase Auth)
-- ---------------------------------------------------------------------------

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  full_name    text        not null default '' check (char_length(full_name) <= 120),
  avatar_path  text        check (avatar_path is null or char_length(avatar_path) <= 512),
  timezone     text        not null default 'UTC' check (char_length(timezone) <= 64),
  currency     char(3)     not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.user_preferences (
  user_id                uuid primary key references auth.users (id) on delete cascade,
  theme                  text     not null default 'system' check (theme in ('system', 'light', 'dark')),
  week_starts_on         smallint not null default 0 check (week_starts_on between 0 and 6),
  notify_tasks           boolean  not null default true,
  notify_events          boolean  not null default true,
  notify_habits          boolean  not null default true,
  notify_budgets         boolean  not null default true,
  notify_documents       boolean  not null default true,
  notify_goals           boolean  not null default true,
  push_enabled           boolean  not null default true,
  default_event_reminder_minutes integer not null default 15 check (default_event_reminder_minutes between 0 and 10080),
  document_reminder_days integer  not null default 30 check (document_reminder_days between 0 and 365),
  hide_amounts           boolean  not null default false,
  dashboard_widgets      jsonb    not null default '["tasks","events","habits","finance","goals","notes","reminders"]'::jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Categories (one table per module, as each module has different semantics)
-- ---------------------------------------------------------------------------

create table public.task_categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  color       text not null default '#635BFF' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  icon        text not null default 'pricetag-outline' check (char_length(icon) <= 64),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, name)
);

create table public.event_categories (like public.task_categories including all);
alter table public.event_categories
  add foreign key (user_id) references auth.users (id) on delete cascade;

create table public.note_categories (like public.task_categories including all);
alter table public.note_categories
  add foreign key (user_id) references auth.users (id) on delete cascade;

create table public.transaction_categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  type        text not null check (type in ('income', 'expense')),
  color       text not null default '#635BFF' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  icon        text not null default 'wallet-outline' check (char_length(icon) <= 64),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, type, name)
);

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------

create table public.tasks (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id          uuid references public.task_categories (id) on delete set null,
  title                text not null check (char_length(btrim(title)) between 1 and 200),
  description          text not null default '' check (char_length(description) <= 5000),
  priority             text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  status               text not null default 'pending' check (status in ('pending', 'in_progress', 'completed')),
  due_at               timestamptz,
  reminder_at          timestamptz,
  recurrence           text not null default 'none' check (recurrence in ('none', 'daily', 'weekly', 'monthly', 'yearly')),
  recurrence_interval  integer not null default 1 check (recurrence_interval between 1 and 365),
  recurrence_until     date,
  recurrence_spawned   boolean not null default false,
  completed_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint tasks_recurrence_needs_due check (recurrence = 'none' or due_at is not null)
);
create index tasks_user_status_due_idx on public.tasks (user_id, status, due_at);
create index tasks_user_updated_idx    on public.tasks (user_id, updated_at);
create index tasks_category_idx        on public.tasks (category_id);

-- Maintain completed_at.
create or replace function public.tasks_before_write()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status <> 'completed') then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status <> 'completed' then
    new.completed_at := null;
  end if;
  -- Flag (once) that this completed recurring task should spawn its next occurrence.
  -- Done in the BEFORE trigger so the row returned to the client is already final.
  if new.status = 'completed' and new.recurrence <> 'none' then
    if tg_op = 'INSERT' then
      new.recurrence_spawned := true;
    elsif not old.recurrence_spawned then
      new.recurrence_spawned := true;
    end if;
  end if;
  if tg_op = 'UPDATE' and old.recurrence_spawned then
    new.recurrence_spawned := true; -- never reset
  end if;
  return new;
end;
$$;

-- When a recurring task is completed for the first time, create its next occurrence
-- atomically in the same transaction.
create or replace function public.tasks_spawn_next_occurrence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  step interval;
  next_due timestamptz;
begin
  if new.recurrence_spawned and (tg_op = 'INSERT' or not old.recurrence_spawned) then
    step := case new.recurrence
              when 'daily'   then make_interval(days   => new.recurrence_interval)
              when 'weekly'  then make_interval(weeks  => new.recurrence_interval)
              when 'monthly' then make_interval(months => new.recurrence_interval)
              when 'yearly'  then make_interval(years  => new.recurrence_interval)
            end;
    next_due := new.due_at + step;

    if new.recurrence_until is null or next_due::date <= new.recurrence_until then
      insert into public.tasks (user_id, category_id, title, description, priority, status,
                                due_at, reminder_at, recurrence, recurrence_interval, recurrence_until)
      values (new.user_id, new.category_id, new.title, new.description, new.priority, 'pending',
              next_due,
              case when new.reminder_at is null then null else new.reminder_at + step end,
              new.recurrence, new.recurrence_interval, new.recurrence_until);
    end if;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Calendar events
-- ---------------------------------------------------------------------------

create table public.events (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id          uuid references public.event_categories (id) on delete set null,
  title                text not null check (char_length(btrim(title)) between 1 and 200),
  description          text not null default '' check (char_length(description) <= 5000),
  location             text not null default '' check (char_length(location) <= 300),
  start_at             timestamptz not null,
  end_at               timestamptz not null,
  all_day              boolean not null default false,
  color                text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  reminder_minutes     integer check (reminder_minutes is null or reminder_minutes between 0 and 10080),
  recurrence           text not null default 'none' check (recurrence in ('none', 'daily', 'weekly', 'monthly', 'yearly')),
  recurrence_interval  integer not null default 1 check (recurrence_interval between 1 and 365),
  recurrence_until     date,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint events_end_after_start check (end_at >= start_at)
);
create index events_user_start_idx   on public.events (user_id, start_at);
create index events_user_updated_idx on public.events (user_id, updated_at);

-- ---------------------------------------------------------------------------
-- Notes
-- ---------------------------------------------------------------------------

create table public.notes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id  uuid references public.note_categories (id) on delete set null,
  title        text not null default '' check (char_length(title) <= 200),
  content      text not null default '' check (char_length(content) <= 100000),
  is_pinned    boolean not null default false,
  is_favorite  boolean not null default false,
  is_archived  boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index notes_user_updated_idx on public.notes (user_id, updated_at desc);

create table public.note_attachments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  note_id       uuid not null references public.notes (id) on delete cascade,
  storage_path  text not null unique check (char_length(storage_path) <= 512),
  file_name     text not null check (char_length(file_name) between 1 and 255),
  mime_type     text not null check (char_length(mime_type) <= 100),
  size_bytes    integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index note_attachments_note_idx on public.note_attachments (note_id);
create index note_attachments_user_updated_idx on public.note_attachments (user_id, updated_at);

-- ---------------------------------------------------------------------------
-- Habits
-- ---------------------------------------------------------------------------

create table public.habits (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name             text not null check (char_length(btrim(name)) between 1 and 100),
  description      text not null default '' check (char_length(description) <= 1000),
  icon             text not null default 'leaf-outline' check (char_length(icon) <= 64),
  color            text not null default '#22C55E' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  -- daily: every day; weekly: N times per week (target_per_week); custom: specific weekdays
  frequency        text not null default 'daily' check (frequency in ('daily', 'weekly', 'custom')),
  days_of_week     smallint[] not null default '{}' check (days_of_week <@ array[0,1,2,3,4,5,6]::smallint[]),
  target_per_week  smallint not null default 7 check (target_per_week between 1 and 7),
  reminder_time    time,
  start_date       date not null default current_date,
  is_archived      boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint habits_custom_needs_days check (frequency <> 'custom' or cardinality(days_of_week) > 0)
);
create index habits_user_updated_idx on public.habits (user_id, updated_at);

create table public.habit_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  habit_id    uuid not null references public.habits (id) on delete cascade,
  log_date    date not null,
  note        text not null default '' check (char_length(note) <= 500),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (habit_id, log_date)
);
create index habit_logs_user_date_idx    on public.habit_logs (user_id, log_date);
create index habit_logs_user_updated_idx on public.habit_logs (user_id, updated_at);

-- ---------------------------------------------------------------------------
-- Personal finance (manually recorded only — no bank connections)
-- ---------------------------------------------------------------------------

create table public.recurring_transactions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id         uuid references public.transaction_categories (id) on delete set null,
  type                text not null check (type in ('income', 'expense')),
  amount              numeric(14, 2) not null check (amount > 0),
  description         text not null default '' check (char_length(description) <= 300),
  payment_method      text not null default 'cash'
                      check (payment_method in ('cash', 'debit_card', 'credit_card', 'bank_transfer', 'e_wallet', 'check', 'other')),
  frequency           text not null check (frequency in ('daily', 'weekly', 'monthly', 'yearly')),
  interval_count      integer not null default 1 check (interval_count between 1 and 365),
  next_run_date       date not null,
  end_date            date,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index recurring_transactions_user_updated_idx on public.recurring_transactions (user_id, updated_at);

create table public.transactions (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id               uuid references public.transaction_categories (id) on delete set null,
  recurring_transaction_id  uuid references public.recurring_transactions (id) on delete set null,
  type                      text not null check (type in ('income', 'expense')),
  amount                    numeric(14, 2) not null check (amount > 0 and amount < 1000000000000),
  description               text not null default '' check (char_length(description) <= 300),
  transaction_date          date not null default current_date,
  payment_method            text not null default 'cash'
                            check (payment_method in ('cash', 'debit_card', 'credit_card', 'bank_transfer', 'e_wallet', 'check', 'other')),
  -- Every LifeSync transaction is entered by the user. This column makes that explicit
  -- in the data model and in exports, so records are never mistaken for bank data.
  entry_source              text not null default 'manual' check (entry_source in ('manual', 'recurring_rule')),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (recurring_transaction_id, transaction_date)
);
create index transactions_user_date_idx    on public.transactions (user_id, transaction_date desc);
create index transactions_user_updated_idx on public.transactions (user_id, updated_at);
create index transactions_category_idx     on public.transactions (category_id);

create table public.budgets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  month         date not null check (extract(day from month) = 1),
  category_id   uuid references public.transaction_categories (id) on delete cascade, -- null = overall monthly budget
  limit_amount  numeric(14, 2) not null check (limit_amount > 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint budgets_unique_per_month unique nulls not distinct (user_id, month, category_id)
);
create index budgets_user_updated_idx on public.budgets (user_id, updated_at);

create table public.savings_goals (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name            text not null check (char_length(btrim(name)) between 1 and 100),
  target_amount   numeric(14, 2) not null check (target_amount > 0),
  current_amount  numeric(14, 2) not null default 0 check (current_amount >= 0),
  target_date     date,
  color           text not null default '#635BFF' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index savings_goals_user_updated_idx on public.savings_goals (user_id, updated_at);

-- ---------------------------------------------------------------------------
-- Documents (files live in the private "documents" storage bucket)
-- ---------------------------------------------------------------------------

create table public.documents (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title               text not null check (char_length(btrim(title)) between 1 and 200),
  description         text not null default '' check (char_length(description) <= 2000),
  category            text not null default 'other'
                      check (category in ('identification', 'medical', 'financial', 'education', 'legal',
                                          'insurance', 'travel', 'work', 'home', 'other')),
  storage_path        text not null unique check (char_length(storage_path) <= 512),
  file_name           text not null check (char_length(file_name) between 1 and 255),
  mime_type           text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes          integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  expires_at          date,
  remind_days_before  integer not null default 30 check (remind_days_before between 0 and 365),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index documents_user_updated_idx on public.documents (user_id, updated_at);
create index documents_user_expires_idx on public.documents (user_id, expires_at);

-- ---------------------------------------------------------------------------
-- Goals
-- ---------------------------------------------------------------------------

create table public.goals (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title          text not null check (char_length(btrim(title)) between 1 and 200),
  description    text not null default '' check (char_length(description) <= 5000),
  category       text not null default 'personal'
                 check (category in ('academic', 'personal', 'professional', 'financial', 'health', 'other')),
  target_date    date,
  status         text not null default 'active' check (status in ('active', 'completed', 'abandoned')),
  progress_mode  text not null default 'milestones' check (progress_mode in ('manual', 'milestones')),
  -- Used when progress_mode = 'manual'. For 'milestones' goals progress is derived
  -- from goal_milestones at read time (keeps the goal row free of write contention).
  progress       smallint not null default 0 check (progress between 0 and 100),
  reminder_at    timestamptz,
  completed_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index goals_user_updated_idx on public.goals (user_id, updated_at);

create table public.goal_milestones (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  goal_id       uuid not null references public.goals (id) on delete cascade,
  title         text not null check (char_length(btrim(title)) between 1 and 200),
  due_date      date,
  is_completed  boolean not null default false,
  completed_at  timestamptz,
  position      integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index goal_milestones_goal_idx         on public.goal_milestones (goal_id, position);
create index goal_milestones_user_updated_idx on public.goal_milestones (user_id, updated_at);

create or replace function public.goals_before_write()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status <> 'completed') then
    new.completed_at := coalesce(new.completed_at, now());
    if new.progress_mode = 'manual' then new.progress := 100; end if;
  elsif new.status <> 'completed' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;

create or replace function public.milestones_before_write()
returns trigger
language plpgsql
as $$
begin
  if new.is_completed and (tg_op = 'INSERT' or not old.is_completed) then
    new.completed_at := coalesce(new.completed_at, now());
  elsif not new.is_completed then
    new.completed_at := null;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------

create table public.notifications (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type           text not null check (type in ('task', 'event', 'habit', 'budget', 'document', 'goal', 'system')),
  title          text not null check (char_length(title) between 1 and 200),
  body           text not null default '' check (char_length(body) <= 1000),
  entity_type    text check (entity_type is null or char_length(entity_type) <= 40),
  entity_id      uuid,
  dedupe_key     text,
  read_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index notifications_user_updated_idx on public.notifications (user_id, updated_at);

-- ---------------------------------------------------------------------------
-- Triggers: updated_at, tombstones, domain logic
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'user_preferences', 'task_categories', 'event_categories', 'note_categories',
    'transaction_categories', 'tasks', 'events', 'notes', 'note_attachments', 'habits', 'habit_logs',
    'recurring_transactions', 'transactions', 'budgets', 'savings_goals', 'documents', 'goals',
    'goal_milestones', 'notifications'
  ] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
                   t || '_set_updated_at', t);
  end loop;

  foreach t in array array[
    'task_categories', 'event_categories', 'note_categories', 'transaction_categories', 'tasks', 'events',
    'notes', 'note_attachments', 'habits', 'habit_logs', 'recurring_transactions', 'transactions', 'budgets',
    'savings_goals', 'documents', 'goals', 'goal_milestones', 'notifications'
  ] loop
    execute format('create trigger %I after delete on public.%I for each row execute function public.record_tombstone()',
                   t || '_tombstone', t);
  end loop;
end;
$$;

create trigger tasks_before_write before insert or update on public.tasks
  for each row execute function public.tasks_before_write();
create trigger tasks_spawn_next after insert or update on public.tasks
  for each row execute function public.tasks_spawn_next_occurrence();

create trigger goals_before_write before insert or update on public.goals
  for each row execute function public.goals_before_write();
create trigger milestones_before_write before insert or update on public.goal_milestones
  for each row execute function public.milestones_before_write();

-- ---------------------------------------------------------------------------
-- New-user bootstrap: profile, preferences and sensible starter categories
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(left(new.raw_user_meta_data ->> 'full_name', 120), ''));

  insert into public.user_preferences (user_id) values (new.id);

  insert into public.task_categories (user_id, name, color, icon) values
    (new.id, 'Personal', '#635BFF', 'person-outline'),
    (new.id, 'Work',     '#0EA5E9', 'briefcase-outline'),
    (new.id, 'Study',    '#F59E0B', 'school-outline'),
    (new.id, 'Errands',  '#22C55E', 'cart-outline');

  insert into public.event_categories (user_id, name, color, icon) values
    (new.id, 'Personal', '#635BFF', 'person-outline'),
    (new.id, 'Work',     '#0EA5E9', 'briefcase-outline'),
    (new.id, 'Social',   '#EC4899', 'people-outline'),
    (new.id, 'Health',   '#22C55E', 'fitness-outline');

  insert into public.note_categories (user_id, name, color, icon) values
    (new.id, 'Personal', '#635BFF', 'person-outline'),
    (new.id, 'Ideas',    '#F59E0B', 'bulb-outline'),
    (new.id, 'Work',     '#0EA5E9', 'briefcase-outline');

  insert into public.transaction_categories (user_id, name, type, color, icon) values
    (new.id, 'Salary',        'income',  '#22C55E', 'cash-outline'),
    (new.id, 'Freelance',     'income',  '#14B8A6', 'laptop-outline'),
    (new.id, 'Other income',  'income',  '#84CC16', 'add-circle-outline'),
    (new.id, 'Food & Dining', 'expense', '#F97316', 'restaurant-outline'),
    (new.id, 'Transport',     'expense', '#0EA5E9', 'car-outline'),
    (new.id, 'Housing',       'expense', '#8B5CF6', 'home-outline'),
    (new.id, 'Utilities',     'expense', '#06B6D4', 'flash-outline'),
    (new.id, 'Shopping',      'expense', '#EC4899', 'bag-outline'),
    (new.id, 'Health',        'expense', '#EF4444', 'medkit-outline'),
    (new.id, 'Entertainment', 'expense', '#A855F7', 'film-outline'),
    (new.id, 'Education',     'expense', '#F59E0B', 'school-outline'),
    (new.id, 'Other',         'expense', '#64748B', 'ellipsis-horizontal-outline');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
