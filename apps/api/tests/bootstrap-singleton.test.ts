import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { users } from "@kal-el/db/schema";

import { createTestApp, type TestContext } from "./helpers.js";

describe("bootstrap is a singleton", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("creates exactly one owner when two initialisations race", async () => {
    // The "already initialized" check ran outside the transaction with nothing
    // serializing it, so a retried request or a deploy script running twice produced two
    // sites and two full-permission owner accounts, silently.
    const call = (slug: string, email: string) =>
      ctx.app.inject({
        method: "POST",
        url: "/v1/bootstrap/init",
        headers: { "x-bootstrap-token": ctx.config.BOOTSTRAP_TOKEN as string },
        payload: {
          site: { slug, name: slug },
          user: { email, name: "Owner", password: "super-secure-password-123" },
        },
      });

    const [a, b] = await Promise.all([call("race-a", "a@kalel.test"), call("race-b", "b@kalel.test")]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([201, 403]);

    const all = await ctx.db.select({ id: users.id }).from(users);
    expect(all).toHaveLength(1);
  });

  it("rejects a token of the wrong length without comparing it directly", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/bootstrap/init",
      headers: { "x-bootstrap-token": "short" },
      payload: {
        site: { slug: "nope", name: "Nope" },
        user: { email: "nope@kalel.test", name: "Nope", password: "super-secure-password-123" },
      },
    });
    expect(res.statusCode).toBe(403);
  });
});
