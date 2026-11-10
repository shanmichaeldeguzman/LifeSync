import { Component, computed, inject, signal, type OnInit } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonTitle, IonToolbar, ModalController } from '@ionic/angular';
import { DataService } from '../../core/data/data.service';
import type { Priority, Recurrence, Task, TaskStatus } from '../../core/models';
import { UiService } from '../../core/services/ui.service';
import { addDays, fromLocalInput, toLocalInput } from '../../core/utils/date';
import { PRIORITY_META } from '../../core/utils/format';
import { CategoryManagerModal } from '../../shared/components/category-manager.modal';

const REMINDER_OPTIONS = [
  { value: 'none', label: 'No reminder' },
  { value: '0', label: 'At due time' },
  { value: '10', label: '10 minutes before' },
  { value: '60', label: '1 hour before' },
  { value: '1440', label: '1 day before' },
  { value: 'custom', label: 'Custom time…' },
];

@Component({
  selector: 'app-task-form',
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonIcon, ReactiveFormsModule],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-button (click)="cancel()">Cancel</ion-button></ion-buttons>
        <ion-title>{{ task ? 'Edit task' : 'New task' }}</ion-title>
        <ion-buttons slot="end"><ion-button (click)="save()" [disabled]="saving()" strong>Save</ion-button></ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <form class="ls-modal-body ls-form" [formGroup]="form" (ngSubmit)="save()" novalidate>
        <div>
          <label class="ls-field-label" for="t-title">Title</label>
          <input id="t-title" class="ls-native-input" formControlName="title" placeholder="What needs to be done?" maxlength="200" [class.invalid]="invalid('title')" />
          @if (invalid('title')) { <div class="ls-field-error">Give your task a title.</div> }
        </div>
        <div>
          <label class="ls-field-label" for="t-desc">Description</label>
          <textarea id="t-desc" class="ls-native-input" formControlName="description" placeholder="Add details (optional)" maxlength="5000"></textarea>
        </div>

        <div>
          <span class="ls-field-label">Priority</span>
          <div class="ls-segmented" role="radiogroup" aria-label="Priority">
            @for (p of priorities; track p) {
              <button type="button" role="radio" [attr.aria-checked]="form.controls.priority.value === p" [class.active]="form.controls.priority.value === p" (click)="form.controls.priority.setValue(p)">
                <span class="ls-dot" [style.background]="meta[p].color"></span> {{ meta[p].label }}
              </button>
            }
          </div>
        </div>

        <div>
          <span class="ls-field-label">Status</span>
          <div class="ls-segmented" role="radiogroup" aria-label="Status">
            @for (s of statuses; track s.value) {
              <button type="button" role="radio" [attr.aria-checked]="form.controls.status.value === s.value" [class.active]="form.controls.status.value === s.value" (click)="form.controls.status.setValue(s.value)">{{ s.label }}</button>
            }
          </div>
        </div>

        <div>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <label class="ls-field-label" for="t-cat">Category</label>
            <button type="button" class="link" (click)="manageCategories()">Manage</button>
          </div>
          <select id="t-cat" class="ls-native-input" formControlName="category_id">
            <option [ngValue]="null">No category</option>
            @for (c of categories(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }
          </select>
        </div>

        <div>
          <label class="ls-field-label" for="t-due">Due date</label>
          <div class="quick">
            <button type="button" class="ls-filter-chip" (click)="quickDue(0)">Today</button>
            <button type="button" class="ls-filter-chip" (click)="quickDue(1)">Tomorrow</button>
            <button type="button" class="ls-filter-chip" (click)="quickDue(7)">Next week</button>
            <button type="button" class="ls-filter-chip" (click)="form.controls.due_at.setValue('')">No date</button>
          </div>
          <input id="t-due" type="datetime-local" class="ls-native-input" formControlName="due_at" />
        </div>

        <div class="ls-form-row two">
          <div>
            <label class="ls-field-label" for="t-rem">Reminder</label>
            <select id="t-rem" class="ls-native-input" formControlName="reminder">
              @for (r of reminderOptions; track r.value) { <option [value]="r.value" [disabled]="needsDue(r.value)">{{ r.label }}</option> }
            </select>
          </div>
          @if (form.controls.reminder.value === 'custom') {
            <div>
              <label class="ls-field-label" for="t-rem-at">Remind me at</label>
              <input id="t-rem-at" type="datetime-local" class="ls-native-input" formControlName="reminder_at" />
            </div>
          }
        </div>

        <div class="ls-form-row two">
          <div>
            <label class="ls-field-label" for="t-rec">Repeat</label>
            <select id="t-rec" class="ls-native-input" formControlName="recurrence">
              <option value="none">Does not repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
            @if (recurrenceError()) { <div class="ls-field-error">Recurring tasks need a due date.</div> }
          </div>
          @if (form.controls.recurrence.value !== 'none') {
            <div>
              <label class="ls-field-label" for="t-int">Every</label>
              <input id="t-int" type="number" min="1" max="365" class="ls-native-input" formControlName="recurrence_interval" />
            </div>
            <div>
              <label class="ls-field-label" for="t-until">Until (optional)</label>
              <input id="t-until" type="date" class="ls-native-input" formControlName="recurrence_until" />
            </div>
          }
        </div>
        @if (form.controls.recurrence.value !== 'none') {
          <p class="ls-hint" style="margin-top:-6px">When you complete this task, the next occurrence is created automatically.</p>
        }

        @if (task) {
          <ion-button fill="outline" color="danger" (click)="remove()" type="button">
            <ion-icon slot="start" name="trash-outline"></ion-icon> Delete task
          </ion-button>
        }
        <button type="submit" hidden></button>
      </form>
    </ion-content>
  `,
  styles: `
    .quick { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
    .quick .ls-filter-chip { padding: 5px 11px; font-size: 0.78rem; }
    .link { background: none; border: 0; color: var(--ion-color-primary); font-weight: 600; font-size: 0.82rem; cursor: pointer; margin-bottom: 6px; }
  `,
})
export class TaskFormModal implements OnInit {
  /** componentProps */
  task?: Task;
  defaults?: Partial<Task>;

  private readonly data = inject(DataService);
  private readonly ui = inject(UiService);
  private readonly modal = inject(ModalController);
  private readonly fb = inject(FormBuilder);

  readonly priorities: Priority[] = ['low', 'medium', 'high', 'urgent'];
  readonly meta = PRIORITY_META;
  readonly statuses: { value: TaskStatus; label: string }[] = [
    { value: 'pending', label: 'Pending' },
    { value: 'in_progress', label: 'In progress' },
    { value: 'completed', label: 'Completed' },
  ];
  readonly reminderOptions = REMINDER_OPTIONS;
  readonly categories = computed(() => [...this.data.list('task_categories')()].sort((a, b) => a.name.localeCompare(b.name)));
  readonly saving = signal(false);
  readonly submitted = signal(false);
  readonly recurrenceError = signal(false);

  readonly form = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(200)]],
    description: [''],
    priority: ['medium' as Priority],
    status: ['pending' as TaskStatus],
    category_id: [null as string | null],
    due_at: [''],
    reminder: ['none'],
    reminder_at: [''],
    recurrence: ['none' as Recurrence],
    recurrence_interval: [1, [Validators.min(1), Validators.max(365)]],
    recurrence_until: [''],
  });

  ngOnInit() {
    const t = this.task ?? (this.defaults as Task | undefined);
    if (!t) return;
    let reminder = 'none';
    if (t.reminder_at) {
      const diff = t.due_at ? (new Date(t.due_at).getTime() - new Date(t.reminder_at).getTime()) / 60000 : NaN;
      reminder = ['0', '10', '60', '1440'].includes(String(diff)) ? String(diff) : 'custom';
    }
    this.form.patchValue({
      title: t.title ?? '',
      description: t.description ?? '',
      priority: t.priority ?? 'medium',
      status: t.status ?? 'pending',
      category_id: t.category_id ?? null,
      due_at: toLocalInput(t.due_at),
      reminder,
      reminder_at: toLocalInput(t.reminder_at),
      recurrence: t.recurrence ?? 'none',
      recurrence_interval: t.recurrence_interval ?? 1,
      recurrence_until: t.recurrence_until ?? '',
    });
  }

  invalid(name: 'title') {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || this.submitted());
  }

  needsDue(option: string) {
    return !['none', 'custom'].includes(option) && !this.form.controls.due_at.value;
  }

  quickDue(days: number) {
    const d = addDays(new Date(), days);
    d.setHours(17, 0, 0, 0);
    this.form.controls.due_at.setValue(toLocalInput(d.toISOString()));
  }

  async manageCategories() {
    const m = await this.modal.create({ component: CategoryManagerModal, componentProps: { table: 'task_categories', title: 'Task categories' }, cssClass: 'ls-modal' });
    await m.present();
  }

  async save() {
    this.submitted.set(true);
    const v = this.form.getRawValue();
    this.recurrenceError.set(v.recurrence !== 'none' && !v.due_at);
    if (this.form.invalid || this.recurrenceError() || this.saving()) return;

    const due = fromLocalInput(v.due_at);
    let reminderAt: string | null = null;
    if (v.reminder === 'custom') reminderAt = fromLocalInput(v.reminder_at);
    else if (v.reminder !== 'none' && due) reminderAt = new Date(new Date(due).getTime() - Number(v.reminder) * 60000).toISOString();

    const values: Partial<Task> = {
      title: v.title.trim(),
      description: v.description,
      priority: v.priority,
      status: v.status,
      category_id: v.category_id || null,
      due_at: due,
      reminder_at: reminderAt,
      recurrence: v.recurrence,
      recurrence_interval: Number(v.recurrence_interval) || 1,
      recurrence_until: v.recurrence !== 'none' && v.recurrence_until ? v.recurrence_until : null,
      completed_at: v.status === 'completed' ? (this.task?.completed_at ?? new Date().toISOString()) : null,
    };

    this.saving.set(true);
    try {
      if (this.task) await this.data.update('tasks', this.task.id, values);
      else await this.data.create('tasks', values);
      await this.ui.success(this.task ? 'Task updated' : 'Task created');
      await this.modal.dismiss(true, 'saved');
    } catch (e) {
      await this.ui.error(e);
    } finally {
      this.saving.set(false);
    }
  }

  async remove() {
    if (!this.task) return;
    const ok = await this.ui.confirm({ header: 'Delete task?', message: `"${this.task.title}" will be permanently deleted.`, confirmText: 'Delete', destructive: true });
    if (!ok) return;
    await this.data.remove('tasks', this.task.id);
    await this.ui.success('Task deleted');
    await this.modal.dismiss(true, 'deleted');
  }

  cancel() {
    void this.modal.dismiss(null, 'cancel');
  }
}
