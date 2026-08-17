import { describe, expect, it } from "vitest";
import { dryRun } from "../src/dryrun.js";
import { normalizeWordPress, readWordPressSnapshot } from "../src/wordpress.js";

const SNAPSHOT = {
  site: { name: "Portal Legado", url: "https://legado.example.com" },
  authors: [{ id: 1, display_name: "Ana Souza", user_nicename: "ana-souza", user_email: "ana@legado.example" }],
  categories: [
    { id: 5, name: "Filmes", slug: "filmes" },
    { id: 6, name: "Crítica", slug: "critica" },
  ],
  tags: [{ id: 9, name: "Gladiador", slug: "gladiador" }],
  media: [{ id: 12, filename: "gladiador.jpg", url: "https://legado.example.com/wp-content/gladiador.jpg", mime_type: "image/jpeg" }],
  posts: [
    {
      id: 42,
      post_type: "post",
      title: "Gladiador II chega aos cinemas",
      slug: "gladiador-ii-cinemas",
      content: "<h2>Retorno</h2><p>Texto.</p>",
      excerpt: "Resumo",
      status: "publish",
      date: "2024-11-15T10:00:00Z",
      author: 1,
      categories: [5],
      tags: [9],
      featured_media: 12,
      meta: { _yoast_wpseo_title: "Título SEO", _yoast_wpseo_metadesc: "Descrição SEO" },
      link: "https://legado.example.com/gladiador-ii-cinemas",
    },
    {
      id: 43,
      post_type: "post",
      title: "Rascunho da crítica",
      slug: "rascunho-critica",
      content: "<p>Rascunho.</p>",
      status: "draft",
      date: "2024-11-14T09:00:00Z",
      author: 1,
      categories: [6],
      tags: [],
    },
  ],
};

describe("WordPress adapter", () => {
  it("normalizes a snapshot deterministically", () => {
    const snapshot = readWordPressSnapshot(SNAPSHOT);
    const batch = normalizeWordPress(snapshot);

    expect(batch.sourceName).toBe("Portal Legado");
    expect(batch.categories.length).toBe(2);
    expect(batch.tags.length).toBe(1);
    expect(batch.authors.length).toBe(1);
    expect(batch.media.length).toBe(1);
    expect(batch.articles.length).toBe(2);

    const published = batch.articles.find((a) => a.externalId === "wp:post:42");
    expect(published).toBeDefined();
    expect(published?.status).toBe("published");
    expect(published?.publishedAt).toBe("2024-11-15T10:00:00Z");
    expect(published?.seo?.seoTitle).toBe("Título SEO");
    expect(published?.categoryExternalIds).toEqual(["wp:cat:5"]);
    expect(published?.authorExternalIds).toEqual(["wp:author:1"]);
    expect(published?.intermediateNodes[0]).toEqual({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Retorno", marks: [] }] });

    const draft = batch.articles.find((a) => a.externalId === "wp:post:43");
    expect(draft?.status).toBe("draft");
    expect(draft?.publishedAt).toBeUndefined();

    const again = normalizeWordPress(snapshot);
    expect(JSON.stringify(again)).toBe(JSON.stringify(batch));
  });

  it("produces a dry-run report with counts and no issues for a valid snapshot", () => {
    const batch = normalizeWordPress(readWordPressSnapshot(SNAPSHOT));
    const report = dryRun(batch);
    expect(report.issues).toEqual([]);
    expect(report.counts.articles).toBe(2);
    expect(report.mediaPending).toBe(1);
    expect(report.preview.length).toBe(2);
  });

  it("flags broken references in the dry-run", () => {
    const batch = normalizeWordPress(readWordPressSnapshot(SNAPSHOT));
    const first = batch.articles[0];
    if (first) first.categoryExternalIds.push("wp:cat:999");
    const report = dryRun(batch);
    expect(report.issues.some((i) => i.includes("missing category ref"))).toBe(true);
  });
});
