import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const repoName = 'mushroom-tracker-app';

export default defineConfig(() => {
  // Use GH Pages subpath in CI; "/" locally.
  const isGhPages = process.env.GITHUB_PAGES === 'true' || process.env.CI === 'true';
  const base = isGhPages ? `/${repoName}/` : '/';

  return {
    base,
    plugins: [
      react(),
      VitePWA({
        // Ensure SW + routes honor the base
        registerType: 'autoUpdate',
        injectRegister: 'auto',

        // Always provide the manifest so dist/manifest.webmanifest has icons & correct scope
        manifest: {
          name: 'Mushroom Tracker',
          short_name: 'Myco Tracker',
          id: base,
          start_url: base,
          scope: base,
          display: 'standalone',
          background_color: '#0b0b0b',
          theme_color: '#16a34a',
          icons: [
            { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'pwa-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
          ]
        },

        // Make sure these assets are copied so icon URLs resolve
        includeAssets: [
          'favicon.ico',
          'app-logo.svg',
          'app-logo.png',
          'pwa-192.png',
          'pwa-512.png',
          'pwa-512-maskable.png'
        ],

        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2}'],
          navigateFallback: `${base}index.html`
        }
      })
    ]
  };
});
