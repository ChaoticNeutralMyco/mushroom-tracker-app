// tests/e2e/helpers/resetUserData.ts
import { Page, expect } from "@playwright/test";
import { clickAppTab } from "./app";

async function acceptDialogIfPresent(page: Page, timeout = 5_000) {
  try {
    const dialog = await page.waitForEvent("dialog", { timeout });
    await dialog.accept();
    return true;
  } catch {
    return false;
  }
}

export async function resetUserDataViaSettings(page: Page) {
  await clickAppTab(page, "Settings");
  await page.getByRole("tab", { name: /^Advanced$/i }).click();

  const deleteAllButton = page.getByRole("button", {
    name: /^Delete All Data$/i,
  });
  await expect(deleteAllButton).toBeVisible({ timeout: 20_000 });
  await expect(deleteAllButton).toBeEnabled({ timeout: 20_000 });
  await deleteAllButton.click();

  const modalHeading = page.getByRole("heading", { name: /Delete ALL Data/i });
  await expect(modalHeading).toBeVisible({ timeout: 15_000 });

  const confirmInput = page.getByPlaceholder("DELETE");
  await expect(confirmInput).toBeVisible({ timeout: 10_000 });
  await confirmInput.fill("DELETE");
  await confirmInput.dispatchEvent("input");
  await confirmInput.dispatchEvent("change");

  const confirmDeleteButton = page.getByRole("button", {
    name: /Confirm Delete/i,
  });
  await expect(confirmDeleteButton).toBeVisible({ timeout: 10_000 });
  await expect(confirmDeleteButton).toBeEnabled({ timeout: 10_000 });

  const dialogPromise = acceptDialogIfPresent(page);
  await confirmDeleteButton.click({ force: true });
  await dialogPromise;

  await expect(modalHeading).toBeHidden({ timeout: 60_000 });
  await expect(deleteAllButton).toBeVisible({ timeout: 20_000 });
}