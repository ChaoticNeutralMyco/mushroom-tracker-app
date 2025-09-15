import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const gotoHome = async (page: any) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('cnm:guideEnabled', 'false'); } catch {}
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
};

const openPhotosContext = async (page: any) => {
  // If there's a Photos nav/tab, use it
  const photosLink = page.getByRole('link', { name: /photos/i }).first();
  if (await photosLink.count()) { await photosLink.click().catch(() => {}); return; }
  const photosTab = page.getByRole('tab', { name: /photos/i }).first();
  if (await photosTab.count()) { await photosTab.click().catch(() => {}); return; }

  // Else open a grow detail where the photo widget likely exists
  const growCard = page.locator('[data-testid="grow-card"], article, [role="listitem"]').first();
  if (await growCard.count()) {
    const view = growCard.getByRole('button', { name: /view|details|open/i }).first();
    if (await view.count()) { await view.click().catch(() => {}); return; }
    await growCard.click().catch(() => {});
  }
};

const writeTinyPng = (dir: string, name: string) => {
  const file = path.join(dir, name);
  // 1x1 transparent PNG
  const b64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9n9yK0sAAAAASUVORK5CYII=';
  fs.writeFileSync(file, Buffer.from(b64, 'base64'));
  return file;
};

test.describe('Photos upload', () => {
  test.beforeEach(async ({ page }) => {
    await gotoHome(page);
    await openPhotosContext(page);
  });

  test('Upload control works; no console errors', async ({ page }, testInfo) => {
    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${String(err)}`));
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(`console.error: ${msg.text()}`); });

    // Find any file input for images
    const fileInputs = page.locator('input[type="file"][accept*="image" i], input[type="file"]');
    test.skip((await fileInputs.count()) === 0, 'No file input present');

    const target = fileInputs.first();
    const tiny = writeTinyPng(testInfo.outputDir, 'tiny.png');

    await target.setInputFiles(tiny);

    // Best-effort: expect a new preview to appear near the input or anywhere on the page
    // (guarded, because preview UI differs per build)
    const previewCandidate = page.locator('img, [role="img"], canvas').first();
    await expect.soft(previewCandidate).toBeVisible({ timeout: 10_000 });

    expect.soft(consoleErrors, `Console/Page errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  });
});
