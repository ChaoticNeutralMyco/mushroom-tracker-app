// playwright.config.ts (root)
// Runs tests against the production build to avoid `virtual:pwa-register` issues.
import { defineConfig, devices } from '@playwright/test';

const SUBPATH = process.env.CI ? '/mushroom-tracker-app/' : '/';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [['html', { outputFolder: 'playwright-report', open: 'never' }], ['list']]
    : 'list',

  // Always serve the built site for tests (stable for PWA virtual modules)
  webServer: {
    command: 'npm run build && npm run preview -- --strictPort --port=5173',
    // Playwright will wait for this URL to respond; point at the subpath in CI.
    url: `http://localhost:5173${SUBPATH}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },

  use: {
    // Make navigation and request.get() resolve relative to the right base.
    baseURL: `http://localhost:5173${SUBPATH}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Enable these later if you want cross-browser:
    // { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // { name: 'webkit',  use: { ...devices['Desktop Safari']  } },
  ],
});
