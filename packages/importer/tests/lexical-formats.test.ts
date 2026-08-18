import { describe, expect, it } from "vitest";
import { lexicalToIntermediate, marksFromFormat, unsupportedFormats } from "../src/lexical.js";

/**
 * Lexical's TextNode format bits are IS_BOLD=1, IS_ITALIC=2, IS_STRIKETHROUGH=4,
 * IS_UNDERLINE=8, IS_CODE=16, IS_SUBSCRIPT=32, IS_SUPERSCRIPT=64, IS_HIGHLIGHT=128.
 *
 * The importer previously used 8/16/64 for strikethrough/underline/code, so underlined
 * Payload text imported as struck through, inline code imported as underline, and
 * superscript imported as code. Only bold and italic were correct - which is exactly the
 * range the original test covered.
 */
describe("lexical format bitmask", () => {
  const names = (format: number) => marksFromFormat(format).map((m) => m.type).sort();

  it("maps every supported format bit to the right mark", () => {
    expect(names(1)).toEqual(["bold"]);
    expect(names(2)).toEqual(["italic"]);
    expect(names(4)).toEqual(["strike"]);
    expect(names(8)).toEqual(["underline"]);
    expect(names(16)).toEqual(["code"]);
  });

  it("combines bits without cross-talk", () => {
    expect(names(1 | 2)).toEqual(["bold", "italic"]);
    expect(names(4 | 8)).toEqual(["strike", "underline"]);
    expect(names(1 | 16)).toEqual(["bold", "code"]);
  });

  it("does not invent marks for formats it cannot represent", () => {
    expect(names(32)).toEqual([]);
    expect(names(64)).toEqual([]);
    expect(names(128)).toEqual([]);
    expect(unsupportedFormats(32)).toEqual(["subscript"]);
    expect(unsupportedFormats(64)).toEqual(["superscript"]);
    expect(unsupportedFormats(128)).toEqual(["highlight"]);
    expect(unsupportedFormats(1 | 2)).toEqual([]);
  });
});

describe("lexical block coverage", () => {
  it("keeps an upload node as an image instead of dropping it", () => {
    const warnings: string[] = [];
    const nodes = lexicalToIntermediate(
      {
        type: "root",
        children: [
          { type: "paragraph", children: [{ type: "text", text: "antes", format: 0 }] },
          { type: "upload", fields: { url: "https://cdn.example/hero.jpg" } },
          { type: "paragraph", children: [{ type: "text", text: "depois", format: 0 }] },
        ],
      },
      warnings,
    );

    expect(nodes.map((n) => n.type)).toEqual(["paragraph", "image", "paragraph"]);
    const image = nodes[1];
    if (image?.type !== "image") throw new Error("expected an image node");
    expect(image.attrs.sourceUrl).toBe("https://cdn.example/hero.jpg");
    expect(warnings).toEqual([]);
  });

  it("reports unsupported block types instead of silently dropping them", () => {
    const warnings: string[] = [];
    const nodes = lexicalToIntermediate(
      {
        type: "root",
        children: [
          { type: "paragraph", children: [{ type: "text", text: "ok", format: 0 }] },
          { type: "block", children: [] },
          { type: "relationship", children: [] },
        ],
      },
      warnings,
    );

    expect(nodes.map((n) => n.type)).toEqual(["paragraph"]);
    expect(warnings).toEqual([
      "unsupported lexical node dropped: block",
      "unsupported lexical node dropped: relationship",
    ]);
  });
});
