import type { ImportBatch } from "./types.js";

export type DryRunReport = {
  sourceName: string;
  counts: Record<string, number>;
  issues: string[];
  mediaPending: number;
  preview: { title: string; slug: string; status: string; externalId: string }[];
};

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,299}$/;

/** Pure, side-effect-free validation + preview of an import batch (dry-run). */
export function dryRun(batch: ImportBatch): DryRunReport {
  const issues: string[] = [];
  const seenExternal = new Set<string>();

  const checkUnique = (kind: string, externalId: string) => {
    if (seenExternal.has(externalId)) {
      issues.push(`${kind} duplicate externalId: ${externalId}`);
    }
    seenExternal.add(externalId);
  };

  for (const c of batch.categories) {
    checkUnique("category", c.externalId);
    if (!SLUG_RE.test(c.slug)) issues.push(`category invalid slug: ${c.slug}`);
  }
  for (const t of batch.tags) {
    checkUnique("tag", t.externalId);
    if (!SLUG_RE.test(t.slug)) issues.push(`tag invalid slug: ${t.slug}`);
  }
  for (const a of batch.authors) {
    checkUnique("author", a.externalId);
    if (!SLUG_RE.test(a.slug)) issues.push(`author invalid slug: ${a.slug}`);
  }
  for (const m of batch.media) {
    checkUnique("media", m.externalId);
    if (!/^https?:\/\//i.test(m.url)) issues.push(`media invalid url: ${m.url}`);
  }

  const categoryIds = new Set(batch.categories.map((c) => c.externalId));
  const tagIds = new Set(batch.tags.map((t) => t.externalId));
  const authorIds = new Set(batch.authors.map((a) => a.externalId));

  for (const article of batch.articles) {
    checkUnique("article", article.externalId);
    if (!SLUG_RE.test(article.slug)) issues.push(`article invalid slug: ${article.slug}`);
    for (const ref of article.categoryExternalIds) {
      if (!categoryIds.has(ref)) issues.push(`article ${article.externalId}: missing category ref ${ref}`);
    }
    for (const ref of article.tagExternalIds) {
      if (!tagIds.has(ref)) issues.push(`article ${article.externalId}: missing tag ref ${ref}`);
    }
    for (const ref of article.authorExternalIds) {
      if (!authorIds.has(ref)) issues.push(`article ${article.externalId}: missing author ref ${ref}`);
    }
  }

  return {
    sourceName: batch.sourceName,
    counts: {
      categories: batch.categories.length,
      tags: batch.tags.length,
      authors: batch.authors.length,
      media: batch.media.length,
      articles: batch.articles.length,
      redirects: batch.redirects.length,
    },
    issues,
    mediaPending: batch.media.length,
    preview: batch.articles.slice(0, 20).map((a) => ({ title: a.title, slug: a.slug, status: a.status, externalId: a.externalId })),
  };
}
