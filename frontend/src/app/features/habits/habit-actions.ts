import type { DataService } from '../../core/data/data.service';
import type { Habit, HabitLog } from '../../core/models';

/** Set of completed day keys for a habit. */
export function completedDays(logs: HabitLog[], habitId: string): Set<string> {
  return new Set(logs.filter((l) => l.habit_id === habitId).map((l) => l.log_date));
}

/** Toggles completion of a habit on a given day (works offline). */
export async function toggleHabitDay(data: DataService, habit: Habit, day: string): Promise<boolean> {
  const existing = data.list('habit_logs')().find((l) => l.habit_id === habit.id && l.log_date === day);
  if (existing) {
    await data.remove('habit_logs', existing.id);
    return false;
  }
  await data.create('habit_logs', { habit_id: habit.id, log_date: day });
  return true;
}
