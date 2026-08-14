import { describe, expect, it } from "vitest";
import { finalizeDocument, htmlToIntermediate } from "../src/html.js";

const WP_HTML = `
<h2>Retorno à arena</h2>
<p>Uma <strong>nova</strong> aventura de <a href="https://example.com">Ridley Scott</a>.</p>
<blockquote>Citação de exemplo</blockquote>
<ul><li>Item um</li><li>Item dois</li></ul>
<figure><img src="https://legado.example.com/wp-content/gladiador.jpg" alt="Cartaz" /><figcaption>Cartaz oficial</figcaption></figure>
<iframe src="https://www.youtube.com/embed/abc123xyz" frameborder="0"></iframe>
<script>alert(1)</script>
<p style="color:red" onclick="evil()">Texto seguro</p>
<table><tr><th>Ano</th></tr><tr><td>2024</td></tr></table>
`;

describe("html → document transform", () => {
  it("converts classic WordPress HTML into intermediate nodes deterministically", () => {
    const { nodes, warnings } = htmlToIntermediate(WP_HTML);
    expect(warnings).toEqual([]);
    expect(nodes[0]).toEqual({ type: "heading", attrs: { level: 2 }, content: "Retorno à arena" });
    expect(nodes[1]).toEqual({ type: "paragraph", content: "Uma nova aventura de Ridley Scott." });
    expect(nodes[2]).toEqual({ type: "quote", content: "Citação de exemplo" });
    expect(nodes[3]).toEqual({ type: "list", attrs: { ordered: false }, content: ["Item um", "Item dois"] });
    expect(nodes[4]).toMatchObject({ type: "image", attrs: { sourceUrl: "https://legado.example.com/wp-content/gladiador.jpg", caption: "Cartaz oficial", altText: "Cartaz" } });
    expect(nodes[5]).toMatchObject({ type: "embed", attrs: { url: "https://www.youtube.com/embed/abc123xyz", provider: "youtube", id: "abc123xyz" } });
    // scripts and inline event handlers are gone; no node holds the script text
    const flattened = JSON.stringify(nodes);
    expect(flattened).not.toContain("alert(1)");
    expect(flattened).not.toContain("onclick");
    expect(nodes.some((n) => n.type === "table")).toBe(true);
  });

  it("finalizes documents, resolving media URLs to mediaIds and dropping unmapped images", () => {
    const { nodes } = htmlToIntermediate('<p>Olá</p><img src="https://a.example.com/x.jpg" />');
    const warnings: string[] = [];
    const map = new Map([["https://a.example.com/x.jpg", "11111111-1111-4111-8111-111111111111"]]);
    const doc = finalizeDocument(nodes, map, warnings);
    expect(warnings).toEqual([]);
    expect(doc.nodes[1]).toEqual({
      type: "image",
      attrs: { mediaId: "11111111-1111-4111-8111-111111111111", caption: undefined, credit: undefined, altText: undefined },
    });

    const unmapped = finalizeDocument(nodes, new Map(), warnings);
    expect(unmapped.nodes.length).toBe(1);
    expect(warnings.some((w) => w.includes("media not imported"))).toBe(true);
  });

  it("never emits arbitrary html or unsafe urls", () => {
    const { nodes } = htmlToIntermediate('<p>ok</p><a href="javascript:evil()">x</a><img src="data:text/html;base64,AAAA" />');
    const flattened = JSON.stringify(nodes);
    expect(flattened).not.toContain("javascript:");
    expect(flattened).not.toContain("data:");
  });
});
