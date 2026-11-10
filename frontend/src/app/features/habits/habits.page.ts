import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonButtons, IonContent, IonFab, IonFabButton, IonHeader, IonIcon, IonTitle, IonToolbar, ModalController } from '@ionic/angular';
import { DataService } from '../../core/data/data.service';
import type { Habit } from '../../core/models';
import { addDays, dateKey, parseDateKey, startOfWeek } from '../../core/utils/date';
import { currentStreak, describeSchedule, isScheduled } from '../../core/utils/habits';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { HeaderActionsComponent } from '../../shared/components/header-actions.component';
import { ProgressRingComponent } from '../../shared/components/progress-ring.component';
import { SkeletonComponent } from '../../shared/components/skeleton.component';
import { SyncBadgeComponent } from '../../shared/components/sync-badge.component';
import { completedDays, toggleHabitDay } from './habit-actions';
import { HabitFormModal } from './habit-form.modal';

@Component({
  selector: 'app-habits',
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonContent, IonIcon, IonFab, IonFabButton, HeaderActionsComponent, EmptyStateComponent, ProgressRingComponent, SkeletonComponent, SyncBadgeComponent],
  template: `
    <ion-header class="ion-hide-lg-up">
      <ion-toolbar>
        <ion-title>Habits</ion-title>
        <ion-buttons slot="end"><app-header-actions></app-header-actions></ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <div class="ls-page">
        <div class="ls-page-header">
          <div><h1 class="page-title">Habits</h1><p>Small, consistent steps. Missing a day is fine. Just pick it back up.</p></div>
          <div class="actions ion-hide-lg-down"><app-header-actions></app-header-actions></div>
        </div>

        <div class="top ls-grid cols-2">
          <div class="ls-card summary">
            <app-progress-ring [value]="summary().pct" [size]="84" [stroke]="9" color="var(--ion-color-success)"></app-progress-ring>
            <div>
              <div class="ls-muted ls-small" style="font-weight:600">{{ selectedLabel() }}</div>
              <div class="big">{{ summary().done }} / {{ summary().total }}</div>
              <div class="ls-muted ls-small">{{ encouragement() }}</div>
            </div>
          </div>
          <div class="ls-card">
            <div class="week-strip" role="tablist" aria-label="Choose a day">
              @for (d of week(); track d.key) {
                <button role="tab" [attr.aria-selected]="d.key === selected()" class="day" [class.active]="d.key === selected()" [class.future]="d.future" [disabled]="d.future" (click)="selected.set(d.key)">
                  <span class="dow">{{ d.label }}</span>
                  <span class="num">{{ d.num }}</span>
                  <span class="bar"><span [style.width.%]="d.pct"></span></span>
                </button>
              }
            </div>
          </div>
        </div>

        @if (!data.ready()) {
          <app-skeleton [rows]="4"></app-skeleton>
        } @else if (active().length === 0) {
          <div class="ls-card">
            <app-empty-state icon="leaf-outline" title="Build your first habit" message="Start with something small and easy, like a glass of water or a 5-minute walk." actionText="New habit" (action)="openForm()"></app-empty-state>
          </div>
        } @else {
          <div class="ls-group-label">{{ selectedLabel() }}</div>
          <div class="ls-card flush">
            @for (h of scheduled(); track h.habit.id) {
              <div class="ls-row clickable" (click)="openDetail(h.habit)" (keydown.enter)="openDetail(h.habit)" tabindex="0">
                <span class="ls-icon-tile" [style.background]="h.habit.color + '1f'" [style.color]="h.habit.color"><ion-icon [name]="h.habit.icon"></ion-icon></span>
                <div class="grow">
                  <div class="title">{{ h.habit.name }}</div>
                  <div class="meta">
                    <span>{{ schedule(h.habit) }}</span>
                    @if (h.streak > 0) { <span class="streak"><ion-icon name="flame"></ion-icon> {{ h.streak }} {{ h.habit.frequency === 'weekly' ? 'wk' : 'day' }} streak</span> }
                    @if (h.habit.frequency === 'weekly') { <span>{{ h.weekCount }}/{{ h.habit.target_per_week }} this week</span> }
                  </div>
                </div>
                <app-sync-badge [status]="h.habit._status"></app-sync-badge>
                <button class="check" [class.done]="h.done" [style.--c]="h.habit.color" (click)="toggle(h.habit, $event)" [attr.aria-label]="(h.done ? 'Undo ' : 'Complete ') + h.habit.name" [attr.aria-pressed]="h.done">
                  <ion-icon [name]="h.done ? 'checkmark' : 'add'"></ion-icon>
                </button>
              </div>
            } @empty {
              <div class="ls-row"><span class="ls-muted ls-small">No habits scheduled for this day. Rest is part of the process.</span></div>
            }
          </div>

          @if (notScheduled().length) {
            <div class="ls-group-label">Not scheduled this day</div>
            <div class="ls-card flush">
              @for (h of notScheduled(); track h.id) {
                <div class="ls-row clickable" (click)="openDetail(h)" (keydown.enter)="openDetail(h)" tabindex="0">
                  <span class="ls-icon-tile sm" [style.background]="h.color + '1f'" [style.color]="h.color"><ion-icon [name]="h.icon"></ion-icon></span>
                  <div class="grow"><div class="title">{{ h.name }}</div><div class="meta">{{ schedule(h) }}</div></div>
                </div>
              }
            </div>
          }

          @if (archived().length) {
            <button class="archived-toggle" (click)="showArchived.set(!showArchived())">
              <ion-icon [name]="showArchived() ? 'chevron-down' : 'chevron-forward'"></ion-icon> Archived ({{ archived().length }})
            </button>
            @if (showArchived()) {
              <div class="ls-card flush">
                @for (h of archived(); track h.id) {
                  <div class="ls-row clickable" (click)="openForm(h)" (keydown.enter)="openForm(h)" tabindex="0">
                    <span class="ls-icon-tile sm" style="opacity:0.6"><ion-icon [name]="h.icon"></ion-icon></span>
                    <div class="grow"><div class="title">{{ h.name }}</div></div>
                  </div>
                }
              </div>
            }
          }
        }
      </div>
      <ion-fab slot="fixed" vertical="bottom" horizontal="end" class="ls-fab">
        <ion-fab-button (click)="openForm()" aria-label="New habit"><ion-icon name="add"></ion-icon></ion-fab-button>
      </ion-fab>
    </ion-content>
  `,
  styles: `
    .top { margin-bottom: 8px; }
    .summary { display: flex; align-items: center; gap: 18px; }
    .big { font-size: 1.8rem; font-weight: 800; letter-spacing: -0.03em; }
    .week-strip { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; height: 100%; align-items: center; }
    .day { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 0; border-radius: 12px; border: 1px solid transparent; background: transparent; cursor: pointer; font: inherit; color: var(--ls-text); }
    .day.active { background: var(--ls-primary-soft); border-color: var(--ion-color-primary); }
    .day.future { opacity: 0.4; cursor: default; }
    .dow { font-size: 0.68rem; font-weight: 700; color: var(--ls-text-2); text-transform: uppercase; }
    .num { font-weight: 750; }
    .bar { width: 70%; height: 4px; border-radius: 4px; background: var(--ls-surface-2); overflow: hidden; }
    .bar span { display: block; height: 100%; background: var(--ion-color-success); }
    .streak { color: #ea580c; font-weight: 600; }
    .streak ion-icon { vertical-align: -2px; }
    .check { width: 44px; height: 44px; border-radius: 14px; border: 2px solid color-mix(in srgb, var(--c) 45%, transparent); background: transparent; color: var(--c); font-size: 22px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.18s ease; flex-shrink: 0; }
    .check.done { background: var(--c); color: #fff; border-color: var(--c); animation: ls-pop 0.25s ease; }
    .archived-toggle { background: none; border: 0; color: var(--ls-text-2); font: inherit; font-weight: 600; font-size: 0.85rem; margin: 20px 4px 8px; cursor: pointer; display: flex; align-items: center; gap: 6px; }
  `,
})
export class HabitsPage {
  readonly data = inject(DataService);
  private readonly modal = inject(ModalController);
  private readonly router = inject(Router);

