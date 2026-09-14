import { defineConfig } from "tsup";

export default defineConfig({
  entry: { server: "src/server.ts" },
  format: ["esm"],
  target: "node22",
  sourcemap: true,
  clean: true,
  splitting: false,
  // The workspace packages publish TypeScript source (`exports` points at ./src/*.ts), which
  // Node cannot load at runtime, so they are compiled into the bundle. Every other package
  // stays external — including dependencies of those workspace packages that this app does
  // not declare itself (pg, @node-rs/argon2): tsup only treats this package.json's own
  // dependencies as external, and bundling a native module fails. They come from the image's
  // production node_modules (see the Dockerfile).
  noExternal: [/^@kal-el\//],
  skipNodeModulesBundle: true,
});
