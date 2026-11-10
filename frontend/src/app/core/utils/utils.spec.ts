import type { CalendarEvent, Habit } from '../models';
import { toPayload } from '../data/sync.service';
import { transactionsCsv } from '../../features/finance/finance.store';
import { addDays, dateKey, fromLocalInput, parseDateKey, toLocalInput } from './date';
import { bestStreak, completionRate, currentStreak, isScheduled } from './habits';
import { markdownExcerpt, renderMarkdown } from './markdown';
import { expandEvent } from './recurrence';
import { safeFileName } from './format';

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h1', name: 'Read', description: '', icon: 'book-outline', color: '#22C55E', frequency: 'daily',
  days_of_week: [], target_per_week: 7, reminder_time: null, start_date: '2026-01-01', is_archived: false,
  created_at: '', updated_at: '', ...over,
});

const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'e1', title: 'Standup', description: '', location: '', category_id: null,
  start_at: new Date(2026, 0, 5, 9, 0).toISOString(), end_at: new Date(2026, 0, 5, 9, 30).toISOString(),
  all_day: false, color: null, reminder_minutes: 10, recurrence: 'none', recurrence_interval: 1, recurrence_until: null,
  created_at: '', updated_at: '', ...over,
});

const keys = (start: string, n: number) => Array.from({ length: n }, (_, i) => dateKey(addDays(parseDateKey(start), i)));

describe('date utils', () => {
  it('round-trips local date keys', () => {
    expect(dateKey(parseDateKey('2026-03-09'))).toBe('2026-03-09');
  });
  it('round-trips datetime-local values', () => {
    const iso = new Date(2026, 4, 2, 14, 30).toISOString();
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
    expect(fromLocalInput('')).toBeNull();
  });
});

describe('habit streaks', () => {
  it('counts consecutive days and ignores an unfinished today', () => {
    const done = new Set(keys('2026-02-01', 5)); // Feb 1–5
    expect(currentStreak(habit(), done, '2026-02-06')).toBe(5);
    expect(currentStreak(habit(), done, '2026-02-05')).toBe(5);
    expect(currentStreak(habit(), done, '2026-02-07')).toBe(0);
  });

  it('only counts scheduled days for custom schedules', () => {
    // Mon/Wed/Fri habit; Feb 2 2026 is a Monday.
    const h = habit({ frequency: 'custom', days_of_week: [1, 3, 5] });
    expect(isScheduled(h, '2026-02-03')).toBe(false);
    const done = new Set(['2026-02-02', '2026-02-04', '2026-02-06']);
    expect(currentStreak(h, done, '2026-02-08')).toBe(3);
  });

  it('tracks weekly targets in weeks', () => {
    const h = habit({ frequency: 'weekly', target_per_week: 3 });
    // Two full weeks (Mon-based) with 3 check-ins each.
    const done = new Set(['2026-02-02', '2026-02-04', '2026-02-06', '2026-02-09', '2026-02-10', '2026-02-11']);
    expect(currentStreak(h, done, '2026-02-12')).toBe(2);
    expect(bestStreak(h, done, '2026-02-12')).toBe(2);
  });

  it('computes best streak and completion rate', () => {
    const done = new Set([...keys('2026-01-01', 4), ...keys('2026-01-10', 7)]);
    expect(bestStreak(habit(), done, '2026-01-20')).toBe(7);
    expect(completionRate(habit(), done, '2026-01-01', '2026-01-10')).toBe(50);
  });

  it('never schedules a habit before its start date', () => {
    expect(isScheduled(habit({ start_date: '2026-05-01' }), '2026-04-30')).toBe(false);
  });
});

describe('recurring events', () => {
  it('returns a single occurrence for non-recurring events in range', () => {
    const occ = expandEvent(event(), new Date(2026, 0, 1), new Date(2026, 0, 31));
    expect(occ).toHaveLength(1);
  });

  it('expands weekly events and respects the until date', () => {
    const e = event({ recurrence: 'weekly', recurrence_until: '2026-01-26' });
    const occ = expandEvent(e, new Date(2026, 0, 1), new Date(2026, 2, 1));
    expect(occ.map((o) => dateKey(o.start))).toEqual(['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26']);
  });

  it('jumps efficiently to far-future ranges', () => {
    const e = event({ recurrence: 'daily' });
    const occ = expandEvent(e, new Date(2030, 5, 1), new Date(2030, 5, 4));
    expect(occ.map((o) => dateKey(o.start))).toEqual(['2030-06-01', '2030-06-02', '2030-06-03']);
  });

  it('handles month-end for monthly events', () => {
    const e = event({ recurrence: 'monthly', start_at: new Date(2026, 0, 31, 9).toISOString(), end_at: new Date(2026, 0, 31, 10).toISOString() });
    const occ = expandEvent(e, new Date(2026, 1, 1), new Date(2026, 2, 1));
    expect(dateKey(occ[0].start)).toBe('2026-02-28');
  });
});

describe('sync payloads', () => {
  it('strips local bookkeeping and server-managed fields and normalises money', () => {
    const p = toPayload({ id: 'x', title: 't', amount: '12.50', user_id: 'u', created_at: 'c', updated_at: 'u', _status: 'pending', _base: null, _rev: 3 });
    expect(p).toEqual({ id: 'x', title: 't', amount: 12.5 });
  });
});

describe('markdown', () => {
  it('renders formatting and strips scripts and unsafe links', () => {
    const html = renderMarkdown('**bold** <script>alert(1)</script> [x](javascript:alert(1)) <img src=x onerror=alert(1)>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('onerror');
  });
  it('renders task lists', () => {
    expect(renderMarkdown('- [ ] todo\n- [x] done')).toContain('☑');
  });
  it('creates plain excerpts', () => {
    expect(markdownExcerpt('# Title\n\n- **one** [link](http://a.b)', 50)).toBe('Title one link');
  });
});

describe('exports', () => {
  it('builds CSV that neutralises formulas and labels manual entries', () => {
    const csv = transactionsCsv(
      [{ id: '1', type: 'expense', amount: 5, category_id: null, description: '=cmd()', transaction_date: '2026-01-02', payment_method: 'cash', entry_source: 'manual', created_at: '', updated_at: '' }],
      () => 'Food',
    );
    expect(csv).toContain("'=cmd()");
    expect(csv).toContain('Manual entry');
    expect(csv.startsWith('﻿Date,Type,Amount')).toBe(true);
  });
  it('sanitises uploaded file names', () => {
    const name = safeFileName('../../etc/pass wd?.pdf');
    expect(name).not.toContain('/');
    expect(name).toBe('....etcpass-wd.pdf');
  });
});
