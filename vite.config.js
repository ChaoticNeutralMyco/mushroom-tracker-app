// vite.config.js
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Disable PWA in dev and when Playwright sets VITE_PWA_DISABLED=1
  const pwaEnabled =
    mode !== 'development' && process.env.VITE_PWA_DISABLED !== '1';

  const pwa = VitePWA({
    strategies: 'generateSW',
    registerType: 'autoUpdate',
    injectRegister: 'auto',
    workbox: {
      cleanupOutdatedCaches: true,
      globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2}'],
      navigateFallbackDenylist: [/^\/_\/?/],
    },
    manifest: {
      name: 'Mushroom Tracker',
      short_name: 'Myco',
      start_url: '/',
      display: 'standalone',
      background_color: '#0b0f19',
      theme_color: '#10b981',
      icons: [
        { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/pwa-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    // Never enable PWA in dev; avoids the dev-dist/glob warnings.
    devOptions: { enabled: false },
  });

  return {
    plugins: [
      react(),
      // Only add the plugin when enabled
      ...(pwaEnabled ? [pwa] : []),
    ],
    build: {
      sourcemap: false,
      chunkSizeWarningLimit: 1000,
    },
    // keep any aliases / server options you had here
  };
});
