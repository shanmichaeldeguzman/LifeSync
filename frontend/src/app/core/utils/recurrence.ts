import type { CalendarEvent, Recurrence } from '../models';
import { addMonths, parseDateKey } from './date';

function step(date: Date, recurrence: Recurrence, interval: number, n: number): Date {
  const d = new Date(date);
  switch (recurrence) {
    case 'daily':
      d.setDate(d.getDate() + interval * n);
      return d;
    case 'weekly':
      d.setDate(d.getDate() + 7 * interval * n);
      return d;
    case 'monthly':
      return addMonths(d, interval * n);
    case 'yearly':
      return addMonths(d, 12 * interval * n);
    default:
      return d;
  }
}

export interface Occurrence {
  event: CalendarEvent;
  start: Date;
  end: Date;
}

/**
 * Expands a (possibly recurring) event into the concrete occurrences that overlap
 * [rangeStart, rangeEnd). Mirrors `event_next_occurrence` in the database.
 */
export function expandEvent(event: CalendarEvent, rangeStart: Date, rangeEnd: Date): Occurrence[] {
  const start = new Date(event.start_at);
  const duration = Math.max(0, new Date(event.end_at).getTime() - start.getTime());
  const until = event.recurrence_until ? parseDateKey(event.recurrence_until) : null;
  if (until) until.setHours(23, 59, 59, 999);

  if (event.recurrence === 'none') {
    const end = new Date(start.getTime() + duration);
    return end >= rangeStart && start < rangeEnd ? [{ event, start, end }] : [];
  }

  const interval = Math.max(1, event.recurrence_interval || 1);
  // Jump close to the range start instead of iterating from the first occurrence.
  let n = 0;
  const gap = rangeStart.getTime() - duration - start.getTime();
  if (gap > 0) {
    const approx = { daily: 1, weekly: 7, monthly: 28, yearly: 365 }[event.recurrence] * interval * 86_400_000;
    n = Math.max(0, Math.floor(gap / approx) - 2);
  }
  const out: Occurrence[] = [];
  for (let guard = 0; guard < 1000; guard++, n++) {
    const s = step(start, event.recurrence, interval, n);
    if (s >= rangeEnd || (until && s > until)) break;
    const e = new Date(s.getTime() + duration);
    if (e >= rangeStart) out.push({ event, start: s, end: e });
  }
  return out;
}

export const RECURRENCE_LABELS: Record<Recurrence, string> = {
  none: 'Does not repeat',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

export function describeRecurrence(r: Recurrence, interval = 1): string {
  if (r === 'none') return RECURRENCE_LABELS.none;
  if (interval <= 1) return RECURRENCE_LABELS[r];
  const unit = { daily: 'days', weekly: 'weeks', monthly: 'months', yearly: 'years' }[r];
  return `Every ${interval} ${unit}`;
}
