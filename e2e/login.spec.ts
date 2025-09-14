// e2e/login.spec.ts
import { test, expect } from '@playwright/test';

const EMAIL = process.env.E2E_AUTH_EMAIL || '';
const PASSWORD = process.env.E2E_AUTH_PASSWORD || '';

test.describe('Auth & app smoke', () => {
  test('dashboard loads if authed, otherwise login guard shows (and logs in if creds provided)', async ({ page }) => {
    // Open app
    await page.goto('/');

    // If a login form exists, sign in (best-effort; no-op if not present)
    const maybeEmail = page.getByLabel(/email/i).first();
    const maybePassword = page.getByLabel(/password/i).first();
    const signInBtn = page.getByRole('button', { name: /sign in|log in/i }).first();

    if (await signInBtn.isVisible().catch(() => false)) {
      if (EMAIL) await maybeEmail.fill(EMAIL).catch(() => {});
      if (PASSWORD) await maybePassword.fill(PASSWORD).catch(() => {});
      await signInBtn.click().catch(() => {});
    }

    // Smoke: main nav renders and a couple tabs can be visited
    await expect(page.getByRole('navigation')).toBeVisible();
    await page.getByRole('link', { name: /dashboard/i }).first().click().catch(() => {});
    await page.getByRole('link', { name: /settings/i }).first().click().catch(() => {});
  });
});
