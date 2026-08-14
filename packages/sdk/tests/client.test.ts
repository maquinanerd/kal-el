import { describe, expect, it, vi } from "vitest";
import { KalElClient, KalElError } from "../src/client.js";

function mockFetch(handler: (req: { method: string; url: string; headers: Record<string, string>; body: unknown }) => Response | Promise<Response>) {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers as Record<string, string>) ?? {})) headers[k.toLowerCase()] = v;
    let body: unknown;
    if (typeof init?.body === "string") body = JSON.parse(init.body);
    return handler({ method: init?.method ?? "GET", url, headers, body });
  });
}

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

describe("KalEl SDK", () => {
  const siteId = "00000000-0000-0000-0000-000000000001";

  it("authenticates with the service token and auto-generates an idempotency key", async () => {
    const fetchMock = mockFetch(async (req) => {
      expect(req.headers.authorization).toBe("Bearer ke_st.test");
      expect(req.headers["idempotency-key"]).toBeTruthy();
      return json(201, { data: { id: "a1", title: "x" } });
    });
    const client = new KalElClient({ baseUrl: "http://api", token: "ke_st.test", retries: 0, fetchImpl: fetchMock });

    await client.createArticle(siteId, { title: "x" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1];
    expect((init?.headers as Record<string, string>)["idempotency-key"]).toMatch(/^sdk\./);
  });

  it("retries 5xx with the SAME idempotency key", async () => {
    const keysSeen: (string | undefined)[] = [];
    const fetchMock = mockFetch(async (req) => {
      keysSeen.push(req.headers["idempotency-key"]);
      if (keysSeen.length === 1) return json(503, { error: { code: "INTERNAL_ERROR", message: "boom" } });
      return json(201, { data: { id: "a1" } });
    });
    const client = new KalElClient({ baseUrl: "http://api", token: "t", retries: 2, fetchImpl: fetchMock });

    const article = await client.createArticle(siteId, { title: "x" });
    expect(article).toEqual({ id: "a1" });
    expect(keysSeen.length).toBe(2);
    expect(keysSeen[0]).toBe(keysSeen[1]);
  });

  it("surfaces 4xx as KalElError without retrying", async () => {
    const fetchMock = mockFetch(() => json(409, { error: { code: "CONFLICT", message: "dup" } }));
    const client = new KalElClient({ baseUrl: "http://api", token: "t", retries: 2, fetchImpl: fetchMock });

    await expect(client.createArticle(siteId, { title: "x" })).rejects.toMatchObject({ status: 409, code: "CONFLICT" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not add idempotency keys to GETs", async () => {
    const fetchMock = mockFetch(async (req) => {
      expect(req.headers["idempotency-key"]).toBeUndefined();
      return json(200, { data: { items: [], nextCursor: null } });
    });
    const client = new KalElClient({ baseUrl: "http://api", token: "t", retries: 0, fetchImpl: fetchMock });
    await client.listArticles(siteId, { status: "published" });
    const init = fetchMock.mock.calls[0]?.[1];
    expect((init?.headers as Record<string, string>)["idempotency-key"]).toBeUndefined();
  });

  it("throws KalElError with typed code/message", async () => {
    const fetchMock = mockFetch(() => json(403, { error: { code: "FORBIDDEN", message: "nope" } }));
    const client = new KalElClient({ baseUrl: "http://api", token: "t", retries: 0, fetchImpl: fetchMock });
    try {
      await client.getArticle(siteId, "x");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(KalElError);
      expect((err as KalElError).code).toBe("FORBIDDEN");
    }
  });
});
