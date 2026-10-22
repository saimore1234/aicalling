import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { E2E_ADMIN, E2E_SALES } from './global-setup';

async function login(page: Page, who: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test('unauthenticated visitors are sent to login', async ({ page }) => {
  await page.goto('/customers');
  await expect(page).toHaveURL(/\/login/);
});

test('wrong password shows a generic error', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(E2E_ADMIN.email);
  await page.getByLabel('Password').fill('definitely-wrong-Password1');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test('admin sees DEMO mode and every page renders without server errors', async ({ page }) => {
  const failures: string[] = [];
  page.on('response', (r) => { if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`); });
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await login(page, E2E_ADMIN);
  await expect(page.getByText('DEMO', { exact: false }).first()).toBeVisible();

  const pages: [string, RegExp][] = [
    ['/dashboard', /dashboard/i], ['/customers', /customers/i], ['/import', /import/i], ['/pipeline', /pipeline/i], ['/agents', /ai agents/i],
    ['/campaigns', /campaigns/i], ['/calls', /call history/i], ['/followups', /follow-up/i], ['/templates', /templates/i], ['/appointments', /appointments/i],
    ['/integrations', /integrations/i], ['/compliance', /compliance/i], ['/users', /users/i], ['/audit', /audit/i], ['/system', /system health/i], ['/account', /my account/i],
  ];
  for (const [url, heading] of pages) {
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await page.waitForTimeout(500); // let the page's first API calls settle (some pages poll, so 'networkidle' never occurs)
  }
  expect(failures).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('import wizard accepts the sample CSV and reaches the mapping step', async ({ page }) => {
  await login(page, E2E_ADMIN);
  await page.goto('/import');
  await page.locator('input[type=file]').setInputFiles(path.resolve(process.cwd(), 'samples/customers-sample.csv'));
  await expect(page.getByText(/customer name/i).first()).toBeVisible({ timeout: 15_000 });
});

test('sales executive does not get admin navigation and is blocked from admin pages data', async ({ page }) => {
  await login(page, E2E_SALES);
  await expect(page.getByRole('link', { name: /audit log/i })).toHaveCount(0);
  const res = await page.request.get('/api/audit');
  expect(res.status()).toBe(403);
});

test('kill switch can be activated and released by an admin', async ({ page }) => {
  await login(page, E2E_ADMIN);
  await page.goto('/system');
  await page.getByRole('button', { name: /activate kill switch/i }).click();
  await page.getByLabel(/reason/i).fill('e2e test');
  await page.getByRole('button', { name: /activate kill switch/i }).last().click();
  await expect(page.getByText(/active — all dialling blocked/i)).toBeVisible();
  await page.getByRole('button', { name: /release kill switch/i }).click();
  await expect(page.getByText(/^Off$/)).toBeVisible();
});
