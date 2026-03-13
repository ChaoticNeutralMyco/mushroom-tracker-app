// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";
import fs from "fs";
import path from "path";

(function loadLocalEnv() {
  const envPath = path.resolve(process.cwd(), ".env.e2e.local");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;

    const key = match[1];
    const raw = match[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    if (!process.env[key]) process.env[key] = raw;
  }
})();

(function hydrateCreds() {
  if (process.env.E2E_EMAIL && process.env.E2E_PASSWORD) return;

  const src = process.env.TEST_ACCOUNT;
  if (!src) return;

  const setIfEmpty = (key: "E2E_EMAIL" | "E2E_PASSWORD", value?: string) => {
    if (value && !process.env[key]) process.env[key] = value;
  };

  try {
    const parsed = JSON.parse(src);
    setIfEmpty("E2E_EMAIL", parsed.email);
    setIfEmpty("E2E_PASSWORD", parsed.password);
    return;
  } catch {
    // ignore non-JSON secrets
  }

  const match = src.match(/^\s*([^:,]+)\s*[:|,]\s*(.+)\s*$/);
  if (match) {
    setIfEmpty("E2E_EMAIL", match[1]);
    setIfEmpty("E2E_PASSWORD", match[2]);
  }
})();

const isCI = !!process.env.CI;
const devPort = Number(process.env.DEV_PORT || 5173);
const authStatePath = path.join("tests", "e2e", ".auth", "user.json");

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: [/.*\/setup\.auth\.ts$/, /.*\/grow-lifecycle\.spec\.ts$/],
  fullyParallel: false,
  workers: 1,
  retries: isCI ? 1 : 0,
  timeout: 180_000,
  expect: {
    timeout: 15_000,
  },
  reporter: isCI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${devPort}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "setup",
      testMatch: /.*\/setup\.auth\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
      },
    },
    {
      name: "chromium",
      dependencies: ["setup"],
      testMatch: /.*\/grow-lifecycle\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: authStatePath,
      },
    },
  ],
  webServer: {
    command: `npm run dev:e2e -- --port ${devPort}`,
    url: `http://127.0.0.1:${devPort}`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});