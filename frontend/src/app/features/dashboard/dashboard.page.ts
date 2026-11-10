import { Component, computed, inject, signal, type OnDestroy } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IonButtons, IonContent, IonHeader, IonIcon, IonRefresher, IonRefresherContent, IonTitle, IonToolbar, ModalController } from '@ionic/angular';
import { DataService } from '../../core/data/data.service';
import { SyncService } from '../../core/data/sync.service';
import type { DashboardWidget, Habit, Task } from '../../core/models';
import { AuthService } from '../../core/services/auth.service';
import { ReminderService } from '../../core/services/reminder.service';
import { addDays, dateKey, formatTime, greeting, monthKey, relativeDateTime, relativeDay, startOfDay, timeAgo } from '../../core/utils/date';
import { currentStreak, isScheduled } from '../../core/utils/habits';
import { markdownExcerpt } from '../../core/utils/markdown';
import { expandEvent } from '../../core/utils/recurrence';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { HeaderActionsComponent } from '../../shared/components/header-actions.component';
import { ProgressRingComponent } from '../../shared/components/progress-ring.component';
import { SkeletonComponent } from '../../shared/components/skeleton.component';
import { EventFormModal } from '../calendar/event-form.modal';
import { DocumentFormModal } from '../documents/document-form.modal';
import { FinanceStore } from '../finance/finance.store';
import { TransactionFormModal } from '../finance/transaction-form.modal';
import { goalCategory, goalProgress } from '../goals/goal-utils';
import { completedDays, toggleHabitDay } from '../habits/habit-actions';
import { TaskFormModal } from '../tasks/task-form.modal';
import { TaskRowComponent } from '../tasks/task-row.component';

const DEFAULT_WIDGETS: DashboardWidget[] = ['tasks', 'events', 'habits', 'finance', 'goals', 'notes', 'reminders'];

@Component({
  selector: 'app-dashboard',
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonContent, IonIcon, IonRefresher, IonRefresherContent, RouterLink, EmptyStateComponent, HeaderActionsComponent, ProgressRingComponent, SkeletonComponent, TaskRowComponent],
  templateUrl: './dashboard.page.html',
  styleUrl: './dashboard.page.scss',
})
export class DashboardPage implements OnDestroy {
  readonly data = inject(DataService);
  readonly finance = inject(FinanceStore);
  private readonly auth = inject(AuthService);
  private readonly sync = inject(SyncService);
  private readonly reminders = inject(ReminderService);
  private readonly modal = inject(ModalController);
  private readonly router = inject(Router);

  readonly now = signal(new Date());
  private readonly clock = setInterval(() => this.now.set(new Date()), 30_000);

  ngOnDestroy() {
    clearInterval(this.clock);
  }

