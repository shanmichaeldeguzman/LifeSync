import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonBackButton, IonButton, IonButtons, IonContent, IonFab, IonFabButton, IonHeader, IonIcon, IonTitle, IonToolbar } from '@ionic/angular';
import { DataService } from '../../core/data/data.service';
import type { PaymentMethod, RecurringTransaction, TxType } from '../../core/models';
import { UiService } from '../../core/services/ui.service';
import { dateKey, formatDate } from '../../core/utils/date';
import { PAYMENT_METHODS } from '../../core/utils/format';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { SyncBadgeComponent } from '../../shared/components/sync-badge.component';
import { FinanceStore } from './finance.store';

type Freq = RecurringTransaction['frequency'];

@Component({
  selector: 'app-recurring',
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonButton, IonContent, IonIcon, IonFab, IonFabButton, FormsModule, EmptyStateComponent, SyncBadgeComponent],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/finance" text=""></ion-back-button></ion-buttons>
        <ion-title>Recurring transactions</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <div class="ls-page narrow">
        <div class="ls-banner" style="margin-bottom:16px"><ion-icon name="information-circle-outline"></ion-icon>Rules you define here add transactions automatically on their due dates (when LifeSync syncs). They are still your own manual records.</div>

        @if (editing()) {
          <form class="ls-card ls-form" (ngSubmit)="save()" style="margin-bottom:16px">
            <h3 style="font-size:1rem">{{ editing()!.id ? 'Edit rule' : 'New recurring rule' }}</h3>
            <div class="ls-segmented">
              <button type="button" [class.active]="type === 'expense'" (click)="type = 'expense'; categoryId = null">Expense</button>
              <button type="button" [class.active]="type === 'income'" (click)="type = 'income'; categoryId = null">Income</button>
            </div>
            <div class="ls-form-row two">
              <div>
                <label class="ls-field-label" for="r-amount">Amount</label>
                <input id="r-amount" name="amount" class="ls-native-input" type="number" min="0.01" step="0.01" [(ngModel)]="amount" [class.invalid]="error()" />
              </div>
              <div>
                <label class="ls-field-label" for="r-cat">Category</label>
                <select id="r-cat" name="cat" class="ls-native-input" [(ngModel)]="categoryId">
                  <option [ngValue]="null">Uncategorized</option>
                  @for (c of categoryOptions(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }
                </select>
              </div>
            </div>
            <div>
              <label class="ls-field-label" for="r-desc">Description</label>
              <input id="r-desc" name="desc" class="ls-native-input" [(ngModel)]="description" maxlength="300" placeholder="e.g. Rent, Salary, Streaming subscription" />
            </div>
            <div class="ls-form-row two">
              <div>
                <label class="ls-field-label" for="r-freq">Repeats</label>
                <select id="r-freq" name="freq" class="ls-native-input" [(ngModel)]="frequency">
                  <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option>
                </select>
              </div>
              <div>
                <label class="ls-field-label" for="r-int">Every</label>
                <input id="r-int" name="int" class="ls-native-input" type="number" min="1" max="365" [(ngModel)]="interval" />
              </div>
            </div>
            <div class="ls-form-row two">
              <div>
                <label class="ls-field-label" for="r-next">Next date</label>
                <input id="r-next" name="next" class="ls-native-input" type="date" [(ngModel)]="nextDate" />
              </div>
              <div>
                <label class="ls-field-label" for="r-end">End date (optional)</label>
                <input id="r-end" name="end" class="ls-native-input" type="date" [(ngModel)]="endDate" />
              </div>
            </div>
            <div>
              <label class="ls-field-label" for="r-method">Payment method</label>
              <select id="r-method" name="method" class="ls-native-input" [(ngModel)]="method">
                @for (p of methods; track p.value) { <option [value]="p.value">{{ p.label }}</option> }
              </select>
            </div>
            @if (error()) { <div class="ls-field-error">{{ error() }}</div> }
            <div style="display:flex;gap:8px;justify-content:flex-end">
              <ion-button fill="clear" color="medium" (click)="editing.set(null)">Cancel</ion-button>
              <ion-button type="submit" [disabled]="saving()">Save rule</ion-button>
            </div>
          </form>
        }

        @if (rules().length) {
          <div class="ls-card flush">
            @for (r of rules(); track r.id) {
              <div class="ls-row clickable" (click)="edit(r)" (keydown.enter)="edit(r)" tabindex="0" [style.opacity]="r.is_active ? 1 : 0.55">
                <span class="ls-icon-tile sm"><ion-icon name="repeat-outline"></ion-icon></span>
                <div class="grow">
                  <div class="title">{{ r.description || store.category(r.category_id)?.name || 'Recurring ' + r.type }}</div>
                  <div class="meta">
                    <span>{{ freqLabel(r) }}</span>
                    <span>· {{ r.is_active ? 'Next ' + date(r.next_run_date) : 'Paused' }}</span>
                    <app-sync-badge [status]="r._status"></app-sync-badge>
                  </div>
                </div>
                <span class="ls-money" [class.income]="r.type === 'income'">{{ store.format(r.amount, { signed: r.type }) }}</span>
                <button class="ls-icon-btn ghost" (click)="toggleActive(r, $event)" [attr.aria-label]="r.is_active ? 'Pause rule' : 'Resume rule'"><ion-icon [name]="r.is_active ? 'pause-outline' : 'play-outline'"></ion-icon></button>
                <button class="ls-icon-btn ghost" (click)="remove(r, $event)" aria-label="Delete rule"><ion-icon name="trash-outline"></ion-icon></button>
              </div>
            }
          </div>
        } @else if (!editing()) {
          <div class="ls-card"><app-empty-state icon="repeat-outline" title="No recurring transactions" message="Add rent, salary or subscriptions once and LifeSync records them for you." actionText="New rule" (action)="create()"></app-empty-state></div>
        }
      </div>
      <ion-fab slot="fixed" vertical="bottom" horizontal="end" class="ls-fab">
        <ion-fab-button (click)="create()" aria-label="New recurring rule"><ion-icon name="add"></ion-icon></ion-fab-button>
      </ion-fab>
    </ion-content>
  `,
})
export class RecurringPage {
  readonly store = inject(FinanceStore);
  private readonly data = inject(DataService);
  private readonly ui = inject(UiService);

  readonly methods = PAYMENT_METHODS;
  readonly rules = computed(() => [...this.data.list('recurring_transactions')()].sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.next_run_date.localeCompare(b.next_run_date)));
  readonly editing = signal<Partial<RecurringTransaction> | null>(null);
  readonly saving = signal(false);
  readonly error = signal('');
  private readonly typeSig = signal<TxType>('expense');
  readonly categoryOptions = computed(() => this.store.categories().filter((c) => c.type === this.typeSig()));

  get type(): TxType {
    return this.typeSig();
  }
  set type(v: TxType) {
    this.typeSig.set(v);
  }
  amount: number | null = null;
  categoryId: string | null = null;
  description = '';
  frequency: Freq = 'monthly';
  interval = 1;
  nextDate = dateKey();
  endDate = '';
  method: PaymentMethod = 'bank_transfer';

  freqLabel(r: RecurringTransaction) {
    const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[r.frequency];
    return r.interval_count > 1 ? `Every ${r.interval_count} ${unit}s` : `Every ${unit}`;
  }
  date(d: string) {
    return formatDate(d);
  }

  create() {
    this.type = 'expense';
    this.amount = null;
    this.categoryId = null;
    this.description = '';
    this.frequency = 'monthly';
    this.interval = 1;
    this.nextDate = dateKey();
    this.endDate = '';
    this.method = 'bank_transfer';
    this.error.set('');
    this.editing.set({});
  }

  edit(r: RecurringTransaction) {
    this.type = r.type;
    this.amount = Number(r.amount);
    this.categoryId = r.category_id;
    this.description = r.description;
    this.frequency = r.frequency;
    this.interval = r.interval_count;
    this.nextDate = r.next_run_date;
    this.endDate = r.end_date ?? '';
    this.method = r.payment_method;
    this.error.set('');
    this.editing.set(r);
  }

  async save() {
    const amount = Number(this.amount);
    if (!amount || amount <= 0) return this.error.set('Enter an amount greater than zero.');
    if (!this.nextDate) return this.error.set('Choose the next date.');
    if (this.endDate && this.endDate < this.nextDate) return this.error.set('The end date must be after the next date.');
    this.saving.set(true);
    try {
      const values: Partial<RecurringTransaction> = {
        type: this.type,
        amount: Math.round(amount * 100) / 100,
        category_id: this.categoryId,
        description: this.description.trim(),
        frequency: this.frequency,
        interval_count: Math.max(1, Number(this.interval) || 1),
        next_run_date: this.nextDate,
        end_date: this.endDate || null,
        payment_method: this.method,
        is_active: true,
      };
      const id = this.editing()?.id;
      if (id) await this.data.update('recurring_transactions', id, values);
      else await this.data.create('recurring_transactions', values);
      this.editing.set(null);
      await this.ui.success('Recurring rule saved');
    } catch (e) {
      await this.ui.error(e);
    } finally {
      this.saving.set(false);
    }
  }

  async toggleActive(r: RecurringTransaction, ev: Event) {
    ev.stopPropagation();
    await this.data.update('recurring_transactions', r.id, { is_active: !r.is_active });
  }

  async remove(r: RecurringTransaction, ev: Event) {
    ev.stopPropagation();
    const ok = await this.ui.confirm({ header: 'Delete rule?', message: 'Transactions already recorded by this rule are kept.', confirmText: 'Delete', destructive: true });
    if (ok) await this.data.remove('recurring_transactions', r.id);
  }
}
