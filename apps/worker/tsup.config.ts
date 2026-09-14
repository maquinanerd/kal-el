import { defineConfig } from "tsup";

export default defineConfig({
  entry: { worker: "src/worker.ts" },
  format: ["esm"],
  target: "node22",
  sourcemap: true,
  clean: true,
  splitting: false,
  // Workspace packages publish TypeScript source, which Node cannot load at runtime: compile
  // them into the bundle. Every other package stays external, including dependencies of the
  // workspace packages this app does not declare itself, and comes from the image's
  // production node_modules (see the Dockerfile and apps/api/tsup.config.ts).
  noExternal: [/^@kal-el\//],
  skipNodeModulesBundle: true,
});
