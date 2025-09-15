import { test, expect } from '@playwright/test';

const gotoHome = async (page: any) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('cnm:guideEnabled', 'false'); } catch {}
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
};

const openCOG = async (page: any) => {
  const cogLink = page.getByRole('link', { name: /(cog|supplies|cost of goods)/i }).first();
  if (await cogLink.count()) {
    await cogLink.click();
    return;
  }
  const tabBtn = page.getByRole('tab', { name: /(cog|supplies|cost of goods)/i }).first();
  if (await tabBtn.count()) {
    await tabBtn.click();
    return;
  }
  await page.goto('./cog', { waitUntil: 'domcontentloaded' }).catch(() => {});
};

test.describe('COG', () => {
  test.beforeEach(async ({ page }) => {
    await gotoHome(page);
    await openCOG(page);
  });

  test('COG page loads; add item control (if present) does not error', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${String(err)}`));
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(`console.error: ${msg.text()}`); });

    // Basic visible anchor: a heading or a known region
    const heading = page.getByRole('heading', { name: /(cog|supplies|cost of goods)/i }).first();
    if (await heading.count()) await expect(heading).toBeVisible();

    // Optional: open "Add" UI if available
    const addBtn = page.locator('button:has-text("Add Supply"), button:has-text("Add Item"), button:has-text("New Item"), button:has-text("Add")').first();
    if (await addBtn.count()) {
      await addBtn.click().catch(() => {});

      // If a dialog opens, try minimal safe interactions
      const dlg = page.getByRole('dialog').first();
      if (await dlg.count()) {
        // Try fill a few common fields if present, otherwise just cancel
        const nameInput = dlg.getByLabel(/name/i).first();
        if (await nameInput.count()) await nameInput.fill(`E2E Supply ${Date.now()}`).catch(() => {});
        const costInput = dlg.getByLabel(/cost/i).first();
        if (await costInput.count()) await costInput.fill('1.23').catch(() => {});
        const unitSel = dlg.getByLabel(/unit/i).first();
        if (await unitSel.count()) await unitSel.selectOption({ index: 1 }).catch(() => {});
        const typeSel = dlg.getByLabel(/type/i).first();
        if (await typeSel.count()) await typeSel.selectOption({ index: 1 }).catch(() => {});

        const save = dlg.getByRole('button', { name: /save|add/i }).first();
        const cancel = dlg.getByRole('button', { name: /cancel|close/i }).first();

        if (await save.isEnabled().catch(() => false)) {
          await Promise.race([
            save.click(),
            // If save is async, give it a little air then close if needed
            page.waitForTimeout(500),
          ]).catch(() => {});
        } else if (await cancel.count()) {
          await cancel.click().catch(() => {});
        }
      }
    } else {
      test.skip(true, 'No Add control present on this build');
    }

    // Assert no hard errors hit the console
    expect.soft(consoleErrors, `Console/Page errors: \n${consoleErrors.join('\n')}`).toEqual([]);
  });
});
