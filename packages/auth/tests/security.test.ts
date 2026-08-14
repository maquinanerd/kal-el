import { describe, expect, it } from "vitest";
import { generateCsrfToken, generateOpaqueToken, hashToken, sessionTokenPrefix, serviceTokenPrefix } from "@kal-el/auth";
import { hashPassword, verifyPassword } from "@kal-el/auth";

describe("password hashing", () => {
  it("hashes and verifies a password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).not.toContain("correct");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });

  it("never verifies against a malformed hash", async () => {
    expect(await verifyPassword("anything", "not-a-valid-argon2-hash")).toBe(false);
  });
});

describe("opaque tokens", () => {
  it("generates distinct, prefixed tokens", () => {
    const a = generateOpaqueToken(sessionTokenPrefix());
    const b = generateOpaqueToken(sessionTokenPrefix());
    expect(a).toMatch(/^ke_s\./);
    expect(a).not.toBe(b);
  });

  it("hashes tokens deterministically without exposing them", () => {
    const token = generateOpaqueToken(serviceTokenPrefix());
    const h1 = hashToken(token);
    const h2 = hashToken(token);
    expect(h1).toBe(h2);
    expect(h1).not.toContain(token);
  });

  it("generates csrf tokens", () => {
    expect(generateCsrfToken().length).toBeGreaterThan(20);
  });
});
