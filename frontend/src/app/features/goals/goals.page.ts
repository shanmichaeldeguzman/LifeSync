import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonButtons, IonContent, IonFab, IonFabButton, IonHeader, IonIcon, IonTitle, IonToolbar, ModalController } from '@ionic/angular';
import { DataService } from '../../core/data/data.service';
import type { Goal, GoalCategory } from '../../core/models';
import { formatDate } from '../../core/utils/date';
import { GOAL_CATEGORIES } from '../../core/utils/format';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { HeaderActionsComponent } from '../../shared/components/header-actions.component';
import { SkeletonComponent } from '../../shared/components/skeleton.component';
import { SyncBadgeComponent } from '../../shared/components/sync-badge.component';
import { GoalFormModal } from './goal-form.modal';
import { deadlineLabel, goalCategory, goalProgress } from './goal-utils';

type Tab = 'active' | 'completed' | 'abandoned';

@Component({
  selector: 'app-goals',
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonContent, IonIcon, IonFab, IonFabButton, HeaderActionsComponent, EmptyStateComponent, SkeletonComponent, SyncBadgeComponent],
  template: `
    <ion-header class="ion-hide-lg-up">
      <ion-toolbar>
        <ion-title>Goals</ion-title>
        <ion-buttons slot="end"><app-header-actions></app-header-actions></ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <div class="ls-page">
        <div class="ls-page-header">
          <div><h1 class="page-title">Goals</h1><p>{{ counts().active }} active · {{ counts().completed }} achieved</p></div>
          <div class="actions ion-hide-lg-down"><app-header-actions></app-header-actions></div>
        </div>

        <div class="ls-segmented" style="max-width:420px;margin-bottom:12px" role="tablist">
          <button role="tab" [class.active]="tab() === 'active'" (click)="tab.set('active')">Active ({{ counts().active }})</button>
          <button role="tab" [class.active]="tab() === 'completed'" (click)="tab.set('completed')">Completed ({{ counts().completed }})</button>
          <button role="tab" [class.active]="tab() === 'abandoned'" (click)="tab.set('abandoned')">Paused</button>
        </div>
        <div class="ls-filter-bar">
          <button class="ls-filter-chip" [class.active]="!category()" (click)="category.set('')">All</button>
          @for (c of categories; track c.value) {
            <button class="ls-filter-chip" [class.active]="category() === c.value" (click)="category.set(c.value)"><ion-icon [name]="c.icon" style="vertical-align:-2px"></ion-icon> {{ c.label }}</button>
          }
        </div>

        @if (!data.ready()) {
          <app-skeleton variant="cards" [rows]="3"></app-skeleton>
        } @else if (visible().length === 0) {
          <div class="ls-card">
            @if (tab() === 'completed') {
              <app-empty-state icon="trophy-outline" title="No completed goals yet" message="Your achievements will be celebrated here."></app-empty-state>
            } @else if (tab() === 'abandoned') {
              <app-empty-state icon="pause-circle-outline" title="No paused goals" message="Goals you set aside appear here, ready to resume."></app-empty-state>
            } @else {
              <app-empty-state icon="flag-outline" title="Set a goal worth chasing" message="Academic, personal, professional or financial, then break it into milestones." actionText="New goal" (action)="create()"></app-empty-state>
            }
          </div>
        } @else {
          <div class="ls-grid cols-3">
            @for (g of visible(); track g.id) {
              <button class="goal ls-card interactive ls-fade-in" (click)="open(g)" [style.--c]="cat(g).color">
                <div class="top">
                  <span class="ls-icon-tile sm" [style.background]="cat(g).color + '1f'" [style.color]="cat(g).color"><ion-icon [name]="cat(g).icon"></ion-icon></span>
                  <span class="ls-muted ls-small" style="font-weight:600">{{ cat(g).label }}</span>
                  <span class="ls-spacer"></span>
                  <app-sync-badge [status]="g._status"></app-sync-badge>
                </div>
                <strong class="title">{{ g.title }}</strong>
                <div class="prog">
                  <div class="ls-progress" [class.success]="progress(g) === 100"><span [style.width.%]="progress(g)"></span></div>
                  <span>{{ progress(g) }}%</span>
                </div>
                <div class="foot">
                  @if (milestoneCount(g); as mc) { <span><ion-icon name="git-commit-outline"></ion-icon> {{ mc.done }}/{{ mc.total }} milestones</span> }
                  @if (g.status === 'completed' && g.completed_at) { <span class="ls-chip success"><ion-icon name="trophy-outline"></ion-icon>{{ date(g.completed_at) }}</span> }
                  @else if (deadline(g); as d) { <span class="ls-chip" [class]="'ls-chip ' + d.tone"><ion-icon name="calendar-outline"></ion-icon>{{ d.label }}</span> }
                </div>
              </button>
            }
          </div>
        }
      </div>
      <ion-fab slot="fixed" vertical="bottom" horizontal="end" class="ls-fab">
        <ion-fab-button (click)="create()" aria-label="New goal"><ion-icon name="add"></ion-icon></ion-fab-button>
      </ion-fab>
    </ion-content>
  `,
  styles: `
    .goal { display: flex; flex-direction: column; gap: 12px; text-align: left; font: inherit; color: inherit; width: 100%; border-top: 3px solid var(--c); }
    .top { display: flex; align-items: center; gap: 8px; }
    .title { font-size: 1.02rem; line-height: 1.35; }
    .prog { display: flex; align-items: center; gap: 10px; }
    .prog .ls-progress { flex: 1; }
    .prog span { font-weight: 700; font-size: 0.85rem; min-width: 38px; text-align: right; }
    .foot { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 0.8rem; color: var(--ls-text-2); }
    .foot ion-icon { vertical-align: -2px; }
  `,
})
export class GoalsPage {
  readonly data = inject(DataService);
  private readonly modal = inject(ModalController);
  private readonly router = inject(Router);

  readonly categories = GOAL_CATEGORIES;
  readonly tab = signal<Tab>('active');
  readonly category = signal<'' | GoalCategory>('');
  private readonly milestones = this.data.list('goal_milestones');

  readonly counts = computed(() => {
    const g = this.data.list('goals')();
    return { active: g.filter((x) => x.status === 'active').length, completed: g.filter((x) => x.status === 'completed').length };
  });

  readonly visible = computed(() =>
    this.data
      .list('goals')()
      .filter((g) => g.status === this.tab() && (!this.category() || g.category === this.category()))
      .sort((a, b) =>
        this.tab() === 'completed'
          ? (b.completed_at ?? '').localeCompare(a.completed_at ?? '')
          : (a.target_date ?? '9999').localeCompare(b.target_date ?? '9999'),
      ),
  );

  cat(g: Goal) {
    return goalCategory(g);
  }
  progress(g: Goal) {
    return goalProgress(g, this.milestones());
  }
  deadline(g: Goal) {
    return deadlineLabel(g);
  }
  date(d: string) {
    return formatDate(d);
  }
  milestoneCount(g: Goal) {
    const m = this.milestones().filter((x) => x.goal_id === g.id);
    return m.length ? { total: m.length, done: m.filter((x) => x.is_completed).length } : null;
  }

  open(g: Goal) {
    void this.router.navigate(['/goals', g.id]);
  }

  async create() {
    const m = await this.modal.create({ component: GoalFormModal, cssClass: 'ls-modal' });
    await m.present();
    const { data, role } = await m.onDidDismiss();
    if (role === 'created' && typeof data === 'string') void this.router.navigate(['/goals', data]);
  }
}
