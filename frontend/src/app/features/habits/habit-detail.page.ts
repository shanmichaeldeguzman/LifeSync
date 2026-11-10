import { Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonBackButton, IonButtons, IonContent, IonHeader, IonIcon, IonTitle, IonToolbar, ModalController } from '@ionic/angular';
import type { ChartData } from 'chart.js';
import { DataService } from '../../core/data/data.service';
import { addDays, addMonths, dateKey, parseDateKey, startOfMonth, startOfWeek, WEEKDAYS_MIN } from '../../core/utils/date';
import { bestStreak, completionRate, currentStreak, describeSchedule, isScheduled } from '../../core/utils/habits';
import { ChartComponent } from '../../shared/components/chart.component';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { completedDays, toggleHabitDay } from './habit-actions';
import { HabitFormModal } from './habit-form.modal';

@Component({
  selector: 'app-habit-detail',
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent, IonIcon, ChartComponent, EmptyStateComponent],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/habits" text=""></ion-back-button></ion-buttons>
        <ion-title>{{ habit()?.name ?? 'Habit' }}</ion-title>
        <ion-buttons slot="end">
          @if (habit()) { <button class="ls-icon-btn ghost" (click)="edit()" aria-label="Edit habit"><ion-icon name="create-outline"></ion-icon></button> }
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <div class="ls-page narrow">
        @if (habit(); as h) {
          <div class="hero ls-card" [style.--c]="h.color">
            <span class="ls-icon-tile" [style.background]="h.color + '22'" [style.color]="h.color" style="width:56px;height:56px;font-size:28px;border-radius:16px"><ion-icon [name]="h.icon"></ion-icon></span>
            <div style="flex:1;min-width:0">
              <h2>{{ h.name }}</h2>
              <div class="ls-muted ls-small">{{ schedule() }}@if (h.reminder_time) { · Reminder at {{ h.reminder_time.slice(0, 5) }} }</div>
              @if (h.description) { <p class="why">{{ h.description }}</p> }
            </div>
          </div>

          <div class="ls-stats" style="margin:16px 0">
            <div class="ls-stat"><div class="label">Current streak</div><div class="value">{{ stats().current }}</div><div class="sub">{{ unit() }}</div></div>
            <div class="ls-stat"><div class="label">Best streak</div><div class="value">{{ stats().best }}</div><div class="sub">{{ unit() }}</div></div>
            <div class="ls-stat"><div class="label">This week</div><div class="value">{{ stats().week }}%</div></div>
            <div class="ls-stat"><div class="label">This month</div><div class="value">{{ stats().month }}%</div><div class="sub">{{ stats().total }} check-ins total</div></div>
          </div>

          <div class="ls-card">
            <div class="ls-card-header">
              <h3>{{ monthLabel() }}</h3>
              <div style="display:flex;gap:6px">
                <button class="ls-icon-btn" (click)="shiftMonth(-1)" aria-label="Previous month"><ion-icon name="chevron-back"></ion-icon></button>
                <button class="ls-icon-btn" (click)="shiftMonth(1)" [disabled]="isCurrentMonth()" aria-label="Next month"><ion-icon name="chevron-forward"></ion-icon></button>
              </div>
            </div>
            <div class="cal">
              @for (w of weekdays; track $index) { <span class="wd">{{ w }}</span> }
              @for (c of cells(); track c.key) {
                <button class="c" [class.out]="!c.inMonth" [class.done]="c.done" [class.sched]="c.scheduled" [class.today]="c.today" [disabled]="c.future || !c.inMonth" [style.--c]="h.color" (click)="toggle(c.key)" [attr.aria-label]="c.key + (c.done ? ', completed' : '')" [attr.aria-pressed]="c.done">{{ c.day }}</button>
              }
            </div>
            <p class="ls-hint">Tap a past day to add or remove a check-in.</p>
          </div>

          <div class="ls-card" style="margin-top:16px">
            <div class="ls-card-header"><h3>Last 8 weeks</h3><span class="ls-muted ls-small">completion rate</span></div>
            <app-chart type="bar" [data]="chart()" [height]="200" label="Weekly completion rate chart" [options]="{ plugins: { legend: { display: false } }, scales: { y: { max: 100, ticks: { callback: pctTick } } } }"></app-chart>
          </div>
        } @else {
          <app-empty-state icon="leaf-outline" title="Habit not found" message="It may have been deleted on another device."></app-empty-state>
        }
      </div>
    </ion-content>
  `,
  styles: `
    .hero { display: flex; gap: 16px; align-items: flex-start; }
    .hero h2 { font-size: 1.3rem; font-weight: 800; }
    .why { margin: 8px 0 0; color: var(--ls-text-2); font-size: 0.9rem; font-style: italic; }
    .cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
    .wd { text-align: center; font-size: 0.7rem; font-weight: 700; color: var(--ls-text-3); padding-bottom: 4px; }
    .c { aspect-ratio: 1; border-radius: 10px; border: 0; background: transparent; color: var(--ls-text-3); font: inherit; font-size: 0.85rem; font-weight: 600; cursor: pointer; max-height: 52px; }
    .c.sched { background: var(--ls-surface-2); color: var(--ls-text); }
    .c.done { background: var(--c); color: #fff; }
    .c.today { box-shadow: 0 0 0 2px var(--ion-color-primary) inset; }
    .c.out { visibility: hidden; }
    .c:disabled { cursor: default; }
  `,
})
export class HabitDetailPage {
  private readonly data = inject(DataService);
  private readonly modal = inject(ModalController);
  private readonly router = inject(Router);
  readonly id = input.required<string>();
  readonly weekdays = WEEKDAYS_MIN;
  readonly month = signal(startOfMonth(new Date()));

  readonly habit = computed(() => this.data.find('habits', this.id()));
  readonly done = computed(() => completedDays(this.data.list('habit_logs')(), this.id()));
  readonly schedule = computed(() => (this.habit() ? describeSchedule(this.habit()!) : ''));
  readonly unit = computed(() => (this.habit()?.frequency === 'weekly' ? 'weeks' : 'days'));

  readonly stats = computed(() => {
    const h = this.habit();
    if (!h) return { current: 0, best: 0, week: 0, month: 0, total: 0 };
    const today = dateKey();
    const done = this.done();
    return {
      current: currentStreak(h, done, today),
      best: bestStreak(h, done, today),
      week: completionRate(h, done, dateKey(startOfWeek(new Date(), 1)), today),
      month: completionRate(h, done, dateKey(startOfMonth(new Date())), today),
      total: done.size,
    };
  });

  readonly monthLabel = computed(() => this.month().toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));
  readonly isCurrentMonth = computed(() => dateKey(this.month()).slice(0, 7) === dateKey().slice(0, 7));

  readonly cells = computed(() => {
    const h = this.habit();
    const m = this.month();
    const start = startOfWeek(m, 0);
    const today = dateKey();
    return Array.from({ length: 42 }, (_, i) => {
      const d = addDays(start, i);
      const key = dateKey(d);
      return { key, day: d.getDate(), inMonth: d.getMonth() === m.getMonth(), done: this.done().has(key), scheduled: !!h && isScheduled(h, key), today: key === today, future: key > today };
    }).filter((c, i, arr) => !(i >= 35 && arr.slice(35).every((x) => !x.inMonth)));
  });

  readonly chart = computed<ChartData>(() => {
    const h = this.habit();
    const labels: string[] = [];
    const values: number[] = [];
    const thisWeek = startOfWeek(new Date(), 1);
    for (let i = 7; i >= 0; i--) {
      const ws = addDays(thisWeek, -7 * i);
      const we = addDays(ws, 6);
      labels.push(ws.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
      const to = dateKey(we) > dateKey() ? dateKey() : dateKey(we);
      values.push(h ? completionRate(h, this.done(), dateKey(ws), to) : 0);
    }
    return { labels, datasets: [{ data: values, backgroundColor: h?.color ?? '#22C55E', borderRadius: 8, maxBarThickness: 28 }] };
  });

  pctTick = (v: string | number) => `${v}%`;

  shiftMonth(n: number) {
    this.month.set(startOfMonth(addMonths(this.month(), n)));
  }

  async toggle(key: string) {
    const h = this.habit();
    if (!h || key > dateKey()) return;
    await toggleHabitDay(this.data, h, key);
  }

  async edit() {
    const m = await this.modal.create({ component: HabitFormModal, componentProps: { habit: this.habit() }, cssClass: 'ls-modal' });
    await m.present();
    const { role } = await m.onDidDismiss();
    if (role === 'deleted') void this.router.navigateByUrl('/habits', { replaceUrl: true });
  }

  protected readonly parseDateKey = parseDateKey;
}
