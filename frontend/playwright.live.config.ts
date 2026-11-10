import { defineConfig, devices } from '@playwright/test';

/** Runs e2e-live/ against a deployed LifeSync (see the spec header for required env vars). */
export default defineConfig({
  testDir: './e2e-live',
  timeout: 120_000,
  workers: 1,
  reporter: 'list',
  use: { baseURL: process.env['LIVE_URL'], trace: 'retain-on-failure', serviceWorkers: 'block' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
});
