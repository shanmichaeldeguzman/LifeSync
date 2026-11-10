import { Component, inject, signal, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonTitle, IonToolbar, ModalController } from '@ionic/angular';
import { DataService } from '../../core/data/data.service';
import type { Goal, GoalCategory } from '../../core/models';
import { UiService } from '../../core/services/ui.service';
import { fromLocalInput, toLocalInput } from '../../core/utils/date';
import { GOAL_CATEGORIES } from '../../core/utils/format';

@Component({
  selector: 'app-goal-form',
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonIcon, FormsModule],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-button (click)="cancel()">Cancel</ion-button></ion-buttons>
        <ion-title>{{ goal ? 'Edit goal' : 'New goal' }}</ion-title>
        <ion-buttons slot="end"><ion-button strong (click)="save()" [disabled]="saving()">Save</ion-button></ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <form class="ls-modal-body ls-form" (ngSubmit)="save()" novalidate>
        <div>
          <label class="ls-field-label" for="g-title">Goal</label>
          <input id="g-title" name="title" class="ls-native-input" [(ngModel)]="title" maxlength="200" placeholder="e.g. Run a 10K, finish my thesis" [class.invalid]="submitted() && !title.trim()" />
          @if (submitted() && !title.trim()) { <div class="ls-field-error">Describe your goal.</div> }
        </div>
        <div>
          <label class="ls-field-label" for="g-desc">Description</label>
          <textarea id="g-desc" name="desc" class="ls-native-input" [(ngModel)]="description" maxlength="5000" placeholder="What does success look like? Why does it matter?"></textarea>
        </div>
        <div>
          <span class="ls-field-label">Category</span>
          <div class="cats">
            @for (c of categories; track c.value) {
              <button type="button" [class.active]="category === c.value" [style.--c]="c.color" (click)="category = c.value"><ion-icon [name]="c.icon"></ion-icon>{{ c.label }}</button>
            }
          </div>
        </div>
        <div class="ls-form-row two">
          <div>
            <label class="ls-field-label" for="g-date">Target date</label>
            <input id="g-date" name="date" type="date" class="ls-native-input" [(ngModel)]="targetDate" />
          </div>
          <div>
            <label class="ls-field-label" for="g-rem">Check-in reminder</label>
            <input id="g-rem" name="rem" type="datetime-local" class="ls-native-input" [(ngModel)]="reminderAt" />
          </div>
        </div>
        <div>
          <span class="ls-field-label">Track progress by</span>
          <div class="ls-segmented">
            <button type="button" [class.active]="mode === 'milestones'" (click)="mode = 'milestones'">Milestones</button>
            <button type="button" [class.active]="mode === 'manual'" (click)="mode = 'manual'">Manual %</button>
          </div>
        </div>
        @if (mode === 'manual') {
          <div>
            <label class="ls-field-label" for="g-prog">Progress: {{ progress }}%</label>
            <input id="g-prog" name="prog" type="range" min="0" max="100" step="5" [(ngModel)]="progress" style="width:100%;accent-color:var(--ion-color-primary)" />
          </div>
        }
        @if (goal) {
          <ion-button fill="outline" color="danger" type="button" (click)="remove()"><ion-icon slot="start" name="trash-outline"></ion-icon>Delete goal</ion-button>
        }
        <button type="submit" hidden></button>
      </form>
    </ion-content>
  `,
  styles: `
    .cats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .cats button { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 10px 6px; border-radius: 12px; border: 1px solid var(--ls-border); background: var(--ls-surface); color: var(--ls-text-2); font: inherit; font-size: 0.82rem; font-weight: 600; cursor: pointer; }
    .cats button ion-icon { color: var(--c); font-size: 18px; }
    .cats button.active { border-color: var(--c); color: var(--ls-text); background: color-mix(in srgb, var(--c) 12%, transparent); }
  `,
})
export class GoalFormModal implements OnInit {
  goal?: Goal;

  private readonly data = inject(DataService);
  private readonly ui = inject(UiService);
  private readonly modal = inject(ModalController);

  readonly categories = GOAL_CATEGORIES;
  readonly saving = signal(false);
  readonly submitted = signal(false);
  title = '';
  description = '';
  category: GoalCategory = 'personal';
  targetDate = '';
  reminderAt = '';
  mode: Goal['progress_mode'] = 'milestones';
  progress = 0;

  ngOnInit() {
    const g = this.goal;
    if (!g) return;
    this.title = g.title;
    this.description = g.description;
    this.category = g.category;
    this.targetDate = g.target_date ?? '';
    this.reminderAt = toLocalInput(g.reminder_at);
    this.mode = g.progress_mode;
    this.progress = g.progress;
  }

  async save() {
    this.submitted.set(true);
    if (!this.title.trim() || this.saving()) return;
    const values: Partial<Goal> = {
      title: this.title.trim(),
      description: this.description,
      category: this.category,
      target_date: this.targetDate || null,
      reminder_at: fromLocalInput(this.reminderAt),
      progress_mode: this.mode,
      progress: Number(this.progress),
    };
    this.saving.set(true);
    try {
      if (this.goal) await this.data.update('goals', this.goal.id, values);
      else {
        const g = await this.data.create('goals', values);
        await this.modal.dismiss(g.id, 'created');
        await this.ui.success('Goal created. Add milestones to break it down.');
        return;
      }
      await this.ui.success('Goal updated');
      await this.modal.dismiss(true, 'saved');
    } catch (e) {
      await this.ui.error(e);
    } finally {
      this.saving.set(false);
    }
  }

  async remove() {
    if (!this.goal) return;
    const ok = await this.ui.confirm({ header: 'Delete goal?', message: `"${this.goal.title}" and its milestones will be deleted.`, confirmText: 'Delete', destructive: true });
    if (!ok) return;
    await this.data.remove('goals', this.goal.id);
    await this.ui.success('Goal deleted');
    await this.modal.dismiss(true, 'deleted');
  }

  cancel() {
    void this.modal.dismiss(null, 'cancel');
  }
}
