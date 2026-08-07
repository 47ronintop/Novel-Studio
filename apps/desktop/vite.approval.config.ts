import { defineConfig } from "vite";

/** Independent, fixed approval bundle; build this alongside the normal renderer. */
export default defineConfig({
  root: "apps/desktop/src/approval",
  base: "./",
  build: {
    outDir: "../../dist/approval",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: "apps/desktop/src/approval/index.html",
      output: {
        // Qualification and the build manifest bind these fixed filenames.
        entryFileNames: "approval.js",
        chunkFileNames: "[name].js",
        assetFileNames: (asset) =>
          asset.name?.endsWith(".css") ? "approval.css" : "[name][extname]"
      }
    }
  }
});
