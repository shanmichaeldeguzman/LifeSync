import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, signal, effect, untracked } from '@angular/core';
import { IonButtons, IonContent, IonFab, IonFabButton, IonHeader, IonIcon, IonTitle, IonToolbar, ModalController } from '@ionic/angular';
import { DataService } from '../../core/data/data.service';
import type { CalendarEvent, Task } from '../../core/models';
import { addDays, addMonths, dateKey, formatTime, isSameDay, parseDateKey, startOfDay, startOfMonth, startOfWeek, WEEKDAYS_SHORT } from '../../core/utils/date';
import { PRIORITY_META } from '../../core/utils/format';
import { expandEvent } from '../../core/utils/recurrence';
import { CategoryManagerModal } from '../../shared/components/category-manager.modal';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { HeaderActionsComponent } from '../../shared/components/header-actions.component';
import { TaskFormModal } from '../tasks/task-form.modal';
import { EventFormModal } from './event-form.modal';

type View = 'month' | 'week' | 'day';

/** A unified calendar entry: an event occurrence or a task due on that day. */
interface Entry {
  key: string;
  kind: 'event' | 'task';
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  color: string;
  done: boolean;
  location?: string;
  event?: CalendarEvent;
  task?: Task;
}

@Component({
  selector: 'app-calendar',
  imports: [NgTemplateOutlet, IonHeader, IonToolbar, IonTitle, IonButtons, IonContent, IonIcon, IonFab, IonFabButton, HeaderActionsComponent, EmptyStateComponent],
  templateUrl: './calendar.page.html',
  styleUrl: './calendar.page.scss',
})
export class CalendarPage {
  private readonly data = inject(DataService);
  private readonly modal = inject(ModalController);

  /** Optional ?date=YYYY-MM-DD deep link. */
  readonly dateParam = input<string | undefined>(undefined, { alias: 'date' });

  readonly view = signal<View>('month');
  readonly cursor = signal(startOfDay(new Date()));
  readonly selected = signal(startOfDay(new Date()));
  readonly showTasks = signal(true);
  readonly weekStartsOn = computed(() => this.data.preferences()?.week_starts_on ?? 0);
  readonly weekdayLabels = computed(() => Array.from({ length: 7 }, (_, i) => WEEKDAYS_SHORT[(i + this.weekStartsOn()) % 7]));
  readonly hours = Array.from({ length: 24 }, (_, i) => i);

