// vite.config.js
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Optional-load the Tauri plugin so the config works even if the package isn't installed.
export default defineConfig(async () => {
  let tauriPlugin = null;
  try {
    const mod = await import("@tauri-apps/vite-plugin");
    tauriPlugin = mod.tauri();
  } catch {
    tauriPlugin = null; // fine for web/Vercel
  }

  const metadata = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
  const versionManifest = {
    name: "myco-version-manifest",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "app-version.json",
        source: JSON.stringify({ version: metadata.version, notes: metadata.mycoReleaseNotes || [] }),
      });
    },
  };

  return {
    plugins: [tailwindcss(), react(), versionManifest, ...(tauriPlugin ? [tauriPlugin] : [])],

    build: {
      target: "es2020",
      sourcemap: false,
      minify: "esbuild", // avoids requiring terser in Vercel/web builds
      chunkSizeWarningLimit: 1500,
      // Let Rollup decide chunking; removing manualChunks/splitVendorChunk avoids bad init order
      commonjsOptions: { transformMixedEsModules: true },
    },

    server: { strictPort: true },

    optimizeDeps: {
      include: ["react", "react-dom", "react-router"],
    },
  };
});