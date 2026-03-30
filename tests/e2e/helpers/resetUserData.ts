// tests/e2e/helpers/resetUserData.ts
import { Locator, Page, expect } from "@playwright/test";
import { clickAppTab } from "./app";

async function retry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;

  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }

  throw lastError;
}

function advancedTab(page: Page) {
  return page.getByRole("tab", { name: /^Advanced$/i }).first();
}

function advancedPanel(page: Page) {
  return page.getByRole("tabpanel", { name: /Advanced settings/i }).first();
}

function deleteAllButtonInAdvanced(page: Page) {
  return advancedPanel(page)
    .getByRole("button", { name: /^Delete All Data$/i })
    .first();
}

function deleteAllHeading(page: Page) {
  return page.getByRole("heading", { name: /Delete ALL Data/i }).first();
}

function deleteAllConfirmInput(page: Page) {
  return page.getByPlaceholder("DELETE").last();
}

function confirmDeleteButton(page: Page) {
  return page.getByRole("button", { name: /^Confirm Delete$/i }).last();
}

export async function resetUserDataViaSettings(page: Page) {
  await clickAppTab(page, "Settings");

  const advTab = advancedTab(page);
  await expect(advTab).toBeVisible({ timeout: 20_000 });
  await advTab.click();
  await expect(advTab).toHaveAttribute("aria-selected", "true", {
    timeout: 10_000,
  });

  const panel = advancedPanel(page);
  await expect(panel).toBeVisible({ timeout: 20_000 });

  const deleteAllButton = deleteAllButtonInAdvanced(page);
  await deleteAllButton.scrollIntoViewIfNeeded();
  await expect(deleteAllButton).toBeVisible({ timeout: 20_000 });
  await expect(deleteAllButton).toBeEnabled({ timeout: 20_000 });

  await retry(async () => {
    await deleteAllButton.scrollIntoViewIfNeeded();
    await deleteAllButton.click({ force: true });
    await expect(deleteAllHeading(page)).toBeVisible({ timeout: 15_000 });
  });

  const confirmInput = deleteAllConfirmInput(page);
  await expect(confirmInput).toBeVisible({ timeout: 10_000 });
  await confirmInput.fill("DELETE");
  await confirmInput.dispatchEvent("input");
  await confirmInput.dispatchEvent("change");
  await expect(confirmInput).toHaveValue("DELETE", { timeout: 10_000 });

  const confirmButton = confirmDeleteButton(page);
  await confirmButton.scrollIntoViewIfNeeded();
  await expect(confirmButton).toBeVisible({ timeout: 10_000 });
  await expect(confirmButton).toBeEnabled({ timeout: 10_000 });

  await retry(async () => {
    await confirmButton.click({ force: true });
  }, 3);

  await expect(deleteAllHeading(page)).toBeHidden({ timeout: 120_000 });
  await expect(deleteAllButton).toBeVisible({ timeout: 30_000 });
}