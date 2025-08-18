import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ],
  // Build first, then preview dist/
  webServer: {
    command: 'npm run preview:ci',
    port: 5173,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
    // Do NOT set VITE_PWA_DISABLED here; we want the real prod build/manifest.
  }
});
