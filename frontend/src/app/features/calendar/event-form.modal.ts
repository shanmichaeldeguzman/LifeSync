import { Component, computed, inject, signal, type OnInit } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonTitle, IonToolbar, ModalController } from '@ionic/angular';
import { DataService } from '../../core/data/data.service';
import type { CalendarEvent, Recurrence } from '../../core/models';
import { UiService } from '../../core/services/ui.service';
import { addDays, dateKey, fromLocalInput, parseDateKey, toLocalInput } from '../../core/utils/date';
import { CategoryManagerModal } from '../../shared/components/category-manager.modal';
import { ColorPickerComponent } from '../../shared/components/pickers.component';

@Component({
  selector: 'app-event-form',
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonIcon, ReactiveFormsModule, ColorPickerComponent],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-button (click)="cancel()">Cancel</ion-button></ion-buttons>
        <ion-title>{{ event ? 'Edit event' : 'New event' }}</ion-title>
        <ion-buttons slot="end"><ion-button strong (click)="save()" [disabled]="saving()">Save</ion-button></ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <form class="ls-modal-body ls-form" [formGroup]="form" (ngSubmit)="save()" novalidate>
        @if (event && event.recurrence !== 'none') {
          <div class="ls-banner"><ion-icon name="repeat-outline"></ion-icon>Changes apply to every occurrence of this repeating event.</div>
        }
        <div>
          <label class="ls-field-label" for="e-title">Title</label>
          <input id="e-title" class="ls-native-input" formControlName="title" placeholder="Event name" maxlength="200" [class.invalid]="invalid('title')" />
          @if (invalid('title')) { <div class="ls-field-error">Give your event a title.</div> }
        </div>

        <label class="toggle-row">
          <span><strong>All day</strong></span>
          <input type="checkbox" class="switch" formControlName="all_day" role="switch" />
        </label>

        <div class="ls-form-row two">
          <div>
            <label class="ls-field-label" for="e-start">Starts</label>
            @if (form.controls.all_day.value) {
              <input id="e-start" type="date" class="ls-native-input" formControlName="start_date" />
            } @else {
              <input id="e-start" type="datetime-local" class="ls-native-input" formControlName="start" (change)="syncEnd()" />
            }
          </div>
          <div>
            <label class="ls-field-label" for="e-end">Ends</label>
            @if (form.controls.all_day.value) {
              <input id="e-end" type="date" class="ls-native-input" formControlName="end_date" [class.invalid]="rangeError()" />
            } @else {
              <input id="e-end" type="datetime-local" class="ls-native-input" formControlName="end" [class.invalid]="rangeError()" />
            }
            @if (rangeError()) { <div class="ls-field-error">The end must be after the start.</div> }
          </div>
        </div>

        <div>
          <label class="ls-field-label" for="e-loc">Location</label>
          <input id="e-loc" class="ls-native-input" formControlName="location" placeholder="Add a place (optional)" maxlength="300" />
        </div>
        <div>
          <label class="ls-field-label" for="e-desc">Description</label>
          <textarea id="e-desc" class="ls-native-input" formControlName="description" placeholder="Notes, agenda, links…" maxlength="5000"></textarea>
        </div>

        <div class="ls-form-row two">
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <label class="ls-field-label" for="e-cat">Category</label>
              <button type="button" class="link" (click)="manageCategories()">Manage</button>
            </div>
            <select id="e-cat" class="ls-native-input" formControlName="category_id">
              <option [ngValue]="null">No category</option>
              @for (c of categories(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }
            </select>
          </div>
          <div>
            <label class="ls-field-label" for="e-rem">Reminder</label>
            <select id="e-rem" class="ls-native-input" formControlName="reminder_minutes">
              <option [ngValue]="null">No reminder</option>
              <option [ngValue]="0">At start time</option>
              <option [ngValue]="5">5 minutes before</option>
              <option [ngValue]="15">15 minutes before</option>
              <option [ngValue]="30">30 minutes before</option>
              <option [ngValue]="60">1 hour before</option>
              <option [ngValue]="1440">1 day before</option>
            </select>
          </div>
        </div>

        <div class="ls-form-row two">
          <div>
            <label class="ls-field-label" for="e-rec">Repeat</label>
            <select id="e-rec" class="ls-native-input" formControlName="recurrence">
              <option value="none">Does not repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
          @if (form.controls.recurrence.value !== 'none') {
            <div>
              <label class="ls-field-label" for="e-int">Every</label>
              <input id="e-int" type="number" min="1" max="365" class="ls-native-input" formControlName="recurrence_interval" />
            </div>
            <div>
              <label class="ls-field-label" for="e-until">Until (optional)</label>
              <input id="e-until" type="date" class="ls-native-input" formControlName="recurrence_until" />
            </div>
          }
        </div>

        <div>
          <span class="ls-field-label">Color</span>
          <app-color-picker [value]="form.controls.color.value || categoryColor()" (valueChange)="form.controls.color.setValue($event)"></app-color-picker>
        </div>

        @if (event) {
          <ion-button fill="outline" color="danger" type="button" (click)="remove()"><ion-icon slot="start" name="trash-outline"></ion-icon>Delete event</ion-button>
        }
        <button type="submit" hidden></button>
      </form>
    </ion-content>
  `,
  styles: `
    .toggle-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; border: 1px solid var(--ls-border); border-radius: 12px; background: var(--ls-surface); cursor: pointer; }
    .switch { appearance: none; width: 44px; height: 26px; border-radius: 13px; background: var(--ls-border-strong); position: relative; cursor: pointer; transition: background 0.2s; }
    .switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: transform 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
    .switch:checked { background: var(--ion-color-primary); }
    .switch:checked::after { transform: translateX(18px); }
    .link { background: none; border: 0; color: var(--ion-color-primary); font-weight: 600; font-size: 0.82rem; cursor: pointer; margin-bottom: 6px; }
  `,
})
export class EventFormModal implements OnInit {
  event?: CalendarEvent;
  /** Pre-selected day (YYYY-MM-DD) for new events. */
  date?: string;

  private readonly data = inject(DataService);
  private readonly ui = inject(UiService);
  private readonly modal = inject(ModalController);
  private readonly fb = inject(FormBuilder);

  readonly categories = computed(() => [...this.data.list('event_categories')()].sort((a, b) => a.name.localeCompare(b.name)));
  readonly saving = signal(false);
  readonly submitted = signal(false);
  readonly rangeError = signal(false);

  readonly form = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(200)]],
    description: [''],
    location: [''],
    category_id: [null as string | null],
    all_day: [false],
    start: [''],
    end: [''],
    start_date: [''],
    end_date: [''],
    reminder_minutes: [15 as number | null],
    recurrence: ['none' as Recurrence],
    recurrence_interval: [1],
    recurrence_until: [''],
    color: [''],
  });

  ngOnInit() {
    const prefMinutes = this.data.preferences()?.default_event_reminder_minutes ?? 15;
    if (this.event) {
      const e = this.event;
      this.form.patchValue({
        title: e.title,
        description: e.description,
        location: e.location,
        category_id: e.category_id,
        all_day: e.all_day,
        start: toLocalInput(e.start_at),
        end: toLocalInput(e.end_at),
        start_date: dateKey(new Date(e.start_at)),
        end_date: dateKey(new Date(e.end_at)),
        reminder_minutes: e.reminder_minutes,
        recurrence: e.recurrence,
        recurrence_interval: e.recurrence_interval,
        recurrence_until: e.recurrence_until ?? '',
        color: e.color ?? '',
      });
    } else {
      const day = this.date ? parseDateKey(this.date) : new Date();
      const start = new Date(day);
      if (this.date) start.setHours(9, 0, 0, 0);
      else start.setHours(start.getHours() + 1, 0, 0, 0);
      const end = new Date(start.getTime() + 3600_000);
      this.form.patchValue({
        start: toLocalInput(start.toISOString()),
        end: toLocalInput(end.toISOString()),
        start_date: dateKey(start),
        end_date: dateKey(start),
        reminder_minutes: prefMinutes,
      });
    }
  }

  categoryColor() {
    return this.data.find('event_categories', this.form.controls.category_id.value)?.color ?? '#635BFF';
  }

  invalid(name: 'title') {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || this.submitted());
  }

  /** Keep the same duration when the start moves past the end. */
  syncEnd() {
    const s = fromLocalInput(this.form.controls.start.value);
    const e = fromLocalInput(this.form.controls.end.value);
    if (s && (!e || new Date(e) <= new Date(s))) {
      this.form.controls.end.setValue(toLocalInput(new Date(new Date(s).getTime() + 3600_000).toISOString()));
    }
  }

  async manageCategories() {
    const m = await this.modal.create({ component: CategoryManagerModal, componentProps: { table: 'event_categories', title: 'Event categories' }, cssClass: 'ls-modal' });
    await m.present();
  }

  async save() {
    this.submitted.set(true);
    const v = this.form.getRawValue();
    let start: string | null;
    let end: string | null;
    if (v.all_day) {
      start = v.start_date ? parseDateKey(v.start_date).toISOString() : null;
      const endDay = v.end_date ? parseDateKey(v.end_date) : null;
      end = endDay ? new Date(addDays(endDay, 1).getTime() - 60_000).toISOString() : null;
    } else {
      start = fromLocalInput(v.start);
      end = fromLocalInput(v.end);
    }
    this.rangeError.set(!start || !end || new Date(end) < new Date(start));
    if (this.form.invalid || this.rangeError() || this.saving()) return;

    const values: Partial<CalendarEvent> = {
      title: v.title.trim(),
      description: v.description,
      location: v.location,
      category_id: v.category_id,
      all_day: v.all_day,
      start_at: start!,
      end_at: end!,
      reminder_minutes: v.reminder_minutes,
      recurrence: v.recurrence,
      recurrence_interval: Math.max(1, Number(v.recurrence_interval) || 1),
      recurrence_until: v.recurrence !== 'none' && v.recurrence_until ? v.recurrence_until : null,
      color: v.color || null,
    };
    this.saving.set(true);
    try {
      if (this.event) await this.data.update('events', this.event.id, values);
      else await this.data.create('events', values);
      await this.ui.success(this.event ? 'Event updated' : 'Event created');
      await this.modal.dismiss(true, 'saved');
    } catch (e) {
      await this.ui.error(e);
    } finally {
      this.saving.set(false);
    }
  }

  async remove() {
    if (!this.event) return;
    const series = this.event.recurrence !== 'none' ? ' and all of its occurrences' : '';
    const ok = await this.ui.confirm({ header: 'Delete event?', message: `"${this.event.title}"${series} will be deleted.`, confirmText: 'Delete', destructive: true });
    if (!ok) return;
    await this.data.remove('events', this.event.id);
    await this.ui.success('Event deleted');
    await this.modal.dismiss(true, 'deleted');
  }

  cancel() {
    void this.modal.dismiss(null, 'cancel');
  }
}
