import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./vitest.global-setup.ts"],
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
