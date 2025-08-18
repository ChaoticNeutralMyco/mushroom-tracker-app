import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Adjust if you ever change the repo name
const repoName = 'mushroom-tracker-app';

export default defineConfig(() => {
  // Prefer GH Pages subpath in CI, but use "/" for local dev.
  // (If you also pass `vite build --base "/mushroom-tracker-app/"`, the CLI wins —
  // that's fine; VitePWA will inherit the resolved base.)
  const isGhPages = process.env.GITHUB_PAGES === 'true' || process.env.CI === 'true';
  const base = isGhPages ? `/${repoName}/` : '/';

  return {
    base,
    plugins: [
      react(),
      VitePWA({
        // Let the plugin follow Vite's resolved base (keeps SW scope correct).
        // No explicit `manifest` object here — we use /public/manifest.webmanifest.
        registerType: 'autoUpdate',
        injectRegister: 'auto',

        // Make sure these are copied and can be precached
        includeAssets: [
          'favicon.ico',
          'app-logo.svg',
          'app-logo.png',
          'pwa-192.png',
          'pwa-512.png',
          'pwa-512-maskable.png'
        ],

        workbox: {
          // Precache usual static assets
          globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2}'],
          // Ensure SPA fallback works under the GH Pages subpath
          navigateFallback: `${base}index.html`
        }
      })
    ]
  };
});
