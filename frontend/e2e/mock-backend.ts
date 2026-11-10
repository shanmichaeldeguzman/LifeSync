import type { BrowserContext, Page, Route } from '@playwright/test';

/**
 * In-memory stand-in for the LifeSync REST API and Supabase Auth used by the
 * end-to-end tests. It implements the same contract as the real backend
 * (sync pull, idempotent create, optimistic-concurrency PATCH, delete).
 */
export const API = 'https://api.e2e.test/api';
export const SUPABASE = 'https://e2e.supabase.test';
export const USER_ID = '11111111-1111-4111-8111-111111111111';

type Row = Record<string, unknown> & { id: string; updated_at: string };

const PATH_TO_TABLE: Record<string, string> = {
  'task-categories': 'task_categories', 'event-categories': 'event_categories', 'note-categories': 'note_categories',
  'transaction-categories': 'transaction_categories', tasks: 'tasks', events: 'events', notes: 'notes',
  'note-attachments': 'note_attachments', habits: 'habits', 'habit-logs': 'habit_logs', transactions: 'transactions',
  'recurring-transactions': 'recurring_transactions', budgets: 'budgets', 'savings-goals': 'savings_goals',
  documents: 'documents', goals: 'goals', 'goal-milestones': 'goal_milestones', notifications: 'notifications',
};

const iso = (d: Date) => d.toISOString();
const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};
const at = (offsetDays: number, hour: number, min = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, min, 0, 0);
  return iso(d);
};
let counter = 0;
const id = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

export class MockBackend {
  tables: Record<string, Row[]> = {};
  requests: { method: string; path: string; body: unknown }[] = [];
  /** Record ids whose next PATCH should be rejected with 409 (conflict simulation). */
  conflictOnce = new Set<string>();

  constructor() {
    for (const t of Object.values(PATH_TO_TABLE)) this.tables[t] = [];
    this.seed();
  }

  private add(table: string, data: Record<string, unknown>): Row {
    const now = iso(new Date(Date.now() - 60_000));
    const row = { id: id(), user_id: USER_ID, created_at: now, updated_at: now, ...data } as Row;
    this.tables[table].push(row);
    return row;
  }