  readonly firstName = computed(() => {
    const name = this.data.profile()?.full_name?.trim() || (this.auth.user()?.user_metadata?.['full_name'] as string | undefined) || '';
    return name.split(/\s+/)[0] || 'there';
  });
  readonly greeting = computed(() => greeting(this.now()));
  readonly dateLabel = computed(() => this.now().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }));
  readonly timeLabel = computed(() => formatTime(this.now()));
  readonly loading = computed(() => !this.data.ready() || (!this.data.lastSyncedAt() && this.sync.state() === 'syncing'));
  readonly widgets = computed(() => this.data.preferences()?.dashboard_widgets ?? DEFAULT_WIDGETS);

  // -------- tasks
  readonly todayTasks = computed(() => {
    const end = addDays(startOfDay(this.now()), 1);
    return this.data
      .list('tasks')()
      .filter((t) => t.due_at && new Date(t.due_at) < end && (t.status !== 'completed' || dateKey(new Date(t.completed_at ?? 0)) === dateKey(this.now())))
      .sort((a, b) => Number(a.status === 'completed') - Number(b.status === 'completed') || a.due_at!.localeCompare(b.due_at!));
  });
  readonly taskStats = computed(() => {
    const list = this.todayTasks();
    const done = list.filter((t) => t.status === 'completed').length;
    const overdue = list.filter((t) => t.status !== 'completed' && new Date(t.due_at!) < this.now()).length;
    const open = this.data.list('tasks')().filter((t) => t.status !== 'completed').length;
    return { total: list.length, done, overdue, open };
  });

  // -------- events (next 7 days, recurring expanded)
  readonly upcoming = computed(() => {
    const now = this.now();
    const end = addDays(startOfDay(now), 7);
    const out: { key: string; title: string; when: string; day: string; color: string; date: string }[] = [];
    for (const e of this.data.list('events')()) {
      const color = e.color ?? this.data.find('event_categories', e.category_id)?.color ?? '#635BFF';
      for (const o of expandEvent(e, now, end)) {
        out.push({ key: `${e.id}:${o.start.getTime()}`, title: e.title, when: e.all_day ? 'All day' : `${formatTime(o.start)} – ${formatTime(o.end)}`, day: relativeDay(o.start), color, date: dateKey(o.start) });
      }
    }
    return out.sort((a, b) => a.key.split(':')[1].localeCompare(b.key.split(':')[1])).slice(0, 5);
  });

  // -------- habits
  readonly todayHabits = computed(() => {
    const key = dateKey(this.now());
    const logs = this.data.list('habit_logs')();
    return this.data
      .list('habits')()
      .filter((h) => !h.is_archived && isScheduled(h, key))
      .map((h) => {
        const done = completedDays(logs, h.id);
        return { habit: h, done: done.has(key), streak: currentStreak(h, done, key) };
      });
  });
  readonly habitPct = computed(() => {
    const list = this.todayHabits();
    return list.length ? Math.round((list.filter((h) => h.done).length / list.length) * 100) : 0;
  });

  // -------- finance
  readonly month = computed(() => monthKey(this.now()));
  readonly monthTotals = computed(() => this.finance.totals(this.month()));
  readonly topSpending = computed(() => this.finance.spendingByCategory(this.month()).slice(0, 3));
  readonly budgetAlerts = computed(() =>
    this.data
      .list('budgets')()
      .filter((b) => b.month === `${this.month()}-01`)
      .map((b) => ({ name: b.category_id ? (this.finance.category(b.category_id)?.name ?? 'Category') : 'Overall', pct: Math.round((this.finance.spent(this.month(), b.category_id) / Number(b.limit_amount)) * 100) }))
      .filter((b) => b.pct >= 80)
      .sort((a, b) => b.pct - a.pct),
  );

  // -------- goals
  readonly goals = computed(() => {
    const ms = this.data.list('goal_milestones')();
    return this.data
      .list('goals')()
      .filter((g) => g.status === 'active')
      .sort((a, b) => (a.target_date ?? '9999').localeCompare(b.target_date ?? '9999'))
      .slice(0, 3)
      .map((g) => ({ goal: g, progress: goalProgress(g, ms), cat: goalCategory(g) }));
  });

  // -------- notes
  readonly notes = computed(() =>
    this.data
      .list('notes')()
      .filter((n) => !n.is_archived)
      .sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned) || b.updated_at.localeCompare(a.updated_at))
      .slice(0, 4),
  );

  // -------- reminders
  readonly upcomingReminders = computed(() => {
    // Recompute when data changes or the clock ticks.
    this.now();
    this.data.list('tasks')();
    this.data.list('events')();
    this.data.list('habits')();
    return this.reminders.plan().filter((r) => r.at.getTime() > Date.now()).slice(0, 4);
  });
  readonly unread = computed(() => this.data.list('notifications')().filter((n) => !n.read_at).length);

  readonly summary = computed(() => {
    const open = this.taskStats().total - this.taskStats().done;
    const events = this.upcoming().length;
    if (open <= 0) return events ? `Your tasks are done. ${events} event${events === 1 ? '' : 's'} coming up this week.` : 'Your day is clear. A great time to plan ahead.';
    const tasks = `${open} task${open === 1 ? '' : 's'} for today`;
    return events ? `You have ${tasks} and ${events} upcoming event${events === 1 ? '' : 's'}.` : `You have ${tasks}.`;
  });

  reminderTime(d: Date) {
    return relativeDateTime(d.toISOString());
  }
  excerpt(s: string) {
    return markdownExcerpt(s, 90);
  }
  ago(iso: string) {
    return timeAgo(iso);
  }

  async toggleHabit(h: Habit, ev: Event) {
    ev.stopPropagation();
    await toggleHabitDay(this.data, h, dateKey(this.now()));
  }

  async newTask() {
    const due = new Date();
    due.setHours(17, 0, 0, 0);
    const m = await this.modal.create({ component: TaskFormModal, componentProps: { defaults: { due_at: due.toISOString() } }, cssClass: 'ls-modal' });
    await m.present();
  }
  async editTask(t: Task) {
    const m = await this.modal.create({ component: TaskFormModal, componentProps: { task: t }, cssClass: 'ls-modal' });
    await m.present();
  }
  async newEvent() {
    const m = await this.modal.create({ component: EventFormModal, cssClass: 'ls-modal' });
    await m.present();
  }
  async newExpense() {
    const m = await this.modal.create({ component: TransactionFormModal, componentProps: { initialType: 'expense' }, cssClass: 'ls-modal' });
    await m.present();
  }
  async newDocument() {
    const m = await this.modal.create({ component: DocumentFormModal, cssClass: 'ls-modal' });
    await m.present();
  }
  newNote() {
    void this.router.navigate(['/notes', 'new']);
  }

  async refresh(ev: Event) {
    await this.sync.sync({ housekeeping: true });
    (ev.target as HTMLIonRefresherElement).complete();
  }
}
