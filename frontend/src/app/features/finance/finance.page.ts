import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonButtons, IonContent, IonFab, IonFabButton, IonHeader, IonIcon, IonTitle, IonToolbar, ModalController } from '@ionic/angular';
import type { ChartData, ChartOptions } from 'chart.js';
import { DataService } from '../../core/data/data.service';
import type { Transaction } from '../../core/models';
import { addMonths, monthKey, monthStartKey, parseDateKey, relativeDay } from '../../core/utils/date';
import { saveFile } from '../../core/utils/files';
import { CategoryManagerModal } from '../../shared/components/category-manager.modal';
import { ChartComponent } from '../../shared/components/chart.component';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { HeaderActionsComponent } from '../../shared/components/header-actions.component';
import { SyncBadgeComponent } from '../../shared/components/sync-badge.component';
import { FinanceStore, transactionsCsv } from './finance.store';
import { TransactionFormModal } from './transaction-form.modal';

@Component({
  selector: 'app-finance',
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonContent, IonIcon, IonFab, IonFabButton, RouterLink, ChartComponent, EmptyStateComponent, HeaderActionsComponent, SyncBadgeComponent],
  templateUrl: './finance.page.html',
  styles: `
    .month-nav { display: flex; align-items: center; gap: 6px; }
    .month-nav strong { min-width: 130px; text-align: center; }
    .links { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 18px 0; }
    @media (min-width: 900px) { .links { grid-template-columns: repeat(6, minmax(0, 1fr)); } }
    .link-tile { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 14px 6px; border-radius: var(--ls-radius); background: var(--ls-surface); border: 1px solid var(--ls-border); color: var(--ls-text); text-decoration: none; font-size: 0.8rem; font-weight: 600; cursor: pointer; font-family: inherit; }
    .link-tile:hover { border-color: var(--ls-border-strong); }
    .link-tile ion-icon { font-size: 22px; color: var(--ion-color-primary); }
    .budget { margin-bottom: 14px; }
    .budget .row { display: flex; justify-content: space-between; font-size: 0.86rem; margin-bottom: 6px; gap: 8px; }
    .legend { display: grid; gap: 8px; margin-top: 12px; }
    .legend div { display: flex; align-items: center; gap: 8px; font-size: 0.85rem; }
    .legend .amt { margin-left: auto; font-weight: 700; font-variant-numeric: tabular-nums; }
    .two-col { display: grid; gap: 16px; grid-template-columns: 1fr; margin-top: 16px; }
    @media (min-width: 1024px) { .two-col { grid-template-columns: 3fr 2fr; } }
  `,
})
export class FinancePage {
  readonly store = inject(FinanceStore);
  private readonly data = inject(DataService);
  private readonly modal = inject(ModalController);

  readonly month = signal(monthKey());
  readonly monthLabel = computed(() => parseDateKey(`${this.month()}-01`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));
  readonly isCurrent = computed(() => this.month() === monthKey());
  readonly totals = computed(() => this.store.totals(this.month()));
  readonly breakdown = computed(() => this.store.spendingByCategory(this.month()));
  readonly recent = computed(() => [...this.store.inMonth(this.month())].sort((a, b) => b.transaction_date.localeCompare(a.transaction_date) || b.created_at.localeCompare(a.created_at)).slice(0, 6));

  readonly budgets = computed(() => {
    const m = `${this.month()}-01`;
    return this.data
      .list('budgets')()
      .filter((b) => b.month === m)
      .map((b) => {
        const spent = this.store.spent(this.month(), b.category_id);
        const limit = Number(b.limit_amount);
        const pct = Math.round((spent / limit) * 100);
        return { id: b.id, name: b.category_id ? (this.store.category(b.category_id)?.name ?? 'Category') : 'Overall budget', spent, limit, pct, tone: pct >= 100 ? 'danger' : pct >= 80 ? 'warning' : 'success' };
      })
      .sort((a, b) => b.pct - a.pct);
  });

  readonly savings = computed(() => this.data.list('savings_goals')());
  readonly savingsTotal = computed(() => this.savings().reduce((s, g) => s + Number(g.current_amount), 0));

  readonly trendChart = computed<ChartData>(() => {
    const t = this.store.trend(this.month());
    return {
      labels: t.map((x) => x.label),
      datasets: [
        { label: 'Income', data: t.map((x) => x.income), backgroundColor: '#22C55E', borderRadius: 6, maxBarThickness: 22 },
        { label: 'Expenses', data: t.map((x) => x.expense), backgroundColor: '#635BFF', borderRadius: 6, maxBarThickness: 22 },
      ],
    };
  });

  readonly breakdownChart = computed<ChartData>(() => ({
    labels: this.breakdown().map((b) => b.name),
    datasets: [{ data: this.breakdown().map((b) => Math.round(b.total * 100) / 100), backgroundColor: this.breakdown().map((b) => b.color), borderWidth: 0 }],
  }));

  readonly doughnutOptions = { cutout: '68%', plugins: { legend: { display: false } } } as ChartOptions;

  moneyTick = (v: string | number) => (this.store.hidden() ? '' : Number(v).toLocaleString());

  shift(n: number) {
    this.month.set(monthKey(addMonths(parseDateKey(`${this.month()}-01`), n)));
  }

  label(t: Transaction) {
    return t.description || this.store.category(t.category_id)?.name || (t.type === 'income' ? 'Income' : 'Expense');
  }
  day(t: Transaction) {
    return relativeDay(t.transaction_date);
  }

  async add(type: 'income' | 'expense' = 'expense') {
    const m = await this.modal.create({ component: TransactionFormModal, componentProps: { initialType: type }, cssClass: 'ls-modal' });
    await m.present();
  }
  async edit(t: Transaction) {
    const m = await this.modal.create({ component: TransactionFormModal, componentProps: { tx: t }, cssClass: 'ls-modal' });
    await m.present();
  }
  async manageCategories() {
    const m = await this.modal.create({ component: CategoryManagerModal, componentProps: { table: 'transaction_categories', title: 'Finance categories' }, cssClass: 'ls-modal' });
    await m.present();
  }
  async exportMonth() {
    const rows = this.store.inMonth(this.month());
    const csv = transactionsCsv(rows, (id) => this.store.category(id)?.name ?? 'Uncategorized');
    await saveFile(csv, `lifesync-transactions-${this.month()}.csv`, 'text/csv');
  }

  protected readonly monthStartKey = monthStartKey;
}
