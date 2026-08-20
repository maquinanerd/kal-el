import { describe, expect, it } from "vitest";
import { documentV2Schema, type ArticleDocumentV2 } from "@kal-el/contracts";
import { buildTiptapSchema, documentToProseMirror, proseMirrorToDocument, serializeDeterministic as tiptapSerialize } from "../src/tiptap.js";
import { buildLexicalEditor, documentToLexical, lexicalToDocument, serializeDeterministic as lexicalSerialize } from "../src/lexical.js";

const FULL_DOC: ArticleDocumentV2 = {
  version: 2,
  nodes: [
    { type: "paragraph", attrs: {}, content: [{ type: "text", text: "Gladiador II chega aos cinemas com recorde.", marks: [] }] },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Retorno à arena", marks: [] }] },
    { type: "quote", attrs: {}, content: [{ type: "text", text: "Uma citação importante.", marks: [] }] },
    { type: "list", attrs: { ordered: false }, content: [[{ type: "text", text: "Item um", marks: [] }], [{ type: "text", text: "Item dois", marks: [] }]] },
    { type: "list", attrs: { ordered: true }, content: [[{ type: "text", text: "Primeiro", marks: [] }], [{ type: "text", text: "Segundo", marks: [] }]] },
    {
      type: "table",
      attrs: { headers: ["Ano"] },
      content: [
        [[{ type: "text", text: "Ano", marks: [] }], [{ type: "text", text: "Bilheteria", marks: [] }]],
        [[{ type: "text", text: "2000", marks: [] }], [{ type: "text", text: "R$ 100 mi", marks: [] }]],
      ],
    },
    { type: "image", attrs: { mediaId: "11111111-1111-4111-8111-111111111111", caption: "Cartaz", credit: "Divulgação", altText: "Cartaz do filme" } },
    { type: "gallery", attrs: { mediaIds: ["11111111-1111-4111-8111-111111111111"] } },
    { type: "embed", attrs: { url: "https://www.youtube.com/watch?v=abc", provider: "youtube", id: "abc" } },
    { type: "source", attrs: { label: "IMDb", url: "https://imdb.com", kind: "external" } },
  ],
};

const TEXT_ONLY: ArticleDocumentV2 = {
  version: 2,
  nodes: [{ type: "paragraph", attrs: {}, content: [{ type: "text", text: "apenas texto", marks: [] }] }],
};

