"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Modal } from "@kal-el/design-system";

import { ApiError, readRawDocument, readRawRevision, replaceDocument, type RawDocument } from "../lib/api";

const EMPTY_DOC = { version: 2, nodes: [] };

/**
 * Repair surface for an article whose stored document cannot be parsed.
 *
 * Every reader in the product degrades such a document to an empty one so the row stays
 * reachable, which means the editor below this banner is showing a blank body that is not
 * what is in the database. Saving over it would destroy the original bytes, so the banner
 * has to say what is happening and offer the three things an editor can actually do:
 * look at what is stored, put a known-good revision back, or replace the body outright.
 *
 * Rendered only for someone holding `articles.recover`; a role without it sees the read
 * failure from the API and gets the warning without the actions, which is the right
 * outcome - a corrupt body is not something an author should be repairing.
 */
export function DocumentRepair({
  siteId,
  articleId,
  version,
  onRepaired,
}: {
  siteId: string;
  articleId: string;
  version: number;
  onRepaired: () => void;
}) {
  const [raw, setRaw] = useState<RawDocument | null>(null);
  const [permitted, setPermitted] = useState(true);
  const [open, setOpen] = useState<"raw" | "restore" | "replace" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRaw(await readRawDocument(siteId, articleId));
      setPermitted(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setPermitted(false);
      else setError(err instanceof ApiError ? err.message : "Falha ao ler o documento armazenado");
    }
  }, [siteId, articleId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function apply(document: unknown, note: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await replaceDocument(siteId, articleId, { document, note }, version);
      setDone(`Documento substituído. O conteúdo anterior foi preservado na revisão ${result.preservedAs}.`);
      setOpen(null);
      await load();
      onRepaired();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao substituir o documento");
    } finally {
      setBusy(false);
    }
  }

  async function restoreRevision(revisionId: string, revisionNumber: number) {
    setBusy(true);
    setError(null);
    try {
      const rev = await readRawRevision(siteId, articleId, revisionId);
      if (!rev.readable) {
        setError("Essa revisão também está ilegível; escolha outra.");
        return;
      }
      await apply(rev.raw, `restaurado da revisão ${revisionNumber}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao ler a revisão");
    } finally {
      setBusy(false);
    }
  }

  if (done) return <Alert tone="success">{done}</Alert>;
  // Readable, or the current user cannot repair: nothing to show.
  if (!permitted || !raw || raw.readable) return null;

  const readableRevisions = raw.revisions.filter((r) => r.readable);

  return (
    <>
      <Alert tone="danger">
        <strong>Este documento precisa de reparo.</strong> O conteúdo armazenado não pôde ser interpretado
        {raw.reason ? ` (${raw.reason})` : ""}, então o editor abaixo está mostrando um corpo vazio que{" "}
        <em>não</em> é o que está no banco. Não salve o corpo antes de resolver isto.
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
          <Button size="sm" variant="secondary" onClick={() => setOpen("raw")}>
            Ver conteúdo original
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setOpen("restore")} disabled={readableRevisions.length === 0}>
            Restaurar versão válida{readableRevisions.length === 0 ? " (nenhuma)" : ""}
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setOpen("replace")}>
            Substituir documento
          </Button>
        </div>
      </Alert>

      {error && <Alert tone="danger">{error}</Alert>}

      {open === "raw" && (
        <Modal title="Conteúdo original armazenado" onClose={() => setOpen(null)}>
          <p style={{ marginTop: 0 }}>
            Exatamente o que está na coluna, sem normalização. Copie o que precisar antes de substituir — depois da
            substituição isto fica apenas na revisão preservada.
          </p>
          <pre
            style={{
              maxHeight: 360,
              overflow: "auto",
              background: "var(--peg-surface-2)",
              padding: 12,
              borderRadius: 6,
              fontSize: 12,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {JSON.stringify(raw.raw, null, 2)}
          </pre>
        </Modal>
      )}

      {open === "restore" && (
        <Modal title="Restaurar uma versão válida" onClose={() => setOpen(null)}>
          <p style={{ marginTop: 0 }}>
            O conteúdo ilegível atual será preservado como uma revisão antes da troca, então nada é perdido.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {raw.revisions.map((r) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span>
                  <strong>#{r.revisionNumber}</strong> {r.note ?? ""}{" "}
                  <span className="peg-table__muted">{new Date(r.createdAt).toLocaleString("pt-BR")}</span>
                </span>
                {r.readable ? (
                  <Button size="xs" variant="secondary" disabled={busy} onClick={() => void restoreRevision(r.id, r.revisionNumber)}>
                    Restaurar
                  </Button>
                ) : (
                  <Badge tone="danger">ilegível</Badge>
                )}
              </div>
            ))}
            {raw.revisions.length === 0 && <p className="peg-table__muted">Sem revisões no histórico.</p>}
          </div>
        </Modal>
      )}

      {open === "replace" && (
        <Modal title="Substituir o documento" onClose={() => setOpen(null)}>
          <p style={{ marginTop: 0 }}>
            Substitui o corpo por um documento vazio, a partir do qual você pode reescrever. O conteúdo ilegível atual
            é preservado como uma revisão antes da troca e continua acessível por &ldquo;Ver conteúdo original&rdquo;
            nessa revisão.
          </p>
          <Button variant="destructive" disabled={busy} onClick={() => void apply(EMPTY_DOC, "documento substituido manualmente")}>
            {busy ? "Substituindo…" : "Substituir por um documento vazio"}
          </Button>
        </Modal>
      )}
    </>
  );
}
