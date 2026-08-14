import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "dev",
  base: "./",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
