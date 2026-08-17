import { describe, expect, it } from "vitest";
import {
  articleListQuerySchema,
  createArticleBodySchema,
  documentSchema,
  documentV2Schema,
  idempotencyKeySchema,
  migrateDocumentToV1,
  migrateDocumentToV2,
  updateArticleBodySchema,
} from "@kal-el/contracts";

describe("document schema", () => {
  it("accepts a legacy v1 prose-first document", () => {
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

  it("accepts a v2 document with inline marks", () => {
    const doc = {
      version: 2,
      nodes: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "texto com ", marks: [] },
            { type: "text", text: "negrito", marks: [{ type: "bold" }] },
            { type: "text", text: " e ", marks: [] },
            { type: "text", text: "link", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
          ],
        },
      ],
    };
    expect(documentV2Schema.safeParse(doc).success).toBe(true);
  });

  it("rejects unknown node types (no arbitrary executable blocks)", () => {
    const doc = {
      version: 2,
      nodes: [{ type: "html", content: [{ type: "text", text: "<script>alert(1)</script>", marks: [] }] }],
    };
    const parsed = documentV2Schema.safeParse(doc);
    expect(parsed.success).toBe(false);
  });

  it("rejects unsupported document versions", () => {
    expect(documentSchema.safeParse({ version: 3, nodes: [] }).success).toBe(false);
  });

  it("rejects unsafe link hrefs", () => {
    const doc = {
      version: 2,
      nodes: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }],
    };
    expect(documentV2Schema.safeParse(doc).success).toBe(false);
  });

  it("accepts media, gallery, embed and source nodes with strict urls", () => {
    const doc = {
      version: 2,
      nodes: [
        { type: "image", attrs: { mediaId: "11111111-1111-4111-8111-111111111111", caption: "Legenda" } },
        { type: "gallery", attrs: { mediaIds: ["11111111-1111-4111-8111-111111111111"] } },
        { type: "embed", attrs: { url: "https://www.youtube.com/watch?v=abc", provider: "youtube" } },
        { type: "source", attrs: { label: "Fonte", url: "https://example.com" } },
      ],
    };
    expect(documentV2Schema.safeParse(doc).success).toBe(true);
  });

  it("rejects invalid embed urls", () => {
    const doc = { version: 2, nodes: [{ type: "embed", attrs: { url: "javascript:alert(1)", provider: "x" } }] };
    expect(documentV2Schema.safeParse(doc).success).toBe(false);
  });
});

describe("document migration", () => {
  it("migrates v1 to v2 preserving text", () => {
    const v1 = {
      version: 1 as const,
      nodes: [
        { type: "paragraph" as const, attrs: {}, content: "Olá mundo" },
        { type: "heading" as const, attrs: { level: 2 as const }, content: "Seção" },
        { type: "list" as const, attrs: { ordered: false as const }, content: ["a", "b"] },
        { type: "table" as const, attrs: { headers: ["Ano"] }, content: [["Ano", "2024"]] },
      ],
    };
    const v2 = migrateDocumentToV2(v1);
    expect(v2.version).toBe(2);
    expect(v2.nodes[0]).toEqual({ type: "paragraph", attrs: {}, content: [{ type: "text", text: "Olá mundo", marks: [] }] });
    expect(v2.nodes[1]).toEqual({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Seção", marks: [] }] });
    expect(v2.nodes[2]).toEqual({ type: "list", attrs: { ordered: false }, content: [[{ type: "text", text: "a", marks: [] }], [{ type: "text", text: "b", marks: [] }]] });
    expect(v2.nodes[3]).toEqual({ type: "table", attrs: { headers: ["Ano"] }, content: [[[{ type: "text", text: "Ano", marks: [] }], [{ type: "text", text: "2024", marks: [] }]]] });
  });

  it("is idempotent for v2 documents", () => {
    const v2 = { version: 2 as const, nodes: [{ type: "paragraph" as const, attrs: {}, content: [{ type: "text", text: "x", marks: [] }] }] };
    expect(migrateDocumentToV2(v2)).toEqual(v2);
  });

  it("round-trips v1 -> v2 -> v1 for plain text documents", () => {
    const v1 = {
      version: 1 as const,
      nodes: [
        { type: "paragraph" as const, attrs: {}, content: "Olá mundo" },
        { type: "list" as const, attrs: { ordered: true as const }, content: ["a", "b"] },
      ],
    };
    const back = migrateDocumentToV1(migrateDocumentToV2(v1));
    expect(back).toEqual(v1);
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
