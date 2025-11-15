import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Optional-load the Tauri plugin so the config works even if the package isn't installed.
export default defineConfig(async () => {
  let tauriPlugin = null;
  try {
    const mod = await import("@tauri-apps/vite-plugin");
    tauriPlugin = mod.tauri();
  } catch {
    tauriPlugin = null; // fine for web/Vercel
  }

  return {
    plugins: [react(), ...(tauriPlugin ? [tauriPlugin] : [])],

    build: {
      target: "es2020",
      sourcemap: false,
      minify: "terser",                 // safer than esbuild for vendor/circular cases
      chunkSizeWarningLimit: 1500,
      // Let Rollup decide chunking; removing manualChunks/splitVendorChunk avoids bad init order
      commonjsOptions: { transformMixedEsModules: true },
    },

    server: { strictPort: true },

    optimizeDeps: {
      include: ["react", "react-dom", "react-router-dom"],
    },
  };
});
