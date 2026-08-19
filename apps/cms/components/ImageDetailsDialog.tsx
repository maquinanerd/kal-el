"use client";

import { useEffect, useState } from "react";
import { Button, Input, Modal, Textarea } from "@kal-el/design-system";

export type ImageDetails = {
  altText: string | null;
  caption: string | null;
  credit: string | null;
};

/**
 * Alt text is asked for at insert time, not inherited silently from the media library.
 *
 * Every image node used to be created with no `altText`, so the renderer emitted
 * `alt=""` - which marks an image decorative and drops it entirely for screen reader
 * users. The library's alt is a good default but not the answer: the same asset can carry
 * different meaning in different articles, and a decorative use has to be a deliberate
 * choice rather than the accident of leaving a field blank.
 */
export function ImageDetailsDialog({
  open,
  filename,
  previewUrl,
  initial,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  filename?: string;
  previewUrl?: string;
  initial?: Partial<ImageDetails>;
  onCancel: () => void;
  onConfirm: (details: ImageDetails) => void;
}) {
  const [altText, setAltText] = useState("");
  const [caption, setCaption] = useState("");
  const [credit, setCredit] = useState("");
  const [decorative, setDecorative] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAltText(initial?.altText ?? "");
    setCaption(initial?.caption ?? "");
    setCredit(initial?.credit ?? "");
    setDecorative(false);
  }, [open, initial?.altText, initial?.caption, initial?.credit]);

  if (!open) return null;

  const missingAlt = !decorative && altText.trim().length === 0;

  return (
    <Modal
      title="Detalhes da imagem"
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            disabled={missingAlt}
            onClick={() =>
              onConfirm({
                altText: decorative ? "" : altText.trim(),
                caption: caption.trim() || null,
                credit: credit.trim() || null,
              })
            }
          >
            Inserir
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {previewUrl && (
          <img
            src={previewUrl}
            alt=""
            style={{ maxHeight: 160, objectFit: "contain", alignSelf: "flex-start", borderRadius: 6 }}
          />
        )}
        {filename && <span className="peg-field__hint">{filename}</span>}

        <Input
          label="Texto alternativo"
          value={altText}
          disabled={decorative}
          onChange={(e) => setAltText(e.target.value)}
          hint="Descreva o que a imagem mostra para quem não pode vê-la."
        />

        <label className="peg-checkbox" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={decorative} onChange={(e) => setDecorative(e.target.checked)} />
          <span className="peg-checkbox__box" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="m5 13 4 4L19 7" />
            </svg>
          </span>
          <span>Imagem decorativa (sem texto alternativo)</span>
        </label>

        <Textarea label="Legenda" rows={2} value={caption} onChange={(e) => setCaption(e.target.value)} />
        <Input label="Crédito" value={credit} onChange={(e) => setCredit(e.target.value)} />

        {missingAlt && (
          <p className="peg-field__error" role="status">
            Informe o texto alternativo ou marque a imagem como decorativa.
          </p>
        )}
      </div>
    </Modal>
  );
}
