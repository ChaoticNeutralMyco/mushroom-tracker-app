import { defineConfig, devices } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// ---- Dev convenience: load .env.e2e.local if present (no dependency on dotenv)
(function loadLocalEnv() {
  const p = path.resolve(process.cwd(), '.env.e2e.local');
  if (!fs.existsSync(p)) return;
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    if (!process.env[key]) process.env[key] = val;
  }
})();

// ---- Hydrate E2E_EMAIL / E2E_PASSWORD from TEST_ACCOUNT (JSON or "email:password"/"email,password")
(function hydrateCreds() {
  if (process.env.E2E_EMAIL && process.env.E2E_PASSWORD) return;
  const src = process.env.TEST_ACCOUNT;
  if (!src) return;

  const setIfEmpty = (k: 'E2E_EMAIL' | 'E2E_PASSWORD', v?: string) => {
    if (v && !process.env[k]) process.env[k] = v;
  };

  try {
    const obj = JSON.parse(src);
    setIfEmpty('E2E_EMAIL', obj.email);
    setIfEmpty('E2E_PASSWORD', obj.password);
    return;
  } catch { /* not JSON */ }

  const m = src.match(/^\s*([^:,]+)\s*[:|,]\s*(.+)\s*$/);
  if (m) {
    setIfEmpty('E2E_EMAIL', m[1]);
    setIfEmpty('E2E_PASSWORD', m[2]);
  }
})();

const isCI = !!process.env.CI;
const basePath = (process.env.BASE_PATH || '/').replace(/\/?$/, '/');
const devPort = process.env.DEV_PORT ? Number(process.env.DEV_PORT) : 5173;
const previewPort = process.env.PREVIEW_PORT ? Number(process.env.PREVIEW_PORT) : 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  // Only pick up the hardened specs
  testMatch: [
    /.*\/app\.spec\.ts$/,
    /.*\/navigation\.spec\.ts$/,
    /.*\/cog\.spec\.ts$/,
    /.*\/analytics\.spec\.ts$/,
    /.*\/grows-crud\.spec\.ts$/,
    /.*\/photos\.spec\.ts$/,
  ],
  fullyParallel: true,
  retries: isCI ? 2 : 0,
  workers: isCI ? 2 : undefined,
  timeout: 90_000,

  use: {
    baseURL: `http://127.0.0.1:${isCI ? previewPort : devPort}${basePath}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

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
