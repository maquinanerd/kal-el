"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Modal, Search } from "@kal-el/design-system";
import { useAuth } from "../lib/auth";
import { ApiError, MEDIA_ACCEPT, isUploadableImage, listMedia, uploadMedia, type MediaItem } from "../lib/api";

export function MediaPicker({
  open,
  multiple = false,
  onClose,
  onSelect,
}: {
  open: boolean;
  multiple?: boolean;
  onClose: () => void;
  onSelect: (ids: string[]) => void;
}) {
  const { activeSiteId } = useAuth();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open || !activeSiteId) return;
    listMedia(activeSiteId, { q: q || undefined, limit: 100 }).then((p) => setItems(p.items)).catch(() => {});
  }, [open, activeSiteId, q]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (multiple) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      } else {
        next.clear();
        next.add(id);
      }
      return next;
    });
  }

  const upload = useCallback(
    async (files: File[]) => {
      if (!activeSiteId) return;
      const images = files.filter(isUploadableImage);
      const rejected = files.length - images.length;
      if (images.length === 0) {
        setError(rejected > 0 ? "Formato não suportado. Use JPG, PNG, WebP, GIF ou AVIF." : null);
        return;
      }
      const batch = multiple ? images : images.slice(0, 1);
      setUploading((n) => n + batch.length);
      setError(rejected > 0 ? `${rejected} arquivo(s) ignorado(s) — formato não suportado.` : null);
      for (const file of batch) {
        try {
          const item = await uploadMedia(activeSiteId, file);
          setItems((prev) => [item, ...prev.filter((m) => m.id !== item.id)]);
          setSelected((prev) => {
            const next = multiple ? new Set(prev) : new Set<string>();
            next.add(item.id);
            return next;
          });
        } catch (err) {
          setError(err instanceof ApiError ? err.message : `Falha ao enviar ${file.name}`);
        } finally {
          setUploading((n) => n - 1);
        }
      }
    },
    [activeSiteId, multiple],
  );

  // Ctrl+V anywhere while the picker is open — the grid itself is not focusable,
  // so a listener scoped to the modal subtree would miss most pastes.
  useEffect(() => {
    if (!open) return;
    function onPaste(e: ClipboardEvent) {
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length === 0) return;
      e.preventDefault();
      void upload(files);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [open, upload]);

  function confirm() {
    onSelect([...selected]);
    setSelected(new Set());
    onClose();
  }

  function close() {
    setSelected(new Set());
    setError(null);
    onClose();
  }

  if (!open) return null;

  const label = multiple ? "Selecionar imagens" : "Selecionar imagem";

  return (
    <Modal
      title={label}
      onClose={close}
      footer={
        <>
          <span className="peg-table__muted" style={{ marginRight: "auto", fontSize: 12 }}>
            {uploading > 0 ? `Enviando ${uploading} arquivo(s)…` : "Arraste, cole (Ctrl+V) ou envie do computador."}
          </span>
          <Button variant="primary" onClick={confirm} disabled={selected.size === 0}>
            Selecionar
          </Button>
        </>
      }
    >
      <div
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const files = [...e.dataTransfer.files];
          if (files.length > 0) void upload(files);
        }}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Search placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
          <input
            ref={fileRef}
            type="file"
            accept={MEDIA_ACCEPT}
            multiple={multiple}
            hidden
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = "";
              if (files.length > 0) void upload(files);
            }}
          />
          <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={uploading > 0 || !activeSiteId}>
            {uploading > 0 ? "Enviando…" : "Enviar do computador"}
          </Button>
        </div>

        {error && <Alert tone="danger">{error}</Alert>}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
            gap: 8,
            maxHeight: 320,
            overflowY: "auto",
            border: `1px dashed ${dragOver ? "var(--peg-accent, #2563eb)" : "transparent"}`,
            borderRadius: 6,
            padding: 4,
            minHeight: 80,
          }}
        >
          {items.length === 0 && uploading === 0 && (
            <p className="peg-table__muted">Nenhuma mídia ainda — arraste uma imagem aqui, cole com Ctrl+V ou clique em “Enviar do computador”.</p>
          )}
          {items.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-label={selected.has(m.id) ? `Remover ${m.filename}` : `Selecionar ${m.filename}`}
              aria-pressed={selected.has(m.id)}
              onClick={() => toggle(m.id)}
              onDoubleClick={() => {
                if (!multiple) {
                  onSelect([m.id]);
                  setSelected(new Set());
                  onClose();
                }
              }}
              style={{
                border: selected.has(m.id) ? "2px solid var(--peg-accent, #2563eb)" : "1px solid var(--peg-border-color, #e5e7eb)",
                borderRadius: 6,
                padding: 2,
                background: "none",
                cursor: "pointer",
              }}
            >
              <img src={m.url} alt={m.filename} style={{ width: "100%", height: 70, objectFit: "cover", borderRadius: 4, display: "block" }} />
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
