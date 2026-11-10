import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonBackButton, IonButton, IonButtons, IonContent, IonFab, IonFabButton, IonHeader, IonIcon, IonTitle, IonToolbar } from '@ionic/angular';
import { DataService } from '../../core/data/data.service';
import type { Budget } from '../../core/models';
import { UiService } from '../../core/services/ui.service';
import { addMonths, monthKey, parseDateKey } from '../../core/utils/date';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { SyncBadgeComponent } from '../../shared/components/sync-badge.component';
import { FinanceStore } from './finance.store';

@Component({
  selector: 'app-budgets',
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonButton, IonContent, IonIcon, IonFab, IonFabButton, FormsModule, EmptyStateComponent, SyncBadgeComponent],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/finance" text=""></ion-back-button></ion-buttons>
        <ion-title>Budgets</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <div class="ls-page narrow">
        <div class="month-nav">
          <button class="ls-icon-btn" (click)="shift(-1)" aria-label="Previous month"><ion-icon name="chevron-back"></ion-icon></button>
          <h2>{{ monthLabel() }}</h2>
          <button class="ls-icon-btn" (click)="shift(1)" aria-label="Next month"><ion-icon name="chevron-forward"></ion-icon></button>
        </div>
        <p class="ls-muted ls-small" style="text-align:center;margin-top:0">You'll get a notification when spending reaches 80% and 100% of a budget.</p>

        @if (editing()) {
          <form class="ls-card ls-form" (ngSubmit)="save()" style="margin-bottom:16px">
            <h3 style="font-size:1rem">{{ editing()!.id ? 'Edit budget' : 'New budget' }}</h3>
            <div>
              <label class="ls-field-label" for="b-cat">Applies to</label>
              <select id="b-cat" name="cat" class="ls-native-input" [(ngModel)]="formCategory" [disabled]="!!editing()!.id">
                <option [ngValue]="null">All spending (overall budget)</option>
                @for (c of expenseCategories(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }
              </select>
            </div>
            <div>
              <label class="ls-field-label" for="b-limit">Monthly limit ({{ store.currency() }})</label>
              <input id="b-limit" name="limit" class="ls-native-input" type="number" min="0.01" step="0.01" inputmode="decimal" [(ngModel)]="formLimit" [class.invalid]="error()" />
              @if (error()) { <div class="ls-field-error">{{ error() }}</div> }
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end">
              <ion-button fill="clear" color="medium" (click)="editing.set(null)">Cancel</ion-button>
              <ion-button type="submit" [disabled]="saving()">Save budget</ion-button>
            </div>
          </form>
        }

        @if (rows().length) {
          <div class="ls-card flush">
            @for (r of rows(); track r.budget.id) {
              <div class="ls-row clickable" (click)="edit(r.budget)" (keydown.enter)="edit(r.budget)" tabindex="0">
                <div class="grow">
                  <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
                    <span class="title">{{ r.name }}</span>
                    <span class="ls-chip" [class]="'ls-chip ' + r.tone">{{ r.pct }}%</span>
                  </div>
                  <div class="ls-progress" [class]="'ls-progress ' + r.tone" style="margin:8px 0 6px"><span [style.width.%]="r.pct > 100 ? 100 : r.pct"></span></div>
                  <div class="meta">
                    <span>{{ store.format(r.spent) }} of {{ store.format(r.limit) }}</span>
                    <span>· {{ r.remaining >= 0 ? store.format(r.remaining) + ' left' : store.format(-r.remaining) + ' over' }}</span>
                    <app-sync-badge [status]="r.budget._status"></app-sync-badge>
                  </div>
                </div>
                <button class="ls-icon-btn ghost" (click)="remove(r.budget, $event)" aria-label="Delete budget"><ion-icon name="trash-outline"></ion-icon></button>
              </div>
            }
          </div>
        } @else if (!editing()) {
          <div class="ls-card">
            <app-empty-state icon="pie-chart-outline" title="No budgets this month" message="Set an overall limit or per-category limits to stay on track." actionText="Create budget" (action)="create()"></app-empty-state>
            @if (previousCount()) {
              <div style="text-align:center"><ion-button fill="outline" size="small" (click)="copyPrevious()">Copy {{ previousCount() }} budget(s) from last month</ion-button></div>
            }
          </div>
        }
      </div>
      <ion-fab slot="fixed" vertical="bottom" horizontal="end" class="ls-fab">
        <ion-fab-button (click)="create()" aria-label="New budget"><ion-icon name="add"></ion-icon></ion-fab-button>
      </ion-fab>
    </ion-content>
  `,
  styles: `
    .month-nav { display: flex; align-items: center; justify-content: center; gap: 16px; margin: 8px 0; }
    .month-nav h2 { font-size: 1.2rem; font-weight: 750; min-width: 170px; text-align: center; }
  `,
})
export class BudgetsPage {
  readonly store = inject(FinanceStore);
  private readonly data = inject(DataService);
  private readonly ui = inject(UiService);

  readonly month = signal(monthKey());
  readonly monthLabel = computed(() => parseDateKey(`${this.month()}-01`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));
  readonly expenseCategories = computed(() => this.store.categories().filter((c) => c.type === 'expense').sort((a, b) => a.name.localeCompare(b.name)));
  readonly editing = signal<Partial<Budget> | null>(null);
  readonly saving = signal(false);
  readonly error = signal('');
  formCategory: string | null = null;
  formLimit: number | null = null;

  private budgetsFor(month: string) {
    return this.data.list('budgets')().filter((b) => b.month === `${month}-01`);
  }

  readonly rows = computed(() =>
    this.budgetsFor(this.month())
      .map((b) => {
        const spent = this.store.spent(this.month(), b.category_id);
        const limit = Number(b.limit_amount);
        const pct = Math.round((spent / limit) * 100);
        return { budget: b, name: b.category_id ? (this.store.category(b.category_id)?.name ?? 'Category') : 'Overall budget', spent, limit, pct, remaining: limit - spent, tone: pct >= 100 ? 'danger' : pct >= 80 ? 'warning' : 'success' };
      })
      .sort((a, b) => (a.budget.category_id === null ? -1 : b.budget.category_id === null ? 1 : b.pct - a.pct)),
  );

  readonly previousCount = computed(() => this.budgetsFor(monthKey(addMonths(parseDateKey(`${this.month()}-01`), -1))).length);

  shift(n: number) {
    this.month.set(monthKey(addMonths(parseDateKey(`${this.month()}-01`), n)));
    this.editing.set(null);
  }

  create() {
    this.formCategory = null;
    this.formLimit = null;
    this.error.set('');
    this.editing.set({});
  }

  edit(b: Budget) {
    this.formCategory = b.category_id;
    this.formLimit = Number(b.limit_amount);
    this.error.set('');
    this.editing.set(b);
  }

  async save() {
    const limit = Number(this.formLimit);
    if (!limit || limit <= 0) return this.error.set('Enter a limit greater than zero.');
    const existing = this.budgetsFor(this.month()).find((b) => b.category_id === this.formCategory && b.id !== this.editing()?.id);
    if (existing) return this.error.set('A budget for this category already exists this month.');
    this.saving.set(true);
    try {
      const id = this.editing()?.id;
      if (id) await this.data.update('budgets', id, { limit_amount: Math.round(limit * 100) / 100 });
      else await this.data.create('budgets', { month: `${this.month()}-01`, category_id: this.formCategory, limit_amount: Math.round(limit * 100) / 100 });
      this.editing.set(null);
      await this.ui.success('Budget saved');
    } catch (e) {
      await this.ui.error(e);
    } finally {
      this.saving.set(false);
    }
  }

  async remove(b: Budget, ev: Event) {
    ev.stopPropagation();
    const ok = await this.ui.confirm({ header: 'Delete budget?', message: 'Your transactions are not affected.', confirmText: 'Delete', destructive: true });
    if (ok) await this.data.remove('budgets', b.id);
  }

  async copyPrevious() {
    const prev = this.budgetsFor(monthKey(addMonths(parseDateKey(`${this.month()}-01`), -1)));
    for (const b of prev) await this.data.create('budgets', { month: `${this.month()}-01`, category_id: b.category_id, limit_amount: b.limit_amount });
    await this.ui.success(`Copied ${prev.length} budget(s)`);
  }
}
