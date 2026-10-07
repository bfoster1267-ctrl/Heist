import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// `--mode single` builds one self-contained index.html (for sharing a playable link).
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === "single" ? [viteSingleFile()] : [])],
  build: { outDir: mode === "single" ? "dist-single" : "dist" },
}));
