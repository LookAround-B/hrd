import { test, expect, type Page } from '@playwright/test';
import { clubA, consumptionTotals, dashboard, feedPlans } from './fixtures';

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
    if (path === '/api/efm-data') return route.fulfill({ json: [
      { dataset: 'Attendance', total: 2, fields: ['id', 'employeeId', 'date', 'status', 'remarks'], state: 'ok', synced_at: new Date().toISOString(), checked_at: new Date().toISOString() },
      { dataset: 'GateEntry', total: 0, fields: ['id', 'personName'], state: 'denied', synced_at: null, checked_at: new Date().toISOString() },
    ] });
    if (path === '/api/efm-data/rows') {
      const params = new URL(route.request().url()).searchParams;
      const rows = [
        { id: 'att-1', data: { id: 'att-1', employeeId: 'employee-0', date: '2026-10-01T00:00:00.000Z', status: 'Present', remarks: 'On time' }, syncedAt: new Date().toISOString() },
        { id: 'att-2', data: { id: 'att-2', employeeId: 'employee-1', date: '2026-10-02T00:00:00.000Z', status: 'Absent', remarks: 'Sick leave' }, syncedAt: new Date().toISOString() },
      ].filter(r => JSON.stringify(r.data).toLowerCase().includes((params.get('search') || '').toLowerCase()));
      if (params.get('dir') === 'desc') rows.reverse();
      return route.fulfill({ json: { total: rows.length, fields: ['id', 'employeeId', 'date', 'status', 'remarks'], rows } });
    }
    if (path === '/api/audit') return route.fulfill({ json: [] });
    if (path === '/api/feed-plans') return route.fulfill({ json: feedPlans });
    if (path === '/api/consumption') return route.fulfill({ json: consumptionTotals });
    if (path.endsWith('/status')) return route.fulfill({json:[{state:'partial',started_at:new Date().toISOString(),finished_at:new Date().toISOString(),datasets:{employee:'ok:25',horse:'ok:2',medicine:'denied',feedPlan:'error'}}]});
    return route.fulfill({ json: { ok: true, state: 'success', datasets: { employee: 'ok:25', horse: 'ok:2' } } });
  });
}

// HRD uses custom Select and DatePicker components instead of native controls.
async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
async function pickDate(page: Page, label: string, iso: string) {
  const trigger = page.getByRole('button', { name: new RegExp(`^${label},`) });
  const forward = iso > ((await trigger.getAttribute('data-value')) || '');
  await trigger.click();
  const calendar = page.getByRole('dialog', { name: `Choose ${label.toLowerCase()} date` });
  const day = calendar.getByRole('button', { name: new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }), exact: true });
  for (let i = 0; i < 36 && !(await day.isVisible()); i++) await calendar.getByRole('button', { name: forward ? 'Next month' : 'Previous month' }).click();
  await day.click();
  await expect(trigger).toHaveAttribute('data-value', iso);
}

