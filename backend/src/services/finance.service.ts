import { z } from 'zod';
import type { AuthContext } from '../middleware/auth.js';
import { fromDbError } from '../utils/http-error.js';
import { toCsv } from '../utils/csv.js';

const MonthParam = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM')
  .optional();

interface TxRow {
  id: string;
  type: 'income' | 'expense';
  amount: string | number;
  category_id: string | null;
  transaction_date: string;
  description: string;
  payment_method: string;
  entry_source: string;
  category?: { name: string } | null;
}

const monthStart = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}-01`;
const addMonths = (y: number, m: number, delta: number): [number, number] => {
  const idx = y * 12 + (m - 1) + delta;
  return [Math.floor(idx / 12), (idx % 12) + 1];
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Monthly totals, category breakdown, budget usage and a 6-month income/expense trend. */
export async function monthlySummary(ctx: AuthContext, monthRaw: unknown) {
  const now = new Date();
  const month = MonthParam.parse(monthRaw) ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const [y, m] = month.split('-').map(Number);
  const [fy, fm] = addMonths(y, m, -5);
  const [ny, nm] = addMonths(y, m, 1);
  const rangeStart = monthStart(fy, fm);
  const currentStart = monthStart(y, m);
  const rangeEnd = monthStart(ny, nm);

  const [txRes, budgetRes, catRes] = await Promise.all([
    ctx.db
      .from('transactions')
      .select('id, type, amount, category_id, transaction_date')
      .gte('transaction_date', rangeStart)
      .lt('transaction_date', rangeEnd)
      .limit(10000),
    ctx.db.from('budgets').select('*').eq('month', currentStart),
    ctx.db.from('transaction_categories').select('id, name, color, type'),
  ]);
  for (const r of [txRes, budgetRes, catRes]) if (r.error) throw fromDbError(r.error);

  const txs = (txRes.data ?? []) as TxRow[];
  const categories = new Map((catRes.data ?? []).map((c) => [c.id as string, c]));

  const trend: { month: string; income: number; expense: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const [ty, tm] = addMonths(fy, fm, i);
    trend.push({ month: `${ty}-${String(tm).padStart(2, '0')}`, income: 0, expense: 0 });
  }
  const byCategory = new Map<string, number>();
  let income = 0;
  let expense = 0;

  for (const t of txs) {
    const amount = Number(t.amount);
    const bucket = trend.find((b) => t.transaction_date.startsWith(b.month));
    if (bucket) bucket[t.type] += amount;
    if (t.transaction_date >= currentStart) {
      if (t.type === 'income') income += amount;
      else {
        expense += amount;
        const key = t.category_id ?? 'uncategorized';
        byCategory.set(key, (byCategory.get(key) ?? 0) + amount);
      }
    }
  }

  const spendingByCategory = [...byCategory.entries()]
    .map(([id, total]) => ({
      category_id: id === 'uncategorized' ? null : id,
      name: categories.get(id)?.name ?? 'Uncategorized',
      color: categories.get(id)?.color ?? '#94A3B8',
      total: round2(total),
    }))
    .sort((a, b) => b.total - a.total);

  const budgets = (budgetRes.data ?? []).map((b) => {
    const spent = b.category_id ? (byCategory.get(b.category_id) ?? 0) : expense;
    const limit = Number(b.limit_amount);
    return {
      ...b,
      category_name: b.category_id ? (categories.get(b.category_id)?.name ?? 'Category') : 'Overall',
      spent: round2(spent),
      remaining: round2(limit - spent),
      percent: Math.round((spent / limit) * 100),
    };
  });

  return {
    month,
    totals: { income: round2(income), expense: round2(expense), net: round2(income - expense) },
    spendingByCategory,
    budgets,
    trend: trend.map((t) => ({ ...t, income: round2(t.income), expense: round2(t.expense) })),
    disclaimer: 'All figures are calculated from transactions you recorded manually in LifeSync. No bank data is used.',
  };
}

const ExportQuery = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  type: z.enum(['income', 'expense']).optional(),
});

/** CSV export of the caller's manually-recorded transactions. */
export async function exportTransactionsCsv(ctx: AuthContext, query: unknown): Promise<string> {
  const { from, to, type } = ExportQuery.parse(query);
  const rows: TxRow[] = [];
  const page = 1000;
  for (let offset = 0; offset < 50_000; offset += page) {
    let q = ctx.db
      .from('transactions')
      .select('id, type, amount, category_id, transaction_date, description, payment_method, entry_source, category:transaction_categories(name)');
    if (from) q = q.gte('transaction_date', from);
    if (to) q = q.lte('transaction_date', to);
    if (type) q = q.eq('type', type);
    const { data, error } = await q
      .order('transaction_date', { ascending: false })
      .order('id')
      .range(offset, offset + page - 1);
    if (error) throw fromDbError(error);
    rows.push(...((data ?? []) as unknown as TxRow[]));
    if (!data || data.length < page) break;
  }

  return toCsv(
    ['Date', 'Type', 'Amount', 'Category', 'Description', 'Payment method', 'Source'],
    rows.map((r) => [
      r.transaction_date,
      r.type,
      Number(r.amount).toFixed(2),
      r.category?.name ?? 'Uncategorized',
      r.description,
      r.payment_method.replace('_', ' '),
      r.entry_source === 'recurring_rule' ? 'Manual (recurring rule)' : 'Manual entry',
    ]),
  );
}

export async function runRecurring(ctx: AuthContext): Promise<number> {
  const { data, error } = await ctx.db.rpc('run_my_recurring_transactions');
  if (error) throw fromDbError(error);
  return Number(data ?? 0);
}