  constructor() {
    effect(() => {
      const d = this.dateParam();
      if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
        untracked(() => {
          const day = parseDateKey(d);
          this.cursor.set(day);
          this.selected.set(day);
          this.view.set('day');
        });
      }
    });
  }

  /** Visible date range for the current view. */
  readonly range = computed(() => {
    const c = this.cursor();
    if (this.view() === 'day') return { start: startOfDay(c), end: addDays(startOfDay(c), 1) };
    if (this.view() === 'week') {
      const s = startOfWeek(c, this.weekStartsOn());
      return { start: s, end: addDays(s, 7) };
    }
    const s = startOfWeek(startOfMonth(c), this.weekStartsOn());
    return { start: s, end: addDays(s, 42) };
  });

  readonly title = computed(() => {
    const c = this.cursor();
    if (this.view() === 'day') return c.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    if (this.view() === 'week') {
      const { start, end } = this.range();
      const last = addDays(end, -1);
      return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${last.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }
    return c.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  });

  /** All entries in range, grouped by local day key. */
  readonly entriesByDay = computed(() => {
    const { start, end } = this.range();
    const map = new Map<string, Entry[]>();
    // Multi-day events appear on every day they span (an end at exactly midnight
    // does not spill into the next day).
    const push = (e: Entry) => {
      const first = startOfDay(e.start);
      let last = startOfDay(e.end);
      if (e.end.getTime() === last.getTime() && e.end > e.start) last = addDays(last, -1);
      if (last < first) last = first;
      for (let d = first, i = 0; d <= last && i < 62; d = addDays(d, 1), i++) {
        if (d < start) continue;
        if (d >= end) break;
        const k = dateKey(d);
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push(e);
      }
    };
    for (const ev of this.data.list('events')()) {
      const color = ev.color ?? this.data.find('event_categories', ev.category_id)?.color ?? '#635BFF';
      for (const occ of expandEvent(ev, start, end)) {
        push({ key: `e:${ev.id}:${occ.start.getTime()}`, kind: 'event', title: ev.title, start: occ.start, end: occ.end, allDay: ev.all_day, color, done: false, location: ev.location, event: ev });
      }
    }
    if (this.showTasks()) {
      for (const t of this.data.list('tasks')()) {
        if (!t.due_at) continue;
        const due = new Date(t.due_at);
        if (due < start || due >= end) continue;
        push({ key: `t:${t.id}`, kind: 'task', title: t.title, start: due, end: due, allDay: false, color: PRIORITY_META[t.priority].color, done: t.status === 'completed', task: t });
      }
    }
    for (const list of map.values()) list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime());
    return map;
  });

  readonly monthCells = computed(() => {
    const { start } = this.range();
    const month = this.cursor().getMonth();
    const today = startOfDay(new Date());
    return Array.from({ length: 42 }, (_, i) => {
      const d = addDays(start, i);
      const k = dateKey(d);
      return { date: d, key: k, inMonth: d.getMonth() === month, today: isSameDay(d, today), entries: this.entriesByDay().get(k) ?? [] };
    });
  });

  readonly weekDays = computed(() => {
    const { start } = this.range();
    const today = startOfDay(new Date());
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(start, i);
      return { date: d, key: dateKey(d), today: isSameDay(d, today), entries: this.entriesByDay().get(dateKey(d)) ?? [] };
    });
  });

  readonly selectedEntries = computed(() => this.entriesByDay().get(dateKey(this.selected())) ?? this.entriesFor(this.selected()));
  readonly dayEntries = computed(() => this.entriesByDay().get(dateKey(this.cursor())) ?? []);
  readonly dayAllDay = computed(() => this.dayEntries().filter((e) => e.allDay));
  readonly dayTimed = computed(() => this.dayEntries().filter((e) => !e.allDay));

  /** Entries for a date outside the visible range (e.g. selected in another month). */
  private entriesFor(day: Date): Entry[] {
    const end = addDays(day, 1);
    const out: Entry[] = [];
    for (const ev of this.data.list('events')()) {
      for (const occ of expandEvent(ev, day, end)) {
        out.push({ key: `e:${ev.id}:${occ.start.getTime()}`, kind: 'event', title: ev.title, start: occ.start, end: occ.end, allDay: ev.all_day, color: ev.color ?? '#635BFF', done: false, event: ev });
      }
    }
    return out;
  }

  entriesAtHour(hour: number): Entry[] {
    return this.dayTimed().filter((e) => (isSameDay(e.start, this.cursor()) ? e.start.getHours() === hour : hour === 0));
  }

  setView(v: View) {
    this.view.set(v);
    this.cursor.set(this.selected());
  }

  move(dir: -1 | 1) {
    const c = this.cursor();
    const next = this.view() === 'month' ? addMonths(startOfMonth(c), dir) : addDays(c, this.view() === 'week' ? 7 * dir : dir);
    this.cursor.set(next);
    if (this.view() !== 'month') this.selected.set(next);
  }

  goToday() {
    const t = startOfDay(new Date());
    this.cursor.set(t);
    this.selected.set(t);
  }

  selectDay(d: Date) {
    this.selected.set(d);
    if (d.getMonth() !== this.cursor().getMonth() && this.view() === 'month') this.cursor.set(d);
  }

  openDay(d: Date) {
    this.selected.set(d);
    this.cursor.set(d);
    this.view.set('day');
  }

  timeLabel(e: Entry): string {
    if (e.allDay) return 'All day';
    if (e.kind === 'task') return `Due ${formatTime(e.start)}`;
    return `${formatTime(e.start)} – ${formatTime(e.end)}`;
  }

  hourLabel(h: number): string {
    return new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' });
  }

  async openEntry(e: Entry) {
    if (e.kind === 'task') {
      const m = await this.modal.create({ component: TaskFormModal, componentProps: { task: e.task }, cssClass: 'ls-modal' });
      await m.present();
    } else {
      const m = await this.modal.create({ component: EventFormModal, componentProps: { event: e.event }, cssClass: 'ls-modal' });
      await m.present();
    }
  }

  async newEvent() {
    const m = await this.modal.create({ component: EventFormModal, componentProps: { date: dateKey(this.view() === 'day' ? this.cursor() : this.selected()) }, cssClass: 'ls-modal' });
    await m.present();
  }

  async manageCategories() {
    const m = await this.modal.create({ component: CategoryManagerModal, componentProps: { table: 'event_categories', title: 'Event categories' }, cssClass: 'ls-modal' });
    await m.present();
  }

  async toggleTask(e: Entry, ev: Event) {
    ev.stopPropagation();
    if (!e.task) return;
    await this.data.update('tasks', e.task.id, { status: e.done ? 'pending' : 'completed' });
  }

  protected readonly isSameDay = isSameDay;
}
