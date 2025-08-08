import { chromium } from "@playwright/test";

export default async () => {
  const baseURL = process.env.E2E_BASE_URL || "https://mushroom-tracker-app.vercel.app";
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  // Auto-accept any confirms/alerts in cleanup
  page.on("dialog", (d) => d.accept());

  await page.goto(baseURL, { waitUntil: "domcontentloaded" });

  // If not signed in, sign in quickly
  const needsLogin = await page.getByRole("button", { name: /sign out/i }).count().then(c => c === 0);
  if (needsLogin) {
    const emailBox = page.locator('input[type="email"], input[name="email"]').first();
    const passBox = page.locator('input[type="password"], input[name="password"]').first();
    await emailBox.fill(email || "");
    await passBox.fill(password || "");
    const loginBtn = page.getByRole("button", { name: /sign in|log in|login|continue|submit/i }).first();
    await loginBtn.click();
    await page.getByRole("button", { name: /dashboard/i }).waitFor({ timeout: 15000 });
  }

  // Open Settings
  await page.getByRole("button", { name: /^settings$/i }).click();

  // Click "Clear All Data" (two confirms in your handler; our dialog handler accepts both)
  await page.getByTestId("clear-all-data").click();

  // Give Firestore time to process and UI to settle
  await page.waitForTimeout(2000);

  await browser.close();
};
