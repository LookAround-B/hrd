import { test, expect, type Page } from '@playwright/test';
import { clubA, dashboard } from './fixtures';

async function mockApi(page: Page, options: { signedOut?: boolean; delay?: number; activationError?: boolean; dashboardError?: boolean } = {}) {
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/session') {
      return route.fulfill({ status: options.signedOut ? 401 : 200, json: options.signedOut ? { error: 'Sign in' } : { email: 'admin@example.com', csrf: 'fixture-csrf', expiresAt: new Date(Date.now() + 3600000).toISOString() } });
    }
    if (path === '/api/config') return route.fulfill({ json: { googleClientId: null, authReady: false } });
    if (path === '/api/dashboard') {
      if (options.dashboardError) return route.fulfill({ status: 503, json: { error: 'HRD database is unavailable.' } });
      if (options.delay) await new Promise(resolve => setTimeout(resolve, options.delay));
      return route.fulfill({ json: dashboard });
    }
    if (path.endsWith('/activate') && options.activationError) return route.fulfill({ status: 409, json: { error: 'Run a fresh reconciliation sync before activating.' } });
    if (path === '/api/audit') return route.fulfill({ json: [] });
    return route.fulfill({ json: { ok: true, state: 'success', datasets: { employee: 'ok:25', horse: 'ok:2' } } });
  });
}

test('desktop navigation, filtering, horse detail and map remain usable', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await mockApi(page); await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto('/');
  await expect(page.getByRole('heading', { name: clubA.name })).toBeVisible();
  await page.screenshot({ path: 'test-results/ui-clubs.png', fullPage: true });
  await page.getByRole('button', { name: 'Employees', exact: true }).click();
  await page.getByLabel('Club', { exact: true }).selectOption(clubA.id);
  await expect(page.getByText('Asha Menon', { exact: true })).toBeVisible();
  await expect(page.getByText('Ravi Kumar', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByText('Team member 25', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search records' }).fill('Asha');
  await expect(page.getByText('Asha Menon', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search records' }).fill('');
  await page.screenshot({ path: 'test-results/ui-employees.png', fullPage: true });
  await page.getByRole('button', { name: 'Horses', exact: true }).click();
  await page.getByRole('button', { name: 'View', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('tab', { name: 'Health', exact: true }).click();
  await expect(page.getByText('Routine examination')).toBeVisible();
  await page.screenshot({ path: 'test-results/ui-horse-dialog.png', fullPage: true });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Entity Map', exact: true }).click();
  await expect(page.getByRole('img', { name: `Relationships in ${clubA.name}` })).toBeVisible();
  await page.screenshot({ path: 'test-results/ui-map.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('mobile navigation, data rows and club form fit the viewport', async ({ page }) => {
  await mockApi(page); await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.getByRole('heading', { name: clubA.name })).toBeVisible();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Employees', exact: true }).click();
  await expect(page.getByText('Asha Menon', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/ui-mobile-employees.png', fullPage: true });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Clubs', exact: true }).click();
  await page.getByRole('button', { name: 'Add club', exact: true }).first().click();
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox(); expect(bounds!.x).toBeGreaterThanOrEqual(8); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(382);
  await page.screenshot({ path: 'test-results/ui-mobile-form.png', fullPage: true });
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
});

test('sign-in screen remains readable on desktop and mobile', async ({ page }) => {
  await mockApi(page, { signedOut: true }); await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in to HRD' })).toBeVisible();
  await page.screenshot({ path: 'test-results/ui-login.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/ui-mobile-login.png', fullPage: true });
});

test('loading does not flash an empty club state', async ({ page }) => {
  await mockApi(page, { delay: 1200 }); await page.goto('/');
  await expect(page.getByRole('status', { name: 'Loading club data' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Connect your first club' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: clubA.name })).toBeVisible();
});

test('mobile navigation keeps keyboard focus inside the drawer and restores it', async ({ page }) => {
  await mockApi(page); await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.getByRole('heading', { name: clubA.name })).toBeVisible();
  await expect(page.locator('#main-navigation')).toHaveAttribute('inert', '');
  const menu=page.getByRole('button', { name: 'Open navigation' }); await menu.click();
  await expect(page.getByRole('button', { name: 'Close navigation', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(page.getByRole('button', { name: 'Sign out' })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: 'Close navigation', exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(menu).toBeFocused(); await expect(menu).toHaveAttribute('aria-expanded', 'false');
});

test('activation failure remains visible inside the open dialog', async ({ page }) => {
  await mockApi(page, { activationError: true }); await page.goto('/');
  await page.getByRole('button', { name: 'Activate', exact: true }).click();
  const dialog=page.getByRole('dialog'); await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Activate scheduled sync' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Run a fresh reconciliation sync before activating.');
  await expect(dialog.getByRole('button', { name: 'Activate scheduled sync' })).toBeEnabled();
});

test('food date semantics and excluded API routes remain visible on mobile', async ({ page }) => {
  await mockApi(page); await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.getByRole('heading', { name: clubA.name })).toBeVisible();
  await page.getByRole('button', { name: 'Open navigation' }).click(); await page.getByRole('button', { name: 'Food', exact: true }).click();
  await page.getByLabel('From', { exact: true }).fill('2026-10-01'); await page.getByLabel('To', { exact: true }).fill('2026-10-13');
  await expect(page.getByText('10/2026 · monthly')).toBeVisible(); await expect(page.getByText('100 kg / month')).toBeVisible();
  await page.getByText('Data availability', { exact: true }).click(); await expect(page.getByText(/monthly source figures/)).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/ui-mobile-food.png', fullPage: true });
  await page.getByLabel('From', { exact: true }).fill('2026-11-01'); await expect(page.getByRole('alert')).toContainText('end date');
  await page.getByRole('button', { name: 'Open navigation' }).click(); await page.getByRole('button', { name: 'API Routes', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search records' }).fill('/api/horse-feed'); await expect(page.getByText('Excluded', { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/ui-mobile-api-routes.png', fullPage: true });
});


test('dashboard connection errors show recovery instead of an empty club', async ({ page }) => {
  const options={dashboardError:true}; await mockApi(page,options); await page.goto('/');
  await expect(page.getByRole('heading',{name:'Club data could not load'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Connect your first club'})).toHaveCount(0);
  options.dashboardError=false; await page.getByRole('button',{name:'Try again'}).click();
  await expect(page.getByRole('heading',{name:clubA.name})).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
