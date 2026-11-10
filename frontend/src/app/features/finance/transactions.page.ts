import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonBackButton, IonButtons, IonContent, IonFab, IonFabButton, IonHeader, IonIcon, IonSearchbar, IonTitle, IonToolbar, ModalController } from '@ionic/angular';
import type { PaymentMethod, Transaction, TxType } from '../../core/models';
import { ApiService } from '../../core/services/api.service';
import { NetworkService } from '../../core/services/network.service';
import { UiService } from '../../core/services/ui.service';
import { relativeDay } from '../../core/utils/date';
import { saveFile } from '../../core/utils/files';
import { PAYMENT_METHODS } from '../../core/utils/format';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { SyncBadgeComponent } from '../../shared/components/sync-badge.component';
import { FinanceStore, transactionsCsv } from './finance.store';
import { TransactionFormModal } from './transaction-form.modal';

const PAGE = 60;

@Component({
  selector: 'app-transactions',
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent, IonIcon, IonFab, IonFabButton, IonSearchbar, FormsModule, EmptyStateComponent, SyncBadgeComponent],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/finance" text=""></ion-back-button></ion-buttons>
        <ion-title>Transactions</ion-title>
        <ion-buttons slot="end">
          <button class="ls-icon-btn ghost" (click)="exportCsv()" aria-label="Export filtered transactions to CSV" title="Export CSV"><ion-icon name="download-outline"></ion-icon></button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <div class="ls-page">
        <ion-searchbar class="ls-search" placeholder="Search descriptions" [debounce]="200" (ionInput)="search.set($any($event).detail.value ?? '')" aria-label="Search transactions"></ion-searchbar>
        <div class="filters">
          <select class="ls-native-input" [ngModel]="type()" (ngModelChange)="type.set($event); category.set('')" aria-label="Type">
            <option value="">All types</option><option value="expense">Expenses</option><option value="income">Income</option>
          </select>
          <select class="ls-native-input" [ngModel]="category()" (ngModelChange)="category.set($event)" aria-label="Category">
            <option value="">All categories</option>
            <option value="none">Uncategorized</option>
            @for (c of categoryOptions(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }
          </select>
          <select class="ls-native-input" [ngModel]="method()" (ngModelChange)="method.set($event)" aria-label="Payment method">
            <option value="">All methods</option>
            @for (p of methods; track p.value) { <option [value]="p.value">{{ p.label }}</option> }
          </select>
          <input class="ls-native-input" type="date" [ngModel]="from()" (ngModelChange)="from.set($event)" aria-label="From date" />
          <input class="ls-native-input" type="date" [ngModel]="to()" (ngModelChange)="to.set($event)" aria-label="To date" />
        </div>

        <div class="summary ls-card">
          <div><span class="ls-muted ls-small">Showing</span><strong>{{ filtered().length }}</strong></div>
          <div><span class="ls-muted ls-small">Income</span><strong class="ls-money income">{{ store.format(sum().income) }}</strong></div>
          <div><span class="ls-muted ls-small">Expenses</span><strong class="ls-money">{{ store.format(sum().expense) }}</strong></div>
          @if (hasFilters()) { <button class="link" (click)="clear()">Clear filters</button> }
        </div>

        @for (g of groups(); track g.date) {
          <div class="ls-group-label" style="display:flex;justify-content:space-between"><span>{{ g.label }}</span><span>{{ store.format(g.net) }}</span></div>
          <div class="ls-card flush">
            @for (t of g.items; track t.id) {
              <div class="ls-row clickable" (click)="edit(t)" (keydown.enter)="edit(t)" tabindex="0">
                <span class="ls-icon-tile sm" [style.background]="color(t) + '1f'" [style.color]="color(t)"><ion-icon [name]="store.category(t.category_id)?.icon ?? 'wallet-outline'"></ion-icon></span>
                <div class="grow">
                  <div class="title">{{ t.description || store.category(t.category_id)?.name || (t.type === 'income' ? 'Income' : 'Expense') }}</div>
                  <div class="meta">
                    <span>{{ store.category(t.category_id)?.name ?? 'Uncategorized' }}</span>
                    <span>· {{ methodLabel(t.payment_method) }}</span>
                    @if (t.entry_source === 'recurring_rule') { <span class="ls-chip"><ion-icon name="repeat-outline"></ion-icon>Recurring</span> }
                  </div>
                </div>
                <app-sync-badge [status]="t._status"></app-sync-badge>
                <span class="ls-money" [class.income]="t.type === 'income'">{{ store.format(t.amount, { signed: t.type }) }}</span>
              </div>
            }
          </div>
        } @empty {
          <div class="ls-card">
            <app-empty-state [icon]="hasFilters() ? 'search-outline' : 'wallet-outline'" [title]="hasFilters() ? 'No matching transactions' : 'No transactions yet'" [message]="hasFilters() ? 'Try adjusting your filters.' : 'Record income and expenses to see your history.'" [actionText]="hasFilters() ? '' : 'Add transaction'" (action)="add()"></app-empty-state>
          </div>
        }
        @if (filtered().length > shown()) {
          <div style="text-align:center;margin-top:16px"><button class="link" (click)="shown.set(shown() + page)">Show more ({{ filtered().length - shown() }} remaining)</button></div>
        }
      </div>
      <ion-fab slot="fixed" vertical="bottom" horizontal="end" class="ls-fab">
        <ion-fab-button (click)="add()" aria-label="Add transaction"><ion-icon name="add"></ion-icon></ion-fab-button>
      </ion-fab>
    </ion-content>
  `,
  styles: `
    .filters { display: grid; gap: 8px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin: 12px 0; }
    .filters > * { min-height: 42px; font-size: 0.86rem; }
    @media (min-width: 900px) { .filters { grid-template-columns: repeat(5, minmax(0, 1fr)); } }
    .summary { display: flex; gap: 22px; align-items: center; flex-wrap: wrap; padding: 12px 16px; }
    .summary div { display: flex; flex-direction: column; }
    .link { background: none; border: 0; color: var(--ion-color-primary); font: inherit; font-weight: 600; font-size: 0.86rem; cursor: pointer; margin-left: auto; }
  `,
})
export class TransactionsPage {
  readonly store = inject(FinanceStore);
  private readonly modal = inject(ModalController);
  private readonly api = inject(ApiService);
  private readonly network = inject(NetworkService);
  private readonly ui = inject(UiService);

  readonly methods = PAYMENT_METHODS;
  readonly page = PAGE;
  readonly search = signal('');
  readonly type = signal<'' | TxType>('');
  readonly category = signal('');
  readonly method = signal<'' | PaymentMethod>('');
  readonly from = signal('');
  readonly to = signal('');
  readonly shown = signal(PAGE);

  readonly categoryOptions = computed(() => this.store.categories().filter((c) => !this.type() || c.type === this.type()).sort((a, b) => a.name.localeCompare(b.name)));
  readonly hasFilters = computed(() => !!(this.search() || this.type() || this.category() || this.method() || this.from() || this.to()));

  readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    return this.store
      .transactions()
      .filter((t) => !this.type() || t.type === this.type())
      .filter((t) => !this.category() || (this.category() === 'none' ? !t.category_id : t.category_id === this.category()))
      .filter((t) => !this.method() || t.payment_method === this.method())
      .filter((t) => !this.from() || t.transaction_date >= this.from())
      .filter((t) => !this.to() || t.transaction_date <= this.to())
      .filter((t) => !q || t.description.toLowerCase().includes(q) || (this.store.category(t.category_id)?.name ?? '').toLowerCase().includes(q))
      .sort((a, b) => b.transaction_date.localeCompare(a.transaction_date) || b.created_at.localeCompare(a.created_at));
  });

  readonly sum = computed(() => {
    let income = 0;
    let expense = 0;
    for (const t of this.filtered()) t.type === 'income' ? (income += Number(t.amount)) : (expense += Number(t.amount));
    return { income, expense };
  });

  readonly groups = computed(() => {
    const out: { date: string; label: string; net: number; items: Transaction[] }[] = [];
    for (const t of this.filtered().slice(0, this.shown())) {
      let g = out[out.length - 1];
      if (!g || g.date !== t.transaction_date) {
        g = { date: t.transaction_date, label: relativeDay(t.transaction_date), net: 0, items: [] };
        out.push(g);
      }
      g.items.push(t);
      g.net += (t.type === 'income' ? 1 : -1) * Number(t.amount);
    }
    return out;
  });

  color(t: Transaction) {
    return this.store.category(t.category_id)?.color ?? '#94A3B8';
  }
  methodLabel(m: PaymentMethod) {
    return PAYMENT_METHODS.find((p) => p.value === m)?.label ?? m;
  }
  clear() {
    this.search.set('');
    this.type.set('');
    this.category.set('');
    this.method.set('');
    this.from.set('');
    this.to.set('');
  }

  async add() {
    const m = await this.modal.create({ component: TransactionFormModal, cssClass: 'ls-modal' });
    await m.present();
  }
  async edit(t: Transaction) {
    const m = await this.modal.create({ component: TransactionFormModal, componentProps: { tx: t }, cssClass: 'ls-modal' });
    await m.present();
  }

  /** Exports what's on screen. Uses the server export when online and unfiltered (complete history). */
  async exportCsv() {
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      if (this.network.online() && !this.search() && !this.category() && !this.method()) {
        const blob = await this.api.getBlob('/finance/export.csv', { from: this.from(), to: this.to(), type: this.type() });
        await saveFile(blob, `lifesync-transactions-${stamp}.csv`, 'text/csv');
      } else {
        const csv = transactionsCsv(this.filtered(), (id) => this.store.category(id)?.name ?? 'Uncategorized');
        await saveFile(csv, `lifesync-transactions-${stamp}.csv`, 'text/csv');
      }
      await this.ui.success('Export ready');
    } catch (e) {
      await this.ui.error(e, 'Export failed.');
    }
  }
}