  readonly selected = signal(dateKey());
  readonly showArchived = signal(false);

  readonly active = computed(() => this.data.list('habits')().filter((h) => !h.is_archived).sort((a, b) => a.created_at.localeCompare(b.created_at)));
  readonly archived = computed(() => this.data.list('habits')().filter((h) => h.is_archived));
  private readonly logs = this.data.list('habit_logs');

  readonly scheduled = computed(() => {
    const day = this.selected();
    const weekStart = dateKey(startOfWeek(parseDateKey(day), 1));
    return this.active()
      .filter((h) => isScheduled(h, day))
      .map((h) => {
        const done = completedDays(this.logs(), h.id);
        let weekCount = 0;
        for (let i = 0; i < 7; i++) if (done.has(dateKey(addDays(parseDateKey(weekStart), i)))) weekCount++;
        return { habit: h, done: done.has(day), streak: currentStreak(h, done), weekCount };
      });
  });
  readonly notScheduled = computed(() => this.active().filter((h) => !isScheduled(h, this.selected())));

  readonly summary = computed(() => {
    const total = this.scheduled().length;
    const done = this.scheduled().filter((s) => s.done).length;
    return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
  });

  readonly week = computed(() => {
    const today = dateKey();
    const start = addDays(parseDateKey(today), -6);
    const logs = this.logs();
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(start, i);
      const key = dateKey(d);
      const sched = this.active().filter((h) => isScheduled(h, key));
      const done = sched.filter((h) => logs.some((l) => l.habit_id === h.id && l.log_date === key)).length;
      return { key, label: d.toLocaleDateString(undefined, { weekday: 'short' }), num: d.getDate(), future: key > today, pct: sched.length ? (done / sched.length) * 100 : 0 };
    });
  });

  readonly selectedLabel = computed(() => (this.selected() === dateKey() ? 'Today' : parseDateKey(this.selected()).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })));
  readonly encouragement = computed(() => {
    const { done, total } = this.summary();
    if (!total) return 'Nothing scheduled, enjoy your day.';
    if (done === total) return 'All done. Nice work!';
    if (done === 0) return 'Every streak starts with one check.';
    return `${total - done} to go. Keep it light.`;
  });

  schedule(h: Habit) {
    return describeSchedule(h);
  }

  async toggle(h: Habit, ev: Event) {
    ev.stopPropagation();
    await toggleHabitDay(this.data, h, this.selected());
  }

  openDetail(h: Habit) {
    void this.router.navigate(['/habits', h.id]);
  }

  async openForm(habit?: Habit) {
    const m = await this.modal.create({ component: HabitFormModal, componentProps: { habit }, cssClass: 'ls-modal' });
    await m.present();
  }
}
