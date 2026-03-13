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

function safeVisible(locator: Locator) {
  return locator.isVisible().catch(() => false);
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

async function dismissTutorialIfPresent(page: Page) {
  const tutorialHeading = page.getByText(/Welcome to your Dashboard/i);
  const tutorialSkip = page.getByRole("button", { name: /^Skip$/i });

  if (await safeVisible(tutorialHeading)) {
    if (await safeVisible(tutorialSkip)) {
      await tutorialSkip.click();
      await expect(tutorialHeading).toBeHidden({ timeout: 15_000 });
    }
  }
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
  const signOutButton = page.getByRole("button", { name: /sign out/i });
  const dashboardTab = page.getByRole("tab", { name: /^Dashboard$/i });
  const tutorialHeading = page.getByText(/Welcome to your Dashboard/i);

  await expect
    .poll(
      async () => {
        if (await safeVisible(signOutButton)) return true;
        if (await safeVisible(dashboardTab)) return true;
        if (await safeVisible(tutorialHeading)) return true;
        return false;
      },
      {
        timeout: 45_000,
        intervals: [250, 500, 1000, 1500, 2000],
      }
    )
    .toBe(true);

  await dismissTutorialIfPresent(page);
  await expect(dashboardTab).toBeVisible({ timeout: 15_000 });
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