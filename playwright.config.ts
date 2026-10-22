import fs from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
export const E2E_DB = process.env.E2E_DATABASE_URL ?? 'postgresql://vms:vms_dev_password@localhost:5432/vms_e2e';
export const E2E_REDIS = process.env.E2E_REDIS_URL ?? 'redis://localhost:6379/14';
// Use a pre-installed Chromium when present (PLAYWRIGHT_CHROMIUM_PATH overrides); otherwise Playwright's own.
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? ['/opt/pw-browsers/chromium/chrome-linux/chrome', '/opt/pw-browsers/chromium'].find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    launchOptions: chromiumPath ? { executablePath: chromiumPath, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Requires `npm run build` first (CI: build, then test:e2e).
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`, // health needs the DB, which global setup creates after the server starts
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NODE_ENV: 'production',
      DATABASE_URL: E2E_DB,
      REDIS_URL: E2E_REDIS,
      APP_SECRET: 'e2e-secret-e2e-secret-e2e-secret-123456',
      APP_URL: `http://localhost:${PORT}`,
      SETUP_TOKEN: 'e2e-setup-token',
      COOKIE_SECURE: 'false',
      LOG_LEVEL: 'silent',
      UPLOAD_DIR: './.e2e-uploads',
    },
  },
});
