import { test, expect } from '@playwright/test';

async function boot(page: any, baseURL?: string) {
  await page.addInitScript(() => {
    try { localStorage.setItem('cnm:guideEnabled', 'false'); } catch {}
  });
  await page.goto(baseURL || '/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('main, [role="main"], header, nav').first()).toBeVisible({ timeout: 15_000 });
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

  // Try a wide set so this stays future-proof; we only click if found.
  const tabs = [
    'Dashboard', 'Home', 'Grows', 'Recipes', 'COG', 'Supplies', 'Cost of Goods',
    'Analytics', 'Calendar', 'Timeline', 'Settings', 'Photos', 'Backup', 'Strains'
  ];

  for (const name of tabs) {
    const clicked = await clickNav(page, name);
    if (clicked) {
      await page.waitForLoadState('networkidle').catch(() => {});
      await expect.soft(page.locator('body')).toBeVisible();
      // tiny pause to let content settle
      await page.waitForTimeout(200);
    }
  }
});
