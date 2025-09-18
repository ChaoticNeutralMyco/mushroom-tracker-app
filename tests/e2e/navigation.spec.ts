import { test, expect } from '@playwright/test';

async function disableOverlays(page: any) {
  await page.addInitScript(() => {
    try { localStorage.setItem('cnm:guideEnabled', 'false'); } catch {}
  });
}

async function ensureAuthed(page: any) {
  const shell = page.locator('nav, header, [data-testid="app-shell"]');
  if (await shell.first().isVisible().catch(() => false)) return;

  const email = page.getByRole('textbox', { name: /email/i }).first();
  const pass = page.getByLabel(/password/i).first();
  const signInBtn = page.getByRole('button', { name: /sign in/i }).first();

  const onLogin = (await email.count()) > 0 && (await pass.count()) > 0 && (await signInBtn.count()) > 0;
  if (!onLogin) return;

  const user = process.env.E2E_EMAIL || '';
  const pwd  = process.env.E2E_PASSWORD || '';
  if (!user || !pwd) test.skip(true, 'E2E_EMAIL / E2E_PASSWORD not set; tests require auth.');

  await email.fill(user);
  await pass.fill(pwd);
  await Promise.all([page.waitForLoadState('networkidle').catch(()=>{}), signInBtn.click()]);
  await page.waitForTimeout(600);
}

async function boot(page: any, baseURL?: string) {
  await disableOverlays(page);
  await page.goto(baseURL || '/', { waitUntil: 'domcontentloaded' });
  await ensureAuthed(page);
  await expect(page.locator('body')).toBeVisible();
}

async function clickNav(page: any, label: string) {
  for (const role of ['button', 'link', 'tab']) {
    const el = page.getByRole(role as any, { name: new RegExp(`^${label}$`, 'i') }).first();
    if (await el.count()) { await el.scrollIntoViewIfNeeded(); await el.click().catch(() => {}); return true; }
  }
  const any = page.locator(`[title*="${label}" i], [aria-label*="${label}" i]`).first();
  if (await any.count()) { await any.scrollIntoViewIfNeeded(); await any.click().catch(() => {}); return true; }
  return false;
}

test('All tabs render without crashing (guarded)', async ({ page, baseURL }) => {
  await boot(page, baseURL);

  const tabs = [
    'Dashboard','Home','Grows','Recipes','COG','Supplies','Cost of Goods',
    'Analytics','Calendar','Timeline','Settings','Photos','Backup','Strains'
  ];

  for (const name of tabs) {
    const clicked = await clickNav(page, name);
    if (clicked) {
      await page.waitForLoadState('networkidle').catch(() => {});
      await expect.soft(page.locator('body')).toBeVisible();
      await page.waitForTimeout(200);
    }
  }
});
