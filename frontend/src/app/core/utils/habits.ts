import type { Habit } from '../models';
import { addDays, dateKey, parseDateKey, startOfWeek } from './date';

/** Whether a habit is expected on the given day. Weekly-target habits can be done any day. */
export function isScheduled(habit: Habit, key: string): boolean {
  if (key < habit.start_date) return false;
  if (habit.frequency === 'custom') return habit.days_of_week.includes(parseDateKey(key).getDay());
  return true;
}

/** Monday-based week key, used for weekly-target habits. */
function weekKey(key: string): string {
  return dateKey(startOfWeek(parseDateKey(key), 1));
}

/**
 * Current streak: consecutive scheduled days (or weeks, for weekly targets) completed,
 * counted back from today. An unfinished *today* never breaks the streak.
 */
export function currentStreak(habit: Habit, done: Set<string>, today = dateKey()): number {
  if (habit.frequency === 'weekly') {
    let streak = 0;
    let cursor = startOfWeek(parseDateKey(today), 1);
    const thisWeek = countInWeek(done, dateKey(cursor));
    if (thisWeek >= habit.target_per_week) streak++;
    cursor = addDays(cursor, -7);
    for (let i = 0; i < 520; i++) {
      if (dateKey(addDays(cursor, 6)) < habit.start_date) break;
      if (countInWeek(done, dateKey(cursor)) >= habit.target_per_week) streak++;
      else break;
      cursor = addDays(cursor, -7);
    }
    return streak;
  }

  let streak = 0;
  let cursor = parseDateKey(today);
  if (!done.has(today)) cursor = addDays(cursor, -1);
  for (let i = 0; i < 3650; i++) {
    const key = dateKey(cursor);
    if (key < habit.start_date) break;
    if (isScheduled(habit, key)) {
      if (done.has(key)) streak++;
      else break;
    }
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** Longest run of consecutive completed scheduled days ever recorded. */
export function bestStreak(habit: Habit, done: Set<string>, today = dateKey()): number {
  if (done.size === 0) return 0;
  if (habit.frequency === 'weekly') {
    const weeks = new Map<string, number>();
    for (const k of done) weeks.set(weekKey(k), (weeks.get(weekKey(k)) ?? 0) + 1);
    const sorted = [...weeks.keys()].sort();
    let best = 0;
    let run = 0;
    let prev: string | null = null;
    for (const w of sorted) {
      const ok = (weeks.get(w) ?? 0) >= habit.target_per_week;
      const consecutive = prev && dateKey(addDays(parseDateKey(prev), 7)) === w;
      run = ok ? (consecutive ? run + 1 : 1) : 0;
      best = Math.max(best, run);
      prev = w;
    }
    return best;
  }
  const first = [...done].sort()[0];
  let best = 0;
  let run = 0;
  for (let d = parseDateKey(first); dateKey(d) <= today; d = addDays(d, 1)) {
    const key = dateKey(d);
    if (!isScheduled(habit, key)) continue;
    run = done.has(key) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

function countInWeek(done: Set<string>, weekStart: string): number {
  let n = 0;
  const start = parseDateKey(weekStart);
  for (let i = 0; i < 7; i++) if (done.has(dateKey(addDays(start, i)))) n++;
  return n;
}

/** Completion rate (0–100) over [from, to] inclusive, relative to what was scheduled. */
export function completionRate(habit: Habit, done: Set<string>, from: string, to: string): number {
  if (habit.frequency === 'weekly') {
    let expected = 0;
    let got = 0;
    for (let w = startOfWeek(parseDateKey(from), 1); dateKey(w) <= to; w = addDays(w, 7)) {
      expected += habit.target_per_week;
      got += Math.min(habit.target_per_week, countInWeek(done, dateKey(w)));
    }
    return expected ? Math.round((got / expected) * 100) : 0;
  }
  let expected = 0;
  let got = 0;
  for (let d = parseDateKey(from); dateKey(d) <= to; d = addDays(d, 1)) {
    const key = dateKey(d);
    if (!isScheduled(habit, key)) continue;
    expected++;
    if (done.has(key)) got++;
  }
  return expected ? Math.round((got / expected) * 100) : 0;
}

export function describeSchedule(h: Habit): string {
  if (h.frequency === 'daily') return 'Every day';
  if (h.frequency === 'weekly') return `${h.target_per_week}× per week`;
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const days = [...h.days_of_week].sort();
  if (days.join() === '1,2,3,4,5') return 'Weekdays';
  if (days.join() === '0,6') return 'Weekends';
  return days.map((d) => names[d]).join(', ');
}
