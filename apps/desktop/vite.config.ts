import { defineConfig } from "vite";

export default defineConfig({
  root: "apps/desktop/src/renderer",
  base: "./",
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: "apps/desktop/src/renderer/index.html"
    }
  }
});
