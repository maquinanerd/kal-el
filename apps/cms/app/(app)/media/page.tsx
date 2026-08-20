"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, EmptyState, IconPlus, PageHead, Search } from "@kal-el/design-system";
import { useAuth } from "../../../lib/auth";
import { ApiError, MEDIA_ACCEPT, deleteMedia, isUploadableImage, listMedia, uploadMedia, type MediaItem } from "../../../lib/api";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MediaPage() {
  const router = useRouter();
  const { activeSiteId } = useAuth();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const LIMIT = 60;

  const load = useCallback(async (siteId: string, query: string, off: number) => {
    setLoading(true);
    setError(null);
    try {
      const page = await listMedia(siteId, { q: query || undefined, limit: LIMIT, offset: off });
      setItems((prev) => (off === 0 ? page.items : [...prev, ...page.items]));
      setTotal(page.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao carregar mídia");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeSiteId) void load(activeSiteId, "", 0);
    else setItems([]);
  }, [activeSiteId]);

  async function doUpload(files: File[]) {
    if (!activeSiteId) return;
    const images = files.filter(isUploadableImage);
    if (images.length === 0) {
      setError("Formato não suportado. Use JPG, PNG, WebP, GIF ou AVIF.");
      return;
    }
    setUploading(true);
    setError(images.length < files.length ? `${files.length - images.length} arquivo(s) ignorado(s) — formato não suportado.` : null);
    try {
      for (const file of images) await uploadMedia(activeSiteId, file);
      await load(activeSiteId, q, 0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao enviar arquivo");
      await load(activeSiteId, q, 0);
    } finally {
      setUploading(false);
    }
  }

  async function onDelete(mediaId: string) {
    if (!activeSiteId) return;
    try {
      await deleteMedia(activeSiteId, mediaId);
      setOffset(0);
      await load(activeSiteId, q, 0);
    } catch (err) {
      setError(err instanceof ApiError ? (err.status === 409 ? "Mídia em uso — não pode ser excluída" : err.message) : "Falha ao excluir");
    }
  }

  function search(value: string) {
    setQ(value);
    setOffset(0);
    if (activeSiteId) void load(activeSiteId, value, 0);
  }

  return (
    <>
      <PageHead
        title="Mídia"
        description={`${total} item(s)`}
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept={MEDIA_ACCEPT}
              multiple
              hidden
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = "";
                if (files.length > 0) void doUpload(files);
              }}
            />
            <Button variant="primary" icon={<IconPlus />} onClick={() => fileRef.current?.click()} disabled={uploading || !activeSiteId}>
              {uploading ? "Enviando…" : "Enviar"}
            </Button>
          </>
        }
      />

      {error && <Alert tone="danger">{error}</Alert>}

      <div style={{ marginBottom: 16 }}>
        <Search placeholder="Buscar por nome de arquivo…" value={q} onChange={(e) => search(e.target.value)} />
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); const files = [...e.dataTransfer.files]; if (files.length > 0) void doUpload(files); }}
        style={{
          border: `1px dashed ${dragOver ? "var(--peg-accent, #2563eb)" : "var(--peg-border-color, #e5e7eb)"}`,
          borderRadius: 8,
          padding: 12,
          minHeight: 120,
          background: dragOver ? "var(--peg-surface-hover, #f9fafb)" : "transparent",
        }}
      >
        {loading && items.length === 0 ? (
          <p className="peg-table__muted">Carregando…</p>
        ) : !activeSiteId ? (
          <EmptyState title="Nenhum site disponível" body="Selecione um site." />
        ) : items.length === 0 ? (
          <EmptyState title="Nenhuma mídia" body="Arraste imagens aqui ou clique em Enviar." />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
            {items.map((m) => (
              <div key={m.id} className="peg-card" style={{ padding: 8 }}>
                <button type="button" aria-label={`Abrir ${m.filename}`} style={{ background: "none", border: 0, padding: 0, cursor: "pointer", width: "100%" }} onClick={() => router.push(`/media/${m.id}`)}>
                  <img src={m.url} alt={m.altText ?? m.filename} style={{ width: "100%", height: 110, objectFit: "cover", borderRadius: 6, display: "block" }} />
                </button>
                <div style={{ padding: "6px 4px", display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={m.filename}>{m.filename}</span>
                  <span className="peg-table__muted" style={{ fontSize: 11 }}>
                    {m.width && m.height ? `${m.width}×${m.height} · ` : ""}{formatBytes(m.sizeBytes)}
                  </span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <Button size="xs" variant="secondary" onClick={() => router.push(`/media/${m.id}`)}>Editar</Button>
                    <Button size="xs" variant="destructive" onClick={() => void onDelete(m.id)}>Excluir</Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {items.length < total && (
        <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}>
          <Button variant="secondary" onClick={() => { const next = offset + LIMIT; setOffset(next); if (activeSiteId) void load(activeSiteId, q, next); }} disabled={loading}>
            Carregar mais
          </Button>
        </div>
      )}
    </>
  );
}
