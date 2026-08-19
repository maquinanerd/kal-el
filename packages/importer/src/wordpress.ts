import type { ArticleStatus, ArticleType } from "@kal-el/contracts";
import { emptyBatch, type ImportBatch, type NormalizedArticle, type NormalizedMedia, type NormalizedTaxonomy } from "./types.js";
import { htmlToIntermediate } from "./html.js";

/** Deterministic JSON export modeled on WXR essentials. */

export type WpMeta = {
  "_yoast_wpseo_title"?: string;
  "_yoast_wpseo_metadesc"?: string;
  "_yoast_wpseo_canonical"?: string;
};

export type WpPost = {
  id: number;
  post_type: string;
  title: string;
  slug: string;
  content: string;
  excerpt?: string;
  status: string;
  date: string;
  modified?: string;
  author?: number;
  categories: number[];
  tags: number[];
  featured_media?: number;
  meta?: WpMeta;
  link?: string;
};

export type WpSnapshot = {
  site: { name: string; url: string };
  authors: { id: number; display_name: string; user_email?: string; user_nicename?: string }[];
  categories: { id: number; name: string; slug: string; parent?: number }[];
  tags: { id: number; name: string; slug: string }[];
  media: {
    id: number;
    filename: string;
    url: string;
    mime_type?: string;
    width?: number;
    height?: number;
    alt?: string;
    caption?: string;
  }[];
  posts: WpPost[];
};

export function readWordPressSnapshot(json: unknown): WpSnapshot {
  if (!json || typeof json !== "object" || !Array.isArray((json as WpSnapshot).posts)) {
    throw new Error("invalid WordPress snapshot: expected { site, posts, … }");
  }
  return json as WpSnapshot;
}

const STATUS_MAP: Record<string, ArticleStatus> = {
  publish: "published",
  future: "scheduled",
  draft: "draft",
  pending: "in_review",
  // WordPress `private` is published-but-restricted. Kal El has no equivalent visibility
  // rule, so it imports as a draft: making it live would publish content the source
  // deliberately kept off the public site.
  private: "draft",
};

/**
 * Where an expired `future` post lands.
 *
 * A WordPress export routinely contains `future` posts whose date has already passed -
 * a missed cron, a site that was offline, an export taken from an old backup. Mapping
 * those to `scheduled` handed them to the publish worker with a due date in the past, so
 * the very next tick published them: content the source never published going live on
 * import, announced to every webhook subscriber, with nobody having decided to publish it.
 *
 * `blocked` is the editorial state that means "needs a decision before it can move", it is
 * visible in the workflow queue, and both `approve` and `reject` are legal from it - so
 * the article is recoverable in one click either way. A draft would be quieter but would
 * also let the post disappear into a list nobody reviews.
 */
const EXPIRED_FUTURE_STATUS: ArticleStatus = "blocked";

const POST_TYPE_MAP: Record<string, ArticleType> = {
  review: "review",
  listicle: "list",
  "post": "article",
};

export function normalizeWordPress(snapshot: WpSnapshot, opts: { now?: Date } = {}): ImportBatch {
  const batch = emptyBatch(snapshot.site.name);
  const now = opts.now ?? new Date();

  const categories = new Map<number, NormalizedTaxonomy>();
  for (const c of snapshot.categories) {
    categories.set(c.id, { externalId: `wp:cat:${c.id}`, kind: "category", name: c.name, slug: c.slug });
  }
  for (const c of snapshot.categories) {
    const row = categories.get(c.id);
    if (row && c.parent && categories.has(c.parent)) {
      row.parentExternalId = `wp:cat:${c.parent}`;
    }
  }
  batch.categories = [...categories.values()];

  batch.tags = snapshot.tags.map((t) => ({ externalId: `wp:tag:${t.id}`, kind: "tag", name: t.name, slug: t.slug }));

  batch.authors = snapshot.authors.map((a) => ({
    externalId: `wp:author:${a.id}`,
    name: a.display_name,
    slug: a.user_nicename ?? a.display_name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    email: a.user_email,
  }));

  const media = new Map<number, NormalizedMedia>();
  for (const m of snapshot.media) {
    media.set(m.id, {
      externalId: `wp:media:${m.id}`,
      filename: m.filename,
      url: m.url,
      mimeType: m.mime_type ?? "application/octet-stream",
      width: m.width,
      height: m.height,
      altText: m.alt,
      caption: m.caption,
    });
  }
  batch.media = [...media.values()];

  for (const post of snapshot.posts) {
    if (!["post", "review", "listicle", "page"].includes(post.post_type)) continue;

    const parsed = htmlToIntermediate(post.content);
    let status = STATUS_MAP[post.status] ?? "draft";

    // A `future` post whose date has already passed is not a schedule any more; see
    // EXPIRED_FUTURE_STATUS. An unparseable date is treated the same way rather than
    // trusted: `new Date("")` is Invalid Date, and every comparison against it is false,
    // so a lenient check would have silently kept it `scheduled`.
    if (status === "scheduled") {
      const at = new Date(post.date);
      if (!Number.isFinite(at.getTime()) || at <= now) {
        status = EXPIRED_FUTURE_STATUS;
        batch.warnings.push(
          `article wp:post:${post.id}: WordPress status "future" with a past or invalid date (${post.date}); imported as "${EXPIRED_FUTURE_STATUS}" instead of publishing it`,
        );
      }
    }

    const scheduledAt = status === "scheduled" ? post.date : undefined;
    const publishedAt = status === "published" ? post.date : undefined;

    const article: NormalizedArticle = {
      externalId: `wp:post:${post.id}`,
      type: POST_TYPE_MAP[post.post_type] ?? "article",
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt,
      intermediateNodes: parsed.nodes,
      status,
      publishedAt,
      scheduledAt,
      authorExternalIds: post.author ? [`wp:author:${post.author}`] : [],
      categoryExternalIds: post.categories.map((id) => `wp:cat:${id}`),
      tagExternalIds: post.tags.map((id) => `wp:tag:${id}`),
      featuredMediaExternalId: post.featured_media ? `wp:media:${post.featured_media}` : undefined,
      seo: {
        seoTitle: post.meta?._yoast_wpseo_title,
        metaDescription: post.meta?._yoast_wpseo_metadesc,
        canonicalUrl: post.meta?._yoast_wpseo_canonical,
      },
      externalUrl: post.link ?? "",
    };
    batch.articles.push(article);
  }

  return batch;
}
