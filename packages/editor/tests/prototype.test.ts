import { describe, expect, it } from "vitest";
import { documentSchema, type ArticleDocument } from "@kal-el/contracts";
import { documentToProseMirror, proseMirrorToDocument, serializeDeterministic as tiptapSerialize } from "../src/tiptap.js";
import { buildLexicalEditor, documentToLexical, lexicalToDocument, serializeDeterministic as lexicalSerialize } from "../src/lexical.js";

const FULL_DOC: ArticleDocument = {
  version: 1,
  nodes: [
    { type: "paragraph", attrs: {}, content: "Gladiador II chega aos cinemas com recorde." },
    { type: "heading", attrs: { level: 2 }, content: "Retorno à arena" },
    { type: "quote", attrs: {}, content: "Uma citação importante." },
    { type: "list", attrs: { ordered: false }, content: ["Item um", "Item dois"] },
    { type: "list", attrs: { ordered: true }, content: ["Primeiro", "Segundo"] },
    {
      type: "table",
      attrs: { headers: ["Ano"] },
      content: [
        ["Ano", "Bilheteria"],
        ["2000", "R$ 100 mi"],
      ],
    },
    { type: "image", attrs: { mediaId: "11111111-1111-4111-8111-111111111111", caption: "Cartaz", credit: "Divulgação", altText: "Cartaz do filme" } },
    { type: "gallery", attrs: { mediaIds: ["11111111-1111-4111-8111-111111111111"] } },
    { type: "embed", attrs: { url: "https://www.youtube.com/watch?v=abc", provider: "youtube", id: "abc" } },
    { type: "source", attrs: { label: "IMDb", url: "https://imdb.com", kind: "external" } },
  ],
};

const TEXT_ONLY: ArticleDocument = {
  version: 1,
  nodes: [{ type: "paragraph", attrs: {}, content: "apenas texto" }],
};

describe("TipTap (ProseMirror) prototype", () => {
  it("round-trips the full Kal El node set deterministically", () => {
    const pm = documentToProseMirror(FULL_DOC);
    const back = proseMirrorToDocument(pm);
    expect(JSON.stringify(back)).toBe(JSON.stringify(FULL_DOC));
    expect(tiptapSerialize(documentToProseMirror(FULL_DOC))).toBe(tiptapSerialize(documentToProseMirror(FULL_DOC)));
  });

  it("rejects unknown node types at the schema boundary (sanitization)", () => {
    const doc = { version: 1, nodes: [{ type: "html", content: "<script>alert(1)</script>" }] } as unknown as ArticleDocument;
    expect(() => documentToProseMirror(doc)).toThrow();
  });

  it("accepts out-of-range heading levels structurally (range is enforced by the zod contract at the API boundary)", () => {
    const doc: ArticleDocument = { version: 1, nodes: [{ type: "heading", attrs: { level: 6 }, content: "x" }] };
    const pm = documentToProseMirror(doc);
    expect(pm.childCount).toBe(1);
    // zod already rejects level 6 before it ever reaches the editor
    expect(documentSchema.safeParse(doc).success).toBe(false);
  });
});

describe("Lexical headless prototype", () => {
  it("round-trips the core text block set deterministically", async () => {
    const editor = buildLexicalEditor();
    const doc: ArticleDocument = {
      version: 1,
      nodes: [
        { type: "paragraph", attrs: {}, content: "Olá mundo" },
        { type: "heading", attrs: { level: 3 }, content: "Seção" },
        { type: "quote", attrs: {}, content: "Citação" },
        { type: "list", attrs: { ordered: true }, content: ["a", "b"] },
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
    await documentToLexical(editor, { version: 1, nodes: [{ type: "image", attrs: { mediaId: "11111111-1111-4111-8111-111111111111" } }] });
    expect(lexicalToDocument(editor).nodes.length).toBe(0);
  });
});
