import { Component, computed, inject, input, output } from '@angular/core';
import { IonIcon } from '@ionic/angular';
import { DataService } from '../../core/data/data.service';
import type { Task } from '../../core/models';
import { relativeDateTime } from '../../core/utils/date';
import { PRIORITY_META } from '../../core/utils/format';
import { describeRecurrence } from '../../core/utils/recurrence';
import { SyncBadgeComponent } from '../../shared/components/sync-badge.component';

/** A single task line with completion toggle and metadata chips. */
@Component({
  selector: 'app-task-row',
  imports: [IonIcon, SyncBadgeComponent],
  template: `
    <div class="ls-row clickable" (click)="open.emit(task())" (keydown.enter)="open.emit(task())" tabindex="0" role="button" [attr.aria-label]="'Edit task ' + task().title">
      <button class="ls-check" [class.checked]="done()" (click)="toggle($event)" [attr.aria-label]="done() ? 'Mark as not completed' : 'Mark as completed'" [attr.aria-pressed]="done()">
        @if (done()) { <ion-icon name="checkmark"></ion-icon> }
      </button>
      <span class="prio" [style.background]="priority().color" [title]="priority().label + ' priority'"></span>
      <div class="grow">
        <div class="title" [class.done]="done()">{{ task().title }}</div>
        <div class="meta">
          @if (task().due_at) {
            <span [class.overdue]="overdue()"><ion-icon name="time-outline"></ion-icon> {{ due() }}</span>
          }
          @if (category(); as c) {
            <span class="ls-chip" [style.background]="c.color + '1a'" [style.color]="c.color">{{ c.name }}</span>
          }
          @if (task().status === 'in_progress') { <span class="ls-chip info">In progress</span> }
          @if (task().recurrence !== 'none') { <span title="Repeats"><ion-icon name="repeat-outline"></ion-icon> {{ recurrence() }}</span> }
          @if (task().reminder_at && !done()) { <ion-icon name="notifications-outline" title="Reminder set"></ion-icon> }
          @if (task().priority === 'urgent' || task().priority === 'high') {
            <span class="ls-chip" [class]="'ls-chip ' + priority().chip">{{ priority().label }}</span>
          }
        </div>
      </div>
      <app-sync-badge [status]="task()._status"></app-sync-badge>
    </div>
  `,
  styles: `
    .prio { width: 4px; align-self: stretch; border-radius: 4px; flex-shrink: 0; margin: 2px 0; opacity: 0.85; }
    .meta ion-icon { vertical-align: -2px; }
    .overdue { color: var(--ion-color-danger); font-weight: 600; }
  `,
})
export class TaskRowComponent {
  private readonly data = inject(DataService);
  readonly task = input.required<Task>();
  readonly open = output<Task>();

  readonly done = computed(() => this.task().status === 'completed');
  readonly priority = computed(() => PRIORITY_META[this.task().priority]);
  readonly category = computed(() => this.data.find('task_categories', this.task().category_id));
  readonly due = computed(() => (this.task().due_at ? relativeDateTime(this.task().due_at!) : ''));
  readonly overdue = computed(() => !this.done() && !!this.task().due_at && new Date(this.task().due_at!) < new Date());
  readonly recurrence = computed(() => describeRecurrence(this.task().recurrence, this.task().recurrence_interval));

  async toggle(ev: Event) {
    ev.stopPropagation();
    await this.data.update('tasks', this.task().id, { status: this.done() ? 'pending' : 'completed', completed_at: this.done() ? null : new Date().toISOString() });
  }
}