test('desktop navigation, filtering, horse detail and map remain usable', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await mockApi(page); await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto('/');
  await expect(page.getByRole('heading', { name: clubA.name })).toBeVisible();
  await page.screenshot({ path: 'test-results/ui-clubs.png', fullPage: true });
  await page.getByRole('button', { name: 'Employees', exact: true }).click();
  await choose(page, 'Club', clubA.name);
  await expect(page.getByText('Asha Menon', { exact: true })).toBeVisible();
  await expect(page.getByText('Ravi Kumar', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByText('Team member 25', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search records' }).fill('Asha');
  await expect(page.getByText('Asha Menon', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search records' }).fill('');
  await page.getByRole('button', { name: 'View', exact: true }).first().click();
  await expect(page.getByRole('dialog').getByText('Morning shift')).toBeVisible();
  await expect(page.getByRole('dialog').getByText('Fixture supervisor')).toBeVisible();
  await expect(page.getByRole('dialog').getByText('Aurora')).toBeVisible();
  await expect(page.getByRole('dialog').getByText('Comet')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'test-results/ui-employees.png', fullPage: true });
  await page.getByRole('button', { name: 'Horses', exact: true }).click();
  await page.getByRole('button', { name: 'View', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('tab', { name: 'Health', exact: true }).click();
  await expect(page.getByText('Routine examination')).toBeVisible();
  await page.getByRole('tab', { name: 'Profile', exact: true }).click();
  await expect(page.getByText('985000000000001')).toBeVisible();
  await page.getByRole('tab', { name: 'Farrier', exact: true }).click();
  await expect(page.getByText('Fixture farrier')).toBeVisible();
  await page.getByRole('tab', { name: 'Feed', exact: true }).click();
  await expect(page.getByText('Recovery menu')).toBeVisible();
  await page.getByRole('tab', { name: 'Training', exact: true }).click();
  await expect(page.getByText('Novice', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Stable', exact: true }).click();
  await expect(page.getByText('North yard', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/ui-horse-dialog.png', fullPage: true });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Entity Map', exact: true }).click();
  await expect(page.getByRole('img', { name: `Relationships in ${clubA.name}` })).toBeVisible();
  await page.screenshot({ path: 'test-results/ui-map.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('health tab flags due care and links the guide to the schedule', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await mockApi(page); await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto('/');
  await page.getByRole('button', { name: 'Health', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Health', exact: true })).toBeVisible();
  await expect(page.getByText(/^Overdue \d+ days$/).first()).toBeVisible();
  await expect(page.getByText(/· Farrier shoeing/).first()).toBeVisible();
  await expect(page.getByText(/· Medicine log/).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/ui-health-schedule.png', fullPage: true });
  await page.getByRole('button', { name: 'Records & treatments' }).click();
  await expect(page.getByText('Phenylbutazone')).toBeVisible();
  await expect(page.getByText('Routine deworming')).toBeVisible();
  await page.getByRole('button', { name: /^Inspections/ }).click();
  await expect(page.getByText('Swelling on near fore')).toBeVisible();
  await page.getByRole('button', { name: /^Health records/ }).click();
  await expect(page.getByText('Ivermectin deworming')).toBeVisible();
  await page.getByRole('button', { name: 'Care guide' }).click();
  await page.getByRole('textbox', { name: 'Search care guide' }).fill('glanders');
  await expect(page.getByText('notifiable in India')).toBeVisible();
  await page.getByRole('textbox', { name: 'Search care guide' }).fill('');
  await expect(page.getByText('Total topics: 22 · Showing: 22')).toBeVisible();
  await page.getByRole('button', { name: 'Expand all' }).click();
  await expect(page.getByText('UC Davis Equine Center')).toBeVisible();
  await page.getByRole('button', { name: 'Collapse all' }).click();
  await page.getByText('Vaccination and preventive health schedule').click();
  await page.screenshot({ path: 'test-results/ui-health-guide.png', fullPage: true });
  await page.getByRole('button', { name: /horses? needs? vaccination/ }).click();
  await expect(page.getByRole('combobox', { name: 'Care' })).toHaveAttribute('data-value', 'Vaccination');
  await expect(page.getByText('Atlas', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/ui-mobile-health.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('EFM data browses every mirrored table with search, sort and row detail', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await mockApi(page); await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto('/');
  await page.getByRole('button', { name: 'EFM Data', exact: true }).click();
  await choose(page, 'Club', clubA.name);
  await expect(page.getByRole('heading', { name: 'Attendance' })).toBeVisible();
  await expect(page.getByText('Asha Menon', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search EFM rows' }).fill('sick');
  await expect(page.getByText('1 row', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search EFM rows' }).fill('');
  await page.getByRole('button', { name: 'Date', exact: true }).click();
  await page.getByRole('button', { name: 'Date', exact: true }).click();
  await expect(page.locator('.efm-table tbody tr').first()).toContainText('Absent');
  await page.screenshot({ path: 'test-results/ui-efm-data.png', fullPage: true });
  await page.locator('.efm-table tbody tr').first().click();
  await expect(page.getByRole('dialog').getByText('Sick leave')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Gate Entry/ }).click();
  await expect(page.getByText('Access denied by EFM')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
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
  await pickDate(page, 'From', '2026-10-01'); await pickDate(page, 'To', '2026-10-13');
  await expect(page.getByText('10/2026 · monthly').first()).toBeVisible(); await expect(page.getByText('100 kg / month')).toBeVisible();
  await expect(page.getByText('Rice tracker', { exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: /oats\s*Willow Equestrian Club\s*2\s*kg/ })).toBeVisible();
  await page.getByText('Data availability', { exact: true }).click(); await expect(page.getByText(/monthly source figures/)).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/ui-mobile-food.png', fullPage: true });
  await pickDate(page, 'From', '2026-11-01'); await expect(page.getByRole('alert')).toContainText('end date');
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

test('club onboarding submits the key, approval, scopes and rate limits then clears the secret field', async ({ page }) => {
  await mockApi(page);let submitted:Record<string,unknown>|undefined;let tested=false;
  await page.route('**/api/clubs/*/test',async route=>{tested=true;await route.fulfill({json:{verified:true}});});
  await page.route('**/api/clubs',async route=>{submitted=route.request().postDataJSON();await route.fulfill({status:201,json:{id:'33333333-3333-4333-8333-333333333333'}});});
  await page.goto('/');await page.getByRole('button',{name:'Add club',exact:true}).first().click();
  const form=page.getByRole('dialog');
  await form.getByLabel('Club name',{exact:true}).fill('Fixture connection');
  await form.getByLabel('EFM website URL',{exact:false}).fill('https://efm.example.com');
  await form.getByLabel('EFM integration key or access token',{exact:false}).fill(`efm_live_${'z'.repeat(43)}`);
  await form.getByLabel('Scopes granted by EFM').fill('Read-only HRD data');
  await form.getByLabel('EFM rate limits').fill('30 token exchanges per minute');
  await form.getByLabel('Issued by',{exact:true}).fill('Fixture owner');
  await form.getByLabel('Authorisation reference',{exact:true}).fill('Fixture written approval');
  await form.getByRole('checkbox').check();
  await form.getByRole('button',{name:'Save connection'}).click();
  await expect(form).not.toBeVisible();
  expect(submitted).toMatchObject({name:'Fixture connection',baseUrl:'https://efm.example.com',scopeNotes:'Read-only HRD data',rateLimitNotes:'30 token exchanges per minute',termsConfirmed:true});
  expect(submitted?.token).toBe(`efm_live_${'z'.repeat(43)}`);
  expect(tested).toBe(true);
  await expect(page.getByRole('status')).toContainText('saved and verified');
});

test('sync history exposes failed datasets, supports retry, and fits mobile',async({page})=>{
  await mockApi(page);await page.setViewportSize({width:390,height:844});await page.goto('/');
  await page.getByRole('button',{name:'Sync history',exact:true}).first().click();
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByText('25 records imported')).toBeVisible();
  await expect(dialog.getByText('Access denied by EFM')).toBeVisible();
  await expect(dialog.getByText('Import failed; previous data retained')).toBeVisible();
  await page.screenshot({path:'test-results/ui-mobile-sync-history.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.route('**/api/clubs/*/status',route=>route.fulfill({status:503,json:{error:'History unavailable. Try again.'}}));
  await dialog.getByRole('button',{name:'Refresh history'}).click();
  await expect(dialog.getByRole('alert')).toHaveText('History unavailable. Try again.');
  await page.route('**/api/clubs/*/status',route=>route.fulfill({json:[]}));
  await dialog.getByRole('button',{name:'Refresh history'}).click();
  await expect(dialog.getByText(/No syncs recorded yet/)).toBeVisible();
});

test('club lifecycle continues after a failed connection test through sync, activation, rotation and disconnect',async({page})=>{
  await mockApi(page);
  const club={...clubA,id:'33333333-3333-4333-8333-333333333333',name:'Lifecycle fixture',status:'pending' as typeof clubA.status,validatedAt:null as string|null,lastSuccessAt:null as string|null,employeeCount:0,horseCount:0,stale:true};
  let exists=false,failTest=true;const actions:string[]=[];
  await page.route('**/api/dashboard',route=>route.fulfill({json:{...dashboard,clubs:exists?[club]:[],records:[]}}));
  await page.route('**/api/clubs',async route=>{exists=true;await route.fulfill({status:201,json:{id:club.id}});});
  await page.route(`**/api/clubs/${club.id}/*`,async route=>{
    const action=new URL(route.request().url()).pathname.split('/').at(-1)!;actions.push(action);
    if(action==='test'){
      if(failTest)return route.fulfill({status:502,json:{error:'EFM is temporarily unavailable.'}});
      club.validatedAt=new Date().toISOString();return route.fulfill({json:{verified:true,message:'Connection verified.'}});
    }
    if(action==='sync'){club.lastSuccessAt=new Date().toISOString();club.employeeCount=25;club.horseCount=2;club.stale=false;return route.fulfill({json:{state:'success',datasets:{employee:'ok:25',horse:'ok:2'}}});}
    if(action==='activate'){expect(route.request().postDataJSON()).toEqual({reconciled:true});club.status='active';}
    if(action==='credential'){club.status='pending';club.validatedAt=null;club.stale=true;}
    if(action==='disconnect'){club.status='disconnected';}
    await route.fulfill({json:{ok:true}});
  });
  await page.goto('/');await page.getByRole('button',{name:'Add club',exact:true}).first().click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('Club name',{exact:true}).fill(club.name);
  await dialog.getByLabel('EFM website URL',{exact:false}).fill(club.baseUrl);
  await dialog.getByLabel('EFM integration key or access token',{exact:false}).fill(`efm_live_${'x'.repeat(43)}`);
  await dialog.getByLabel('Issued by',{exact:true}).fill('Fixture administrator');
  await dialog.getByLabel('Authorisation reference',{exact:true}).fill('Fixture approval');
  await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Save connection'}).click();
  await expect(dialog).not.toBeVisible();await expect(page.getByRole('status')).toContainText('Connection saved, but verification did not complete');
  await expect(page.getByRole('heading',{name:club.name,exact:true})).toBeVisible();
  await expect(page.getByRole('combobox',{name:'Club',exact:true})).toHaveAttribute('data-value',club.id);
  failTest=false;await page.getByRole('button',{name:'Test connection',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Connection verified');
  await page.getByRole('button',{name:'Sync & reconcile',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Sync success');
  await page.getByRole('button',{name:'Activate',exact:true}).click();
  await expect(dialog.getByText('25 employees')).toBeVisible();
  await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Activate scheduled sync'}).click();
  await expect(dialog).not.toBeVisible();await expect(page.getByText('active',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Replace token',exact:true}).click();
  await dialog.getByLabel('EFM integration key or access token',{exact:false}).fill(`efm_live_${'y'.repeat(43)}`);
  await dialog.getByRole('button',{name:'Replace token',exact:true}).click();
  await expect(dialog).not.toBeVisible();await expect(page.getByText('pending',{exact:true})).toBeVisible();
  await expect(page.getByRole('status')).toContainText('saved and verified');
  await page.getByRole('button',{name:'Disconnect',exact:true}).click();await dialog.getByRole('button',{name:'Disconnect club'}).click();
  await expect(dialog).not.toBeVisible();await expect(page.getByText('disconnected',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Sync & reconcile',exact:true})).toBeDisabled();
  expect(actions).toEqual(['test','test','sync','activate','credential','test','disconnect']);
});

test('food opens on the latest recorded month when EFM has no recent food entries', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2027-03-15T06:00:00Z'));
  await mockApi(page); await page.goto('/');
  await expect(page.getByRole('heading', { name: clubA.name })).toBeVisible();
  await page.getByRole('button', { name: 'Food', exact: true }).click();
  await expect(page.getByRole('button', { name: /^From,/ })).toHaveAttribute('data-value', '2026-10-01');
  await expect(page.getByText('10/2026 · monthly').first()).toBeVisible();
});

test('custom select and date picker work by keyboard and inside dialogs', async ({ page }) => {
  await mockApi(page); await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto('/');
  const club = page.getByRole('combobox', { name: 'Club', exact: true });
  await club.focus(); await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('listbox', { name: 'Club' })).toBeFocused();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(club).toHaveAttribute('data-value', dashboard.clubs[0].id); await expect(club).toBeFocused();
  await page.getByRole('button', { name: 'Activity log' }).click();
  const dialog = page.getByRole('dialog', { name: 'Activity log' }); const rows = dialog.getByRole('combobox', { name: 'Rows per page' });
  await rows.click(); await page.getByRole('option', { name: '50', exact: true }).click();
  await expect(rows).toHaveAttribute('data-value', '50'); await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Food', exact: true }).click();
  const from = page.getByRole('button', { name: /^From,/ }); const start = (await from.getAttribute('data-value'))!;
  await from.click(); await expect(page.getByRole('dialog', { name: 'Choose from date' })).toBeVisible();
  await page.screenshot({ path: 'test-results/ui-date-picker.png' });
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
  await expect(from).toHaveAttribute('data-value', new Date(Date.parse(`${start}T00:00:00Z`) + 86400000).toISOString().slice(0, 10));
});

test('the open tab survives a page refresh and follows back/forward', async ({ page }) => {
  await mockApi(page); await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Clubs', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Food', exact: true }).click();
  await expect(page).toHaveURL(/#food$/);
  await page.reload(); await expect(page.getByRole('heading', { name: 'Food', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Entity Map', exact: true }).click(); await expect(page).toHaveURL(/#entity-map$/);
  await page.goBack(); await expect(page.getByRole('heading', { name: 'Food', exact: true })).toBeVisible();
});
