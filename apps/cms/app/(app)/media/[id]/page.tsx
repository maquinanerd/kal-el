"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button, Input, PageHead, Textarea } from "@kal-el/design-system";
import { useAuth } from "../../../../lib/auth";
import { ApiError, deleteMedia, listMedia, updateMedia, type MediaItem } from "../../../../lib/api";

export default function MediaDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { activeSiteId } = useAuth();
  const [item, setItem] = useState<MediaItem | null>(null);
  const [altText, setAltText] = useState("");
  const [caption, setCaption] = useState("");
  const [credit, setCredit] = useState("");
  const [focalX, setFocalX] = useState("");
  const [focalY, setFocalY] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!activeSiteId) return;
    listMedia(activeSiteId, { limit: 200 })
      .then((page) => {
        const found = page.items.find((m) => m.id === params.id) ?? null;
        setItem(found);
        setAltText(found?.altText ?? "");
        setCaption(found?.caption ?? "");
        setCredit(found?.credit ?? "");
        setFocalX(found?.focalX != null ? String(found.focalX) : "");
        setFocalY(found?.focalY != null ? String(found.focalY) : "");
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Falha ao carregar"));
  }, [activeSiteId, params.id]);

  async function save() {
    if (!activeSiteId || !item) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateMedia(activeSiteId, item.id, {
        altText: altText || null,
        caption: caption || null,
        credit: credit || null,
        // focal point is metadata only: consumers decide how to crop, so no image
        // transformation pipeline is introduced here and StorageProvider stays independent
        focalX: focalX === "" ? null : Number(focalX),
        focalY: focalY === "" ? null : Number(focalY),
      });
      setItem(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!activeSiteId || !item) return;
    try {
      await deleteMedia(activeSiteId, item.id);
      router.push("/media");
    } catch (err) {
      setError(err instanceof ApiError ? (err.status === 409 ? "Mídia em uso — não pode ser excluída" : err.message) : "Falha ao excluir");
    }
  }

  return (
    <>
      <PageHead title={item?.filename ?? "Mídia"} />
      {error && <p className="peg-field__error">{error}</p>}
      {item && (
        <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
          <img src={item.url} alt={item.altText ?? item.filename} style={{ maxWidth: 420, width: "100%", borderRadius: 8 }} />
          <div style={{ flex: 1, minWidth: 280, display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="peg-card">
              <div className="peg-card__body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <span className="peg-field__label">Arquivo</span>
                  <p>{item.filename}</p>
                </div>
                <div>
                  <span className="peg-field__label">Tipo / dimensões</span>
                  <p className="peg-table__muted">{item.mimeType} · {item.width}×{item.height} · {item.sizeBytes} bytes</p>
                </div>
                <Input label="Alt text" value={altText} onChange={(e) => setAltText(e.target.value)} />
                <Textarea label="Legenda (caption)" rows={2} value={caption} onChange={(e) => setCaption(e.target.value)} />
                <Input label="Crédito" value={credit} onChange={(e) => setCredit(e.target.value)} />
                <div style={{ display: "flex", gap: 12 }}>
                  <Input
                    label="Ponto focal X"
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={focalX}
                    onChange={(e) => setFocalX(e.target.value)}
                    hint="0 = esquerda, 1 = direita"
                  />
                  <Input
                    label="Ponto focal Y"
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={focalY}
                    onChange={(e) => setFocalY(e.target.value)}
                    hint="0 = topo, 1 = base"
                  />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <Button variant="primary" onClick={() => void save()} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
                  <Button variant="destructive" onClick={() => void remove()}>Excluir</Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