const MARKED_DOC: ArticleDocumentV2 = {
  version: 2,
  nodes: [
    {
      type: "paragraph",
      attrs: {},
      content: [
        { type: "text", text: "texto com ", marks: [] },
        { type: "text", text: "negrito", marks: [{ type: "bold" }] },
        { type: "text", text: ", ", marks: [] },
        { type: "text", text: "itálico", marks: [{ type: "italic" }] },
        { type: "text", text: " e ", marks: [] },
        { type: "text", text: "link", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
        { type: "text", text: " combinado", marks: [{ type: "bold" }, { type: "link", attrs: { href: "/slug-interno", internal: true } }] },
      ],
    },
  ],
};

describe("TipTap (ProseMirror) prototype", () => {
  it("round-trips the full Kal El node set deterministically", () => {
    const pm = documentToProseMirror(FULL_DOC);
    const back = proseMirrorToDocument(pm);
    expect(JSON.stringify(back)).toBe(JSON.stringify(FULL_DOC));
    expect(tiptapSerialize(documentToProseMirror(FULL_DOC))).toBe(tiptapSerialize(documentToProseMirror(FULL_DOC)));
  });

  it("preserves inline marks (bold, italic, link) across the round-trip", () => {
    const back = proseMirrorToDocument(documentToProseMirror(MARKED_DOC));
    expect(JSON.stringify(back)).toBe(JSON.stringify(MARKED_DOC));
  });

  it("rejects unknown node types at the schema boundary (sanitization)", () => {
    const doc = { version: 2, nodes: [{ type: "html", content: [{ type: "text", text: "<script>alert(1)</script>", marks: [] }] }] } as unknown as ArticleDocumentV2;
    expect(() => documentToProseMirror(doc)).toThrow();
  });

  it("serializes an image inserted without caption/credit/alt into a contract-valid document", () => {
    // The editor inserts atoms with null optional attrs (ProseMirror has no `undefined`);
    // a literal null would fail `documentV2Schema` and the article would refuse to save.
    const schema = buildTiptapSchema();
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("antes")]),
      schema.node("image", { mediaId: "11111111-1111-4111-8111-111111111111", caption: null, credit: null, altText: null }),
    ]);
    const serialized = proseMirrorToDocument(doc);
    expect(JSON.parse(JSON.stringify(serialized)).nodes[1]).toEqual({ type: "image", attrs: { mediaId: "11111111-1111-4111-8111-111111111111" } });
    expect(documentV2Schema.safeParse(serialized).success).toBe(true);
  });

  it("renders every block atom to DOM without a content hole (leaf specs)", () => {
    // A `0` hole in a leaf node's toDOM makes DOMSerializer throw the moment the
    // node is rendered, which took down the editor as soon as an atom was inserted.
    const schema = buildTiptapSchema();
    for (const [name, attrs] of [
      ["image", { mediaId: "11111111-1111-4111-8111-111111111111" }],
      ["gallery", { mediaIds: ["11111111-1111-4111-8111-111111111111"] }],
      ["embed", { url: "https://youtu.be/abc", provider: "youtube", id: "abc" }],
      ["source", { label: "IMDb", url: "https://imdb.com", kind: "external" }],
    ] as const) {
      const spec = schema.nodes[name].spec.toDOM;
      expect(spec).toBeDefined();
      const rendered = spec!(schema.nodes[name].create(attrs)) as unknown[];
      expect(rendered.includes(0)).toBe(false);
    }
  });

  it("accepts out-of-range heading levels structurally (range is enforced by the zod contract at the API boundary)", () => {
    const doc: ArticleDocumentV2 = { version: 2, nodes: [{ type: "heading", attrs: { level: 6 }, content: [{ type: "text", text: "x", marks: [] }] }] };
    const pm = documentToProseMirror(doc);
    expect(pm.childCount).toBe(1);
    // zod already rejects level 6 before it ever reaches the editor
    expect(documentV2Schema.safeParse(doc).success).toBe(false);
  });
});

describe("Lexical headless prototype", () => {
  it("round-trips the core text block set deterministically", async () => {
    const editor = buildLexicalEditor();
    const doc: ArticleDocumentV2 = {
      version: 2,
      nodes: [
        { type: "paragraph", attrs: {}, content: [{ type: "text", text: "Olá mundo", marks: [] }] },
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Seção", marks: [] }] },
        { type: "quote", attrs: {}, content: [{ type: "text", text: "Citação", marks: [] }] },
        { type: "list", attrs: { ordered: true }, content: [[{ type: "text", text: "a", marks: [] }], [{ type: "text", text: "b", marks: [] }]] },
      ],
    };
    await documentToLexical(editor, doc);
    expect(JSON.stringify(lexicalToDocument(editor))).toBe(JSON.stringify(doc));
    expect(lexicalSerialize(editor)).toBe(lexicalSerialize(editor));
  });

  it("serialization includes engine internals (versionability cost)", async () => {
    const editor = buildLexicalEditor();
    await documentToLexical(editor, TEXT_ONLY);
    const json = JSON.stringify(editor.getEditorState().toJSON());
    // Lexical JSON is heavier: node "version" and "type:root" fields are present
    expect(json).toContain('"version"');
    expect(json).toContain('"root"');
  });

  it("drops unsupported node types silently (needs custom node classes)", async () => {
    const editor = buildLexicalEditor();
    await documentToLexical(editor, { version: 2, nodes: [{ type: "image", attrs: { mediaId: "11111111-1111-4111-8111-111111111111" } }] });
    expect(lexicalToDocument(editor).nodes.length).toBe(0);
  });
});
