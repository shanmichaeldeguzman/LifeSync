-- =============================================================================
-- LifeSync — Row Level Security, ownership integrity, private storage,
-- budget alerts, reminder/notification engine, recurring transactions, data export.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Row Level Security: every row is visible/editable only by its owner.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'task_categories', 'event_categories', 'note_categories', 'transaction_categories', 'tasks', 'events',
    'notes', 'note_attachments', 'habits', 'habit_logs', 'recurring_transactions', 'transactions', 'budgets',
    'savings_goals', 'documents', 'goals', 'goal_milestones', 'notifications'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format($p$create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))$p$, t || '_select_own', t);
    execute format($p$create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))$p$, t || '_insert_own', t);
    execute format($p$create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))$p$, t || '_update_own', t);
    execute format($p$create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))$p$, t || '_delete_own', t);
  end loop;
end;
$$;

alter table public.profiles enable row level security;
alter table public.profiles force row level security;
create policy profiles_select_own on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

alter table public.user_preferences enable row level security;
alter table public.user_preferences force row level security;
create policy prefs_select_own on public.user_preferences for select to authenticated using (user_id = (select auth.uid()));
create policy prefs_update_own on public.user_preferences for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table public.sync_tombstones enable row level security;
alter table public.sync_tombstones force row level security;
create policy tombstones_select_own on public.sync_tombstones for select to authenticated using (user_id = (select auth.uid()));

-- Anonymous (signed-out) clients get no table access at all.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- ---------------------------------------------------------------------------
-- 2. Ownership integrity for foreign keys.
--    FK checks bypass RLS, so without this a user could attach their row to
--    another user's parent row by guessing a UUID.
-- ---------------------------------------------------------------------------

create or replace function public.assert_same_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_table text := tg_argv[0];
  fk_column    text := tg_argv[1];
  ref_id       uuid;
  owner_id     uuid;
begin
  execute format('select ($1).%I', fk_column) using new into ref_id;
  if ref_id is null then
    return new;
  end if;
  execute format('select user_id from public.%I where id = $1', parent_table) using ref_id into owner_id;
  if owner_id is distinct from new.user_id then
    raise exception 'Referenced % record was not found', parent_table using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger tasks_owner_category before insert or update of category_id, user_id on public.tasks
  for each row execute function public.assert_same_owner('task_categories', 'category_id');
create trigger events_owner_category before insert or update of category_id, user_id on public.events
  for each row execute function public.assert_same_owner('event_categories', 'category_id');
create trigger notes_owner_category before insert or update of category_id, user_id on public.notes
  for each row execute function public.assert_same_owner('note_categories', 'category_id');
create trigger note_attachments_owner_note before insert or update of note_id, user_id on public.note_attachments
  for each row execute function public.assert_same_owner('notes', 'note_id');
create trigger habit_logs_owner_habit before insert or update of habit_id, user_id on public.habit_logs
  for each row execute function public.assert_same_owner('habits', 'habit_id');
create trigger transactions_owner_category before insert or update of category_id, user_id on public.transactions
  for each row execute function public.assert_same_owner('transaction_categories', 'category_id');
create trigger transactions_owner_recurring before insert or update of recurring_transaction_id, user_id on public.transactions
  for each row execute function public.assert_same_owner('recurring_transactions', 'recurring_transaction_id');
create trigger recurring_owner_category before insert or update of category_id, user_id on public.recurring_transactions
  for each row execute function public.assert_same_owner('transaction_categories', 'category_id');
create trigger budgets_owner_category before insert or update of category_id, user_id on public.budgets
  for each row execute function public.assert_same_owner('transaction_categories', 'category_id');
create trigger milestones_owner_goal before insert or update of goal_id, user_id on public.goal_milestones
  for each row execute function public.assert_same_owner('goals', 'goal_id');