  private seed() {
    const work = this.add('task_categories', { name: 'Work', color: '#0EA5E9', icon: 'briefcase-outline' });
    this.add('task_categories', { name: 'Personal', color: '#635BFF', icon: 'person-outline' });
    const evWork = this.add('event_categories', { name: 'Work', color: '#0EA5E9', icon: 'briefcase-outline' });
    const ideas = this.add('note_categories', { name: 'Ideas', color: '#F59E0B', icon: 'bulb-outline' });
    const salary = this.add('transaction_categories', { name: 'Salary', type: 'income', color: '#22C55E', icon: 'cash-outline' });
    const food = this.add('transaction_categories', { name: 'Food & Dining', type: 'expense', color: '#F97316', icon: 'restaurant-outline' });
    const transport = this.add('transaction_categories', { name: 'Transport', type: 'expense', color: '#0EA5E9', icon: 'car-outline' });
    const housing = this.add('transaction_categories', { name: 'Housing', type: 'expense', color: '#8B5CF6', icon: 'home-outline' });

    const base = { description: '', reminder_at: null, recurrence: 'none', recurrence_interval: 1, recurrence_until: null, completed_at: null };
    this.add('tasks', { ...base, title: 'Prepare quarterly report', priority: 'high', status: 'in_progress', category_id: work.id, due_at: at(0, 17), reminder_at: at(0, 16) });
    this.add('tasks', { ...base, title: 'Reply to client email', priority: 'urgent', status: 'pending', category_id: work.id, due_at: at(-1, 10) });
    this.add('tasks', { ...base, title: 'Book dentist appointment', priority: 'medium', status: 'pending', category_id: null, due_at: at(1, 9) });
    this.add('tasks', { ...base, title: 'Water the plants', priority: 'low', status: 'pending', category_id: null, due_at: at(0, 18), recurrence: 'weekly' });
    this.add('tasks', { ...base, title: 'Renew gym membership', priority: 'medium', status: 'completed', category_id: null, due_at: at(0, 8), completed_at: at(0, 8) });

    const ev = { description: '', location: '', all_day: false, color: null, recurrence_interval: 1, recurrence_until: null };
    this.add('events', { ...ev, title: 'Team standup', category_id: evWork.id, location: 'Video call', start_at: at(0, 9), end_at: at(0, 9, 15), reminder_minutes: 10, recurrence: 'daily' });
    this.add('events', { ...ev, title: 'Project review', category_id: evWork.id, location: 'Room 4B', start_at: at(2, 14), end_at: at(2, 15), reminder_minutes: 30, recurrence: 'none' });
    this.add('events', { ...ev, title: 'Dinner with friends', category_id: null, location: 'Downtown', start_at: at(4, 19), end_at: at(4, 21), reminder_minutes: 60, recurrence: 'none' });

    this.add('notes', { title: 'App ideas', content: '## Ideas\n\n- [x] Habit tracker\n- [ ] Shared grocery list\n\n**Keep it simple.**', category_id: ideas.id, is_pinned: true, is_favorite: true, is_archived: false });
    this.add('notes', { title: 'Reading list', content: '1. Deep Work\n2. Atomic Habits', category_id: null, is_pinned: false, is_favorite: false, is_archived: false });
    this.add('notes', { title: 'Trip packing', content: '- Passport\n- Chargers\n- Sunscreen', category_id: null, is_pinned: false, is_favorite: false, is_archived: false });

    const water = this.add('habits', { name: 'Drink water', description: 'Stay hydrated', icon: 'water-outline', color: '#0EA5E9', frequency: 'daily', days_of_week: [], target_per_week: 7, reminder_time: '09:00:00', start_date: day(-30), is_archived: false });
    const read = this.add('habits', { name: 'Read 20 minutes', description: '', icon: 'book-outline', color: '#8B5CF6', frequency: 'weekly', days_of_week: [], target_per_week: 4, reminder_time: null, start_date: day(-30), is_archived: false });
    this.add('habits', { name: 'Stretch', description: '', icon: 'body-outline', color: '#F97316', frequency: 'custom', days_of_week: [1, 3, 5], target_per_week: 7, reminder_time: null, start_date: day(-30), is_archived: false });
    for (let i = 1; i <= 9; i++) this.add('habit_logs', { habit_id: water.id, log_date: day(-i), note: '' });
    for (const i of [1, 3, 5, 8]) this.add('habit_logs', { habit_id: read.id, log_date: day(-i), note: '' });

    const month = day(0).slice(0, 7);
    const tx = { description: '', payment_method: 'debit_card', entry_source: 'manual', recurring_transaction_id: null };
    this.add('transactions', { ...tx, type: 'income', amount: 3200, category_id: salary.id, description: 'Monthly salary', transaction_date: `${month}-01`, payment_method: 'bank_transfer' });
    this.add('transactions', { ...tx, type: 'expense', amount: 1150, category_id: housing.id, description: 'Rent', transaction_date: `${month}-01`, payment_method: 'bank_transfer' });
    this.add('transactions', { ...tx, type: 'expense', amount: 54.2, category_id: food.id, description: 'Groceries', transaction_date: day(0) });
    this.add('transactions', { ...tx, type: 'expense', amount: 18.75, category_id: food.id, description: 'Lunch', transaction_date: day(0), payment_method: 'cash' });
    this.add('transactions', { ...tx, type: 'expense', amount: 40, category_id: transport.id, description: 'Transit pass', transaction_date: day(0), payment_method: 'e_wallet' });
    this.add('budgets', { month: `${month}-01`, category_id: food.id, limit_amount: 90 });
    this.add('budgets', { month: `${month}-01`, category_id: null, limit_amount: 2000 });
    this.add('savings_goals', { name: 'Emergency fund', target_amount: 5000, current_amount: 1250, target_date: day(180), color: '#22C55E' });

    const goal = this.add('goals', { title: 'Run a 10K', description: 'Build endurance gradually.', category: 'health', target_date: day(45), status: 'active', progress_mode: 'milestones', progress: 0, reminder_at: null, completed_at: null });
    this.add('goal_milestones', { goal_id: goal.id, title: 'Run 3K without stopping', due_date: null, is_completed: true, completed_at: at(-5, 9), position: 0 });
    this.add('goal_milestones', { goal_id: goal.id, title: 'Run 5K', due_date: day(14), is_completed: false, completed_at: null, position: 1 });
    this.add('goals', { title: 'Finish online course', description: '', category: 'academic', target_date: day(20), status: 'active', progress_mode: 'manual', progress: 60, reminder_at: null, completed_at: null });

    this.add('documents', { title: 'Passport', description: '', category: 'identification', storage_path: `${USER_ID}/a-passport.pdf`, file_name: 'passport.pdf', mime_type: 'application/pdf', size_bytes: 482113, expires_at: day(20), remind_days_before: 30 });
    this.add('documents', { title: 'Health insurance card', description: '', category: 'insurance', storage_path: `${USER_ID}/b-card.png`, file_name: 'card.png', mime_type: 'image/png', size_bytes: 120331, expires_at: day(300), remind_days_before: 30 });

    this.add('notifications', { type: 'budget', title: 'Budget at 81%: Food & Dining', body: 'You have used 72.95 of 90.00.', entity_type: 'budget', entity_id: null, read_at: null });
    this.add('notifications', { type: 'document', title: 'Document expiring: Passport', body: 'Expires in 20 days.', entity_type: 'document', entity_id: null, read_at: null });
    this.add('notifications', { type: 'task', title: 'Task reminder: Reply to client email', body: 'Due yesterday', entity_type: 'task', entity_id: null, read_at: iso(new Date()) });
  }

