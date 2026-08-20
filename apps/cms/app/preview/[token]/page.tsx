import type { Metadata } from "next";
import { renderDocumentToHtml } from "../../../lib/renderDocument";

export const metadata: Metadata = { robots: { index: false, follow: false, nocache: true } };

type PreviewData = {
  article: { title: string; dek: string | null; document: { version: number; nodes: unknown[] }; seo?: { seoTitle?: string | null } };
  site: { slug: string; name: string } | null;
};

function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
}

async function fetchPreview(token: string): Promise<PreviewData | null> {
  const res = await fetch(`${apiBase()}/v1/preview/${token}`, { cache: "no-store" });
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: PreviewData };
  return json.data ?? null;
}

export default async function PreviewPage({ params }: { params: { token: string } }) {
  const data = await fetchPreview(params.token);
  if (!data) {
    return <main style={{ padding: 24, fontFamily: "sans-serif" }}><p>Preview inválido ou expirado.</p></main>;
  }
  // The preview has no session, so body images come from the token-scoped media
  // route rather than the `media.read` one the CMS uses.
  const html = renderDocumentToHtml(data.article.document, {
    mediaUrl: (mediaId) => `${apiBase()}/v1/preview/${encodeURIComponent(params.token)}/media/${encodeURIComponent(mediaId)}`,
  });

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 24, fontFamily: "Georgia, serif", lineHeight: 1.7 }}>
      <div style={{ color: "#888", fontSize: 12, marginBottom: 8 }}>{data.site ? `${data.site.name} — preview` : "preview"}</div>
      <h1 style={{ fontSize: 32, lineHeight: 1.2 }}>{data.article.title}</h1>
      {data.article.dek && <p style={{ fontSize: 18, color: "#555" }}>{data.article.dek}</p>}
      <article dangerouslySetInnerHTML={{ __html: html }} />
      <style>{`
        article p { margin: 0 0 1em; }
        article blockquote { border-left: 3px solid #ccc; margin: 1em 0; padding-left: 12px; color: #555; }
        article table { border-collapse: collapse; width: 100%; }
        article th, article td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; }
        article figure { margin: 1em 0; }
        article figcaption { font-size: 13px; color: #777; }
        article img { display: block; max-width: 100%; height: auto; border-radius: 4px; }
        article figure.gallery { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px; }
        article figure.gallery img { width: 100%; object-fit: cover; }
        article iframe { max-width: 100%; }
      `}</style>
    </main>
  );
}
