import { describe, expect, it } from "vitest";
import {
  articleListQuerySchema,
  createArticleBodySchema,
  documentSchema,
  idempotencyKeySchema,
  updateArticleBodySchema,
} from "@kal-el/contracts";

describe("document schema", () => {
  it("accepts a prose-first document", () => {
    const doc = {
      version: 1,
      nodes: [
        { type: "paragraph", content: "Primeiro parágrafo" },
        { type: "heading", attrs: { level: 2 }, content: "Seção" },
        { type: "quote", content: "Citação" },
        { type: "list", attrs: { ordered: false }, content: ["a", "b"] },
      ],
    };
    expect(documentSchema.safeParse(doc).success).toBe(true);
  });

  it("rejects unknown node types (no arbitrary executable blocks)", () => {
    const doc = {
      version: 1,
      nodes: [{ type: "html", content: "<script>alert(1)</script>" }],
    };
    const parsed = documentSchema.safeParse(doc);
    expect(parsed.success).toBe(false);
  });

  it("rejects non-v1 document versions", () => {
    const parsed = documentSchema.safeParse({ version: 2, nodes: [] });
    expect(parsed.success).toBe(false);
  });

  it("accepts media, gallery, embed and source nodes with strict urls", () => {
    const doc = {
      version: 1,
      nodes: [
        { type: "image", attrs: { mediaId: "11111111-1111-4111-8111-111111111111", caption: "Legenda" } },
        { type: "gallery", attrs: { mediaIds: ["11111111-1111-4111-8111-111111111111"] } },
        { type: "embed", attrs: { url: "https://www.youtube.com/watch?v=abc", provider: "youtube" } },
        { type: "source", attrs: { label: "Fonte", url: "https://example.com" } },
      ],
    };
    expect(documentSchema.safeParse(doc).success).toBe(true);
  });

  it("rejects invalid embed urls", () => {
    const doc = { version: 1, nodes: [{ type: "embed", attrs: { url: "javascript:alert(1)", provider: "x" } }] };
    expect(documentSchema.safeParse(doc).success).toBe(false);
  });
});

describe("article body schemas", () => {
  it("applies defaults on create", () => {
    const parsed = createArticleBodySchema.safeParse({ title: "Título" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.type).toBe("article");
      expect(parsed.data.authors).toEqual([]);
    }
  });

  it("rejects empty update bodies", () => {
    expect(updateArticleBodySchema.safeParse({}).success).toBe(false);
  });

  it("rejects unknown fields (strict mutation schemas)", () => {
    expect(updateArticleBodySchema.safeParse({ title: "x", status: "in_review" }).success).toBe(false);
    expect(createArticleBodySchema.safeParse({ title: "x", unknownField: 1 }).success).toBe(false);
  });

  it("normalizes list query defaults", () => {
    const parsed = articleListQuerySchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.limit).toBe(25);
  });

  it("rejects unsafe idempotency keys", () => {
    expect(idempotencyKeySchema.safeParse("short").success).toBe(false);
    expect(idempotencyKeySchema.safeParse("a;b;c;d;e;f;g").success).toBe(false);
    expect(idempotencyKeySchema.safeParse("mn26.create.2026-08-14").success).toBe(true);
  });
});
