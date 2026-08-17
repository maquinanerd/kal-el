"use client";

import { useEffect, useState } from "react";
import { Button, Modal, Search } from "@kal-el/design-system";
import { useAuth } from "../lib/auth";
import { listMedia, type MediaItem } from "../lib/api";

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

  function confirm() {
    onSelect([...selected]);
    setSelected(new Set());
    onClose();
  }

  if (!open) return null;

  return (
    <Modal title={multiple ? "Selecionar imagens" : "Selecionar imagem"} onClose={() => { setSelected(new Set()); onClose(); }} footer={<Button variant="primary" onClick={confirm} disabled={selected.size === 0}>Selecionar</Button>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Search placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 8, maxHeight: 320, overflowY: "auto" }}>
          {items.length === 0 && <p className="peg-table__muted">Nenhuma mídia. Envie imagens em Mídia.</p>}
          {items.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-label={selected.has(m.id) ? `Remover ${m.filename}` : `Selecionar ${m.filename}`}
              aria-pressed={selected.has(m.id)}
              onClick={() => toggle(m.id)}
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
