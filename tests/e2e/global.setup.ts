import { chromium } from "@playwright/test";
import path from "path";
import fs from "fs";

export default async () => {
  const baseURL = process.env.E2E_BASE_URL || "https://mushroom-tracker-app.vercel.app";
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;

  if (!email || !password) {
    throw new Error("E2E_EMAIL and E2E_PASSWORD secrets are required");
  }

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(baseURL, { waitUntil: "domcontentloaded" });

  // Already logged in?
  const hasSignOut = await page.getByRole("button", { name: /sign out/i }).count();
  if (!hasSignOut) {
    // Fill login form (flexible selectors)
    const emailBox = page.locator('input[type="email"], input[name="email"]').first();
    const passBox = page.locator('input[type="password"], input[name="password"]').first();
    await emailBox.waitFor({ state: "visible", timeout: 15000 });
    await emailBox.fill(email);
    await passBox.fill(password);

    const loginBtn = page
      .getByRole("button", { name: /sign in|log in|login|continue|submit/i })
      .first();
    await loginBtn.click();

    // Wait for app shell: heading OR Dashboard tab
    try {
      await page.getByRole("heading", { name: /chaotic neutral tracker/i }).waitFor({ timeout: 20000 });
    } catch {
      await page.getByRole("button", { name: /dashboard/i }).waitFor({ timeout: 10000 });
    }
  }

  // Ensure auth dir exists, then save session
  const statePath = path.join("tests", "e2e", ".auth", "user.json");
  await fs.promises.mkdir(path.dirname(statePath), { recursive: true });
  await context.storageState({ path: statePath });

  await browser.close();
};
