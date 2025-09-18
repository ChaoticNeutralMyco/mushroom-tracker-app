import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.chaoticneutral.myco',
  appName: 'Mushroom Tracker',
  webDir: 'dist',            // Vite build output
  bundledWebRuntime: false,
  server: {
    // Local files are served from the bundle; for any live calls, keep https scheme.
    androidScheme: 'https',
    allowNavigation: ['*'],
  },
};

export default config;
