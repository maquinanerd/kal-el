"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  EmptyState,
  FilterBar,
  IconPlus,
  Input,
  InspectorSection,
  PageHead,
  Search,
  SegmentedControl,
  Select,
  Textarea,
  type FilterChip,
} from "@kal-el/design-system";
import { useAuth } from "../../../lib/auth";
import { ApiError, MEDIA_ACCEPT, deleteMedia, listMedia, updateMedia, uploadMedia, type MediaItem } from "../../../lib/api";

const LIMIT = 60;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Coarse family from the mime type — the filter an editor actually thinks in. */
function family(mime: string): "image" | "video" | "audio" | "doc" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "doc";
}

const FAMILY_LABEL: Record<string, string> = {
  image: "Imagens",
  video: "Vídeos",
  audio: "Áudio",
  doc: "Documentos",
};

export default function MediaPage() {
  const { activeSiteId } = useAuth();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [rawQ, setRawQ] = useState("");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [sort, setSort] = useState<"recent" | "name" | "size">("recent");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(rawQ.trim()), 300);
    return () => clearTimeout(t);
  }, [rawQ]);

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
    setOffset(0);
    if (activeSiteId) void load(activeSiteId, q, 0);
    else setItems([]);
  }, [activeSiteId, q, load]);

  async function doUpload(files: FileList | File[]) {
    if (!activeSiteId) return;
    setUploading(true);
    setError(null);
    try {
      // drag-and-drop can carry several files; uploading one and dropping the rest is a
      // silent loss the person cannot see
      for (const file of Array.from(files)) {
        await uploadMedia(activeSiteId, file);
      }
      setOffset(0);
      await load(activeSiteId, q, 0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao enviar arquivo");
    } finally {
      setUploading(false);
    }
  }

  async function onDelete(mediaId: string) {
    if (!activeSiteId) return;
    try {
      await deleteMedia(activeSiteId, mediaId);
      if (selectedId === mediaId) setSelectedId(null);
      setOffset(0);
      await load(activeSiteId, q, 0);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.status === 409
            ? "Esta mídia está em uso em um artigo e não pode ser excluída."
            : err.message
          : "Falha ao excluir",
      );
    }
  }

  const shown = useMemo(() => {
    let list = kind ? items.filter((m) => family(m.mimeType) === kind) : items;
    if (sort === "name") list = [...list].sort((a, b) => a.filename.localeCompare(b.filename, "pt-BR"));
    else if (sort === "size") list = [...list].sort((a, b) => b.sizeBytes - a.sizeBytes);
    return list;
  }, [items, kind, sort]);

  const selected = shown.find((m) => m.id === selectedId) ?? null;
  const missingAlt = items.filter((m) => family(m.mimeType) === "image" && !m.altText?.trim()).length;

  const chips: FilterChip[] = [];
  if (q) chips.push({ id: "q", label: `Busca: ${q}`, onRemove: () => setRawQ("") });
  if (kind) chips.push({ id: "kind", label: FAMILY_LABEL[kind] ?? kind, onRemove: () => setKind("") });

  function select(id: string) {
    setSelectedId(id);
    setInspectorOpen(true);
  }

  return (
    <>
      <PageHead
        title="Mídia"
        description={`${total} ${total === 1 ? "arquivo" : "arquivos"} na biblioteca.`}
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
                // reset first: without it, picking the same file again fires no change event
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
      {missingAlt > 0 && (
        <Alert tone="warning" title={`${missingAlt} ${missingAlt === 1 ? "imagem sem alt text" : "imagens sem alt text"}`}>
          Sem descrição, a imagem não existe para quem usa leitor de tela.
        </Alert>
      )}

      <FilterBar
        search={<Search placeholder="Buscar por nome de arquivo…" value={rawQ} onChange={(e) => setRawQ(e.target.value)} aria-label="Buscar mídia" />}
        controls={
          <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Filtrar por tipo">
            <option value="">Todos os tipos</option>
            {Object.entries(FAMILY_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </Select>
        }
        trailing={
          <>
            <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Ordenar">
              <option value="recent">Mais recentes</option>
              <option value="name">Nome A–Z</option>
              <option value="size">Maiores primeiro</option>
            </Select>
            <SegmentedControl
              options={[
                { value: "grid", label: "Grade" },
                { value: "list", label: "Lista" },
              ]}
              value={layout}
              onChange={(v) => setLayout(v as "grid" | "list")}
            />
          </>
        }
        chips={chips}
        onClearAll={() => {
          setRawQ("");
          setKind("");
        }}
      />

      <div className="kalel-media">
        <div
          className={`kalel-media__stage ${dragOver ? "kalel-media__stage--drag" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files?.length) void doUpload(e.dataTransfer.files);
          }}
        >
          {loading && items.length === 0 ? (
            <p className="peg-table__muted">Carregando…</p>
          ) : !activeSiteId ? (
            <EmptyState title="Nenhum site disponível" body="Selecione um site." />
          ) : shown.length === 0 ? (
            <EmptyState
              title={chips.length > 0 ? "Nada com esses filtros" : "Biblioteca vazia"}
              body={chips.length > 0 ? "Ajuste a busca ou limpe os filtros." : "Arraste arquivos para esta área ou use Enviar."}
              action={
                chips.length > 0 ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setRawQ("");
                      setKind("");
                    }}
                  >
                    Limpar filtros
                  </Button>
                ) : undefined
              }
            />
          ) : layout === "grid" ? (
            <div className="kalel-media__grid">
              {shown.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`kalel-media__tile ${selectedId === m.id ? "kalel-media__tile--selected" : ""}`}
                  aria-pressed={selectedId === m.id}
                  onClick={() => select(m.id)}
                >
                  <span className="kalel-media__thumb">
                    <img src={m.url} alt={m.altText ?? ""} loading="lazy" />
                    {family(m.mimeType) === "image" && !m.altText?.trim() && (
                      <span className="kalel-media__flag" title="Sem alt text">
                        alt
                      </span>
                    )}
                  </span>
                  <span className="kalel-media__name" title={m.filename}>
                    {m.filename}
                  </span>
                  <span className="kalel-media__meta">
                    {m.width && m.height ? `${m.width}×${m.height} · ` : ""}
                    {formatBytes(m.sizeBytes)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="peg-table-wrap">
              <table className="peg-table peg-table--avatar">
                <thead>
                  <tr>
                    <th>Arquivo</th>
                    <th>Tipo</th>
                    <th>Dimensões</th>
                    <th>Tamanho</th>
                    <th>Alt</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((m) => (
                    <tr key={m.id} onClick={() => select(m.id)} className="kalel-media__row">
                      <td>
                        <div className="peg-cell">
                          <img className="kalel-media__rowthumb" src={m.url} alt="" loading="lazy" />
                          <span className="peg-cell__primary">{m.filename}</span>
                        </div>
                      </td>
                      <td className="peg-table__muted">{FAMILY_LABEL[family(m.mimeType)]}</td>
                      <td className="peg-table__num">{m.width && m.height ? `${m.width}×${m.height}` : "—"}</td>
                      <td className="peg-table__num">{formatBytes(m.sizeBytes)}</td>
                      <td>
                        {m.altText?.trim() ? (
                          <span className="peg-table__muted">ok</span>
                        ) : (
                          <span className="kalel-media__flag kalel-media__flag--inline">falta</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {items.length < total && (
            <div className="kalel-media__more">
              <Button
                variant="secondary"
                disabled={loading}
                onClick={() => {
                  const next = offset + LIMIT;
                  setOffset(next);
                  if (activeSiteId) void load(activeSiteId, q, next);
                }}
              >
                Carregar mais
              </Button>
            </div>
          )}
        </div>

        {inspectorOpen && selected && (
          <div className="peg-scrim kalel-inspector-scrim" onClick={() => setInspectorOpen(false)} aria-hidden="true" />
        )}
        <aside className={`kalel-inspector kalel-media__inspector ${inspectorOpen && selected ? "kalel-inspector--open" : ""}`} aria-label="Detalhes da mídia">
          {selected ? (
            <MediaInspector
              key={selected.id}
              item={selected}
              onClose={() => setInspectorOpen(false)}
              onSaved={(updated) => setItems((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))}
              onDelete={() => void onDelete(selected.id)}
              onError={setError}
              siteId={activeSiteId ?? ""}
            />
          ) : (
            <div className="kalel-media__placeholder">
              <p className="peg-table__muted">Selecione um arquivo para ver e editar seus metadados.</p>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

/**
 * Media detail, 336px. Alt text sits first and is marked required, because it is the one
 * field that changes whether the image exists for part of the audience.
 *
 * The focal point is set by clicking the preview rather than by typing two decimals into
 * number inputs - it is a position on a picture, and the previous pair of 0-1 fields asked
 * an editor to convert one into the other in their head.
 */
function MediaInspector({
  item,
  siteId,
  onClose,
  onSaved,
  onDelete,
  onError,
}: {
  item: MediaItem;
  siteId: string;
  onClose: () => void;
  onSaved: (m: MediaItem) => void;
  onDelete: () => void;
  onError: (msg: string) => void;
}) {
  const [altText, setAltText] = useState(item.altText ?? "");
  const [caption, setCaption] = useState(item.caption ?? "");
  const [credit, setCredit] = useState(item.credit ?? "");
  const [focal, setFocal] = useState<{ x: number; y: number } | null>(
    item.focalX != null && item.focalY != null ? { x: item.focalX, y: item.focalY } : null,
  );
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  function mark<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setDirty(true);
    };
  }

  async function save() {
    if (!siteId) return;
    setSaving(true);
    try {
      const updated = await updateMedia(siteId, item.id, {
        altText: altText || null,
        caption: caption || null,
        credit: credit || null,
        // metadata only: consumers decide how to crop, so no transformation pipeline is
        // introduced here and the storage provider stays independent
        focalX: focal ? Number(focal.x.toFixed(3)) : null,
        focalY: focal ? Number(focal.y.toFixed(3)) : null,
      });
      onSaved(updated);
      setDirty(false);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="kalel-inspector__head">
        <span className="kalel-media__title" title={item.filename}>
          {item.filename}
        </span>
        <button type="button" className="peg-btn peg-btn--icon kalel-inspector__close" aria-label="Fechar" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="kalel-inspector__body">
        <InspectorSection title="Ponto focal" hint="Clique na imagem para marcar o que nunca pode ser cortado.">
          <div
            className="kalel-focal"
            role="button"
            tabIndex={0}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setFocal({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
              setDirty(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setFocal({ x: 0.5, y: 0.5 });
                setDirty(true);
              }
            }}
          >
            <img src={item.url} alt={item.altText ?? ""} />
            {focal && <span className="kalel-focal__dot" style={{ left: `${focal.x * 100}%`, top: `${focal.y * 100}%` }} />}
          </div>
          {focal && (
            <div className="peg-row">
              <span className="peg-table__muted kalel-media__mono">
                {focal.x.toFixed(2)} · {focal.y.toFixed(2)}
              </span>
              <Button
                size="xs"
                variant="tertiary"
                onClick={() => {
                  setFocal(null);
                  setDirty(true);
                }}
              >
                Limpar
              </Button>
            </div>
          )}
        </InspectorSection>

        <InspectorSection title="Descrição">
          <Textarea
            label="Alt text"
            rows={2}
            value={altText}
            hint="O que a imagem mostra, para quem não pode vê-la. Deixe vazio só se for puramente decorativa."
            error={!altText.trim() ? "Sem alt text esta imagem não existe para leitores de tela." : undefined}
            onChange={(e) => mark(setAltText)(e.target.value)}
          />
          <Input label="Legenda" optional value={caption} onChange={(e) => mark(setCaption)(e.target.value)} />
          <Input label="Crédito" optional value={credit} placeholder="Divulgação / Agência" onChange={(e) => mark(setCredit)(e.target.value)} />
        </InspectorSection>

        <InspectorSection title="Arquivo">
          <dl className="kalel-media__facts">
            <dt>Tipo</dt>
            <dd className="kalel-media__mono">{item.mimeType}</dd>
            <dt>Dimensões</dt>
            <dd className="kalel-media__mono">{item.width && item.height ? `${item.width} × ${item.height}` : "—"}</dd>
            <dt>Tamanho</dt>
            <dd className="kalel-media__mono">{formatBytes(item.sizeBytes)}</dd>
            <dt>Enviado</dt>
            <dd className="kalel-media__mono">{new Date(item.createdAt).toLocaleDateString("pt-BR")}</dd>
          </dl>
        </InspectorSection>
      </div>

      <div className="peg-inspector__footer">
        <Button variant="destructive" onClick={onDelete}>
          Excluir
        </Button>
        <Button variant="primary" disabled={saving || !dirty} onClick={() => void save()}>
          {saving ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </>
  );
}
