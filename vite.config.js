// vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      devOptions: { enabled: true },
      manifest: {
        id: "/",
        name: "Mushroom Tracker",
        short_name: "Myco Tracker",
        start_url: "/",
        display: "standalone",
        background_color: "#0f172a",
        theme_color: "#0f172a",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          // maskable-only (avoids padding warning)
          { src: "/pwa-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ],
        // Option A: screenshots live at the root of /public
        screenshots: [
          { src: "/mobile.png", sizes: "1080x2340", type: "image/png", form_factor: "narrow", label: "Mobile dashboard" },
          { src: "/desktop-wide.png", sizes: "1600x900", type: "image/png", form_factor: "wide", label: "Desktop overview" }
        ],
        shortcuts: [
          {
            name: "New Grow",
            url: "/#new",
            description: "Create a new grow",
            icons: [{ src: "/pwa-96.png", sizes: "96x96", type: "image/png" }]
          },
          {
            name: "Tasks",
            url: "/#tasks",
            description: "Open Tasks",
            icons: [{ src: "/pwa-96.png", sizes: "96x96", type: "image/png" }]
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webp,woff2}"],
        globIgnores: [
          "**/*.map",
          "playwright-report/**",
          "test-results/**",
          "**/*.DS_Store",
          "**/*.md"
        ],
        navigateFallback: "/index.html"
      }
    })
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("firebase")) return "firebase";
            if (id.includes("recharts")) return "recharts";
            if (id.includes("@zxing")) return "zxing";
            if (id.includes("react-router")) return "router";
            if (id.includes("react")) return "react";
          }
        }
      }
    },
    chunkSizeWarningLimit: 1200
  },
  server: { port: 5173 },
  preview: { port: 4173 }
});
