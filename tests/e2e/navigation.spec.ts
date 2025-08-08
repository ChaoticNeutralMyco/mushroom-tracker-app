import { test, expect } from "@playwright/test";

const tabs = [
  "Dashboard",
  "Tasks",
  "Analytics",
  "Calendar",
  "Timeline",
  "COG",
  "Recipes",
  "Strains",
  "Labels",
  "Archive",
  "Settings",
];

test("All tabs render without crashing", async ({ page, baseURL }) => {
  await page.goto(baseURL!);
  for (const name of tabs) {
    await page.getByRole("button", { name: new RegExp(`^${name}$`, "i") }).click();
    // give the section a moment to render
    await page.waitForTimeout(250);
    // basic sanity: no page crash and body still attached
    await expect(page.locator("body")).toBeVisible();
  }
});
