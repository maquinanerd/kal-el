import type { Metadata } from "next";
import { renderDocumentToHtml } from "../../../lib/renderDocument";

export const metadata: Metadata = { robots: { index: false, follow: false, nocache: true } };

type PreviewData = {
  article: { title: string; dek: string | null; document: { version: number; nodes: unknown[] }; seo?: { seoTitle?: string | null } };
  site: { slug: string; name: string } | null;
};

async function fetchPreview(token: string): Promise<PreviewData | null> {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
  const res = await fetch(`${base}/v1/preview/${token}`, { cache: "no-store" });
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: PreviewData };
  return json.data ?? null;
}

export default async function PreviewPage({ params }: { params: { token: string } }) {
  const data = await fetchPreview(params.token);
  if (!data) {
    return <main style={{ padding: 24, fontFamily: "sans-serif" }}><p>Preview inválido ou expirado.</p></main>;
  }
  const html = renderDocumentToHtml(data.article.document);

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 24, fontFamily: "Georgia, serif", lineHeight: 1.7 }}>
      <div style={{ color: "#888", fontSize: 12, marginBottom: 8 }}>{data.site ? `${data.site.name} — preview` : "preview"}</div>
      <h1 style={{ fontSize: 32, lineHeight: 1.2 }}>{data.article.title}</h1>
      {data.article.dek && <p style={{ fontSize: 18, color: "#555" }}>{data.article.dek}</p>}
      <article dangerouslySetInnerHTML={{ __html: html }} />
      <style>{`
        article p { margin: 0 0 1em; }
        /* the preview has to show the SAME structure the editor does: a list that reads
           as a run of paragraphs here would make the editor's markers a lie */
        article blockquote { border-left: 3px solid #b7b7b0; margin: 1em 0; padding-left: 16px; color: #555; font-style: italic; }
        article blockquote > p { margin: 0 0 0.4em; }
        article blockquote > p:last-child { margin-bottom: 0; }
        article ul, article ol { margin: 1em 0; padding-left: 1.6em; }
        article ul { list-style: disc outside; }
        article ol { list-style: decimal outside; }
        article li { margin: 0.25em 0; }
        article li > p { margin: 0; }
        article table { border-collapse: collapse; width: 100%; }
        article th, article td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; }
        article figure { margin: 1em 0; }
        article figcaption { font-size: 13px; color: #777; }
        article iframe { max-width: 100%; }
      `}</style>
    </main>
  );
}
