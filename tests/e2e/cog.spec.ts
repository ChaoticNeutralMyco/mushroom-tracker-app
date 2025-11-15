import { test, expect } from '@playwright/test';

async function setup(page: any) {
  await page.addInitScript(() => {
    try { localStorage.setItem('cnm:guideEnabled', 'false'); } catch {}
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const email = page.getByRole('textbox', { name: /email/i }).first();
  if (await email.count()) {
    const user = process.env.E2E_EMAIL || '';
    const pwd  = process.env.E2E_PASSWORD || '';
    if (!user || !pwd) test.skip(true, 'E2E_EMAIL/E2E_PASSWORD not set.');
    await email.fill(user);
    await page.getByLabel(/password/i).fill(pwd);
    await Promise.all([page.waitForLoadState('networkidle').catch(()=>{}), page.getByRole('button', { name: /sign in/i }).click()]);
    await page.waitForTimeout(600);
  }
}

async function openCOG(page: any) {
  const link = page.getByRole('link', { name: /(cog|supplies|cost of goods)/i }).first();
  if (await link.count()) { await link.click(); return; }
  const tabBtn = page.getByRole('tab', { name: /(cog|supplies|cost of goods)/i }).first();
  if (await tabBtn.count()) { await tabBtn.click(); return; }
  const btn = page.getByRole('button', { name: /(cog|supplies|cost of goods)/i }).first();
  if (await btn.count()) { await btn.click(); return; }
  await page.goto('./cog', { waitUntil: 'domcontentloaded' }).catch(() => {});
}

test.describe('COG', () => {
  test.beforeEach(async ({ page }) => { await setup(page); await openCOG(page); });

  test('COG page loads; add item control (if present) does not error', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${String(err)}`));
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(`console.error: ${msg.text()}`); });

    const heading = page.getByRole('heading', { name: /(cog|supplies|cost of goods)/i }).first();
    if (await heading.count()) await expect(heading).toBeVisible();

    const addBtn = page.locator('button:has-text("Add Supply"), button:has-text("Add Item"), button:has-text("New Item"), button:has-text("Add")').first();
    if (await addBtn.count()) {
      await addBtn.click().catch(() => {});
      const dlg = page.getByRole('dialog').first();
      if (await dlg.count()) {
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
          await Promise.race([save.click().catch(() => {}), page.waitForTimeout(500)]);
        } else if (await cancel.count()) {
          await cancel.click().catch(() => {});
        }
      }
    } else {
      test.skip(true, 'No Add control present on this build');
    }

    expect.soft(consoleErrors, `Console/Page errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  });
});
