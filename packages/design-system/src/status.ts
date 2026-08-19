/**
 * The single place a workflow state becomes something a person reads.
 *
 * The CMS used to print the raw enum — an editor saw `in_review` and `blocked` in the
 * article list, the workflow queue, the calendar and the editor header. Each screen that
 * did humanise it kept its own `switch`, so the vocabulary drifted between screens.
 *
 * `tone` is the PEG badge tone for the state, so a status renders identically wherever it
 * appears. Note that `blocked` is danger and `archived` is neutral: an archived article is
 * a normal end state, not a problem.
 */
export type StatusKey = "draft" | "in_review" | "scheduled" | "published" | "blocked" | "archived";

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";

export type StatusMeta = {
  /** Human label, pt-BR, sentence case. */
  label: string;
  tone: StatusTone;
  /** One line of plain language for tooltips and empty states. */
  description: string;
};

export const STATUS_META: Record<StatusKey, StatusMeta> = {
  draft: {
    label: "Rascunho",
    tone: "neutral",
    description: "Em escrita. Só quem tem acesso ao CMS enxerga.",
  },
  in_review: {
    label: "Em revisão",
    tone: "info",
    description: "Aguardando um editor aprovar ou pedir alterações.",
  },
  scheduled: {
    label: "Agendado",
    tone: "warning",
    description: "Aprovado e com data marcada. Publica sozinho no horário.",
  },
  published: {
    label: "Publicado",
    tone: "success",
    description: "No ar.",
  },
  blocked: {
    label: "Bloqueado",
    tone: "danger",
    description: "Devolvido pela revisão. Precisa de alterações antes de voltar.",
  },
  archived: {
    label: "Arquivado",
    tone: "neutral",
    description: "Fora de circulação, preservado no histórico.",
  },
};

/** Order used by status tabs and by the workflow queue. Mirrors the editorial pipeline. */
export const STATUS_ORDER: StatusKey[] = ["draft", "in_review", "scheduled", "published", "blocked", "archived"];

function isStatusKey(value: string): value is StatusKey {
  return value in STATUS_META;
}

/**
 * Never throws and never renders an empty string: an unknown status (a new state added on
 * the API before the CMS knows about it) degrades to a de-slugged version of the enum
 * rather than a blank cell.
 */
export function statusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  if (isStatusKey(status)) return STATUS_META[status].label;
  return status.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function statusTone(status: string | null | undefined): StatusTone {
  if (status && isStatusKey(status)) return STATUS_META[status].tone;
  return "neutral";
}

export function statusDescription(status: string | null | undefined): string {
  if (status && isStatusKey(status)) return STATUS_META[status].description;
  return "";
}
