import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonTitle, IonToolbar, ModalController } from '@ionic/angular';
import { DataService } from '../../core/data/data.service';
import type { Goal, GoalMilestone } from '../../core/models';
import { UiService } from '../../core/services/ui.service';
import { formatDate } from '../../core/utils/date';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { ProgressRingComponent } from '../../shared/components/progress-ring.component';
import { SyncBadgeComponent } from '../../shared/components/sync-badge.component';
import { GoalFormModal } from './goal-form.modal';
import { deadlineLabel, goalCategory, goalProgress } from './goal-utils';

@Component({
  selector: 'app-goal-detail',
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonButton, IonContent, IonIcon, FormsModule, EmptyStateComponent, ProgressRingComponent, SyncBadgeComponent],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/goals" text=""></ion-back-button></ion-buttons>
        <ion-title>Goal</ion-title>
        <ion-buttons slot="end">@if (goal()) { <button class="ls-icon-btn ghost" (click)="edit()" aria-label="Edit goal"><ion-icon name="create-outline"></ion-icon></button> }</ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <div class="ls-page narrow">
        @if (goal(); as g) {
          <div class="ls-card hero">
            <app-progress-ring [value]="progress()" [size]="96" [stroke]="10" [color]="g.status === 'completed' ? 'var(--ion-color-success)' : cat().color"></app-progress-ring>
            <div style="flex:1;min-width:0">
              <span class="ls-chip" [style.color]="cat().color" [style.background]="cat().color + '1a'"><ion-icon [name]="cat().icon"></ion-icon>{{ cat().label }}</span>
              <h1>{{ g.title }}</h1>
              <div class="meta">
                @if (deadline(); as d) { <span class="ls-chip" [class]="'ls-chip ' + d.tone"><ion-icon name="calendar-outline"></ion-icon>{{ d.label }}</span> }
                @if (g.status === 'completed' && g.completed_at) { <span class="ls-chip success"><ion-icon name="trophy-outline"></ion-icon>Completed {{ date(g.completed_at) }}</span> }
                @if (g.status === 'abandoned') { <span class="ls-chip">Paused</span> }
                <app-sync-badge [status]="g._status"></app-sync-badge>
              </div>
            </div>
          </div>
          @if (g.description) { <p class="desc">{{ g.description }}</p> }

          @if (g.progress_mode === 'manual' && g.status !== 'completed') {
            <div class="ls-card" style="margin-top:14px">
              <label class="ls-field-label" for="prog">Progress: {{ manual() }}%</label>
              <input id="prog" type="range" min="0" max="100" step="5" [ngModel]="manual()" (ngModelChange)="manual.set($event)" (change)="saveManual()" style="width:100%;accent-color:var(--ion-color-primary)" />
            </div>
          }

          <div class="ls-card-header" style="margin-top:22px"><h3>Milestones</h3><span class="ls-muted ls-small">{{ doneCount() }}/{{ milestones().length }} done</span></div>
          <div class="ls-card flush">
            @for (m of milestones(); track m.id; let i = $index) {
              <div class="ls-row">
                <button class="ls-check" [class.checked]="m.is_completed" (click)="toggle(m)" [attr.aria-label]="m.is_completed ? 'Mark milestone incomplete' : 'Mark milestone complete'">@if (m.is_completed) { <ion-icon name="checkmark"></ion-icon> }</button>
                <div class="grow">
                  <div class="title" [class.done]="m.is_completed">{{ m.title }}</div>
                  <div class="meta">
                    @if (m.due_date) { <span>Due {{ date(m.due_date) }}</span> }
                    @if (m.completed_at) { <span>Done {{ date(m.completed_at) }}</span> }
                    <app-sync-badge [status]="m._status"></app-sync-badge>
                  </div>
                </div>
                <button class="ls-icon-btn ghost" [disabled]="i === 0" (click)="move(m, -1)" aria-label="Move up"><ion-icon name="arrow-up"></ion-icon></button>
                <button class="ls-icon-btn ghost" (click)="removeMilestone(m)" aria-label="Delete milestone"><ion-icon name="close"></ion-icon></button>
              </div>
            } @empty {
              <app-empty-state [compact]="true" icon="git-commit-outline" title="Break it down" message="Add 3–5 concrete steps. Each one completed moves your progress forward."></app-empty-state>
            }
            <form class="add" (ngSubmit)="addMilestone()">
              <input class="ls-native-input" name="mt" [(ngModel)]="newTitle" placeholder="Add a milestone…" maxlength="200" aria-label="New milestone" />
              <input class="ls-native-input" name="md" type="date" [(ngModel)]="newDue" aria-label="Milestone due date" style="max-width:160px" />
              <ion-button type="submit" [disabled]="!newTitle.trim()">Add</ion-button>
            </form>
          </div>

          <div class="status-actions">
            @if (g.status === 'active') {
              <ion-button (click)="setStatus('completed')"><ion-icon slot="start" name="trophy-outline"></ion-icon>Mark goal achieved</ion-button>
              <ion-button fill="outline" color="medium" (click)="setStatus('abandoned')"><ion-icon slot="start" name="pause-outline"></ion-icon>Pause</ion-button>
            } @else {
              <ion-button fill="outline" (click)="setStatus('active')"><ion-icon slot="start" name="refresh-outline"></ion-icon>Reactivate</ion-button>
            }
          </div>
        } @else {
          <app-empty-state icon="flag-outline" title="Goal not found" message="It may have been deleted on another device."></app-empty-state>
        }
      </div>
    </ion-content>
  `,
  styles: `
    .hero { display: flex; gap: 18px; align-items: center; }
    .hero h1 { font-size: 1.35rem; font-weight: 800; margin: 8px 0; line-height: 1.25; }
    .meta { display: flex; gap: 6px; flex-wrap: wrap; }
    .desc { color: var(--ls-text-2); line-height: 1.6; white-space: pre-wrap; margin: 14px 4px 0; }
    .add { display: flex; gap: 8px; padding: 12px; border-top: 1px solid var(--ls-border); flex-wrap: wrap; }
    .add input:first-child { flex: 1; min-width: 160px; }
    .status-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 22px; }
  `,
})
export class GoalDetailPage {
  private readonly data = inject(DataService);
  private readonly ui = inject(UiService);
  private readonly modal = inject(ModalController);
  private readonly router = inject(Router);

  readonly id = input.required<string>();
  readonly goal = computed(() => this.data.find('goals', this.id()));
  readonly milestones = computed(() => this.data.list('goal_milestones')().filter((m) => m.goal_id === this.id()).sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at)));
  readonly doneCount = computed(() => this.milestones().filter((m) => m.is_completed).length);
  readonly progress = computed(() => (this.goal() ? goalProgress(this.goal()!, this.milestones()) : 0));
  readonly cat = computed(() => goalCategory(this.goal()!));
  readonly deadline = computed(() => (this.goal() ? deadlineLabel(this.goal()!) : null));
  readonly manual = signal(0);
  newTitle = '';
  newDue = '';

  constructor() {
    // Keep the manual-progress slider in sync with the stored value.
    effect(() => {
      const p = this.goal()?.progress;
      if (p !== undefined) untracked(() => this.manual.set(p));
    });
  }

  date(d: string) {
    return formatDate(d);
  }

  async addMilestone() {
    const title = this.newTitle.trim();
    if (!title) return;
    const position = (this.milestones().at(-1)?.position ?? -1) + 1;
    await this.data.create('goal_milestones', { goal_id: this.id(), title, due_date: this.newDue || null, position });
    this.newTitle = '';
    this.newDue = '';
    await this.maybeCelebrate();
  }

  async toggle(m: GoalMilestone) {
    await this.data.update('goal_milestones', m.id, { is_completed: !m.is_completed, completed_at: m.is_completed ? null : new Date().toISOString() });
    await this.maybeCelebrate();
  }

  async move(m: GoalMilestone, dir: -1) {
    const list = this.milestones();
    const i = list.findIndex((x) => x.id === m.id);
    const other = list[i + dir];
    if (!other) return;
    // Normalise positions then swap.
    await Promise.all(list.map((x, idx) => (x.position !== idx ? this.data.update('goal_milestones', x.id, { position: idx }) : null)));
    await this.data.update('goal_milestones', m.id, { position: i + dir });
    await this.data.update('goal_milestones', other.id, { position: i });
  }

  async removeMilestone(m: GoalMilestone) {
    const ok = await this.ui.confirm({ header: 'Delete milestone?', message: `"${m.title}" will be removed.`, confirmText: 'Delete', destructive: true });
    if (ok) await this.data.remove('goal_milestones', m.id);
  }

  async saveManual() {
    const g = this.goal();
    if (g) await this.data.update('goals', g.id, { progress: Number(this.manual()) });
  }

  private async maybeCelebrate() {
    const g = this.goal();
    if (g && g.status === 'active' && g.progress_mode === 'milestones' && this.milestones().length && this.doneCount() === this.milestones().length) {
      const ok = await this.ui.confirm({ header: 'All milestones done! 🎉', message: 'Mark this goal as achieved?', confirmText: 'Mark achieved' });
      if (ok) await this.setStatus('completed');
    }
  }

  async setStatus(status: Goal['status']) {
    const g = this.goal();
    if (!g) return;
    await this.data.update('goals', g.id, { status, completed_at: status === 'completed' ? new Date().toISOString() : null });
    await this.ui.success(status === 'completed' ? 'Goal achieved. Well done!' : status === 'active' ? 'Goal reactivated' : 'Goal paused');
  }

  async edit() {
    const m = await this.modal.create({ component: GoalFormModal, componentProps: { goal: this.goal() }, cssClass: 'ls-modal' });
    await m.present();
    const { role } = await m.onDidDismiss();
    if (role === 'deleted') void this.router.navigateByUrl('/goals', { replaceUrl: true });
    else this.manual.set(this.goal()?.progress ?? 0);
  }
}
