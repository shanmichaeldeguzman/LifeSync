import { expect, test, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

/**
 * Live end-to-end test against a DEPLOYED LifeSync (real Supabase + API).
 *   LIVE_URL=https://… SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx playwright test -c playwright.live.config.ts
 * Creates a temporary confirmed user, drives the real UI, verifies each change in the
 * production database, and deletes the user afterwards.
 */
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
let admin: SupabaseClient;
let userId = '';
const email = `lifesync-live-${Date.now()}@example.com`;
let password = `Live-${randomUUID().slice(0, 12)}9a`;

const active = (page: Page) => page.locator('.ion-page:not(.ion-page-hidden)').last();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function rows(table: string, filter: Record<string, string> = {}) {
  let q = admin.from(table).select('*').eq('user_id', userId);
  for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
  return (await q).data ?? [];
}

async function signIn(page: Page, pw = password) {
  await page.goto('/auth/login');
  await active(page).locator('#email').fill(email);
  await active(page).locator('#password').fill(pw);
  await active(page).getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/dashboard/, { timeout: 30_000 });
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  admin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: 'Live Tester' } });
  if (error) throw error;
  userId = data.user.id;
});

test.afterAll(async () => {
  if (userId) await admin.auth.admin.deleteUser(userId);
});

test('signs in and shows the personalized dashboard', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page);
  await expect(page.getByRole('heading', { name: /, Live$/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Synced/).first()).toBeAttached({ timeout: 30_000 });
  expect(errors).toEqual([]);
});

test('creates records in every core module and they reach the database', async ({ page }) => {
  await signIn(page);

  // Task
  await page.goto('/tasks');
  await active(page).getByLabel('New task').click();
  await page.getByLabel('Title').fill('Live task');
  await page.getByRole('button', { name: 'Tomorrow' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect.poll(async () => (await rows('tasks', { title: 'Live task' })).length, { timeout: 30_000 }).toBe(1);

  // Event
  await page.goto('/calendar');
  await active(page).getByLabel('New event').click();
  await page.getByLabel('Title').fill('Live event');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect.poll(async () => (await rows('events', { title: 'Live event' })).length, { timeout: 30_000 }).toBe(1);

  // Note (autosave)
  await page.goto('/notes/new');
  await active(page).getByLabel('Note title').fill('Live note');
  await active(page).getByLabel('Note content').fill('Hello **production**');
  await expect.poll(async () => (await rows('notes', { title: 'Live note' })).length, { timeout: 30_000 }).toBe(1);

  // Habit + check-in
  await page.goto('/habits');
  await active(page).getByLabel('New habit').click();
  await page.getByLabel('Name').fill('Live habit');
  await page.getByRole('button', { name: 'Save' }).click();
  await active(page).getByRole('button', { name: 'Complete Live habit' }).click();
  await expect.poll(async () => (await rows('habit_logs')).length, { timeout: 30_000 }).toBe(1);

  // Transaction
  await page.goto('/finance');
  await active(page).getByLabel('Add transaction').click();
  await page.getByLabel(/Amount/).fill('42.50');
  await page.getByLabel('Description').fill('Live expense');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect.poll(async () => (await rows('transactions', { description: 'Live expense' }))[0]?.amount, { timeout: 30_000 }).toBe(42.5);

  // Goal
  await page.goto('/goals');
  await active(page).getByLabel('New goal').click();
  await page.locator('#g-title').fill('Live goal');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect.poll(async () => (await rows('goals', { title: 'Live goal' })).length, { timeout: 30_000 }).toBe(1);
});

test('uploads, previews and deletes a private document', async ({ page }) => {
  await signIn(page);
  await page.goto('/documents');
  await active(page).getByLabel('Upload document').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Choose a file/ }).click();
  await (await chooser).setFiles({ name: 'id-card.png', mimeType: 'image/png', buffer: PNG });
  await page.getByLabel('Title').fill('Live ID card');
  await page.getByRole('button', { name: 'Upload' }).click();
  await expect(page.getByText('Document uploaded')).toBeVisible({ timeout: 30_000 });
  const [doc] = await rows('documents', { title: 'Live ID card' });
  expect(doc?.storage_path).toMatch(new RegExp(`^${userId}/`));

  await active(page).getByText('Live ID card').click();
  await expect(page.locator('ion-modal img')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).last().click();
  await expect.poll(async () => (await rows('documents', { title: 'Live ID card' })).length, { timeout: 30_000 }).toBe(0);
});

test('queues changes offline and syncs them on reconnect', async ({ page, context }) => {
  await signIn(page);
  await page.goto('/tasks');
  await expect(active(page).getByText('Live task')).toBeVisible({ timeout: 30_000 });
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await active(page).getByLabel('New task').click();
  await page.getByLabel('Title').fill('Offline task');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(active(page).getByText('Local').first()).toBeVisible();
  expect((await rows('tasks', { title: 'Offline task' })).length).toBe(0);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(async () => (await rows('tasks', { title: 'Offline task' })).length, { timeout: 40_000 }).toBe(1);
});

test('updates the profile', async ({ page }) => {
  await signIn(page);
  await page.goto('/settings');
  await active(page).locator('#s-name').fill('Live Tester Renamed');
  await active(page).getByRole('button', { name: 'Save profile' }).click();
  await expect.poll(async () => (await admin.from('profiles').select('full_name').eq('id', userId).single()).data?.full_name, { timeout: 20_000 }).toBe('Live Tester Renamed');
});

test('resets the password through a recovery link', async ({ page }) => {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo: `${process.env['LIVE_URL']}/auth/reset-password` } });
  if (error) throw error;
  await page.goto(data.properties.action_link);
  await expect(page).toHaveURL(/reset-password/, { timeout: 30_000 });
  const next = `Reset-${randomUUID().slice(0, 10)}7b`;
  await active(page).locator('#pw').fill(next);
  await active(page).locator('#pw2').fill(next);
  await active(page).getByRole('button', { name: 'Update password' }).click();
  await expect(page).toHaveURL(/dashboard/, { timeout: 30_000 });
  password = next;
});

test('signs out and clears local data from the device', async ({ page }) => {
  await signIn(page);
  await page.goto('/settings');
  await active(page).getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/auth\/login/, { timeout: 20_000 });
  const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  expect(dbs.some((n) => n?.startsWith('lifesync_'))).toBe(false);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/auth\/login/);
});
