import { describe, expect, it } from "vitest";
import { corsOrigins, loadConfig, trustProxySetting } from "../src/config.js";
import { assertSafeWebhookUrl } from "../src/services/webhooks.js";

describe("production hardening", () => {
  it("refuses production config without COOKIE_SECURE", () => {
    expect(() => loadConfig({ NODE_ENV: "production", SESSION_SECRET: "strong-secret-xyz-at-least-32-chars-long", COOKIE_SECURE: "false" })).toThrow(/COOKIE_SECURE/);
  });

  it("refuses production config with the default SESSION_SECRET", () => {
    expect(() => loadConfig({ NODE_ENV: "production", SESSION_SECRET: "development-only-secret", COOKIE_SECURE: "true" })).toThrow(/SESSION_SECRET/);
  });

  it("accepts a valid production config", () => {
    const c = loadConfig({ NODE_ENV: "production", SESSION_SECRET: "strong-secret-xyz-at-least-32-chars-long", COOKIE_SECURE: "true", TRUST_PROXY: "direct" });
    expect(c.COOKIE_SECURE).toBe(true);
    expect(c.LOG_LEVEL).toBe("info");
  });

  it("defaults CORS origins to APP_BASE_URL and parses a custom list", () => {
    const c = loadConfig({});
    expect(corsOrigins(c)).toEqual(["http://localhost:3000"]);
    const multi = loadConfig({ CORS_ORIGINS: "http://a.example,http://b.example" });
    expect(corsOrigins(multi)).toEqual(["http://a.example", "http://b.example"]);
  });

  it("rejects private/internal webhook URLs (SSRF)", async () => {
    await expect(assertSafeWebhookUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow();
    await expect(assertSafeWebhookUrl("http://localhost:3000/hook")).rejects.toThrow();
    await expect(assertSafeWebhookUrl("http://192.168.1.10/hook")).rejects.toThrow();
    await expect(assertSafeWebhookUrl("http://10.0.0.5/hook")).rejects.toThrow();
    await expect(assertSafeWebhookUrl("http://127.0.0.1/hook")).rejects.toThrow();
    await expect(assertSafeWebhookUrl("http://[::1]/hook")).rejects.toThrow();
    await expect(assertSafeWebhookUrl("http://metadata.google.internal")).rejects.toThrow();
    // IPv4-mapped IPv6: the URL parser normalises these to ::ffff:a9fe:a9fe, which the
    // previous prefix-only IPv6 check let straight through.
    await expect(assertSafeWebhookUrl("http://[::ffff:169.254.169.254]/latest/meta-data")).rejects.toThrow();
    await expect(assertSafeWebhookUrl("http://[::ffff:127.0.0.1]/hook")).rejects.toThrow();
    await expect(assertSafeWebhookUrl("http://[::ffff:10.0.0.5]/hook")).rejects.toThrow();
    await expect(assertSafeWebhookUrl("http://100.64.1.1/hook")).rejects.toThrow();
  });

  it("refuses to boot in production with a weak or permissive configuration", () => {
    const base = {
      NODE_ENV: "production",
      COOKIE_SECURE: "true",
      DATABASE_URL: "postgres://u:p@localhost:5432/db",
      // production must state a reverse-proxy policy; "direct" is the explicit "no proxy"
      TRUST_PROXY: "direct",
    } as NodeJS.ProcessEnv;

    // a single character satisfied the old "not the default value" check
    expect(() => loadConfig({ ...base, SESSION_SECRET: "x" })).toThrow(/at least 32/);
    expect(() => loadConfig({ ...base, SESSION_SECRET: "development-only-secret" })).toThrow();
    expect(() =>
      loadConfig({ ...base, SESSION_SECRET: "a".repeat(32), ALLOW_PRIVATE_WEBHOOKS: "true" }),
    ).toThrow(/ALLOW_PRIVATE_WEBHOOKS/);
    expect(() => loadConfig({ ...base, SESSION_SECRET: "a".repeat(32) })).not.toThrow();

    // A no-op logger in production is the gap that makes every other failure invisible.
    expect(() => loadConfig({ ...base, SESSION_SECRET: "a".repeat(32), LOG_LEVEL: "silent" })).toThrow(/LOG_LEVEL/);
    // Not stating the proxy policy leaves the rate limiter bucketing every user together.
    expect(() => loadConfig({ ...base, SESSION_SECRET: "a".repeat(32), TRUST_PROXY: "false" })).toThrow(/TRUST_PROXY/);
    // And trusting every hop makes the forwarded address client-controlled.
    expect(() =>
      trustProxySetting(loadConfig({ ...base, SESSION_SECRET: "a".repeat(32), TRUST_PROXY: "true" })),
    ).toThrow(/TRUST_PROXY/);
    expect(trustProxySetting(loadConfig({ ...base, SESSION_SECRET: "a".repeat(32), TRUST_PROXY: "1" }))).toBe(1);
    expect(trustProxySetting(loadConfig({ ...base, SESSION_SECRET: "a".repeat(32), TRUST_PROXY: "10.0.0.0/8, 172.16.0.0/12" }))).toEqual([
      "10.0.0.0/8",
      "172.16.0.0/12",
    ]);
  });

  it("accepts public webhook URLs", async () => {
    await expect(assertSafeWebhookUrl("https://hooks.example.com/wh")).resolves.toBeUndefined();
    await expect(assertSafeWebhookUrl("https://api.example.org/notify?x=1")).resolves.toBeUndefined();
  });
});
