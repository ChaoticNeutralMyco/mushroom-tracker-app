// tests/e2e/setup.auth.ts
import fs from "fs";
import path from "path";
import { test, expect, Page, Locator } from "@playwright/test";

const authStatePath = path.join("tests", "e2e", ".auth", "user.json");

function safeVisible(locator: Locator) {
  return locator.isVisible().catch(() => false);
}

function safeEnabled(locator: Locator) {
  return locator.isEnabled().catch(() => false);
}

function authLocators(page: Page) {
  return {
    emailInput: page.locator('input[type="email"]').first(),
    passwordInput: page.locator('input[type="password"]').first(),
    signInButton: page.getByRole("button", { name: /^Sign in$/i }),
    needAccountButton: page.getByRole("button", { name: /Need an account\?/i }),
    createAccountButton: page.getByRole("button", { name: /Create account/i }),
    signOutButton: page.getByRole("button", { name: /Sign out/i }),
    dashboardTab: page.getByRole("tab", { name: /^Dashboard$/i }),
    tutorialHeading: page.getByText(/Welcome to your Dashboard/i),
    tutorialSkip: page.getByRole("button", { name: /^Skip$/i }),
  };
}

async function fillAuthForm(page: Page, email: string, password: string) {
  const { emailInput, passwordInput } = authLocators(page);

  await expect(emailInput).toBeVisible({ timeout: 30_000 });
  await expect(passwordInput).toBeVisible({ timeout: 30_000 });

  await emailInput.fill(email);
  await passwordInput.fill(password);
}

async function isSignedIn(page: Page) {
  const { signOutButton, dashboardTab, tutorialHeading } = authLocators(page);

  if (await safeVisible(signOutButton)) return true;
  if (await safeVisible(dashboardTab)) return true;
  if (await safeVisible(tutorialHeading)) return true;

  return false;
}

async function waitForSignedIn(page: Page) {
  await expect
    .poll(
      async () => {
        return await isSignedIn(page);
      },
      {
        timeout: 60_000,
        intervals: [250, 500, 1000, 1500, 2000],
      }
    )
    .toBe(true);
}

async function dismissTutorialIfPresent(page: Page) {
  const { tutorialHeading, tutorialSkip } = authLocators(page);

  if (await safeVisible(tutorialHeading)) {
    if (await safeVisible(tutorialSkip)) {
      await tutorialSkip.click();
      await expect(tutorialHeading).toBeHidden({ timeout: 15_000 });
    }
  }
}

async function trySignIn(page: Page, email: string, password: string) {
  const { signInButton, emailInput, needAccountButton } = authLocators(page);

  await fillAuthForm(page, email, password);

  await expect(signInButton).toBeVisible({ timeout: 20_000 });
  await expect(signInButton).toBeEnabled({ timeout: 20_000 });
  await signInButton.click();

  try {
    await waitForSignedIn(page);
    return "signed-in";
  } catch {
    const stillOnAuth = await safeVisible(emailInput);
    const canOpenSignup = await safeEnabled(needAccountButton);

    if (stillOnAuth && canOpenSignup) {
      return "needs-signup";
    }

    if (await isSignedIn(page)) {
      return "signed-in";
    }

    return "unknown";
  }
}

async function tryCreateAccount(page: Page, email: string, password: string) {
  const { needAccountButton, createAccountButton } = authLocators(page);

  await expect(needAccountButton).toBeVisible({ timeout: 20_000 });
  await expect(needAccountButton).toBeEnabled({ timeout: 20_000 });
  await needAccountButton.click();

  await fillAuthForm(page, email, password);

  await expect(createAccountButton).toBeVisible({ timeout: 20_000 });
  await expect(createAccountButton).toBeEnabled({ timeout: 20_000 });
  await createAccountButton.click();

  await waitForSignedIn(page);
}

test("authenticate dedicated e2e user", async ({ page, context }) => {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "Set E2E_EMAIL and E2E_PASSWORD in .env.e2e.local before running Playwright."
    );
  }

  await page.goto("/", { waitUntil: "domcontentloaded" });

  if (await isSignedIn(page)) {
    await dismissTutorialIfPresent(page);
    fs.mkdirSync(path.dirname(authStatePath), { recursive: true });
    await context.storageState({ path: authStatePath });
    return;
  }

  const authResult = await trySignIn(page, email, password);

  if (authResult === "needs-signup") {
    await tryCreateAccount(page, email, password);
  } else if (authResult === "unknown") {
    throw new Error(
      "Auth did not reach either a signed-in dashboard state or a stable signup state."
    );
  }

  await waitForSignedIn(page);
  await dismissTutorialIfPresent(page);

  fs.mkdirSync(path.dirname(authStatePath), { recursive: true });
  await context.storageState({ path: authStatePath });
});