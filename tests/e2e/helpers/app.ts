// tests/e2e/helpers/app.ts
import { expect, Locator, Page } from "@playwright/test";

export type GrowRowMatcher =
  | RegExp
  | string
  | {
      title?: RegExp | string;
      strain?: RegExp | string;
      type?: RegExp | string;
      stage?: RegExp | string;
      status?: RegExp | string;
    };

type FirebaseAuthState = {
  uid: string;
  persisted: boolean;
  authEmulator: boolean;
};

function safeVisible(locator: Locator) {
  return locator.isVisible().catch(() => false);
}

function emulatorHarnessRequired() {
  return /^(1|true|yes)$/i.test(
    String(process.env.E2E_REQUIRE_FIREBASE_EMULATORS || "")
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toTextMatcher(matcher: RegExp | string) {
  return typeof matcher === "string"
    ? new RegExp(escapeRegExp(matcher), "i")
    : matcher;
}

function isStructuredGrowMatcher(
  matcher: GrowRowMatcher
): matcher is Exclude<GrowRowMatcher, string | RegExp> {
  return typeof matcher === "object" && matcher !== null && !(matcher instanceof RegExp);
}

function filterRowByField(
  row: Locator,
  page: Page,
  testId: string,
  matcher?: RegExp | string
) {
  if (!matcher) return row;

  return row.filter({
    has: page.getByTestId(testId).filter({
      hasText: toTextMatcher(matcher),
    }),
  });
}

function tabNameMatcher(tabName: string) {
  const normalized = String(tabName || "").trim().toLowerCase();

  if (normalized === "post process" || normalized === "post processing") {
    return /^Post Process(?:ing)?$/i;
  }

  return new RegExp(`^${escapeRegExp(tabName)}$`, "i");
}

async function markGuideToursSeen(page: Page) {
  await page
    .evaluate(() => {
      const routeKeys = [
        "dashboard",
        "tasks",
        "analytics",
        "calendar",
        "timeline",
        "postprocess",
        "cog",
        "recipes",
        "strains",
        "labels",
        "archive",
        "settings",
      ];

      for (const routeKey of routeKeys) {
        localStorage.setItem(`tour.seen:${routeKey}`, "1");
      }
    })
    .catch(() => {});
}

async function dismissTutorialIfPresent(page: Page) {
  const guideDialog = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("button", { name: /^Skip$/i }) })
    .last();
  const guideSkip = guideDialog.getByRole("button", { name: /^Skip$/i });

  if (await safeVisible(guideSkip)) {
    await guideSkip.click();
    await expect(guideDialog).toBeHidden({ timeout: 15_000 });
  }
}

async function readFirebaseAuthState(page: Page): Promise<FirebaseAuthState> {
  return page.evaluate(async () => {
    const mod = await import("/src/firebase-config.js");
    await mod.authReady;

    if (typeof mod.auth.authStateReady === "function") {
      await mod.auth.authStateReady();
    }

    const uid = String(mod.auth.currentUser?.uid || "");
    const authEntries = Object.keys(localStorage)
      .filter((key) => key.startsWith("firebase:authUser:"))
      .map((key) => ({ key, value: String(localStorage.getItem(key) || "") }));
    const persisted = Boolean(
      uid &&
        authEntries.some(
          (entry) => entry.value.includes(uid) || authEntries.length === 1
        )
    );

    return {
      uid,
      persisted,
      authEmulator: Boolean((mod.auth as any)?.emulatorConfig),
    };
  });
}

async function signInEmulatorThroughUi(page: Page) {
  if (!emulatorHarnessRequired()) {
    throw new Error("Firebase authentication was lost outside the emulator harness.");
  }

  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "The emulator harness cannot restore authentication without E2E_EMAIL and E2E_PASSWORD."
    );
  }

  const emailInput = page.locator('input[type="email"]').first();
  const passwordInput = page.locator('input[type="password"]').first();
  const signInButton = page.getByRole("button", { name: /^Sign in$/i });

  await expect(emailInput).toBeVisible({ timeout: 20_000 });
  await expect(passwordInput).toBeVisible({ timeout: 20_000 });
  await emailInput.fill(email);
  await passwordInput.fill(password);
  await expect(signInButton).toBeEnabled({ timeout: 20_000 });
  await signInButton.click();
}

async function shellOrAuthState(page: Page) {
  const signOutButton = page.getByRole("button", { name: /sign out/i });
  const dashboardTab = page.getByRole("tab", { name: /^Dashboard$/i });
  const tutorialHeading = page.getByText(/Welcome to your Dashboard/i);
  const emailInput = page.locator('input[type="email"]').first();
  const passwordInput = page.locator('input[type="password"]').first();
  const signInButton = page.getByRole("button", { name: /^Sign in$/i });

  if (
    (await safeVisible(signOutButton)) ||
    (await safeVisible(dashboardTab)) ||
    (await safeVisible(tutorialHeading))
  ) {
    return "shell" as const;
  }

  if (
    (await safeVisible(emailInput)) &&
    (await safeVisible(passwordInput)) &&
    (await safeVisible(signInButton))
  ) {
    return "auth" as const;
  }

  return "pending" as const;
}

