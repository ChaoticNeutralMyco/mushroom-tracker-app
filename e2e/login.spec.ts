// e2e/login.spec.ts
import { test, expect } from '@playwright/test';

const EMAIL = process.env.E2E_AUTH_EMAIL || '';
const PASSWORD = process.env.E2E_AUTH_PASSWORD || '';

function basePath(): string {
  if (process.env.BASE_PATH) return process.env.BASE_PATH; // e.g. "/mushroom-tracker-app/"
  const repo = process.env.GITHUB_REPOSITORY?.split('/').pop();
  return repo ? `/${repo}/` : '/';
}
const BASE = basePath();

async function gotoRoot(page) {
  await page.goto(BASE);
  await page.waitForLoadState('domcontentloaded');
  // Give the SPA a moment to paint and settle
  await page.waitForLoadState('networkidle').catch(() => {});
}

test.describe('Auth & app smoke', () => {
  test('dashboard loads if authed, otherwise login guard shows (and logs in if creds provided)', async ({ page }) => {
    await gotoRoot(page);

    // Attempt login only if a form is present
    const loginBtn = page.getByRole('button', { name: /sign in|log in/i }).first();
    if (await loginBtn.isVisible().catch(() => false)) {
      if (EMAIL) await page.getByLabel(/email/i).first().fill(EMAIL).catch(() => {});
      if (PASSWORD) await page.getByLabel(/password/i).first().fill(PASSWORD).catch(() => {});
      await loginBtn.click().catch(() => {});
      await page.waitForLoadState('networkidle').catch(() => {});
    }

    // Dismiss any modal/onboarding "close"/"got it" buttons if they appear
    const maybeClose = page.getByRole('button', { name: /got it|close|dismiss|ok/i }).first();
    if (await maybeClose.isVisible().catch(() => false)) {
      await maybeClose.click().catch(() => {});
    }

    // Look for any of your known nav items
    const navNames = [
      /dashboard/i, /analytics/i, /calendar/i, /timeline/i, /cog/i,
      /recipes/i, /strains/i, /labels/i, /archive/i, /settings/i, /scan/i,
    ];
    let seen = false;
    for (const n of navNames) {
      const link = page.getByRole('link', { name: n }).first();
      if (await link.isVisible().catch(() => false)) { seen = true; break; }
    }

    // Fallback: H1 title
    if (!seen) {
      const h1 = page.getByRole('heading', { level: 1 });
      seen = await h1.isVisible().catch(() => false);
    }

    expect(seen).toBeTruthy();

    // Optional: click Settings if present and verify URL
    const settingsLink = page.getByRole('link', { name: /settings/i }).first();
    if (await settingsLink.isVisible().catch(() => false)) {
      await settingsLink.click();
      await expect(page).toHaveURL(new RegExp(`${BASE}settings/?$`));
    }
  });
});
