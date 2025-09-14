import { defineConfig, splitVendorChunkPlugin } from "vite";
import react from "@vitejs/plugin-react";

// Optional-load the Tauri plugin so the config works even if the package isn't installed.
export default defineConfig(async () => {
  let tauriPlugin = null;
  try {
    const mod = await import("@tauri-apps/vite-plugin");
    tauriPlugin = mod.tauri();
  } catch {
    // Plugin not installed; continue without it (safe for dev).
    tauriPlugin = null;
  }

  return {
    plugins: [react(), ...(tauriPlugin ? [tauriPlugin] : []), splitVendorChunkPlugin()],

    build: {
      target: "es2022",
      sourcemap: false,
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks(id) {
            // --- Vendor groups ---
            if (id.includes("node_modules")) {
              if (id.includes("firebase")) return "vendor-firebase";
              if (id.includes("react-router")) return "vendor-router";
              if (id.includes("react-window")) return "opt-react-window";
              if (id.includes("lucide-react")) return "vendor-icons";
              if (/[\\/]node_modules[\\/](react|react-dom)[\\/]/.test(id)) return "vendor-react";
              return "vendor";
            }
            // --- Route-level groups (best-effort) ---
            if (/\bpages[\\/]Analytics\b|[\\/]Analytics\.(tsx|ts|jsx|js)$/.test(id)) {
              return "route-analytics";
            }
            if (/\bcomponents[\\/]ui[\\/]ScanBarcodeModal\b|scanner|barcode/i.test(id)) {
              return "route-scanner";
            }
            return undefined;
          },
        },
      },
    },

    server: { strictPort: true },

    optimizeDeps: {
      include: ["react", "react-dom", "react-router-dom"],
    },
  };
});
