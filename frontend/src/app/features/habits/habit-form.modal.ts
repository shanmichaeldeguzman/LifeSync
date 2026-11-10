import { Component, inject, signal, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonTitle, IonToolbar, ModalController } from '@ionic/angular';
import { DataService } from '../../core/data/data.service';
import type { Habit } from '../../core/models';
import { UiService } from '../../core/services/ui.service';
import { dateKey, WEEKDAYS_SHORT } from '../../core/utils/date';
import { ColorPickerComponent, IconPickerComponent } from '../../shared/components/pickers.component';

const SUGGESTIONS = [
  { name: 'Drink water', icon: 'water-outline', color: '#0EA5E9' },
  { name: 'Read 20 minutes', icon: 'book-outline', color: '#8B5CF6' },
  { name: 'Walk outside', icon: 'walk-outline', color: '#22C55E' },
  { name: 'Meditate', icon: 'leaf-outline', color: '#14B8A6' },
  { name: 'Stretch', icon: 'body-outline', color: '#F97316' },
  { name: 'Journal', icon: 'pencil-outline', color: '#EC4899' },
];

@Component({
  selector: 'app-habit-form',
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonIcon, FormsModule, ColorPickerComponent, IconPickerComponent],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-button (click)="cancel()">Cancel</ion-button></ion-buttons>
        <ion-title>{{ habit ? 'Edit habit' : 'New habit' }}</ion-title>
        <ion-buttons slot="end"><ion-button strong (click)="save()" [disabled]="saving()">Save</ion-button></ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <form class="ls-modal-body ls-form" (ngSubmit)="save()" novalidate>
        @if (!habit) {
          <div>
            <span class="ls-field-label">Ideas to get started</span>
            <div class="ls-filter-bar">
              @for (s of suggestions; track s.name) {
                <button type="button" class="ls-filter-chip" (click)="useSuggestion(s)"><ion-icon [name]="s.icon" style="vertical-align:-2px"></ion-icon> {{ s.name }}</button>
              }
            </div>
          </div>
        }
        <div>
          <label class="ls-field-label" for="h-name">Name</label>
          <input id="h-name" name="name" class="ls-native-input" [(ngModel)]="name" maxlength="100" placeholder="e.g. Read 20 minutes" [class.invalid]="submitted() && !name.trim()" />
          @if (submitted() && !name.trim()) { <div class="ls-field-error">Give your habit a name.</div> }
        </div>
        <div>
          <label class="ls-field-label" for="h-desc">Why it matters (optional)</label>
          <textarea id="h-desc" name="description" class="ls-native-input" [(ngModel)]="description" maxlength="1000" placeholder="A short reminder of your motivation" style="min-height:70px"></textarea>
        </div>

        <div>
          <span class="ls-field-label">How often</span>
          <div class="ls-segmented">
            <button type="button" [class.active]="frequency === 'daily'" (click)="frequency = 'daily'">Every day</button>
            <button type="button" [class.active]="frequency === 'custom'" (click)="frequency = 'custom'">Specific days</button>
            <button type="button" [class.active]="frequency === 'weekly'" (click)="frequency = 'weekly'">Times per week</button>
          </div>
        </div>
        @if (frequency === 'custom') {
          <div>
            <span class="ls-field-label">On these days</span>
            <div class="days">
              @for (d of weekdays; track $index) {
                <button type="button" [class.active]="days.includes($index)" (click)="toggleDay($index)" [attr.aria-pressed]="days.includes($index)">{{ d }}</button>
              }
            </div>
            @if (submitted() && days.length === 0) { <div class="ls-field-error">Pick at least one day.</div> }
          </div>
        }
        @if (frequency === 'weekly') {
          <div>
            <label class="ls-field-label" for="h-target">Target per week: {{ target }}</label>
            <input id="h-target" name="target" type="range" min="1" max="7" [(ngModel)]="target" class="range" />
          </div>
        }

        <div class="ls-form-row two">
          <div>
            <label class="ls-field-label" for="h-rem">Reminder (optional)</label>
            <input id="h-rem" name="reminder" type="time" class="ls-native-input" [(ngModel)]="reminder" />
          </div>
          <div>
            <label class="ls-field-label" for="h-start">Start date</label>
            <input id="h-start" name="start" type="date" class="ls-native-input" [(ngModel)]="startDate" />
          </div>
        </div>

        <div><span class="ls-field-label">Color</span><app-color-picker [(value)]="color"></app-color-picker></div>
        <div><span class="ls-field-label">Icon</span><app-icon-picker [(value)]="icon" [color]="color"></app-icon-picker></div>

        @if (habit) {
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <ion-button fill="outline" color="medium" type="button" (click)="toggleArchive()"><ion-icon slot="start" name="archive-outline"></ion-icon>{{ habit.is_archived ? 'Restore' : 'Archive' }}</ion-button>
            <ion-button fill="outline" color="danger" type="button" (click)="remove()"><ion-icon slot="start" name="trash-outline"></ion-icon>Delete</ion-button>
          </div>
        }
        <button type="submit" hidden></button>
      </form>
    </ion-content>
  `,
  styles: `
    .days { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
    .days button { height: 40px; border-radius: 10px; border: 1px solid var(--ls-border-strong); background: var(--ls-surface); color: var(--ls-text-2); font: inherit; font-weight: 600; font-size: 0.8rem; cursor: pointer; }
    .days button.active { background: var(--ion-color-primary); border-color: var(--ion-color-primary); color: #fff; }
    .range { width: 100%; accent-color: var(--ion-color-primary); }
  `,
})
export class HabitFormModal implements OnInit {
  habit?: Habit;

  private readonly data = inject(DataService);
  private readonly ui = inject(UiService);
  private readonly modal = inject(ModalController);

  readonly suggestions = SUGGESTIONS;
  readonly weekdays = WEEKDAYS_SHORT;
  readonly saving = signal(false);
  readonly submitted = signal(false);

  name = '';
  description = '';
  frequency: Habit['frequency'] = 'daily';
  days: number[] = [1, 2, 3, 4, 5];
  target = 3;
  reminder = '';
  startDate = dateKey();
  color = '#22C55E';
  icon = 'leaf-outline';

  ngOnInit() {
    const h = this.habit;
    if (!h) return;
    this.name = h.name;
    this.description = h.description;
    this.frequency = h.frequency;
    this.days = h.days_of_week.length ? [...h.days_of_week] : [1, 2, 3, 4, 5];
    this.target = h.target_per_week;
    this.reminder = h.reminder_time?.slice(0, 5) ?? '';
    this.startDate = h.start_date;
    this.color = h.color;
    this.icon = h.icon;
  }

  useSuggestion(s: (typeof SUGGESTIONS)[number]) {
    this.name = s.name;
    this.icon = s.icon;
    this.color = s.color;
  }

  toggleDay(d: number) {
    this.days = this.days.includes(d) ? this.days.filter((x) => x !== d) : [...this.days, d].sort();
  }

  async save() {
    this.submitted.set(true);
    if (!this.name.trim() || (this.frequency === 'custom' && !this.days.length) || this.saving()) return;
    const values: Partial<Habit> = {
      name: this.name.trim(),
      description: this.description,
      frequency: this.frequency,
      days_of_week: this.frequency === 'custom' ? this.days : [],
      target_per_week: this.frequency === 'weekly' ? Number(this.target) : 7,
      reminder_time: this.reminder ? `${this.reminder}:00`.slice(0, 8) : null,
      start_date: this.startDate || dateKey(),
      color: this.color,
      icon: this.icon,
    };
    this.saving.set(true);
    try {
      if (this.habit) await this.data.update('habits', this.habit.id, values);
      else await this.data.create('habits', values);
      await this.ui.success(this.habit ? 'Habit updated' : 'Habit created. You\'ve got this!');
      await this.modal.dismiss(true, 'saved');
    } catch (e) {
      await this.ui.error(e);
    } finally {
      this.saving.set(false);
    }
  }

  async toggleArchive() {
    if (!this.habit) return;
    await this.data.update('habits', this.habit.id, { is_archived: !this.habit.is_archived });
    await this.ui.success(this.habit.is_archived ? 'Habit restored' : 'Habit archived');
    await this.modal.dismiss(true, 'saved');
  }

  async remove() {
    if (!this.habit) return;
    const ok = await this.ui.confirm({ header: 'Delete habit?', message: `"${this.habit.name}" and its entire history will be deleted. Archive it instead to keep your history.`, confirmText: 'Delete', destructive: true });
    if (!ok) return;
    await this.data.remove('habits', this.habit.id);
    await this.ui.success('Habit deleted');
    await this.modal.dismiss(true, 'deleted');
  }

  cancel() {
    void this.modal.dismiss(null, 'cancel');
  }
}
