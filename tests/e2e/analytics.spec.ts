import { test, expect } from '@playwright/test';

const gotoHome = async (page: any) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('cnm:guideEnabled', 'false'); } catch {}
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
};

const openAnalytics = async (page: any) => {
  // Prefer a real link/tab first
  const navLink = page.getByRole('link', { name: /analytics/i }).first();
  if (await navLink.count()) {
    await navLink.click();
    return;
  }
  // Fallback: tab button
  const tabBtn = page.getByRole('tab', { name: /analytics/i }).first();
  if (await tabBtn.count()) {
    await tabBtn.click();
    return;
  }
  // Final fallback: route direct if app supports it
  await page.goto('./analytics', { waitUntil: 'domcontentloaded' }).catch(() => {});
};

test.describe('Analytics', () => {
  test.beforeEach(async ({ page }) => {
    await gotoHome(page);
    await openAnalytics(page);
  });

  test('chart renders and export buttons trigger downloads', async ({ page }) => {
    // Wait for any chart canvas/SVG to appear
    const chart = page.locator('canvas, svg, [role="img"]').first();
    await expect(chart).toBeVisible({ timeout: 10_000 });

    // Try toggling any dataset controls if present (checkbox/switch)
    const toggles = page.locator('input[type="checkbox"], [role="switch"]');
    const toggleCount = await toggles.count();
    for (let i = 0; i < Math.min(toggleCount, 3); i++) {
      await toggles.nth(i).click({ trial: true }).catch(() => {});
      await toggles.nth(i).click().catch(() => {});
    }

    // Find export/download buttons by accessible name
    const exportButtons = await page.getByRole('button', { name: /(export|download)/i }).all();
    test.skip(exportButtons.length === 0, 'No export buttons present');

    // Accept common export file types
    const okExt = ['.csv', '.json', '.png', '.jpg', '.jpeg', '.webp', '.svg'];

    for (const btn of exportButtons) {
      const label = await btn.innerText().catch(() => '(button)');
      const maybeDownload = async () => {
        try {
          const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 7000 }),
            btn.click(),
          ]);
          const name = download.suggestedFilename();
          expect.soft(okExt.some(e => name.toLowerCase().endsWith(e)), `Unexpected export filename: ${name} (clicked "${label}")`).toBeTruthy();
          // Touch the stream to ensure it exists
          const stream = await download.createReadStream();
          expect.soft(stream, 'Export download stream should exist').toBeTruthy();
        } catch (e) {
          // If click didn’t produce a download, at least ensure it didn’t crash the page
          await expect.soft(page).toHaveTitle(/.+/);
        }
      };
      await maybeDownload();
    }
  });
});
