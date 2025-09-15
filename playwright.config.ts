import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;

// Allow CI to serve under /mushroom-tracker-app/ (must end with slash)
const basePath = (process.env.BASE_PATH || '/').replace(/\/?$/, '/');
const devPort = process.env.DEV_PORT ? Number(process.env.DEV_PORT) : 5173;
const previewPort = process.env.PREVIEW_PORT ? Number(process.env.PREVIEW_PORT) : 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  retries: isCI ? 2 : 0,
  workers: isCI ? 2 : undefined,
  timeout: 90_000,

  use: {
    baseURL: `http://127.0.0.1:${isCI ? previewPort : devPort}${basePath}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // No storageState needed; we disable onboarding via page.addInitScript in each test BEFORE first navigation.
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Start Vite for local; build+preview for CI
  webServer: isCI
    ? {
        command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${previewPort}`,
        url: `http://127.0.0.1:${previewPort}${basePath}`,
        reuseExistingServer: !isCI,
        timeout: 120_000,
      }
    : {
        command: `npm run dev -- --host 127.0.0.1 --port ${devPort}`,
        url: `http://127.0.0.1:${devPort}${basePath}`,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
