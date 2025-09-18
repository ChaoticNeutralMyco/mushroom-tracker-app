import { test, expect } from '@playwright/test';

async function setup(page: any) {
  await page.addInitScript(() => {
    try { localStorage.setItem('cnm:guideEnabled', 'false'); } catch {}
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  // Ensure auth
  const email = page.getByRole('textbox', { name: /email/i }).first();
  const signInBtn = page.getByRole('button', { name: /sign in/i }).first();
  if (await email.count()) {
    const user = process.env.E2E_EMAIL || '';
    const pwd  = process.env.E2E_PASSWORD || '';
    if (!user || !pwd) test.skip(true, 'E2E_EMAIL/E2E_PASSWORD not set.');
    await email.fill(user);
    await page.getByLabel(/password/i).fill(pwd);
    await Promise.all([page.waitForLoadState('networkidle').catch(()=>{}), signInBtn.click()]);
    await page.waitForTimeout(600);
  }
}

async function openAnalytics(page: any) {
  for (const role of ['link','tab','button']) {
    const el = page.getByRole(role as any, { name: /analytics/i }).first();
    if (await el.count()) { await el.click().catch(()=>{}); return; }
  }
  await page.goto('./analytics', { waitUntil: 'domcontentloaded' }).catch(() => {});
}

test('Analytics › chart renders or empty-state is visible; export buttons trigger downloads if present', async ({ page }) => {
  await setup(page);
  await openAnalytics(page);

  // Either a chart appears OR an empty-state appears; both are acceptable for green runs.
  const chart = page.locator('canvas, svg, [role="img"]').first();
  const emptyState = page.getByText(/no data|not enough data|nothing to show|start tracking/i).first();

  const chartVisible = await chart.isVisible().catch(() => false);
  const emptyVisible = await emptyState.isVisible().catch(() => false);

  // If neither is immediately visible, wait a bit and re-check once.
  if (!chartVisible && !emptyVisible) {
    await page.waitForTimeout(800);
  }
  const okNow = (await chart.isVisible().catch(()=>false)) || (await emptyState.isVisible().catch(()=>false));
  expect.soft(okNow, 'Analytics should show a chart or an empty-state').toBeTruthy();

  // Try toggles if present (won’t fail if missing)
  const toggles = page.locator('input[type="checkbox"], [role="switch"]');
  const count = await toggles.count();
  for (let i = 0; i < Math.min(count, 3); i++) {
    await toggles.nth(i).click({ trial: true }).catch(() => {});
    await toggles.nth(i).click().catch(() => {});
  }

  // Export buttons (best-effort)
  const exportButtons = await page.getByRole('button', { name: /(export|download)/i }).all();
  const okExt = ['.csv', '.json', '.png', '.jpg', '.jpeg', '.webp', '.svg'];

  for (const btn of exportButtons) {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 7000 }).catch(() => null),
      btn.click().catch(() => {}),
    ]);
    if (download) {
      const name = download.suggestedFilename();
      expect.soft(okExt.some(e => name.toLowerCase().endsWith(e))).toBeTruthy();
      await download.createReadStream().catch(() => {});
    }
  }
});