async function waitForShellOrAuth(page: Page, timeoutMs = 45_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const state = await shellOrAuthState(page);
    if (state !== "pending") return state;
    await page.waitForTimeout(250);
  }

  throw new Error("The app did not reach either an authenticated shell or the sign-in form.");
}

export async function waitForFirebaseAuthSession(
  page: Page,
  timeoutMs = 45_000
) {
  const startedAt = Date.now();
  let lastState: FirebaseAuthState | null = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      lastState = await readFirebaseAuthState(page);
      const emulatorOkay =
        !emulatorHarnessRequired() || lastState.authEmulator;

      if (lastState.uid && lastState.persisted && emulatorOkay) {
        return lastState;
      }
    } catch {
      // Ignore transient module/navigation errors while the app settles.
    }

    await page.waitForTimeout(250);
  }

  throw new Error(
    `Firebase Auth did not reach a durable signed-in state. uid=${lastState?.uid || "none"} persisted=${String(lastState?.persisted || false)} emulator=${String(lastState?.authEmulator || false)}`
  );
}

async function waitForOptionValueByText(
  locator: Locator,
  matcher: RegExp | string,
  timeoutMs = 20_000
) {
  const startedAt = Date.now();
  const payload =
    typeof matcher === "string"
      ? { pattern: matcher, flags: "i" }
      : { pattern: matcher.source, flags: matcher.flags };

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const optionValue = await locator.locator("option").evaluateAll(
        (options, input) => {
          const regex = new RegExp(input.pattern, input.flags);
          const found = options.find((option) =>
            regex.test(option.textContent || "")
          );
          return found ? (found as HTMLOptionElement).value : "";
        },
        payload
      );

      if (optionValue) return optionValue;
    } catch {
      // ignore transient detach / re-render errors while the form settles
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`Could not find option matching ${String(matcher)}`);
}

export async function waitForAppShell(page: Page) {
  let state = await waitForShellOrAuth(page);

  if (state === "auth") {
    await signInEmulatorThroughUi(page);
    state = await waitForShellOrAuth(page);
  }

  if (state !== "shell") {
    throw new Error("The app did not reach the authenticated shell.");
  }

  if (emulatorHarnessRequired()) {
    await waitForFirebaseAuthSession(page);
  }
  await markGuideToursSeen(page);
  await dismissTutorialIfPresent(page);
  await expect(page.getByRole("tab", { name: /^Dashboard$/i })).toBeVisible({
    timeout: 15_000,
  });
}

export async function gotoDashboard(page: Page) {
  await page.goto("/");
  await waitForAppShell(page);
}

export async function clickAppTab(page: Page, tabName: string) {
  const matcher = tabNameMatcher(tabName);
  let tab = page.getByRole("tab", { name: matcher });

  if (!(await safeVisible(tab))) {
    await page.goto("/");
    await waitForAppShell(page);
    tab = page.getByRole("tab", { name: matcher });
  }

  await expect(tab).toBeVisible({ timeout: 20_000 });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true", {
    timeout: 20_000,
  });
  await markGuideToursSeen(page);
  await dismissTutorialIfPresent(page);
}

export async function confirmDialog(
  page: Page,
  confirmName: RegExp = /^(Confirm|Delete)$/i
) {
  const dialog = page.getByRole("dialog").last();
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("button", { name: confirmName }).click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
}

export async function openNewGrow(page: Page) {
  await page.getByRole("button", { name: /\+ New Grow/i }).click();
  await expect(page.locator("form.grow-form")).toBeVisible();
}

export function growRowByText(page: Page, text: GrowRowMatcher) {
  if (isStructuredGrowMatcher(text)) {
    let row = page.getByTestId("grow-row");
    row = filterRowByField(row, page, "grow-row-title", text.title);
    row = filterRowByField(row, page, "grow-row-strain", text.strain);
    row = filterRowByField(row, page, "grow-row-type", text.type);
    row = filterRowByField(row, page, "grow-row-stage", text.stage);
    row = filterRowByField(row, page, "grow-row-status", text.status);
    return row.first();
  }

  return page
    .locator("div")
    .filter({ hasText: text })
    .filter({ has: page.getByRole("button", { name: /^Stage \+$/i }) })
    .first();
}

export async function expectGrowRow(page: Page, text: GrowRowMatcher) {
  const row = growRowByText(page, text);
  await expect(row).toBeVisible({ timeout: 20_000 });
  return row;
}

export async function setDateInput(locator: Locator, value: string) {
  await locator.fill(value);
  await locator.dispatchEvent("input");
  await locator.dispatchEvent("change");
}

export async function selectOptionByText(
  locator: Locator,
  matcher: RegExp | string
) {
  await expect(locator).toBeVisible({ timeout: 20_000 });
  const optionValue = await waitForOptionValueByText(locator, matcher, 20_000);
  await locator.selectOption(optionValue);
}

export function controlAfterLabel(
  container: Locator,
  labelText: string,
  tagName: "input" | "select" | "textarea"
) {
  return container
    .locator("label", { hasText: labelText })
    .locator(`xpath=following-sibling::${tagName}[1]`)
    .first();
}

export function buttonByText(container: Locator, text: RegExp | string) {
  const name = typeof text === "string" ? new RegExp(escapeRegExp(text), "i") : text;

  return container.getByRole("button", { name });
}
