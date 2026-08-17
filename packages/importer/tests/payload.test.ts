import { describe, expect, it } from "vitest";
import { PayloadAdapter } from "../src/payload.js";

const EXPORT = {
  docs: [
    {
      id: 1,
      title: "Matéria Payload",
      slug: "materia-payload",
      content: {
        root: {
          type: "root",
          children: [
            { type: "heading", tag: "h2", children: [{ type: "text", text: "Seção", format: 0 }] },
            {
              type: "paragraph",
              children: [
                { type: "text", text: "texto com ", format: 0 },
                { type: "text", text: "negrito", format: 1 },
                { type: "text", text: " e ", format: 0 },
                { type: "link", fields: { url: "https://example.com" }, children: [{ type: "text", text: "link", format: 0 }] },
              ],
            },
          ],
        },
      },
      status: "published",
      publishedAt: "2024-11-15T10:00:00.000Z",
      author: 7,
      categories: [2],
      tags: [3],
    },
  ],
  categories: [{ id: 2, title: "Filmes", slug: "filmes" }],
  tags: [{ id: 3, title: "Gladiador", slug: "gladiador" }],
};

describe("Payload adapter (Lexical richtext)", () => {
  it("maps a Payload export into a normalized batch with relations and inline marks", () => {
    const batch = new PayloadAdapter().readPayloadExport(EXPORT);

    expect(batch.categories.length).toBe(1);
    expect(batch.tags.length).toBe(1);
    expect(batch.articles.length).toBe(1);

    const article = batch.articles[0];
    if (!article) throw new Error("missing article");
    expect(article.externalId).toBe("pl:post:1");
    expect(article.status).toBe("published");
    expect(article.categoryExternalIds).toEqual(["pl:cat:2"]);
    expect(article.tagExternalIds).toEqual(["pl:tag:3"]);
    expect(article.authorExternalIds).toEqual(["pl:author:7"]);

    const heading = article.intermediateNodes[0];
    expect(heading).toMatchObject({ type: "heading", attrs: { level: 2 } });

    const paragraph = article.intermediateNodes[1];
    expect(paragraph?.type).toBe("paragraph");
    const content = (paragraph as { content: { text: string; marks?: { type: string }[] }[] }).content;
    const bold = content.find((c) => c.text === "negrito");
    expect(bold?.marks).toContainEqual({ type: "bold" });
    const link = content.find((c) => c.text === "link");
    expect(link?.marks).toContainEqual({ type: "link", attrs: { href: "https://example.com" } });
  });
});