-- ---------------------------------------------------------------------------
-- 3. Private storage buckets. Files are stored under "<user_id>/..." and are
--    only reachable by their owner (no public URLs).
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('documents',   'documents',   false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  ('attachments', 'attachments', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain']),
  ('avatars',     'avatars',     false, 2097152,  array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy lifesync_storage_select_own on storage.objects for select to authenticated
  using (bucket_id in ('documents', 'attachments', 'avatars')
         and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy lifesync_storage_insert_own on storage.objects for insert to authenticated
  with check (bucket_id in ('documents', 'attachments', 'avatars')
              and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy lifesync_storage_update_own on storage.objects for update to authenticated
  using (bucket_id in ('documents', 'attachments', 'avatars')
         and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id in ('documents', 'attachments', 'avatars')
              and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy lifesync_storage_delete_own on storage.objects for delete to authenticated
  using (bucket_id in ('documents', 'attachments', 'avatars')
         and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- 4. Helpers
-- ---------------------------------------------------------------------------

-- "Today" in the user's own timezone.
create or replace function public.user_local_date(p_user uuid)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select (now() at time zone coalesce(
            (select case when exists (select 1 from pg_timezone_names where name = p.timezone) then p.timezone end
               from public.profiles p where p.id = p_user),
            'UTC'))::date;
$$;

-- Next start of an (optionally recurring) event at or after p_after.
create or replace function public.event_next_occurrence(e public.events, p_after timestamptz)
returns timestamptz
language plpgsql
stable
as $$
declare
  n integer;
  candidate timestamptz;
  months_between integer;
begin
  if e.start_at >= p_after then
    return e.start_at;
  end if;
  if e.recurrence = 'none' then
    return null;
  end if;

  months_between := (extract(year from age(p_after, e.start_at)) * 12 + extract(month from age(p_after, e.start_at)))::int;
  n := case e.recurrence
         when 'daily'   then floor(extract(epoch from (p_after - e.start_at)) / (86400.0 * e.recurrence_interval))
         when 'weekly'  then floor(extract(epoch from (p_after - e.start_at)) / (604800.0 * e.recurrence_interval))
         when 'monthly' then floor(months_between / e.recurrence_interval::numeric)
         when 'yearly'  then floor(months_between / (12.0 * e.recurrence_interval))
       end;
  n := greatest(n - 1, 0);

  for i in 1..10 loop
    candidate := e.start_at + case e.recurrence
                   when 'daily'   then make_interval(days   => e.recurrence_interval * n)
                   when 'weekly'  then make_interval(weeks  => e.recurrence_interval * n)
                   when 'monthly' then make_interval(months => e.recurrence_interval * n)
                   when 'yearly'  then make_interval(years  => e.recurrence_interval * n)
                 end;
    exit when candidate >= p_after;
    n := n + 1;
  end loop;

  if e.recurrence_until is not null and candidate::date > e.recurrence_until then
    return null;
  end if;
  return candidate;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Budget alerts (fired immediately when an expense pushes a budget past 80% / 100%)
-- ---------------------------------------------------------------------------

create or replace function public.transactions_check_budgets()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
  spent numeric;
  pct numeric;
  month_start date := date_trunc('month', new.transaction_date)::date;
  cat_name text;
begin
  if new.type <> 'expense' then
    return null;
  end if;
  if not coalesce((select notify_budgets from public.user_preferences where user_id = new.user_id), true) then
    return null;
  end if;

  for b in
    select * from public.budgets
     where user_id = new.user_id and month = month_start
       and (category_id is null or category_id = new.category_id)
  loop
    select coalesce(sum(amount), 0) into spent
      from public.transactions
     where user_id = new.user_id and type = 'expense'
       and transaction_date >= month_start and transaction_date < (month_start + interval '1 month')
       and (b.category_id is null or category_id = b.category_id);

    pct := spent * 100 / b.limit_amount;
    select name into cat_name from public.transaction_categories where id = b.category_id;

    if pct >= 100 then
      insert into public.notifications (user_id, type, title, body, entity_type, entity_id, dedupe_key)
      values (new.user_id, 'budget',
              'Budget exceeded' || coalesce(': ' || cat_name, ''),
              format('You have spent %s of your %s %s budget for %s.',
                     to_char(spent, 'FM999,999,999,990.00'), to_char(b.limit_amount, 'FM999,999,999,990.00'),
                     coalesce(cat_name, 'overall'), to_char(month_start, 'FMMonth YYYY')),
              'budget', b.id, 'budget:' || b.id || ':100')
      on conflict (user_id, dedupe_key) do nothing;
    elsif pct >= 80 then
      insert into public.notifications (user_id, type, title, body, entity_type, entity_id, dedupe_key)
      values (new.user_id, 'budget',
              'Budget at ' || floor(pct) || '%' || coalesce(': ' || cat_name, ''),
              format('You have used %s of %s for %s.',
                     to_char(spent, 'FM999,999,999,990.00'), to_char(b.limit_amount, 'FM999,999,999,990.00'),
                     to_char(month_start, 'FMMonth YYYY')),
              'budget', b.id, 'budget:' || b.id || ':80')
      on conflict (user_id, dedupe_key) do nothing;
    end if;
  end loop;
  return null;
end;
$$;

create trigger transactions_check_budgets
  after insert or update of amount, category_id, transaction_date, type on public.transactions
  for each row execute function public.transactions_check_budgets();

-- ---------------------------------------------------------------------------
-- 6. Reminder / notification engine (idempotent via dedupe_key)
-- ---------------------------------------------------------------------------

create or replace function public.generate_notifications_for(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  prefs public.user_preferences;
  today date := public.user_local_date(p_user);
  local_now timestamp;
  inserted integer := 0;
  n integer;
begin
  select * into prefs from public.user_preferences where user_id = p_user;
  if not found then
    return 0;
  end if;
  local_now := now() at time zone coalesce(
    (select timezone from public.profiles where id = p_user and timezone in (select name from pg_timezone_names)), 'UTC');

  if prefs.notify_tasks then
    -- Explicit task reminders
    insert into public.notifications (user_id, type, title, body, entity_type, entity_id, dedupe_key)
    select t.user_id, 'task', 'Task reminder: ' || left(t.title, 150),
           case when t.due_at is null then 'You asked to be reminded about this task.'
                else 'Due ' || to_char(t.due_at at time zone 'UTC', 'Mon DD, HH24:MI') || ' UTC' end,
           'task', t.id, 'task-reminder:' || t.id || ':' || extract(epoch from t.reminder_at)::bigint
      from public.tasks t
     where t.user_id = p_user and t.status <> 'completed'
       and t.reminder_at <= now() and t.reminder_at > now() - interval '3 days'
    on conflict (user_id, dedupe_key) do nothing;
    get diagnostics n = row_count; inserted := inserted + n;

    -- Tasks due within the next 24 hours (without an explicit reminder)
    insert into public.notifications (user_id, type, title, body, entity_type, entity_id, dedupe_key)
    select t.user_id, 'task', 'Due soon: ' || left(t.title, 160),
           'This task is due within 24 hours.',
           'task', t.id, 'task-due:' || t.id || ':' || extract(epoch from t.due_at)::bigint
      from public.tasks t
     where t.user_id = p_user and t.status <> 'completed' and t.reminder_at is null
       and t.due_at > now() and t.due_at <= now() + interval '24 hours'
    on conflict (user_id, dedupe_key) do nothing;
    get diagnostics n = row_count; inserted := inserted + n;
  end if;

  if prefs.notify_events then
    insert into public.notifications (user_id, type, title, body, entity_type, entity_id, dedupe_key)
    select x.user_id, 'event', 'Upcoming: ' || left(x.title, 160),
           case when x.reminder_minutes = 0 then 'Starting now.'
                else 'Starts in about ' || x.reminder_minutes || ' minutes.' end,
           'event', x.id, 'event:' || x.id || ':' || extract(epoch from x.occ)::bigint
      from (
        select e.*, public.event_next_occurrence(e, now() - interval '10 minutes') as occ
          from public.events e
         where e.user_id = p_user and e.reminder_minutes is not null
      ) x
     where x.occ is not null and x.occ - make_interval(mins => x.reminder_minutes) <= now()
    on conflict (user_id, dedupe_key) do nothing;
    get diagnostics n = row_count; inserted := inserted + n;
  end if;

  if prefs.notify_habits then
    insert into public.notifications (user_id, type, title, body, entity_type, entity_id, dedupe_key)
    select h.user_id, 'habit', 'Habit check-in: ' || left(h.name, 150),
           'A gentle reminder for today. Skipping a day is okay — consistency over perfection.',
           'habit', h.id, 'habit:' || h.id || ':' || today
      from public.habits h
     where h.user_id = p_user and not h.is_archived and h.reminder_time is not null
       and h.start_date <= today
       and local_now::time >= h.reminder_time
       and (h.frequency = 'daily'
            or (h.frequency = 'custom' and extract(dow from today)::smallint = any (h.days_of_week))
            or (h.frequency = 'weekly' and (
                  select count(*) from public.habit_logs l
                   where l.habit_id = h.id and l.log_date >= date_trunc('week', today)::date and l.log_date <= today
                ) < h.target_per_week))
       and not exists (select 1 from public.habit_logs l where l.habit_id = h.id and l.log_date = today)
    on conflict (user_id, dedupe_key) do nothing;
    get diagnostics n = row_count; inserted := inserted + n;
  end if;

  if prefs.notify_documents then
    insert into public.notifications (user_id, type, title, body, entity_type, entity_id, dedupe_key)
    select d.user_id, 'document',
           case when d.expires_at < today then 'Document expired: ' else 'Document expiring: ' end || left(d.title, 150),
           case when d.expires_at < today then 'Expired on ' || to_char(d.expires_at, 'Mon DD, YYYY') || '.'
                when d.expires_at = today then 'Expires today.'
                else 'Expires on ' || to_char(d.expires_at, 'Mon DD, YYYY') || ' (' || (d.expires_at - today) || ' days).' end,
           'document', d.id,
           case when d.expires_at < today then 'doc-expired:' else 'doc-expiring:' end || d.id || ':' || d.expires_at
      from public.documents d
     where d.user_id = p_user and d.expires_at is not null
       and today >= d.expires_at - d.remind_days_before
       and today <= d.expires_at + 7
    on conflict (user_id, dedupe_key) do nothing;
    get diagnostics n = row_count; inserted := inserted + n;
  end if;

  if prefs.notify_goals then
    insert into public.notifications (user_id, type, title, body, entity_type, entity_id, dedupe_key)
    select g.user_id, 'goal', 'Goal deadline approaching: ' || left(g.title, 140),
           case when g.target_date = today then 'Target date is today.'
                else 'Target date is ' || to_char(g.target_date, 'Mon DD, YYYY') || '.' end,
           'goal', g.id, 'goal-deadline:' || g.id || ':' || g.target_date
      from public.goals g
     where g.user_id = p_user and g.status = 'active' and g.target_date is not null
       and today between g.target_date - 3 and g.target_date
    on conflict (user_id, dedupe_key) do nothing;
    get diagnostics n = row_count; inserted := inserted + n;

    insert into public.notifications (user_id, type, title, body, entity_type, entity_id, dedupe_key)
    select g.user_id, 'goal', 'Goal reminder: ' || left(g.title, 150), 'Take a moment to review your progress.',
           'goal', g.id, 'goal-reminder:' || g.id || ':' || extract(epoch from g.reminder_at)::bigint
      from public.goals g
     where g.user_id = p_user and g.status = 'active'
       and g.reminder_at <= now() and g.reminder_at > now() - interval '3 days'
    on conflict (user_id, dedupe_key) do nothing;
    get diagnostics n = row_count; inserted := inserted + n;
  end if;

  return inserted;
end;
$$;

-- Callable by a signed-in user for themselves only.
create or replace function public.refresh_my_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  return public.generate_notifications_for(auth.uid());
end;
$$;

-- For the scheduler only.
create or replace function public.generate_all_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  u uuid;
  total integer := 0;
begin
  for u in select user_id from public.user_preferences loop
    total := total + public.generate_notifications_for(u);
  end loop;
  return total;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Recurring transactions: materialise due occurrences (idempotent, atomic)
-- ---------------------------------------------------------------------------

create or replace function public.run_recurring_transactions_for(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.recurring_transactions;
  today date := public.user_local_date(p_user);
  run_date date;
  step interval;
  created integer := 0;
  n integer;
  guard integer;
begin
  for r in
    select * from public.recurring_transactions
     where user_id = p_user and is_active and next_run_date <= today
     for update
  loop
    step := case r.frequency
              when 'daily'   then make_interval(days   => r.interval_count)
              when 'weekly'  then make_interval(weeks  => r.interval_count)
              when 'monthly' then make_interval(months => r.interval_count)
              when 'yearly'  then make_interval(years  => r.interval_count)
            end;
    run_date := r.next_run_date;
    guard := 0;
    while run_date <= today and (r.end_date is null or run_date <= r.end_date) and guard < 400 loop
      insert into public.transactions (user_id, category_id, recurring_transaction_id, type, amount,
                                       description, transaction_date, payment_method, entry_source)
      values (r.user_id, r.category_id, r.id, r.type, r.amount, r.description, run_date, r.payment_method, 'recurring_rule')
      on conflict (recurring_transaction_id, transaction_date) do nothing;
      get diagnostics n = row_count; created := created + n;
      run_date := (run_date + step)::date;
      guard := guard + 1;
    end loop;

    update public.recurring_transactions
       set next_run_date = run_date,
           is_active = (r.end_date is null or run_date <= r.end_date)
     where id = r.id;
  end loop;
  return created;
end;
$$;

create or replace function public.run_my_recurring_transactions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  return public.run_recurring_transactions_for(auth.uid());
end;
$$;

create or replace function public.run_all_recurring_transactions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  u uuid;
  total integer := 0;
begin
  for u in select distinct user_id from public.recurring_transactions where is_active loop
    total := total + public.run_recurring_transactions_for(u);
  end loop;
  return total;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Personal data export (runs as the caller, so RLS limits it to their data)
-- ---------------------------------------------------------------------------

create or replace function public.export_my_data()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'exported_at',            now(),
    'profile',                (select to_jsonb(p) from public.profiles p where p.id = auth.uid()),
    'preferences',            (select to_jsonb(p) - 'user_id' from public.user_preferences p where p.user_id = auth.uid()),
    'task_categories',        coalesce((select jsonb_agg(to_jsonb(x) - 'user_id') from public.task_categories x), '[]'),
    'tasks',                  coalesce((select jsonb_agg(to_jsonb(x) - 'user_id') from public.tasks x), '[]'),
    'event_categories',       coalesce((select jsonb_agg(to_jsonb(x) - 'user_id') from public.event_categories x), '[]'),
    'events',                 coalesce((select jsonb_agg(to_jsonb(x) - 'user_id') from public.events x), '[]'),
    'note_categories',        coalesce((select jsonb_agg(to_jsonb(x) - 'user_id') from public.note_categories x), '[]'),
    'notes',                  coalesce((select jsonb_agg(to_jsonb(x) - 'user_id') from public.notes x), '[]'),
    'note_attachments',       coalesce((select jsonb_agg(to_jsonb(x) - 'user_id') from public.note_attachments x), '[]'),
    'habits',                 coalesce((select jsonb_agg(to_jsonb(x) - 'user_id') from public.habits x), '[]'),
    'habit_logs',             coalesce((select jsonb_agg(to_jsonb(x) - 'user_id') from public.habit_logs x), '[]'),
    'transaction_categories', coalesce((select jsonb_agg(to_jsonb(x) - 'user_id') from public.transaction_categories x), '[]'),
    'transactions',           coalesce((select jsonb_agg(to_jsonb(x) - 'user_id') from public.transactions x), '[]'),
    'recurring_transactions', coalesce((select jsonb_agg(to_jsonb(x) - 'user_id') from public.recurring_transactions x), '[]'),
    'budgets',                coalesce((select jsonb_agg(to_jsonb(x) - 'user_id') from public.budgets x), '[]'),
    'savings_goals',          coalesce((select jsonb_agg(to_jsonb(x) - 'user_id') from public.savings_goals x), '[]'),
    'documents',              coalesce((select jsonb_agg(to_jsonb(x) - 'user_id') from public.documents x), '[]'),
    'goals',                  coalesce((select jsonb_agg(to_jsonb(x) - 'user_id') from public.goals x), '[]'),
    'goal_milestones',        coalesce((select jsonb_agg(to_jsonb(x) - 'user_id') from public.goal_milestones x), '[]'),
    'notifications',          coalesce((select jsonb_agg(to_jsonb(x) - 'user_id') from public.notifications x), '[]')
  );
$$;

-- ---------------------------------------------------------------------------
-- 9. Function privileges
-- ---------------------------------------------------------------------------

revoke execute on function public.generate_notifications_for(uuid)      from public, anon, authenticated;
revoke execute on function public.generate_all_notifications()          from public, anon, authenticated;
revoke execute on function public.run_recurring_transactions_for(uuid)  from public, anon, authenticated;
revoke execute on function public.run_all_recurring_transactions()      from public, anon, authenticated;
revoke execute on function public.user_local_date(uuid)                 from public, anon, authenticated;
revoke execute on function public.handle_new_user()                     from public, anon, authenticated;
revoke execute on function public.refresh_my_notifications()            from public, anon;
revoke execute on function public.run_my_recurring_transactions()       from public, anon;
revoke execute on function public.export_my_data()                      from public, anon;
grant execute on function public.refresh_my_notifications()      to authenticated;
grant execute on function public.run_my_recurring_transactions() to authenticated;
grant execute on function public.export_my_data()                to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Background scheduling (pg_cron is available on Supabase, including Free).
--     Wrapped so the migration still applies where pg_cron is unavailable.
-- ---------------------------------------------------------------------------

do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('lifesync-notifications', '*/10 * * * *', 'select public.generate_all_notifications()');
  perform cron.schedule('lifesync-recurring-transactions', '5 * * * *', 'select public.run_all_recurring_transactions()');
exception when others then
  raise notice 'pg_cron not available, skipping schedules: %', sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Tombstones have no FK (they must outlive the deleted row), so clean them
--     up explicitly when the account (and therefore its profile) is removed.
-- ---------------------------------------------------------------------------

create or replace function public.cleanup_user_tombstones()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.sync_tombstones where user_id = old.id;
  return old;
end;
$$;
revoke execute on function public.cleanup_user_tombstones() from public, anon, authenticated;

create trigger profiles_cleanup_tombstones
  after delete on public.profiles
  for each row execute function public.cleanup_user_tombstones();
