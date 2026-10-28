import { defineConfig, devices } from '@playwright/test';

const port = process.env['E2E_PORT'] ?? '7710';

/**
 * Golden paths through the real app: a fresh Hub (start-hub.mjs) and a real
 * browser. The projects run in order: first-time setup through the wizard,
 * then the restaurant is stocked through the API, then the service flows,
 * which share the one Hub like a real day does.
 *
 *   pnpm --filter @restroos/web build && pnpm --filter @restroos/server build
 *   pnpm --filter @restroos/e2e test:e2e
 */
export default defineConfig({
  testDir: 'tests',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    actionTimeout: 10_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /01-setup\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'stock',
      testMatch: /stock\.setup\.ts/,
      dependencies: ['setup'],
    },
    {
      name: 'service',
      testMatch: /0[2-9]-.*\.spec\.ts/,
      dependencies: ['stock'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } },
    },
  ],
  webServer: {
    command: 'node start-hub.mjs',
    url: `http://127.0.0.1:${port}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
