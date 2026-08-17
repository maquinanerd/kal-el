import { describe, expect, it } from "vitest";
import { corsOrigins, loadConfig } from "../src/config.js";
import { assertSafeWebhookUrl } from "../src/services/webhooks.js";

describe("production hardening", () => {
  it("refuses production config without COOKIE_SECURE", () => {
    expect(() => loadConfig({ NODE_ENV: "production", SESSION_SECRET: "strong-secret-xyz", COOKIE_SECURE: "false" })).toThrow(/COOKIE_SECURE/);
  });

  it("refuses production config with the default SESSION_SECRET", () => {
    expect(() => loadConfig({ NODE_ENV: "production", SESSION_SECRET: "development-only-secret", COOKIE_SECURE: "true" })).toThrow(/SESSION_SECRET/);
  });

  it("accepts a valid production config", () => {
    const c = loadConfig({ NODE_ENV: "production", SESSION_SECRET: "strong-secret-xyz", COOKIE_SECURE: "true" });
    expect(c.COOKIE_SECURE).toBe(true);
  });

  it("defaults CORS origins to APP_BASE_URL and parses a custom list", () => {
    const c = loadConfig({});
    expect(corsOrigins(c)).toEqual(["http://localhost:3000"]);
    const multi = loadConfig({ CORS_ORIGINS: "http://a.example,http://b.example" });
    expect(corsOrigins(multi)).toEqual(["http://a.example", "http://b.example"]);
  });

  it("rejects private/internal webhook URLs (SSRF)", () => {
    expect(() => assertSafeWebhookUrl("http://169.254.169.254/latest/meta-data")).toThrow();
    expect(() => assertSafeWebhookUrl("http://localhost:3000/hook")).toThrow();
    expect(() => assertSafeWebhookUrl("http://192.168.1.10/hook")).toThrow();
    expect(() => assertSafeWebhookUrl("http://10.0.0.5/hook")).toThrow();
    expect(() => assertSafeWebhookUrl("http://127.0.0.1/hook")).toThrow();
    expect(() => assertSafeWebhookUrl("http://[::1]/hook")).toThrow();
    expect(() => assertSafeWebhookUrl("http://metadata.google.internal")).toThrow();
  });

  it("accepts public webhook URLs", () => {
    expect(() => assertSafeWebhookUrl("https://hooks.example.com/wh")).not.toThrow();
    expect(() => assertSafeWebhookUrl("https://api.example.org/notify?x=1")).not.toThrow();
  });
});
