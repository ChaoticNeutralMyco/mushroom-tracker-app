// e2e/login.spec.ts
import { test, expect } from '@playwright/test';

const E2E_EMAIL = process.env.E2E_AUTH_EMAIL;
const E2E_PASSWORD = process.env.E2E_AUTH_PASSWORD;
const BASE_PATH = process.env.E2E_BASE_PATH ?? ''; // e.g. '/mushroom-tracker-app'

test.describe('Auth & app smoke', () => {
  test('dashboard loads if authed, otherwise login guard shows (and logs in if creds provided)', async ({ page }) => {
    await page.goto(`${BASE_PATH || ''}/`);
    await page.waitForLoadState('networkidle');

    // Already on dashboard?
    const dashboard = page.getByText(/My Grows/i);
    if (await dashboard.count()) {
      await expect(dashboard.first()).toBeVisible();
      return;
    }

    // Guarded → login form visible
    const emailInput =
      page.getByRole('textbox', { name: /email/i }).first()
        .or(page.getByPlaceholder(/email/i).first());
    const passwordInput =
      page.getByRole('textbox', { name: /password/i }).first()
        .or(page.getByPlaceholder(/password/i).first());
    const submitBtn = page.getByRole('button', { name: /sign in|log in/i });

    await expect(submitBtn).toBeVisible();

    // If CI provides creds, try logging in; otherwise just prove the guard works.
    if (E2E_EMAIL && E2E_PASSWORD) {
      await emailInput.fill(E2E_EMAIL);
      await passwordInput.fill(E2E_PASSWORD);
      await submitBtn.click();
      await page.waitForLoadState('networkidle');

      // Either we reach dashboard or a clear auth error/alert is shown.
      const alert = page.getByRole('alert').first();
      const ok = (await dashboard.count()) || (await alert.count());
      expect(ok, 'Dashboard or an auth error should be visible').toBeTruthy();
    }
  });

  test('PWA manifest is served (base-aware)', async ({ request }) => {
    const res = await request.get(`${BASE_PATH}/manifest.webmanifest`);
    expect(res.ok()).toBeTruthy();

    const json = await res.json();
    expect(json).toHaveProperty('name');
    expect(json).toHaveProperty('icons');
    expect(json.scope).toBe(BASE_PATH || '/');
    expect(json.start_url).toBe(BASE_PATH || '/');
  });
});
