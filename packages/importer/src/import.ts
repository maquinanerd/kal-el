import type { KalElClient } from "@kal-el/sdk";
import { finalizeDocument } from "./html.js";
import type { ImportBatch, NormalizedAuthor, NormalizedMedia, NormalizedTaxonomy } from "./types.js";

export type ImportReport = {
  source: { categories: number; tags: number; authors: number; media: number; articles: number; redirects: number };
  imported: { categories: number; tags: number; authors: number; articles: number; redirects: number; media: number };
  existing: { categories: number; tags: number; authors: number; articles: number };
  warnings: string[];
  articleIds: string[];
  mediaPending: number;
};

function slugToId<T extends { id: string; slug: string }>(rows: T[]): Map<string, string> {
  return new Map(rows.map((r) => [r.slug, r.id]));
}

function externalSuffix(externalId: string): string {
  const idx = externalId.lastIndexOf(":");
  return idx === -1 ? externalId : externalId.slice(idx + 1);
}

async function ensureCategories(client: KalElClient, siteId: string, items: NormalizedTaxonomy[], report: ImportReport, map: Map<string, string>): Promise<void> {
  // parents first so hierarchies exist
  const ordered = [...items].sort((a, b) => (a.parentExternalId ? 1 : 0) - (b.parentExternalId ? 1 : 0));
  for (const item of ordered) {
    if (map.has(item.slug)) continue;
    try {
      const created = await client.createCategory(siteId, { name: item.name, slug: item.slug });
      map.set(created.slug, created.id);
      report.imported.categories++;
    } catch {
      // duplicate slug raced; a later list refresh will pick it up
    }
  }
}

async function ensureTags(client: KalElClient, siteId: string, items: NormalizedTaxonomy[], report: ImportReport, map: Map<string, string>): Promise<void> {
  for (const item of items) {
    if (map.has(item.slug)) continue;
    try {
      const created = await client.createTag(siteId, { name: item.name, slug: item.slug });
      map.set(created.slug, created.id);
      report.imported.tags++;
    } catch {
      // raced
    }
  }
}

async function ensureAuthors(client: KalElClient, siteId: string, items: NormalizedAuthor[], report: ImportReport, map: Map<string, string>): Promise<void> {
  for (const item of items) {
    if (map.has(item.slug)) continue;
    try {
      const created = await client.createAuthor(siteId, { name: item.name, slug: item.slug, email: item.email });
      map.set(created.slug, created.id);
      report.imported.authors++;
    } catch {
      // raced
    }
  }
}

/**
 * Import a normalized batch through the public REST API (never PostgreSQL
 * directly). Article `externalKey = {prefix}:{externalId}` makes re-import
 * idempotent; already-imported articles are skipped and counted as existing.
 */
export async function importBatch(
  client: KalElClient,
  siteId: string,
  batch: ImportBatch,
  opts: { externalKeyPrefix?: string; fetchMedia?: (media: NormalizedMedia) => Promise<{ data: Buffer; mimeType: string }> } = {},
): Promise<ImportReport> {
  const prefix = opts.externalKeyPrefix ?? "imp";
  const report: ImportReport = {
    source: {
      categories: batch.categories.length,
      tags: batch.tags.length,
      authors: batch.authors.length,
      media: batch.media.length,
      articles: batch.articles.length,
      redirects: batch.redirects.length,
    },
    imported: { categories: 0, tags: 0, authors: 0, articles: 0, redirects: 0, media: 0 },
    existing: { categories: 0, tags: 0, authors: 0, articles: 0 },
    warnings: [],
    articleIds: [],
    mediaPending: 0,
  };

  const categoryMap = slugToId(await client.listCategories(siteId));
  const tagMap = slugToId(await client.listTags(siteId));
  const authorMap = slugToId(await client.listAuthors(siteId));
  report.existing = { categories: categoryMap.size, tags: tagMap.size, authors: authorMap.size, articles: 0 };

  await ensureCategories(client, siteId, batch.categories, report, categoryMap);
  await ensureTags(client, siteId, batch.tags, report, tagMap);
  await ensureAuthors(client, siteId, batch.authors, report, authorMap);

  // media: when a fetchMedia provider is given, download + upload binaries so
  // image/gallery nodes and featured images survive the import.
  const urlToMediaId = new Map<string, string>();
  if (opts.fetchMedia) {
    for (const m of batch.media) {
      try {
        const { data, mimeType } = await opts.fetchMedia(m);
        const uploaded = await client.uploadMedia(siteId, m.filename, data, mimeType);
        urlToMediaId.set(m.url, uploaded.id);
        report.imported.media++;
      } catch (err) {
        report.warnings.push(`media failed: ${m.url} (${err instanceof Error ? err.message : String(err)})`);
      }
    }
  }
  report.mediaPending = batch.media.length - report.imported.media;

  for (const article of batch.articles) {
    const externalKey = `${prefix}:${article.externalId}`;
    const existing = await client.listArticles(siteId, { externalKey });
    const first = existing.items[0];
    if (first) {
      report.existing.articles++;
      report.articleIds.push(first.id);
      continue;
    }

    const categoryIds = article.categoryExternalIds.map((e) => categoryMap.get(externalSuffix(e))).filter((id): id is string => Boolean(id));
    const tagIds = article.tagExternalIds.map((e) => tagMap.get(externalSuffix(e))).filter((id): id is string => Boolean(id));
    const authorIds = article.authorExternalIds.map((e) => authorMap.get(externalSuffix(e))).filter((id): id is string => Boolean(id));

    const featuredMediaId = article.featuredMediaExternalId ? urlToMediaId.get(batch.media.find((m) => m.externalId === article.featuredMediaExternalId)?.url ?? "") : undefined;

    const document = finalizeDocument(article.intermediateNodes, urlToMediaId, report.warnings);

    const created = await client.createArticle(siteId, {
      type: article.type,
      title: article.title,
      slug: article.slug,
      excerpt: article.excerpt,
      document,
      status: article.status,
      publishedAt: article.publishedAt,
      scheduledAt: article.scheduledAt,
      categories: categoryIds,
      tags: tagIds,
      authors: authorIds,
      featuredMediaId,
      externalKey,
      provenance: {
        system: batch.sourceName.toLowerCase(),
        sources: [{ provider: batch.sourceName.toLowerCase(), externalId: article.externalId, externalUrl: article.externalUrl || undefined }],
      },
      seo: article.seo,
    });

    report.imported.articles++;
    report.articleIds.push(created.id);
  }

  for (const redirect of batch.redirects) {
    try {
      await client.createRedirect(siteId, { sourcePath: redirect.sourcePath, targetPath: redirect.targetPath, kind: "301" });
      report.imported.redirects++;
    } catch {
      // duplicate source path already imported
    }
  }

  return report;
}
