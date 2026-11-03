import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './apps/web/browser',
  fullyParallel: false,
  retries: 0,
  timeout: 45000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1100 } } },
    { name: 'phone', use: { viewport: { width: 360, height: 780 } } },
  ],
  webServer: {
    command: 'pnpm --filter @yapesa/web dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env['CI'],
    timeout: 30000,
  },
});
