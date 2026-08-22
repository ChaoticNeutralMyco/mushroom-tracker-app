// tests/e2e/setup.auth.ts
import fs from "fs";
import path from "path";
import { test, expect, Page, Locator } from "@playwright/test";
import { waitForFirebaseAuthSession } from "./helpers/app";

const authStatePath = path.join("tests", "e2e", ".auth", "user.json");

function safeVisible(locator: Locator) {
  return locator.isVisible().catch(() => false);
}

function safeEnabled(locator: Locator) {
  return locator.isEnabled().catch(() => false);
}

function isTransientRuntimeEvaluationError(error: unknown) {
  const message = String((error as any)?.message || error || "");
  return /execution context was destroyed|cannot find context|most likely because of a navigation|target page, context or browser has been closed|frame was detached/i.test(
    message
  );
}

async function readFirebaseEmulatorRuntime(
  page: Page,
  { functionsRequired = false } = {}
) {
  const timeoutMs = 60_000;
  const startedAt = Date.now();
  let lastError = "No runtime result was returned.";

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await page
        .waitForLoadState("domcontentloaded", { timeout: 5_000 })
        .catch(() => undefined);

      const runtime = await page.evaluate(async () => {
        const mod = await import("/src/firebase-config.js");
        await mod.authReady;

        if (typeof mod.auth.authStateReady === "function") {
          await mod.auth.authStateReady();
        }

        const authAny = mod.auth as any;
        const dbAny = mod.db as any;
        const functionsBridge = (globalThis as any).__CNM_FUNCTIONS_E2E__;

        return {
          authEmulator: Boolean(authAny?.emulatorConfig),
          firestoreHost: String(
            dbAny?._settings?.host ||
              dbAny?._settingsFrozen?.host ||
              ""
          ),
          functionsBridgeReady: Boolean(functionsBridge),
          functionsEmulator: Boolean(functionsBridge?.connected),
          functionsHost: String(functionsBridge?.host || ""),
          functionsPort: Number(functionsBridge?.port || 0),
        };
      });

      if (
        !runtime.authEmulator ||
        (functionsRequired && !runtime.functionsBridgeReady)
      ) {
        lastError = "The browser Firebase emulator runtime is still initializing.";
        await page.waitForTimeout(250);
        continue;
      }

      return runtime;
    } catch (error) {
      lastError = String((error as any)?.message || error || "Unknown error");
      if (!isTransientRuntimeEvaluationError(error)) {
        throw error;
      }
      await page.waitForTimeout(250);
    }
  }

  throw new Error(
    `Could not inspect the browser Firebase emulator runtime within ${timeoutMs}ms. Last error: ${lastError}`
  );
}

async function assertRequiredFirebaseEmulators(page: Page) {
  const required = /^(1|true|yes)$/i.test(
    String(process.env.E2E_REQUIRE_FIREBASE_EMULATORS || "")
  );
  if (!required) return;

  const functionsRequired = /^(1|true|yes)$/i.test(
    String(process.env.E2E_REQUIRE_FUNCTIONS_EMULATOR || "")
  );

  if (
    !process.env.FIRESTORE_EMULATOR_HOST ||
    !process.env.FIREBASE_AUTH_EMULATOR_HOST
  ) {
    throw new Error(
      "E2E_REQUIRE_FIREBASE_EMULATORS is enabled, but Firestore/Auth emulator hosts are missing."
    );
  }

  if (functionsRequired && !process.env.FUNCTIONS_EMULATOR_HOST) {
    throw new Error(
      "E2E_REQUIRE_FUNCTIONS_EMULATOR is enabled, but FUNCTIONS_EMULATOR_HOST is missing."
    );
  }

  const runtime = await readFirebaseEmulatorRuntime(page, { functionsRequired });

  if (!runtime.authEmulator) {
    throw new Error("The browser app did not connect Firebase Auth to the emulator.");
  }

  if (
    runtime.firestoreHost &&
    !/127\.0\.0\.1|localhost/i.test(runtime.firestoreHost)
  ) {
    throw new Error(
      `The browser app resolved a non-emulator Firestore host: ${runtime.firestoreHost}`
    );
  }

  if (functionsRequired && !runtime.functionsEmulator) {
    throw new Error(
      "The browser app did not connect trusted grow mutations to the Functions emulator."
    );
  }

  if (
    functionsRequired &&
    runtime.functionsHost &&
    !/^(127\.0\.0\.1|localhost)$/i.test(runtime.functionsHost)
  ) {
    throw new Error(
      `The browser app resolved a non-local Functions host: ${runtime.functionsHost}`
    );
  }
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
  const authError = page.locator(".text-rose-700, .text-rose-200").first();

  await fillAuthForm(page, email, password);

  await expect(signInButton).toBeVisible({ timeout: 20_000 });
  await expect(signInButton).toBeEnabled({ timeout: 20_000 });
  await signInButton.click();

  const outcome = await expect
    .poll(
      async () => {
        if (await isSignedIn(page)) return "signed-in";
        if (await safeVisible(authError)) return "needs-signup";
        return "pending";
      },
      {
        timeout: 60_000,
        intervals: [250, 500, 1000, 1500, 2000],
      }
    )
    .not.toBe("pending")
    .then(async () => {
      if (await isSignedIn(page)) return "signed-in";
      if (await safeVisible(authError)) return "needs-signup";
      return "unknown";
    })
    .catch(() => "unknown");

  if (outcome === "needs-signup") {
    const stillOnAuth = await safeVisible(emailInput);
    const canOpenSignup = await safeEnabled(needAccountButton);
    return stillOnAuth && canOpenSignup ? "needs-signup" : "unknown";
  }

  return outcome;
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

async function saveDurableAuthState(page: Page, context: any) {
  const emulatorRequired = /^(1|true|yes)$/i.test(
    String(process.env.E2E_REQUIRE_FIREBASE_EMULATORS || "")
  );

  if (emulatorRequired) {
    await waitForFirebaseAuthSession(page);
  }

  fs.mkdirSync(path.dirname(authStatePath), { recursive: true });
  await context.storageState({ path: authStatePath, indexedDB: true });
}

test("authenticate dedicated e2e user", async ({ page, context }) => {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "Set E2E_EMAIL and E2E_PASSWORD in .env.e2e.local before running Playwright."
    );
  }

  if (/^(1|true|yes)$/i.test(String(process.env.E2E_REQUIRE_FIREBASE_EMULATORS || ""))) {
    fs.rmSync(authStatePath, { force: true });
  }

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await assertRequiredFirebaseEmulators(page);

  if (await isSignedIn(page)) {
    await dismissTutorialIfPresent(page);
    await saveDurableAuthState(page, context);
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
  await saveDurableAuthState(page, context);
});
