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
    target: "es2022",
    chunkSizeWarningLimit: 4096,
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  clearScreen: false,
});
