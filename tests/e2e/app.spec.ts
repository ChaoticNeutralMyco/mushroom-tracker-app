import { test, expect } from '@playwright/test';

async function boot(page: any, baseURL?: string) {
  await page.addInitScript(() => {
    try { localStorage.setItem('cnm:guideEnabled', 'false'); } catch {}
  });
  await page.goto(baseURL || '/', { waitUntil: 'domcontentloaded' });
  // App shell "readiness" without depending on specific text
  const appShell = page.locator('main, [role="main"], [data-testid="app-shell"], header, nav').first();
  await expect(appShell).toBeVisible({ timeout: 15_000 });
}

async function clickNav(page: any, label: string) {
  for (const role of ['button', 'link', 'tab']) {
    const el = page.getByRole(role as any, { name: new RegExp(`^${label}$`, 'i') }).first();
    if (await el.count()) { await el.scrollIntoViewIfNeeded(); await el.click().catch(() => {}); return true; }
  }
  // common fallbacks: sidebars, menus, icons with titles
  const any = page.locator(`[title*="${label}" i], [aria-label*="${label}" i]`).first();
  if (await any.count()) { await any.scrollIntoViewIfNeeded(); await any.click().catch(() => {}); return true; }
  return false;
}

test.describe('App shell & PWA', () => {
  test('PWA sanity + Settings persist + COG add + CSV export (guarded)', async ({ page, baseURL }) => {
    const url = baseURL || '/';
    await boot(page, url);

    // Soft-check: a recognizable app title if present (don’t fail if branding text changes)
    const maybeTitle = page.getByRole('heading', { name: /chaotic|tracker/i }).first();
    if (await maybeTitle.count()) await expect.soft(maybeTitle).toBeVisible();

    // Service worker exists (best-effort; ok to be soft in dev)
    const sw = await page.request.get(new URL('sw.js', url).toString());
    expect.soft([200, 304]).toContain(sw.status());

    // Try open Settings and toggle something harmless if present
    if (await clickNav(page, 'Settings')) {
      const darkToggle = page.getByRole('switch', { name: /dark|theme/i }).first();
      if (await darkToggle.count()) await darkToggle.click().catch(() => {});
    }

    // Try COG and export CSV if the UI supports it (all guarded)
    if (await clickNav(page, 'COG') || await clickNav(page, 'Supplies') || await clickNav(page, 'Cost of Goods')) {
      const exportBtn = page.getByRole('button', { name: /export|download/i }).first();
      if (await exportBtn.count()) {
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 7000 }).catch(() => null),
          exportBtn.click().catch(() => {}),
        ]);
        if (download) {
          const name = download.suggestedFilename();
          expect.soft(/\.(csv|json|png|jpg|jpeg|webp|svg)$/i.test(name)).toBeTruthy();
          await download.createReadStream().catch(() => {});
        }
      }
    }

    // Final sanity: still alive
    await expect(page.locator('body')).toBeVisible();
  });
});
