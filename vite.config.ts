import { defineConfig } from "vite";

// `base` comes from BASE_PATH in the Pages workflow -- never hardcoded (SPEC §14).
const base = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base,
  build: {
    target: "es2022",
    // The OCCT wasm must land in dist/assets as a real file, never inlined.
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4096,
  },
  worker: { format: "es" },
  optimizeDeps: {
    // The 50 MB wasm glue must not go through the dep pre-bundler.
    exclude: ["opencascade.js"],
  },
  server: { fs: { allow: [".."] } },
});
