import { defineConfig } from "@playwright/test";

const STORAGE_STATE = "e2e/.auth/user.json";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:3100",
    headless: true,
  },
  // One login for the whole run: /v1/auth/login is rate limited to 10/minute and a
  // per-test login made the suite non-deterministic once it crossed that.
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      testIgnore: /auth\.setup\.ts/,
      dependencies: ["setup"],
      use: { storageState: STORAGE_STATE },
    },
  ],
  webServer: [
    {
      command: "tsx ../../scripts/dev-api.ts",
      url: "http://localhost:3101/v1/health",
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        PORT: "3101",
        HOST: "127.0.0.1",
        DATABASE_URL: "",
        BOOTSTRAP_TOKEN: "e2e-bootstrap-token",
        SESSION_SECRET: "e2e-session-secret-change-me",
        APP_BASE_URL: "http://localhost:3100",
        API_BASE_URL: "http://localhost:3101",
        CORS_ORIGINS: "http://localhost:3100",
        ENABLE_DOCS: "true",
      },
    },
    {
      command: "next dev -p 3100",
      url: "http://localhost:3100/login",
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        NEXT_PUBLIC_API_BASE_URL: "http://localhost:3101",
      },
    },
  ],
});
