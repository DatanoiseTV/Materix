import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // The Matrix rust-crypto WASM package must not be pre-bundled: esbuild's
  // dep optimizer breaks its wasm-bindgen ESM loader.
  optimizeDeps: {
    exclude: ["@matrix-org/matrix-sdk-crypto-wasm"],
  },
  build: {
    // Target an old Chromium so esbuild down-transpiles modern syntax
    // (logical assignment `??=`, optional chaining, etc.) that the AOSP System
    // WebView on older Android (e.g. LineageOS 18.1 / Android 11 ships
    // Chromium ~83) cannot parse — otherwise the whole bundle is a SyntaxError
    // and the app is a white screen. API-level gaps (Array.prototype.at,
    // Object.hasOwn, crypto.randomUUID, structuredClone) are covered by
    // src/polyfills.ts, imported first in main.tsx. See docs: crypto (WASM
    // reference-types) still needs a newer WebView; this only fixes load+text.
    target: ["chrome79"],
    chunkSizeWarningLimit: 4096,
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  clearScreen: false,
});
