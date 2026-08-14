import { defineConfig } from "tsup";

export default defineConfig({
  entry: { worker: "src/worker.ts" },
  format: ["esm"],
  target: "node22",
  sourcemap: true,
  clean: true,
  splitting: false,
});
