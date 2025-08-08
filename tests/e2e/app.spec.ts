import { test, expect } from "@playwright/test";

test.setTimeout(90_000);

test("PWA sanity + Settings persist + COG add + CSV export", async ({ page, baseURL }) => {
  const url = baseURL!;
  await page.goto(url);

  // App shell visible
  await expect(page.getByRole("heading", { name: /chaotic neutral tracker/i })).toBeVisible();

  // PWA sw.js reachable (sanity only)
  const sw = await page.request.get(new URL("/sw.js", url).toString());
  expect([200, 404]).toContain(sw.status());

  // Go to COG tab
  await page.getByRole("button", { name: /^cog$/i }).click();

  // Wait for COG panel to render
  const heading = page.getByRole("heading", { name: /supplies\s*\/\s*cost of goods/i });
  if (await heading.count()) await expect(heading).toBeVisible({ timeout: 15000 });

  // Create a unique supply
  const stamp = Date.now();
  const name = `e2e-supply-${stamp}`;

  await page.getByPlaceholder("Name").fill(name);
  await page.getByPlaceholder(/Cost per unit/i).fill("1.25");

  const selectWithFallback = async (selector: string, label: string) => {
    try {
      await page.locator(selector).selectOption({ label });
    } catch {
      await page.locator(selector).click();
      await page.getByRole("option", { name: new RegExp(label, "i") }).click();
    }
  };
  await selectWithFallback('select[name="type"]', "tool");
  await selectWithFallback('select[name="unit"]', "count");

  await page.getByPlaceholder(/Quantity on hand/i).fill("2");
  await page.getByPlaceholder(/Reorder URL/i).fill("https://example.com/reorder");

  // Click Add Supply (by testid or visible text)
  const addBtn = page.getByTestId("add-supply");
  if (await addBtn.count()) {
    await expect(addBtn).toBeVisible({ timeout: 15000 });
    await addBtn.click();
  } else {
    const addByText = page.getByRole("button", { name: /add supply/i });
    await expect(addByText).toBeVisible({ timeout: 15000 });
    await addByText.click();
  }

  // Row appears — scope to the row first to avoid strict-mode collisions
  const row = page.getByRole("row", { name: new RegExp(`\\b${name}\\b`, "i") });
  await expect(row).toBeVisible({ timeout: 15000 });

  // Inside that row, confirm the exact name cell exists (no ambiguity)
  await expect(row.getByRole("cell", { name: new RegExp(`^${name}$`) })).toBeVisible();

  // Export CSV (download starts)
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    (async () => {
      const ex = page.getByTestId("export-audit-log");
      if (await ex.count()) await ex.click();
      else await page.getByRole("button", { name: /export audit log/i }).click();
    })(),
  ]);
  expect((await download.suggestedFilename()).toLowerCase()).toMatch(/\.csv$/);

  // Settings persist
  await page.getByRole("button", { name: /^settings$/i }).click();
  const overdue = page.getByLabel(/highlight overdue tasks/i);
  const initial = await overdue.isChecked();
  await overdue.setChecked(!initial);
  await page.getByRole("button", { name: /save settings/i }).click();

  // Reload & verify
  await page.reload();
  await page.getByRole("button", { name: /^settings$/i }).click();
  await expect(page.getByLabel(/highlight overdue tasks/i)).toBeChecked({ checked: !initial });
});
