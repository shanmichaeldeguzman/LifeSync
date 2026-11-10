import type { Goal, GoalMilestone } from '../../core/models';
import { diffInDays, formatDate, parseDateKey } from '../../core/utils/date';
import { GOAL_CATEGORIES } from '../../core/utils/format';

/** Progress 0–100: manual value, or the share of completed milestones. */
export function goalProgress(goal: Goal, milestones: GoalMilestone[]): number {
  if (goal.status === 'completed') return 100;
  if (goal.progress_mode === 'manual') return goal.progress;
  const mine = milestones.filter((m) => m.goal_id === goal.id);
  if (!mine.length) return 0;
  return Math.round((mine.filter((m) => m.is_completed).length / mine.length) * 100);
}

export function goalCategory(goal: Goal) {
  return GOAL_CATEGORIES.find((c) => c.value === goal.category) ?? GOAL_CATEGORIES[GOAL_CATEGORIES.length - 1];
}

export function deadlineLabel(goal: Goal): { label: string; tone: string } | null {
  if (!goal.target_date) return null;
  if (goal.status === 'completed') return { label: `Target ${formatDate(goal.target_date)}`, tone: '' };
  const days = diffInDays(parseDateKey(goal.target_date), new Date());
  if (days < 0) return { label: `${-days}d past target`, tone: 'danger' };
  if (days === 0) return { label: 'Due today', tone: 'warning' };
  if (days <= 7) return { label: `${days}d left`, tone: 'warning' };
  return { label: formatDate(goal.target_date), tone: '' };
}
