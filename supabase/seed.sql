-- =============================================================================
-- LifeSync development seed data (LOCAL ONLY: applied by `supabase db reset`).
-- Never run against production. Creates a demo account:
--   email:    demo@lifesync.local
--   password: LifeSync123
-- =============================================================================

do $$
declare
  uid uuid := '00000000-0000-4000-8000-000000000001';
  cat_work uuid;
  cat_personal uuid;
  ev_cat uuid;
  note_cat uuid;
  food uuid;
  salary uuid;
  transport uuid;
  habit_water uuid := gen_random_uuid();
  habit_read uuid := gen_random_uuid();
  goal_id uuid := gen_random_uuid();
  d int;
begin
  if exists (select 1 from auth.users where id = uid) then
    return;
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', 'demo@lifesync.local',
          extensions.crypt('LifeSync123', extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}', '{"full_name":"Demo User"}', now(), now(), '', '', '', '');

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), uid, uid::text, jsonb_build_object('sub', uid::text, 'email', 'demo@lifesync.local'), 'email', now(), now(), now());

  -- handle_new_user() has already created the profile, preferences and starter categories.
  select id into cat_work from public.task_categories where user_id = uid and name = 'Work';
  select id into cat_personal from public.task_categories where user_id = uid and name = 'Personal';
  select id into ev_cat from public.event_categories where user_id = uid and name = 'Work';
  select id into note_cat from public.note_categories where user_id = uid and name = 'Ideas';
  select id into food from public.transaction_categories where user_id = uid and name = 'Food & Dining';
  select id into salary from public.transaction_categories where user_id = uid and name = 'Salary';
  select id into transport from public.transaction_categories where user_id = uid and name = 'Transport';

  insert into public.tasks (user_id, category_id, title, description, priority, status, due_at, reminder_at, recurrence) values
    (uid, cat_work, 'Prepare quarterly report', 'Collect numbers from finance and draft summary.', 'high', 'in_progress', now() + interval '1 day', now() + interval '23 hours', 'none'),
    (uid, cat_personal, 'Book dentist appointment', '', 'medium', 'pending', now() + interval '3 hours', null, 'none'),
    (uid, cat_personal, 'Water the plants', '', 'low', 'pending', date_trunc('day', now()) + interval '18 hours', null, 'weekly'),
    (uid, cat_work, 'Reply to client email', '', 'urgent', 'pending', now() - interval '2 hours', null, 'none'),
    (uid, null, 'Renew gym membership', '', 'medium', 'completed', now() - interval '1 day', null, 'none');

  insert into public.events (user_id, category_id, title, location, start_at, end_at, reminder_minutes, recurrence) values
    (uid, ev_cat, 'Team standup', 'Video call', date_trunc('day', now()) + interval '1 day 9 hours', date_trunc('day', now()) + interval '1 day 9 hours 15 minutes', 10, 'daily'),
    (uid, ev_cat, 'Project review', 'Room 4B', date_trunc('day', now()) + interval '2 days 14 hours', date_trunc('day', now()) + interval '2 days 15 hours', 30, 'none'),
    (uid, null, 'Dinner with friends', 'Downtown', date_trunc('day', now()) + interval '4 days 19 hours', date_trunc('day', now()) + interval '4 days 21 hours', 60, 'none');

  insert into public.notes (user_id, category_id, title, content, is_pinned, is_favorite) values
    (uid, note_cat, 'App ideas', E'## Ideas\n\n- [x] Habit tracker with gentle reminders\n- [ ] Shared grocery list\n\n**Remember:** keep it simple.', true, true),
    (uid, null, 'Reading list', E'1. Deep Work\n2. Atomic Habits\n3. The Pragmatic Programmer', false, false);

  insert into public.habits (id, user_id, name, icon, color, frequency, reminder_time, start_date) values
    (habit_water, uid, 'Drink water', 'water-outline', '#0EA5E9', 'daily', '09:00', current_date - 30),
    (habit_read, uid, 'Read 20 minutes', 'book-outline', '#8B5CF6', 'weekly', '21:00', current_date - 30);
  update public.habits set target_per_week = 4 where id = habit_read;
  for d in 1..12 loop
    insert into public.habit_logs (user_id, habit_id, log_date) values (uid, habit_water, current_date - d);
    if d % 2 = 0 then
      insert into public.habit_logs (user_id, habit_id, log_date) values (uid, habit_read, current_date - d);
    end if;
  end loop;

  insert into public.transactions (user_id, category_id, type, amount, description, transaction_date, payment_method) values
    (uid, salary, 'income', 3200, 'Monthly salary', date_trunc('month', current_date)::date, 'bank_transfer'),
    (uid, food, 'expense', 54.20, 'Groceries', current_date - 2, 'debit_card'),
    (uid, food, 'expense', 18.75, 'Lunch', current_date - 1, 'cash'),
    (uid, transport, 'expense', 40, 'Monthly transit pass', current_date - 5, 'e_wallet');
  insert into public.budgets (user_id, month, category_id, limit_amount) values
    (uid, date_trunc('month', current_date)::date, food, 400),
    (uid, date_trunc('month', current_date)::date, null, 2000);
  insert into public.savings_goals (user_id, name, target_amount, current_amount, target_date) values
    (uid, 'Emergency fund', 5000, 1250, current_date + 180);

  insert into public.goals (id, user_id, title, description, category, target_date) values
    (goal_id, uid, 'Run a 10K', 'Build up endurance gradually.', 'health', current_date + 60);
  insert into public.goal_milestones (user_id, goal_id, title, is_completed, position) values
    (uid, goal_id, 'Run 3K without stopping', true, 0),
    (uid, goal_id, 'Run 5K', false, 1),
    (uid, goal_id, 'Run 8K', false, 2);
end;
$$;
