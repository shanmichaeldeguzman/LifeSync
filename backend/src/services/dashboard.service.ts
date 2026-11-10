import { z } from 'zod';
import type { AuthContext } from '../middleware/auth.js';
import { fromDbError } from '../utils/http-error.js';

const DashboardQuery = z.object({
  /** Client's local date (YYYY-MM-DD) so "today" matches the user's timezone. */
  today: z.iso.date().optional(),
  /** Client's UTC offset in minutes (as returned by Date#getTimezoneOffset). */
  tz_offset: z.coerce.number().int().min(-840).max(840).optional(),
});

/** Aggregated snapshot for the dashboard, computed in parallel. */
export async function dashboardSummary(ctx: AuthContext, query: unknown) {
  const { today: todayParam, tz_offset = 0 } = DashboardQuery.parse(query);
  const now = new Date();
  const today = todayParam ?? now.toISOString().slice(0, 10);
  const dayStart = new Date(new Date(`${today}T00:00:00Z`).getTime() + tz_offset * 60_000);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const weekAhead = new Date(dayStart.getTime() + 7 * 86_400_000);
  const monthStart = `${today.slice(0, 7)}-01`;

  const db = ctx.db;
  const [dueToday, overdue, completedToday, pending, events, habits, logsToday, monthTx, goals, notes, unread] =
    await Promise.all([
      db.from('tasks').select('id, title, priority, due_at, status').neq('status', 'completed')
        .gte('due_at', dayStart.toISOString()).lt('due_at', dayEnd.toISOString()).order('due_at').limit(20),
      db.from('tasks').select('id', { count: 'exact', head: true }).neq('status', 'completed').lt('due_at', dayStart.toISOString()),
      db.from('tasks').select('id', { count: 'exact', head: true }).eq('status', 'completed').gte('completed_at', dayStart.toISOString()),
      db.from('tasks').select('id', { count: 'exact', head: true }).neq('status', 'completed'),
      db.from('events').select('id, title, start_at, end_at, all_day, location, color, recurrence')
        .or(`and(start_at.gte.${dayStart.toISOString()},start_at.lt.${weekAhead.toISOString()}),recurrence.neq.none`)
        .order('start_at').limit(50),
      db.from('habits').select('id, name, icon, color, frequency, days_of_week').eq('is_archived', false),
      db.from('habit_logs').select('habit_id').eq('log_date', today),
      db.from('transactions').select('type, amount').gte('transaction_date', monthStart).lte('transaction_date', today).limit(10000),
      db.from('goals').select('id, title, progress, progress_mode, target_date, category').eq('status', 'active').order('target_date', { nullsFirst: false }).limit(5),
      db.from('notes').select('id, title, updated_at, is_pinned').eq('is_archived', false).order('updated_at', { ascending: false }).limit(5),
      db.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null),
    ]);

  for (const r of [dueToday, overdue, completedToday, pending, events, habits, logsToday, monthTx, goals, notes, unread]) {
    if (r.error) throw fromDbError(r.error);
  }

  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  const habitsToday = (habits.data ?? []).filter(
    (h) => h.frequency !== 'custom' || (h.days_of_week as number[]).includes(dow),
  );
  const doneIds = new Set((logsToday.data ?? []).map((l) => l.habit_id));
  let income = 0;
  let expense = 0;
  for (const t of monthTx.data ?? []) {
    if (t.type === 'income') income += Number(t.amount);
    else expense += Number(t.amount);
  }

  return {
    today,
    tasks: {
      dueToday: dueToday.data,
      overdueCount: overdue.count ?? 0,
      completedTodayCount: completedToday.count ?? 0,
      pendingCount: pending.count ?? 0,
    },
    upcomingEvents: events.data,
    habits: { scheduledToday: habitsToday.length, completedToday: habitsToday.filter((h) => doneIds.has(h.id)).length },
    finance: { month: today.slice(0, 7), income: Math.round(income * 100) / 100, expense: Math.round(expense * 100) / 100 },
    activeGoals: goals.data,
    recentNotes: notes.data,
    unreadNotifications: unread.count ?? 0,
  };
}
