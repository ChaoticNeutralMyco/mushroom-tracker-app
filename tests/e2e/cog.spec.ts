import { test, expect } from "@playwright/test";

test.setTimeout(90_000);

test("COG add → restock → export → delete", async ({ page, baseURL }) => {
  await page.goto(baseURL!);

  // Open COG tab
  await page.getByRole("button", { name: /^cog$/i }).click();

  // Wait for the COG panel to render (heading and/or add button)
  const heading = page.getByRole("heading", { name: /supplies\s*\/\s*cost of goods/i });
  const addByTestId = page.getByTestId("add-supply");
  const addByText = page.getByRole("button", { name: /add supply/i });

  // Try heading first, but fall back to the button if heading isn't there
  if (await heading.count()) {
    await expect(heading).toBeVisible({ timeout: 15000 });
  }
  if (await addByTestId.count()) {
    await expect(addByTestId).toBeVisible({ timeout: 15000 });
  } else {
    await expect(addByText).toBeVisible({ timeout: 15000 });
  }

  // Create unique supply
  const stamp = Date.now();
  const name = `e2e-supply-${stamp}`;

  await page.getByPlaceholder("Name").fill(name);
  await page.getByPlaceholder(/Cost per unit/i).fill("3.14");

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

  // Click Add Supply (testid or text)
  if (await addByTestId.count()) await addByTestId.click();
  else await addByText.click();

  // Row appears
  const row = page.getByRole("row", { name: new RegExp(name, "i") });
  await expect(row).toBeVisible({ timeout: 15000 });

  // Restock
  await row.getByPlaceholder("+").fill("0.5");
  const restock = row.getByRole("button", { name: new RegExp(`restock ${name}`, "i") });
  if (await restock.count()) await restock.click();
  else await row.getByRole("button").first().click(); // fallback

  // Export CSV
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    (async () => {
      const ex = page.getByTestId("export-audit-log");
      if (await ex.count()) await ex.click();
      else await page.getByRole("button", { name: /export audit log/i }).click();
    })(),
  ]);
  expect((await download.suggestedFilename()).toLowerCase()).toMatch(/\.csv$/);

  // Delete the created row
  const deleteBtn = row.getByRole("button", { name: new RegExp(`delete supply ${name}`, "i") });
  if (await deleteBtn.count()) await deleteBtn.click();
  else await row.locator("button:has(svg)").first().click();

  await expect(row).toHaveCount(0);
});
