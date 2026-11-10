import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { setup, trackErrors } from './mock-backend';

const SHOTS = process.env['SCREENSHOT_DIR'];
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(450); // let enter animations settle
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** The visible page (Ionic keeps previous pages in the DOM, hidden). */
const active = (page: Page) => page.locator('.ion-page:not(.ion-page-hidden)').last();

test.describe('signed-out', () => {
  test('shows the login screen and validates input', async ({ page, context }, info) => {
    await setup(context, { signedIn: false });
    const errors = trackErrors(page);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/auth\/login/);
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Enter a valid email address.')).toBeVisible();
    await shot(page, `${info.project.name}-login`);
    await page.getByRole('link', { name: 'Create an account' }).click();
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
    await active(page).locator('#password').fill('short');
    await active(page).getByRole('button', { name: 'Create account' }).click();
    await expect(active(page).getByText('Use at least 8 characters with letters and numbers.')).toBeVisible();
    await shot(page, `${info.project.name}-register`);
    expect(errors).toEqual([]);
  });
});

test.describe('signed-in', () => {
  test('renders every module without runtime errors', async ({ page, context }, info) => {
    test.setTimeout(150_000);
    await setup(context);
    const errors = trackErrors(page);
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: /, Alex$/ })).toBeVisible();
    await expect(active(page).getByText('Prepare quarterly report').first()).toBeVisible();
    await shot(page, `${info.project.name}-dashboard`);

    const pages: [string, RegExp | string][] = [
      ['/tasks', 'Prepare quarterly report'],
      ['/calendar', 'Events and tasks together'],
      ['/notes', 'App ideas'],
      ['/habits', 'Drink water'],
      ['/finance', 'Recent transactions'],
      ['/finance/transactions', 'Groceries'],
      ['/finance/budgets', 'Overall budget'],
      ['/documents', 'Passport'],
      ['/goals', 'Run a 10K'],
      ['/notifications', 'Budget at 81%: Food & Dining'],
      ['/settings', 'Account & security'],
      ['/settings/sync', 'Everything is synced'],
    ];
    for (const [path, text] of pages) {
      await page.goto(path);
      await expect(active(page).getByText(text).first()).toBeVisible();
      await shot(page, `${info.project.name}${path.replace(/\//g, '-')}`);
    }
    expect(errors).toEqual([]);
  });

  test('creates a task and syncs it to the API', async ({ page, context }) => {
    const backend = await setup(context);
    await page.goto('/tasks');
    await expect(active(page).getByText('Prepare quarterly report').first()).toBeVisible();
    await active(page).getByRole('button', { name: 'New task' }).click();
    await page.getByLabel('Title').fill('Buy birthday gift');
    await page.getByRole('radio', { name: /Urgent/ }).click();
    await page.getByRole('button', { name: 'Tomorrow' }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Task created')).toBeVisible();
    await expect(active(page).getByText('Buy birthday gift')).toBeVisible();
    await expect.poll(() => backend.requests.some((r) => r.method === 'POST' && r.path === '/tasks' && (r.body as { title?: string })?.title === 'Buy birthday gift'), { timeout: 10_000 }).toBe(true);
    const posted = backend.requests.find((r) => r.method === 'POST' && r.path === '/tasks')!.body as Record<string, unknown>;
    expect(posted['priority']).toBe('urgent');
    expect(posted).not.toHaveProperty('_status');
    expect(posted).not.toHaveProperty('user_id');
  });

  test('completes a task and records habit check-ins', async ({ page, context }) => {
    const backend = await setup(context);
    await page.goto('/tasks');
    await active(page).getByRole('button', { name: 'Mark as completed' }).first().click();
    await expect.poll(() => backend.requests.some((r) => r.method === 'PATCH' && r.path.startsWith('/tasks/') && (r.body as { status?: string })?.status === 'completed'), { timeout: 10_000 }).toBe(true);

    await page.goto('/habits');
    await active(page).getByRole('button', { name: 'Complete Drink water' }).click();
    await expect(active(page).getByRole('button', { name: 'Undo Drink water' })).toBeVisible();
    await expect.poll(() => backend.requests.some((r) => r.method === 'POST' && r.path === '/habit-logs'), { timeout: 10_000 }).toBe(true);
  });

  test('works offline and syncs when the connection returns', async ({ page, context }, info) => {
    const backend = await setup(context);
    await page.goto('/finance');
    await expect(active(page).getByText('Groceries')).toBeVisible();
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(page.getByText(/You're offline/)).toBeVisible();

    await active(page).getByLabel('Add transaction').click();
    await page.getByLabel(/Amount/).fill('12.40');
    await page.getByRole('button', { name: /Food & Dining/ }).click();
    await page.getByLabel('Description').fill('Coffee beans');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Transaction recorded')).toBeVisible();
    await expect(active(page).getByText('Coffee beans')).toBeVisible();
    await expect(active(page).getByText('Local').first()).toBeVisible(); // saved locally, not yet in the cloud
    await shot(page, `${info.project.name}-offline`);
    expect(backend.requests.some((r) => r.method === 'POST' && r.path === '/transactions')).toBe(false);

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(() => backend.requests.some((r) => r.method === 'POST' && r.path === '/transactions' && (r.body as { description?: string })?.description === 'Coffee beans'), { timeout: 20_000 }).toBe(true);
    await expect(active(page).getByText('Local')).toHaveCount(0, { timeout: 15_000 });
  });

  test('surfaces sync conflicts and lets the user resolve them', async ({ page, context }) => {
    const backend = await setup(context);
    await page.goto('/tasks');
    const target = backend.tables['tasks'].find((t) => t['title'] === 'Book dentist appointment')!;
    backend.conflictOnce.add(target.id);
    await active(page).getByText('Book dentist appointment').click();
    await page.getByLabel('Title').fill('Book dentist appointment for Friday');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(active(page).getByText('Review').first()).toBeVisible({ timeout: 15_000 });

    await page.goto('/settings/sync');
    await expect(active(page).getByText('Needs your review (1)')).toBeVisible();
    await active(page).getByRole('button', { name: "Keep this device's version" }).click();
    await expect.poll(() => backend.tables['tasks'].find((t) => t.id === target.id)?.['title'], { timeout: 15_000 }).toBe('Book dentist appointment for Friday');
    await expect(active(page).getByText('Needs your review')).toHaveCount(0);
  });

  test('renders the dark theme', async ({ page, context }, info) => {
    await setup(context, { theme: 'dark' });
    await page.goto('/dashboard');
    await expect(page.locator('html')).toHaveClass(/ion-palette-dark/);
    await expect(page.getByRole('heading', { name: /, Alex$/ })).toBeVisible();
    await shot(page, `${info.project.name}-dashboard-dark`);
    await page.goto('/finance');
    await expect(active(page).getByText('Spending breakdown')).toBeVisible();
    await shot(page, `${info.project.name}-finance-dark`);
  });
});
