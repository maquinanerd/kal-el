function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

type InlineNode = { type: string; text?: string; marks?: Mark[] };
type Mark = { type: string; attrs?: { href?: string; title?: string } };
type DocNode = { type: string; content?: unknown; attrs?: Record<string, unknown> };

function renderInline(content: unknown): string {
  if (!Array.isArray(content)) return escapeHtml(String(content ?? ""));
  return (content as InlineNode[])
    .map((node) => {
      if (node.type === "hardBreak") return "<br/>";
      let text = escapeHtml(node.text ?? "");
      for (const mark of node.marks ?? []) {
        if (mark.type === "bold") text = `<strong>${text}</strong>`;
        else if (mark.type === "italic") text = `<em>${text}</em>`;
        else if (mark.type === "code") text = `<code>${text}</code>`;
        else if (mark.type === "underline") text = `<u>${text}</u>`;
        else if (mark.type === "strike") text = `<s>${text}</s>`;
        else if (mark.type === "link") text = `<a href="${escapeHtml(mark.attrs?.href ?? "#")}">${text}</a>`;
      }
      return text;
    })
    .join("");
}

function safeHref(url: unknown): string {
  const s = String(url ?? "");
  return /^https?:\/\//i.test(s) || s.startsWith("/") ? s : "#";
}

export function renderDocumentToHtml(document: { version: number; nodes: unknown[] }): string {
  const blocks = (document.nodes ?? []).map((raw) => {
    const n = raw as DocNode;
    switch (n.type) {
      case "paragraph":
        return `<p>${renderInline(n.content)}</p>`;
      case "heading":
        return `<h${n.attrs?.level ?? 2}>${renderInline(n.content)}</h${n.attrs?.level ?? 2}>`;
      case "quote":
        return `<blockquote>${renderInline(n.content)}</blockquote>`;
      case "list": {
        const tag = n.attrs?.ordered ? "ol" : "ul";
        const items = (n.content as unknown[] ?? []).map((li) => `<li>${renderInline(li)}</li>`).join("");
        return `<${tag}>${items}</${tag}>`;
      }
      case "table": {
        const rows = (n.content as unknown[][] ?? [])
          .map(
            (row, ri) =>
              `<tr>${row.map((cell) => `<${ri === 0 ? "th" : "td"}>${renderInline(cell)}</${ri === 0 ? "th" : "td"}>`).join("")}</tr>`,
          )
          .join("");
        return `<table><tbody>${rows}</tbody></table>`;
      }
      case "image": {
        const caption = n.attrs?.caption ? escapeHtml(String(n.attrs.caption)) : "";
        const alt = n.attrs?.altText ? escapeHtml(String(n.attrs.altText)) : "";
        const credit = n.attrs?.credit ? `<small>${escapeHtml(String(n.attrs.credit))}</small>` : "";
        return `<figure><img src="" alt="${alt}" data-media-id="${escapeHtml(String(n.attrs?.mediaId ?? ""))}"/><figcaption>${caption} ${credit}</figcaption></figure>`;
      }
      case "gallery": {
        const count = (n.attrs?.mediaIds as unknown[] ?? []).length;
        return `<figure><em>Galeria (${count} imagens)</em></figure>`;
      }
      case "embed": {
        const url = safeHref(n.attrs?.url);
        if ((String(n.attrs?.provider ?? "")).toLowerCase() === "youtube") {
          const id = String(n.attrs?.id ?? "");
          return `<iframe width="560" height="315" src="https://www.youtube.com/embed/${escapeHtml(id)}" frameborder="0" allowfullscreen></iframe>`;
        }
        return `<p><a href="${escapeHtml(url)}" rel="nofollow noopener">${escapeHtml(url)}</a></p>`;
      }
      case "source": {
        const label = escapeHtml(String(n.attrs?.label ?? ""));
        const url = safeHref(n.attrs?.url);
        return `<p class="source">Fonte: <a href="${escapeHtml(url)}" rel="noopener">${label}</a></p>`;
      }
      default:
        return "";
    }
  });
  return blocks.join("\n");
}
