import { Injectable, computed, inject } from '@angular/core';
import { DataService } from '../../core/data/data.service';
import type { Transaction, TransactionCategory } from '../../core/models';
import { money } from '../../core/utils/format';

export interface CategoryTotal {
  id: string | null;
  name: string;
  color: string;
  total: number;
}

/** Finance computations over the local (offline-capable) transaction cache. */
@Injectable({ providedIn: 'root' })
export class FinanceStore {
  private readonly data = inject(DataService);

  readonly transactions = this.data.list('transactions');
  readonly categories = this.data.list('transaction_categories');
  readonly currency = computed(() => this.data.profile()?.currency ?? 'USD');
  readonly hidden = computed(() => this.data.preferences()?.hide_amounts ?? false);

  format(amount: number | string, opts?: { signed?: 'income' | 'expense' }): string {
    const s = money(amount, this.currency(), this.hidden());
    if (!opts?.signed || this.hidden()) return s;
    return opts.signed === 'income' ? `+${s}` : `−${s}`;
  }

  category(id: string | null | undefined): TransactionCategory | undefined {
    return this.data.find('transaction_categories', id);
  }

  inMonth(month: string): Transaction[] {
    return this.transactions().filter((t) => t.transaction_date.startsWith(month));
  }

  totals(month: string) {
    let income = 0;
    let expense = 0;
    for (const t of this.inMonth(month)) {
      if (t.type === 'income') income += Number(t.amount);
      else expense += Number(t.amount);
    }
    return { income, expense, net: income - expense, savingsRate: income > 0 ? Math.round(((income - expense) / income) * 100) : 0 };
  }

  spendingByCategory(month: string): CategoryTotal[] {
    const map = new Map<string, number>();
    for (const t of this.inMonth(month)) {
      if (t.type !== 'expense') continue;
      const k = t.category_id ?? 'none';
      map.set(k, (map.get(k) ?? 0) + Number(t.amount));
    }
    return [...map.entries()]
      .map(([id, total]) => {
        const c = id === 'none' ? undefined : this.category(id);
        return { id: id === 'none' ? null : id, name: c?.name ?? 'Uncategorized', color: c?.color ?? '#94A3B8', total };
      })
      .sort((a, b) => b.total - a.total);
  }

  /** Spent so far in a month for a category (null = all expenses). */
  spent(month: string, categoryId: string | null): number {
    return this.inMonth(month)
      .filter((t) => t.type === 'expense' && (categoryId === null || t.category_id === categoryId))
      .reduce((s, t) => s + Number(t.amount), 0);
  }

  trend(endMonth: string, months = 6) {
    const [y, m] = endMonth.split('-').map(Number);
    const out: { month: string; label: string; income: number; expense: number }[] = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(y, m - 1 - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const t = this.totals(key);
      out.push({ month: key, label: d.toLocaleDateString(undefined, { month: 'short' }), income: t.income, expense: t.expense });
    }
    return out;
  }
}

/** CSV for the given transactions (built locally, so export also works offline). */
export function transactionsCsv(rows: Transaction[], categoryName: (id: string | null) => string): string {
  const esc = (v: string | number) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = ['Date', 'Type', 'Amount', 'Category', 'Description', 'Payment method', 'Source'];
  const lines = rows
    .slice()
    .sort((a, b) => b.transaction_date.localeCompare(a.transaction_date))
    .map((t) =>
      [
        t.transaction_date,
        t.type,
        Number(t.amount).toFixed(2),
        categoryName(t.category_id),
        t.description,
        t.payment_method.replace('_', ' '),
        t.entry_source === 'recurring_rule' ? 'Manual (recurring rule)' : 'Manual entry',
      ]
        .map(esc)
        .join(','),
    );
  return '﻿' + [header.join(','), ...lines].join('\r\n') + '\r\n';
}
