import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://localhost:4300';

/**
 * End-to-end tests run the real production build against an in-memory mock of the
 * LifeSync API and Supabase Auth (see e2e/mock-backend.ts), on phone, tablet and
 * desktop viewports.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 2,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    { name: 'tablet', use: { viewport: { width: 834, height: 1112 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
