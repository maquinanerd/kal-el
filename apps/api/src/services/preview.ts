import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@kal-el/db";
import { articles, sites } from "@kal-el/db/schema";
import { notFound } from "../plugins/errors.js";
import { migrateDocumentToV2 } from "@kal-el/contracts";

const PREVIEW_TTL_SECONDS = 15 * 60;

type PreviewPayload = { s: string; a: string; e: number };

export function createPreviewToken(secret: string, siteId: string, articleId: string): string {
  const payload: PreviewPayload = { s: siteId, a: articleId, e: Math.floor(Date.now() / 1000) + PREVIEW_TTL_SECONDS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("hex");
  return `kpv.${body}.${sig}`;
}

export function verifyPreviewToken(secret: string, token: string): PreviewPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "kpv") return null;
  const body = parts[1];
  const sig = parts[2];
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as PreviewPayload;
    if (!payload.s || !payload.a || payload.e < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function safePreviewDocument(value: unknown) {
  if (!value) return { version: 2, nodes: [] };
  try {
    return migrateDocumentToV2(value as Parameters<typeof migrateDocumentToV2>[0]);
  } catch {
    return { version: 2, nodes: [] };
  }
}

export async function resolvePreview(db: Db, payload: PreviewPayload) {
  const row = await db.query.articles.findFirst({
    where: and(eq(articles.id, payload.a), eq(articles.siteId, payload.s)),
  });
  if (!row) throw notFound("preview not found");
  const site = await db.query.sites.findFirst({ where: eq(sites.id, payload.s) });
  return {
    article: {
      id: row.id,
      title: row.title,
      dek: row.dek ?? null,
      slug: row.slug,
      status: row.status,
      // same reason as `storedDocument` in the article service: a malformed column must
      // not take the preview down with it
      document: safePreviewDocument(row.document),
      seo: row.seo,
      featuredMediaId: row.featuredMediaId ?? null,
      publishedAt: row.publishedAt?.toISOString() ?? null,
    },
    site: site ? { slug: site.slug, name: site.name } : null,
  };
}