  profile = { id: USER_ID, full_name: 'Alex Morgan', avatar_path: null, timezone: 'UTC', currency: 'USD', created_at: iso(new Date()), updated_at: iso(new Date()) };
  preferences = {
    user_id: USER_ID, theme: 'light', week_starts_on: 1, notify_tasks: true, notify_events: true, notify_habits: true, notify_budgets: true,
    notify_documents: true, notify_goals: true, push_enabled: true, default_event_reminder_minutes: 15, document_reminder_days: 30,
    hide_amounts: false, dashboard_widgets: ['tasks', 'events', 'habits', 'finance', 'goals', 'notes', 'reminders'], updated_at: iso(new Date()),
  };

  async handle(route: Route) {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/api/, '');
    const method = req.method();
    let body: unknown = null;
    try {
      body = req.postDataJSON();
    } catch {
      body = null;
    }
    this.requests.push({ method, path, body });
    const json = (status: number, data: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });

    if (path === '/sync/pull') {
      return json(200, { cursor: iso(new Date()), hasMore: false, serverTime: iso(new Date()), profile: this.profile, preferences: this.preferences, changes: this.tables, deleted: [] });
    }
    if (path === '/finance/recurring/run' || path === '/notifications/refresh') return json(200, { data: { created: 0 } });
    if (path === '/notifications/read-all') {
      for (const n of this.tables['notifications']) if (!n['read_at']) Object.assign(n, { read_at: iso(new Date()), updated_at: iso(new Date()) });
      return json(200, { data: { updated: 1 } });
    }
    if (path === '/preferences' && method === 'PATCH') {
      Object.assign(this.preferences, body, { updated_at: iso(new Date()) });
      return json(200, { data: this.preferences });
    }
    if (path === '/profile' && method === 'PATCH') {
      Object.assign(this.profile, body, { updated_at: iso(new Date()) });
      return json(200, { data: this.profile });
    }

    const [, segment, recordId] = path.split('/');
    const table = PATH_TO_TABLE[segment];
    if (!table) return json(404, { error: { code: 'not_found', message: 'Endpoint not found' } });
    const rows = this.tables[table];

    if (method === 'POST') {
      const data = body as Record<string, unknown>;
      const existing = rows.find((r) => r.id === data['id']);
      if (existing) return json(200, { data: existing });
      const now = iso(new Date());
      const row = { ...data, id: (data['id'] as string) ?? id(), user_id: USER_ID, created_at: now, updated_at: now } as Row;
      rows.push(row);
      return json(201, { data: row });
    }
    const row = rows.find((r) => r.id === recordId);
    if (method === 'PATCH') {
      if (!row) return json(404, { error: { code: 'not_found', message: 'Resource not found' } });
      if (this.conflictOnce.has(row.id)) {
        this.conflictOnce.delete(row.id);
        Object.assign(row, { title: `${row['title']} (edited on phone)`, updated_at: iso(new Date()) });
        return json(409, { error: { code: 'conflict', message: 'This record was changed on another device.', details: { current: row } } });
      }
      const { base_updated_at: _b, ...patch } = body as Record<string, unknown>;
      Object.assign(row, patch, { updated_at: iso(new Date()) });
      return json(200, { data: row });
    }
    if (method === 'DELETE') {
      if (!row) return json(404, { error: { code: 'not_found', message: 'Resource not found' } });
      this.tables[table] = rows.filter((r) => r.id !== recordId);
      return route.fulfill({ status: 204 });
    }
    return json(200, { data: rows, meta: { page: 1, limit: 50, total: rows.length, totalPages: 1 } });
  }
}

/** A JWT-shaped token (the mock API does not verify signatures). */
function fakeJwt(): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER_ID, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.c2lnbmF0dXJl`;
}

/** Installs the mock backend and (optionally) a signed-in Supabase session. */
export async function setup(context: BrowserContext, opts: { signedIn?: boolean; theme?: 'light' | 'dark' } = {}): Promise<MockBackend> {
  const backend = new MockBackend();
  await context.route(`${API}/**`, (route) => backend.handle(route));
  await context.route(`${SUPABASE}/**`, (route) => {
    const url = route.request().url();
    if (url.includes('/storage/v1/object/')) return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await context.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  if (opts.signedIn !== false) {
    const session = {
      access_token: fakeJwt(), refresh_token: 'refresh', token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'alex@example.com', user_metadata: { full_name: 'Alex Morgan' }, app_metadata: {}, created_at: iso(new Date()) },
    };
    await context.addInitScript(
      ([s, theme]) => {
        localStorage.setItem('lifesync-auth', s as string);
        localStorage.setItem('lifesync-theme', theme as string);
      },
      [JSON.stringify(session), opts.theme ?? 'light'],
    );
  }
  return backend;
}

/** Collects uncaught page errors so tests can assert the app ran cleanly. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED|net::/.test(m.text())) errors.push(m.text());
  });
  return errors;
}
