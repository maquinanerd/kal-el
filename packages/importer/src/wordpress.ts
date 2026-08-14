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
  private: "draft",
};

const POST_TYPE_MAP: Record<string, ArticleType> = {
  review: "review",
  listicle: "list",
  "post": "article",
};

export function normalizeWordPress(snapshot: WpSnapshot): ImportBatch {
  const batch = emptyBatch(snapshot.site.name);

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
    const status = STATUS_MAP[post.status] ?? "draft";
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
