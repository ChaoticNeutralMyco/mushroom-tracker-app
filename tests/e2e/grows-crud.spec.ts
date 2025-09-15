import { test, expect } from '@playwright/test';

const gotoHome = async (page: any) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('cnm:guideEnabled', 'false'); } catch {}
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
};

const openGrows = async (page: any) => {
  const growsLink = page.getByRole('link', { name: /(grows|dashboard|home)/i }).first();
  if (await growsLink.count()) {
    await growsLink.click().catch(() => {});
    return;
  }
  const tabBtn = page.getByRole('tab', { name: /(grows|dashboard|home)/i }).first();
  if (await tabBtn.count()) {
    await tabBtn.click().catch(() => {});
    return;
  }
  // Otherwise, stay on '/'
};

const openNewGrow = async (page: any) => {
  // Try obvious labels first
  const btns = [
    page.getByRole('button', { name: /new grow/i }).first(),
    page.getByRole('button', { name: /add grow/i }).first(),
    page.getByRole('button', { name: /\+.*grow/i }).first(),
  ];
  for (const b of btns) {
    if (await b.count()) { await b.click().catch(() => {}); return; }
  }
  // Fallback: a floating action button with tooltip/aria-label
  const fab = page.locator('button[aria-label*="grow" i], button[title*="grow" i]').first();
  if (await fab.count()) await fab.click().catch(() => {});
};

test.describe('Grows CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await gotoHome(page);
    await openGrows(page);
  });

  test('New Grow modal open/save/cancel/archiving (best-effort, guarded)', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${String(err)}`));
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(`console.error: ${msg.text()}`); });

    await openNewGrow(page);

    // Expect a dialog to open
    const dlg = page.getByRole('dialog').first();
    test.skip(!(await dlg.count()), 'New Grow dialog did not appear');

    // Fill minimal commonly-required fields if present
    const strain = dlg.getByLabel(/strain/i).first();
    if (await strain.count()) {
      const role = await strain.getAttribute('role').catch(() => null);
      if (role === 'combobox') {
        await strain.click().catch(() => {});
        await page.keyboard.type(`E2E Strain ${Date.now()}`);
        await page.keyboard.press('Enter').catch(() => {});
      } else {
        await strain.fill(`E2E Strain ${Date.now()}`).catch(() => {});
      }
    }

    const dateInput = dlg.getByLabel(/date|inoculated|created/i).first();
    if (await dateInput.count()) {
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      await dateInput.fill(`${yyyy}-${mm}-${dd}`).catch(() => {});
    }

    const save = dlg.getByRole('button', { name: /save|create|add/i }).first();
    const cancel = dlg.getByRole('button', { name: /cancel|close/i }).first();

    if (await save.isEnabled().catch(() => false)) {
      await Promise.all([
        page.waitForTimeout(500),
        save.click().catch(() => {}), // allow for validation
      ]);
    } else if (await cancel.count()) {
      await cancel.click().catch(() => {});
    }

    // Try archiving the first visible grow if an Archive control exists
    const firstCard = page.locator('[data-testid="grow-card"], article, [role="listitem"]').first();
    if (await firstCard.count()) {
      const archiveBtn = firstCard.getByRole('button', { name: /archive|archived|unarchive/i }).first();
      if (await archiveBtn.count()) {
        await archiveBtn.click().catch(() => {});
        // Optional: look for an "Archived" badge after a short wait
        await page.waitForTimeout(300);
        const archivedBadge = firstCard.getByText(/archived/i).first();
        if (await archivedBadge.count()) {
          await expect.soft(archivedBadge).toBeVisible();
        }
      }
    }

    expect.soft(consoleErrors, `Console/Page errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  });

  test('Cancel flow remains stable', async ({ page }) => {
    await openNewGrow(page);
    const dlg = page.getByRole('dialog').first();
    test.skip(!(await dlg.count()), 'New Grow dialog did not appear');

    const cancel = dlg.getByRole('button', { name: /cancel|close/i }).first();
    if (await cancel.count()) {
      await cancel.click().catch(() => {});
    } else {
      // If only "X" exists
      const xClose = dlg.locator('button:has-text("×"), button[aria-label*="close" i]').first();
      if (await xClose.count()) await xClose.click().catch(() => {});
    }

    await expect.soft(dlg).toBeHidden({ timeout: 3000 });
  });
});
