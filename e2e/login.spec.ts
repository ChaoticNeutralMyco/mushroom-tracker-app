import { test, expect, Locator, Page } from '@playwright/test';

function getCreds(raw?: string) {
  if (!raw) throw new Error('TEST_ACCOUNT env missing');
  try {
    const { email, password } = JSON.parse(raw);
    if (!email || !password) throw new Error('bad');
    return { email, password };
  } catch {
    throw new Error('TEST_ACCOUNT must be JSON like {"email":"x","password":"y"}');
  }
}

async function pickFirst(...locators: Locator[]): Promise<Locator | null> {
  for (const l of locators) if (await l.count()) return l.first();
  return null;
}

async function isDashboard(page: Page): Promise<Locator | null> {
  const header = page.getByRole('heading', { name: /chaotic neutral tracker/i });
  if (await header.count()) return header;
  const signOut = page.getByRole('button', { name: /sign out/i });
  if (await signOut.count()) return signOut;
  // common nav chip labels
  const navChip = page.getByRole('button', { name: /dashboard|tasks|analytics|calendar|timeline/i }).first();
  if (await navChip.count()) return navChip;
  // header title without role (fallback)
  const fallbackHeader = page.locator('header :text("Chaotic Neutral Tracker")');
  if (await fallbackHeader.count()) return fallbackHeader.first();
  return null;
}

async function waitPastSplash(page: Page, timeoutMs = 15_000) {
  const start = Date.now();
  // Log console errors/warnings for visibility
  page.on('console', (msg) => {
    const t = msg.type();
    if (t === 'error' || t === 'warning') console.log(`[console.${t}] ${msg.text()}`);
  });

  // Common splash/loading markers
  const splashLike = [
    page.getByText(/loading…?|loading\.{0,3}$/i),
    page.locator('[data-testid="splash"], .splash, .loading, [aria-busy="true"]'),
  ];

  // Poll until either dashboard or auth appears, or splash disappears
  while (Date.now() - start < timeoutMs) {
    const dash = await isDashboard(page);
    if (dash) return 'dashboard';

    // Quick auth hints
    const anyAuthMarker = await pickFirst(
      page.getByRole('heading', { name: /sign in|log in|welcome|authenticate/i }),
      page.getByText(/sign in|log in|continue/i),
      page.locator('input[type="email"]'),
      page.locator('input[type="password"]')
    );
    if (anyAuthMarker) return 'auth';

    // If a splash-y thing is visible, keep waiting a bit
    for (const l of splashLike) {
      if ((await l.count()) && (await l.first().isVisible().catch(() => false))) {
        await page.waitForTimeout(350);
        continue;
      }
    }

    // One small idle wait between polls
    await page.waitForTimeout(250);
  }
  return 'unknown';
}

test.describe('Auth & app smoke', () => {
  test('logs in (or shows a clear auth error) and loads/guards dashboard', async ({ page }) => {
    test.setTimeout(90_000);

    // Navigate but don’t wait for "load" (dev SW/chunks can keep loading)
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Give the app a moment to pass the splash/initial lazy mount
    const phase = await waitPastSplash(page, 20_000);

    // If already authenticated, we’re done
    const dashNow = await isDashboard(page);
    if (dashNow) {
      await expect(dashNow).toBeVisible();
      return;
    }

    // Try to locate the email/password form across common patterns
    const email = await pickFirst(
      page.getByLabel(/email/i),
      page.getByPlaceholder(/email/i),
      page.locator('input[type="email"]'),
      page.locator('input[name*="email" i]'),
      page.locator('input[autocomplete="username"]')
    );
    const password = await pickFirst(
      page.getByLabel(/password/i),
      page.getByPlaceholder(/password/i),
      page.locator('input[type="password"]'),
      page.locator('input[name*="password" i]'),
      page.locator('input[autocomplete="current-password"]')
    );
    const submit = await pickFirst(
      page.getByRole('button', { name: /sign in|log in|continue|submit|next/i }),
      page.locator('button[type="submit"]')
    );

    if (!email || !password || !submit) {
      // No obvious form; assert we at least show an auth screen or a guard
      const authMarker = await pickFirst(
        page.getByRole('heading', { name: /sign in|log in|welcome|authenticate/i }),
        page.getByText(/sign in|log in|continue/i)
      );

      // Last ditch: maybe dashboard header text differs or casing changes
      const dashAny = await isDashboard(page);

      expect(
        authMarker || dashAny,
        `Expected auth or dashboard after splash (${phase}), but found neither`
      ).not.toBeNull();

      await expect((authMarker || dashAny)!).toBeVisible();
      return;
    }

    // Perform login
    const creds = getCreds(process.env.TEST_ACCOUNT);
    await email.fill(creds.email);
    await password.fill(creds.password);
    await Promise.all([
      page.waitForLoadState('domcontentloaded'),
      submit.click(),
    ]);

    // Wait for either dashboard UI or a visible auth error
    const dashboardHeader = page.getByRole('heading', { name: /chaotic neutral tracker/i });
    const errorBanner = page.locator('[role="alert"], .error, .text-red-500, .text-red-600, [data-error], .toast-error');

    const winner = await Promise.race([
      dashboardHeader.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'dashboard').catch(() => null),
      errorBanner.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'error').catch(() => null),
    ]);

    if (winner === 'dashboard') {
      await expect(dashboardHeader).toBeVisible();
    } else if (winner === 'error') {
      await expect(errorBanner).toBeVisible();
    } else {
      const dashAny2 = await isDashboard(page);
      expect(dashAny2, 'Neither dashboard nor a clear auth error appeared after login').not.toBeNull();
      await expect(dashAny2!).toBeVisible();
    }
  });

  test('PWA manifest is served', async ({ request, baseURL }) => {
    const res = await request.get(new URL('manifest.webmanifest', baseURL).toString());
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(json).toHaveProperty('name');
    expect(json).toHaveProperty('icons');
  });
});
