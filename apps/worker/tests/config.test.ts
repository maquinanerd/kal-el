import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

describe("worker config", () => {
  it("refuses to start with private webhook targets enabled in production", () => {
    expect(() =>
      loadConfig({ NODE_ENV: "production", ALLOW_PRIVATE_WEBHOOKS: "true" } as NodeJS.ProcessEnv),
    ).toThrow(/ALLOW_PRIVATE_WEBHOOKS/);
  });

  it("allows it outside production", () => {
    const config = loadConfig({ NODE_ENV: "development", ALLOW_PRIVATE_WEBHOOKS: "true" } as NodeJS.ProcessEnv);
    expect(config.ALLOW_PRIVATE_WEBHOOKS).toBe("true");
  });

  it("is unaffected when the flag is absent in production", () => {
    const config = loadConfig({ NODE_ENV: "production" } as NodeJS.ProcessEnv);
    expect(config.NODE_ENV).toBe("production");
  });
});
