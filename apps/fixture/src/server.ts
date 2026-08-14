import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import { HEADER_SIGNATURE, HEADER_EVENT, HEADER_IDEMPOTENCY, verifyWebhookSignature } from "@kal-el/events";

export type PublishedPayload = {
  articleId: string;
  slug: string;
  publishedAt: string;
  version: number;
};

export type FixtureOptions = {
  secret: string;
  onRevalidate?: (payload: PublishedPayload) => void;
};

export type CacheEntry = { value: unknown; freshAt: number; ttlMs: number };

const DEFAULT_TTL_MS = 60_000;

/**
 * Reference delivery fixture: a "frontend" that caches published articles and
 * revalidates them on the Kal El `article.published` webhook. Used to prove the
 * cached-delivery + targeted-revalidation contract (docs/08-DEPLOYMENT.md).
 */
export async function buildFixture(opts: FixtureOptions): Promise<FastifyInstance> {
  const cache = new Map<string, CacheEntry>();
  const revalidated: PublishedPayload[] = [];

  const app = Fastify({ logger: false });

  app.get("/health", async () => ({ status: "ok", cached: cache.size }));

  app.get("/articles/:slug", async (req, reply) => {
    const slug = (req.params as { slug: string }).slug;
    const entry = cache.get(slug);
    if (entry && Date.now() - entry.freshAt < entry.ttlMs) {
      return { data: entry.value, cached: true };
    }
    reply.status(404);
    return { error: { code: "CACHE_MISS", message: `no fresh cached article for ${slug}` } };
  });

  app.post("/webhooks/article.published", async (req, reply) => {
    const signature = req.headers[HEADER_SIGNATURE];
    // the delivered bytes equal JSON.stringify(parsed body) because the worker
    // signs the exact string it sends (jsonb key order is already fixed then)
    const raw = JSON.stringify(req.body ?? {});
    if (typeof signature !== "string" || !verifyWebhookSignature(opts.secret, raw, signature)) {
      reply.status(401);
      return { error: { code: "INVALID_SIGNATURE", message: "signature verification failed" } };
    }

    const payload = req.body as PublishedPayload;
    cache.set(payload.slug, { value: payload, freshAt: Date.now(), ttlMs: DEFAULT_TTL_MS });
    revalidated.push(payload);
    opts.onRevalidate?.(payload);
    return {
      data: {
        revalidated: true,
        slug: payload.slug,
        idempotency: req.headers[HEADER_IDEMPOTENCY] ?? null,
        event: req.headers[HEADER_EVENT] ?? null,
      },
    };
  });

  app.decorate("fixtureCache", {
    size: () => cache.size,
    get: (slug: string) => cache.get(slug),
    revalidated,
  });

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    fixtureCache: {
      size: () => number;
      get: (slug: string) => CacheEntry | undefined;
      revalidated: PublishedPayload[];
    };
  }
}
