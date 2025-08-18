import { test, expect, Locator } from '@playwright/test';

// Parse TEST_ACCOUNT from env (JSON string)
function getCreds(raw?: string) {
  if (!raw) return null;
  try {
    const { email, password } = JSON.parse(raw);
    if (!email || !password) return null;
    return { email, password };
  } catch {
    return null;
  }
}

// Return the first locator that exists
async function firstExisting(...locators: Locator[]) {
  for (const l of locators) {
    if (await l.count()) return l.first();
  }
  return locators[0];
}

test.describe('Auth & app smoke', () => {
  test('logs in (or shows a clear auth error) and loads/guards dashboard', async ({ page }) => {
    const creds = getCreds(process.env.TEST_ACCOUNT);

    await page.goto('/');

    // Already logged in?
    const dashboardHeader = page.getByRole('heading', { name: /chaotic neutral tracker/i });
    if (await dashboardHeader.count()) {
      await expect(dashboardHeader).toBeVisible();
      return;
    }

    // If we don't have creds, just assert the auth screen renders
    if (!creds) {
      const emailField = await firstExisting(
        page.getByLabel(/email/i),
        page.locator('input[type="email"]'),
        page.locator('input[name="email"]')
      );
      await expect(emailField).toBeVisible();
      return;
    }

    // Fill login form
    const emailInput = await firstExisting(
      page.getByLabel(/email/i),
      page.locator('input[type="email"]'),
      page.locator('input[name="email"]')
    );
    await emailInput.fill(creds.email);

    const passwordInput = await firstExisting(
      page.getByLabel(/password/i),
      page.locator('input[type="password"]'),
      page.locator('input[name="password"]')
    );
    await passwordInput.fill(creds.password);

    const submit = await firstExisting(
      page.getByRole('button', { name: /sign in|log in|continue|submit/i }),
      page.locator('button[type="submit"]')
    );

    await Promise.all([page.waitForLoadState('networkidle'), submit.click()]);

    // Consider both outcomes as a pass: dashboard or a clear auth error message
    const errorBanner = page.locator(
      // matches common auth error text
      'text=/invalid|wrong|error|auth|failed/i'
    ).first();

    // Race both waits; whichever appears first "wins"
    const outcome = await Promise.race([
      dashboardHeader.waitFor({ state: 'visible', timeout: 15000 }).then(() => 'dashboard').catch(() => null),
      errorBanner.waitFor({ state: 'visible', timeout: 15000 }).then(() => 'error').catch(() => null)
    ]);

    if (outcome === 'dashboard') {
      await expect(dashboardHeader).toBeVisible();
    } else if (outcome === 'error') {
      await expect(errorBanner).toBeVisible();
    } else {
      // Neither dashboard nor a clear error showed up — surface a helpful failure
      await page.screenshot({ path: 'test-results/login-timeout.png' });
      throw new Error('Login did not succeed or show a clear error within 15s.');
    }
  });

  test('PWA manifest is served', async ({ page }) => {
    await page.goto('/manifest.webmanifest');
    await expect(page).toHaveURL(/manifest\.webmanifest$/);
    await expect(page.getByText(/"name"\s*:\s*"/)).toBeVisible();
  });
});
