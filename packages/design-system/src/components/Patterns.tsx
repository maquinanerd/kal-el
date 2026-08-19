/**
 * PEG patterns — composed components that appear on more than one screen.
 *
 * Everything here is built from the primitives and the tokens; nothing introduces a new
 * colour or a new geometry. A pattern earns its place here only when a second screen
 * needs it, which is why (for example) the SERP preview lives in the CMS and the
 * character counter lives here.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Badge } from "./Badge";
import { Button } from "./Button";
import { Input, Search, Select } from "./FormControls";
import { Modal } from "./Overlays";
import { statusLabel, statusTone, type StatusTone } from "../status";
import { IconCheck, IconChevronLeft, IconChevronRight, IconX } from "../icons";

/* ══════════════════════════════════════════════════════════════════════════
   Status
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * A workflow state, rendered the same way everywhere. Always use this instead of printing
 * the enum: `in_review` is not a word.
 */
export function StatusLabel({ status, dot = true }: { status: string | null | undefined; dot?: boolean }) {
  return (
    <Badge tone={statusTone(status) as StatusTone} dot={dot}>
      {statusLabel(status)}
    </Badge>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Save state
   ══════════════════════════════════════════════════════════════════════════ */

export type SaveStateValue = "idle" | "saving" | "saved" | "error" | "offline";

/**
 * Autosave indicator for the topbar.
 *
 * The point of this component is that it NEVER changes size. It previously rendered an
 * empty string while idle and the words "Salvando…"/"Salvo" otherwise, inside normal page
 * flow directly under the H1 — so every autosave cycle grew and collapsed the block and
 * moved everything below it by ~28px. The product review lost clicks to it.
 *
 * The width is reserved with the longest label held in an invisible sizing copy, and the
 * height is fixed, so the text can change on every cycle at zero layout cost.
 */
export function SaveState({ state, error }: { state: SaveStateValue; error?: string | null }) {
  const label =
    state === "saving" ? "Salvando…" : state === "saved" ? "Salvo" : state === "error" ? "Erro ao salvar" : state === "offline" ? "Sem conexão" : "";

  return (
    <span
      className={`peg-save-state peg-save-state--${state}`}
      role="status"
      aria-live="polite"
      title={state === "error" && error ? error : undefined}
    >
      {/* reserves the width of the widest state so nothing reflows between cycles */}
      <span className="peg-save-state__sizer" aria-hidden="true">
        Erro ao salvar
      </span>
      <span className="peg-save-state__value">
        {state === "saved" && <IconCheck className="peg-save-state__icon" />}
        {label}
      </span>
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Character counter
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Objective length feedback for SEO fields: `42 / 60` plus one word of guidance.
 *
 * Deliberately not a score. There is no number that means "good SEO", and a gamified
 * meter invites writers to pad a title to turn a bar green. This states the count, the
 * target, and whether the value is short, in range, or long.
 */
export function CharacterCounter({
  value,
  min,
  max,
  id,
}: {
  value: string;
  /** Below this the field is usually too thin to be useful. Optional. */
  min?: number;
  /** The point where search engines start truncating. */
  max: number;
  id?: string;
}) {
  const length = value.trim().length;
  const state = length === 0 ? "empty" : length > max ? "long" : min !== undefined && length < min ? "short" : "ok";
  const hint =
    state === "empty" ? "" : state === "long" ? "Longo — será cortado" : state === "short" ? "Curto" : "Dentro da faixa";

  return (
    <span className={`peg-counter peg-counter--${state}`} id={id}>
      <span className="peg-counter__count">
        {length} / {max}
      </span>
      {hint && <span className="peg-counter__hint">{hint}</span>}
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Filter bar
   ══════════════════════════════════════════════════════════════════════════ */

export type FilterChip = { id: string; label: string; onRemove: () => void };

/**
 * Search + selects + removable chips, in one row above a dense table.
 * The chips are what make an active filter visible: a `<select>` that is no longer in
 * view is an invisible filter, and the product review could not tell why a list was short.
 */
export function FilterBar({
  search,
  controls,
  chips = [],
  onClearAll,
  trailing,
}: {
  search?: ReactNode;
  controls?: ReactNode;
  chips?: FilterChip[];
  onClearAll?: () => void;
  trailing?: ReactNode;
}) {
  return (
    <div className="peg-filterbar">
      <div className="peg-filterbar__row">
        {search}
        {controls}
        <span className="peg-filterbar__spacer" />
        {trailing}
      </div>
      {chips.length > 0 && (
        <div className="peg-filterbar__chips">
          {chips.map((c) => (
            <button key={c.id} type="button" className="peg-filterchip" onClick={c.onRemove}>
              {c.label}
              <IconX />
            </button>
          ))}
          {onClearAll && chips.length > 1 && (
            <button type="button" className="peg-filterbar__clear" onClick={onClearAll}>
              Limpar tudo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Inspector section
   ══════════════════════════════════════════════════════════════════════════ */

/** A titled block inside the inspector, separated by the dotted divider (PEG rule 1). */
export function InspectorSection({
  title,
  children,
  actions,
  hint,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  hint?: string;
}) {
  return (
    <section className="peg-inspector-section">
      <div className="peg-inspector-section__head">
        <span className="peg-inspector-section__title">{title}</span>
        {actions}
      </div>
      {hint && <p className="peg-inspector-section__hint">{hint}</p>}
      <div className="peg-inspector-section__body">{children}</div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Dialogs
   ══════════════════════════════════════════════════════════════════════════ */

function isValidUrl(raw: string): boolean {
  const value = raw.trim();
  if (!value) return false;
  // an internal link is a site-root path, which `new URL()` cannot parse on its own
  if (value.startsWith("/")) return !value.startsWith("//");
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Link editor. Replaces `window.prompt`, which could not be styled, could not validate,
 * could not offer the internal-article search, and had no way to REMOVE a link.
 */
export function LinkDialog({
  open,
  initialHref = "",
  initialText = "",
  /** Shown when the caret is inside an existing link. */
  canRemove = false,
  /** Optional internal-article search, rendered under the URL field. */
  browse,
  onApply,
  onRemove,
  onClose,
}: {
  open: boolean;
  initialHref?: string;
  initialText?: string;
  canRemove?: boolean;
  browse?: (select: (href: string) => void) => ReactNode;
  onApply: (href: string, text?: string) => void;
  onRemove?: () => void;
  onClose: () => void;
}) {
  const [href, setHref] = useState(initialHref);
  const [text, setText] = useState(initialText);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setHref(initialHref);
      setText(initialText);
      setTouched(false);
    }
  }, [open, initialHref, initialText]);

  if (!open) return null;

  const valid = isValidUrl(href);
  const submit = () => {
    setTouched(true);
    if (!valid) return;
    onApply(href.trim(), text.trim() || undefined);
  };

  return (
    <Modal
      title="Link"
      onClose={onClose}
      width={460}
      footer={
        <>
          {canRemove && onRemove && (
            <Button variant="destructive" onClick={onRemove}>
              Remover link
            </Button>
          )}
          <span style={{ flex: 1 }} />
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={submit} disabled={touched && !valid}>
            Aplicar
          </Button>
        </>
      }
    >
      <form
        className="peg-stack"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Input
          label="URL"
          autoFocus
          value={href}
          placeholder="https://exemplo.com/pagina ou /slug-interno"
          hint="Use https:// para links externos ou /slug para um artigo deste site."
          error={touched && !valid ? "Informe uma URL https:// válida ou um caminho iniciado por /." : undefined}
          onChange={(e) => setHref(e.target.value)}
        />
        {initialText !== undefined && (
          <Input label="Texto" optional value={text} onChange={(e) => setText(e.target.value)} />
        )}
        {browse?.((picked) => setHref(picked))}
        {/* lets Enter submit without a visible duplicate of the footer action */}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** `YYYY-MM-DD` / `HH:MM` in LOCAL time — `toISOString` would shift the date near midnight. */
export function splitLocal(date: Date): { date: string; time: string } {
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

/**
 * Scheduling dialog. Replaces a `window.prompt` that asked for a free-text
 * "AAAA-MM-DD HH:MM" string and rejected anything else after the fact.
 *
 * Uses native date/time inputs, which bring the platform picker and the user's locale for
 * free, and states the timezone explicitly — a newsroom scheduling across regions has to
 * know which clock the time refers to.
 */
export function DateTimeDialog({
  open,
  title = "Agendar publicação",
  confirmLabel = "Agendar",
  initial,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title?: string;
  confirmLabel?: string;
  initial?: Date | null;
  onConfirm: (when: Date) => void;
  onClose: () => void;
}) {
  const timezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return "";
    }
  }, []);

  const seed = useMemo(() => {
    if (initial) return splitLocal(initial);
    // default to the next round hour, which is what an editor almost always wants
    const d = new Date();
    d.setHours(d.getHours() + 1, 0, 0, 0);
    return splitLocal(d);
  }, [initial, open]);

  const [date, setDate] = useState(seed.date);
  const [time, setTime] = useState(seed.time);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setDate(seed.date);
      setTime(seed.time);
      setTouched(false);
    }
  }, [open, seed.date, seed.time]);

  if (!open) return null;

  const parsed = date && time ? new Date(`${date}T${time}`) : null;
  const valid = parsed !== null && !Number.isNaN(parsed.getTime());
  const future = valid && parsed.getTime() > Date.now();
  const error = !valid ? "Informe uma data e uma hora válidas." : !future ? "O horário precisa estar no futuro." : undefined;

  const submit = () => {
    setTouched(true);
    if (valid && future && parsed) onConfirm(parsed);
  };

  const preview =
    valid && parsed
      ? parsed.toLocaleString("pt-BR", { weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" })
      : null;

  return (
    <Modal
      title={title}
      onClose={onClose}
      width={420}
      footer={
        <>
          <span style={{ flex: 1 }} />
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={submit} disabled={touched && !!error}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form
        className="peg-stack"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="peg-row" style={{ alignItems: "flex-start" }}>
          <Input label="Data" type="date" autoFocus value={date} onChange={(e) => setDate(e.target.value)} />
          <Input label="Hora" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        {timezone && <p className="peg-field__hint">Fuso horário: {timezone}</p>}
        {preview && !error && <p className="peg-schedule-preview">Publica {preview}.</p>}
        {touched && error && <p className="peg-field__error">{error}</p>}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}

/**
 * Editorial comment attached to a workflow transition (submit, reject, approve).
 *
 * A rejection without a reason is the single most expensive thing an editor can do to a
 * writer, so for `require`d comments the confirm button stays disabled until something is
 * written. `alert`/`prompt` could not express that at all.
 */
export function WorkflowCommentDialog({
  open,
  title,
  confirmLabel,
  tone = "primary",
  hint,
  require = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  confirmLabel: string;
  tone?: "primary" | "destructive";
  hint?: string;
  require?: boolean;
  onConfirm: (comment: string) => void;
  onClose: () => void;
}) {
  const [comment, setComment] = useState("");

  useEffect(() => {
    if (open) setComment("");
  }, [open]);

  if (!open) return null;

  const blocked = require && comment.trim().length === 0;

  return (
    <Modal
      title={title}
      onClose={onClose}
      width={480}
      footer={
        <>
          <span style={{ flex: 1 }} />
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant={tone} disabled={blocked} onClick={() => onConfirm(comment.trim())}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="peg-stack">
        {hint && <p className="peg-field__hint">{hint}</p>}
        <label className="peg-field">
          <span className="peg-field__label">
            Comentário
            {!require && <span className="peg-field__optional">opcional</span>}
          </span>
          <textarea
            className="peg-textarea"
            rows={4}
            autoFocus
            value={comment}
            placeholder={require ? "O que precisa mudar antes de publicar?" : "Contexto para quem for revisar"}
            onChange={(e) => setComment(e.target.value)}
          />
        </label>
        {blocked && <p className="peg-field__hint">Escreva o que precisa ser alterado para poder devolver o artigo.</p>}
      </div>
    </Modal>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Calendar
   ══════════════════════════════════════════════════════════════════════════ */

export type CalendarEntry = {
  id: string;
  title: string;
  /** Local Date the entry sits on. */
  when: Date;
  status?: string | null;
  author?: string | null;
  warning?: string | null;
  onOpen?: () => void;
};

export type CalendarView = "month" | "week" | "agenda";

const WEEKDAYS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Monday-first, matching the pt-BR editorial week. */
function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x;
}

function startOfMonthGrid(d: Date): Date {
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  return startOfWeek(first);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function calendarRange(view: CalendarView, cursor: Date): { from: Date; to: Date } {
  if (view === "week") {
    const from = startOfWeek(cursor);
    return { from, to: addDays(from, 7) };
  }
  if (view === "agenda") {
    const from = startOfDay(cursor);
    return { from, to: addDays(from, 30) };
  }
  const from = startOfMonthGrid(cursor);
  return { from, to: addDays(from, 42) };
}

export function calendarTitle(view: CalendarView, cursor: Date): string {
  if (view === "week") {
    const from = startOfWeek(cursor);
    const to = addDays(from, 6);
    const fmt = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
    return `${fmt(from)} – ${fmt(to)}`;
  }
  if (view === "agenda") return "Próximos 30 dias";
  return cursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function EntryChip({ entry }: { entry: CalendarEntry }) {
  const time = entry.when.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return (
    <button type="button" className={`peg-cal-entry peg-cal-entry--${statusTone(entry.status)}`} onClick={entry.onOpen} title={entry.title}>
      <span className="peg-cal-entry__time">{time}</span>
      <span className="peg-cal-entry__title">{entry.title}</span>
      {entry.warning && (
        <span className="peg-cal-entry__warn" title={entry.warning}>
          !
        </span>
      )}
    </button>
  );
}

/**
 * Editorial calendar. Month, week and agenda over the same entry list.
 *
 * What replaced a two-column "Título | Agendado para" table: that told an editor nothing
 * about what ships today, what is stacked on one afternoon, or where the week is empty.
 */
export function CalendarGrid({
  view,
  cursor,
  entries,
  emptyLabel = "Nada agendado neste período.",
}: {
  view: CalendarView;
  cursor: Date;
  entries: CalendarEntry[];
  emptyLabel?: string;
}) {
  const today = startOfDay(new Date());

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const e of entries) {
      const key = startOfDay(e.when).toDateString();
      const list = map.get(key);
      if (list) list.push(e);
      else map.set(key, [e]);
    }
    for (const list of map.values()) list.sort((a, b) => a.when.getTime() - b.when.getTime());
    return map;
  }, [entries]);

  if (view === "agenda") {
    const sorted = [...entries].sort((a, b) => a.when.getTime() - b.when.getTime());
    if (sorted.length === 0) return <p className="peg-cal-empty">{emptyLabel}</p>;
    let lastKey = "";
    return (
      <div className="peg-cal-agenda">
        {sorted.map((e) => {
          const key = startOfDay(e.when).toDateString();
          const isNew = key !== lastKey;
          lastKey = key;
          return (
            <div key={e.id}>
              {isNew && (
                <div className={`peg-cal-agenda__day ${sameDay(e.when, today) ? "peg-cal-agenda__day--today" : ""}`}>
                  {e.when.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
                  {sameDay(e.when, today) && <span className="peg-cal-today-pill">hoje</span>}
                </div>
              )}
              <button type="button" className="peg-cal-agenda__row" onClick={e.onOpen}>
                <span className="peg-cal-agenda__time">
                  {e.when.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="peg-cal-agenda__title">{e.title}</span>
                <StatusLabel status={e.status} />
                {e.author && <span className="peg-cal-agenda__author">{e.author}</span>}
              </button>
            </div>
          );
        })}
      </div>
    );
  }

  const { from } = calendarRange(view, cursor);
  const dayCount = view === "week" ? 7 : 42;
  const days = Array.from({ length: dayCount }, (_, i) => addDays(from, i));
  const month = cursor.getMonth();

  return (
    <div className={`peg-cal peg-cal--${view}`}>
      <div className="peg-cal__head">
        {WEEKDAYS.map((w) => (
          <div key={w} className="peg-cal__weekday">
            {w}
          </div>
        ))}
      </div>
      <div className="peg-cal__grid">
        {days.map((d) => {
          const list = byDay.get(d.toDateString()) ?? [];
          const outside = view === "month" && d.getMonth() !== month;
          return (
            <div
              key={d.toISOString()}
              className={`peg-cal__cell ${outside ? "peg-cal__cell--outside" : ""} ${sameDay(d, today) ? "peg-cal__cell--today" : ""}`}
            >
              <div className="peg-cal__daynum">
                {d.getDate()}
                {sameDay(d, today) && <span className="peg-cal-today-pill">hoje</span>}
              </div>
              <div className="peg-cal__entries">
                {list.map((e) => (
                  <EntryChip key={e.id} entry={e} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Hoje / anterior / próximo, shared by every calendar view. */
export function CalendarNav({
  label,
  onPrev,
  onNext,
  onToday,
}: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  return (
    <div className="peg-cal-nav">
      <Button size="sm" variant="secondary" onClick={onToday}>
        Hoje
      </Button>
      <div className="peg-cal-nav__arrows">
        <button type="button" className="peg-pagebtn" aria-label="Período anterior" onClick={onPrev}>
          <IconChevronLeft />
        </button>
        <button type="button" className="peg-pagebtn" aria-label="Próximo período" onClick={onNext}>
          <IconChevronRight />
        </button>
      </div>
      <span className="peg-cal-nav__label">{label}</span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Typeahead picker
   ══════════════════════════════════════════════════════════════════════════ */

export type PickerOption = { id: string; name: string };

/**
 * Searchable multi-select for taxonomies.
 *
 * A checkbox list is fine for eight categories and unusable for two hundred tags, which is
 * what the product review met. Selected values are chips (so they stay visible once the
 * search box is filtered), and everything is keyboard reachable.
 */
export function TokenPicker({
  label,
  hint,
  options,
  selected,
  onToggle,
  placeholder = "Buscar…",
  emptyLabel = "Nada encontrado.",
  maxVisible = 8,
}: {
  label: string;
  hint?: string;
  options: PickerOption[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  maxVisible?: number;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const chosen = options.filter((o) => selected.has(o.id));
  const q = query.trim().toLowerCase();
  const matches = options.filter((o) => !selected.has(o.id) && (!q || o.name.toLowerCase().includes(q))).slice(0, maxVisible);

  return (
    <div className="peg-picker" ref={boxRef}>
      <span className="peg-field__label">{label}</span>
      {hint && <p className="peg-field__hint">{hint}</p>}
      {chosen.length > 0 && (
        <div className="peg-picker__chips">
          {chosen.map((o) => (
            <button key={o.id} type="button" className="peg-filterchip" onClick={() => onToggle(o.id)} aria-label={`Remover ${o.name}`}>
              {o.name}
              <IconX />
            </button>
          ))}
        </div>
      )}
      <div className="peg-picker__search">
        <Search
          placeholder={placeholder}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
        />
        {open && (
          <div className="peg-picker__list" role="listbox">
            {matches.length === 0 && <div className="peg-picker__empty">{emptyLabel}</div>}
            {matches.map((o) => (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected="false"
                className="peg-picker__option"
                onClick={() => {
                  onToggle(o.id);
                  setQuery("");
                }}
              >
                {o.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Permission summary
   ══════════════════════════════════════════════════════════════════════════ */

export type PermissionGroup = { group: string; permissions: string[] };

/**
 * Groups `articles.publish`-style permission keys by their prefix.
 * A role screen that lists fifty flat chips is not readable; the group is the unit an
 * administrator actually reasons about.
 */
export function groupPermissions(permissions: string[]): PermissionGroup[] {
  const map = new Map<string, string[]>();
  for (const p of permissions) {
    const [head] = p.split(/[.:]/, 1);
    const key = head || "geral";
    const list = map.get(key);
    if (list) list.push(p);
    else map.set(key, [p]);
  }
  return [...map.entries()]
    .map(([group, list]) => ({ group, permissions: list.sort() }))
    .sort((a, b) => a.group.localeCompare(b.group));
}

/** Compact "N permissões" + the first few group names, for a table cell. */
export function RolePermissionSummary({ permissions, maxGroups = 3 }: { permissions: string[]; maxGroups?: number }) {
  if (permissions.length === 0) return <span className="peg-table__muted">Nenhuma permissão</span>;
  const groups = groupPermissions(permissions);
  const shown = groups.slice(0, maxGroups);
  const rest = groups.length - shown.length;
  return (
    <span className="peg-perm-summary">
      <strong className="peg-perm-summary__count">{permissions.length}</strong>
      <span className="peg-perm-summary__groups">
        {shown.map((g) => (
          <span key={g.group} className="peg-chip">
            {g.group}
          </span>
        ))}
        {rest > 0 && <span className="peg-table__muted">+{rest}</span>}
      </span>
    </span>
  );
}

/** Full grouped permission list, for the role detail dialog. */
export function PermissionMatrix({ permissions }: { permissions: string[] }) {
  const groups = groupPermissions(permissions);
  if (groups.length === 0) return <p className="peg-table__muted">Este papel não concede nenhuma permissão.</p>;
  return (
    <div className="peg-perm-matrix">
      {groups.map((g) => (
        <section key={g.group} className="peg-perm-matrix__group">
          <h4 className="peg-perm-matrix__title">
            {g.group}
            <span className="peg-table__muted"> · {g.permissions.length}</span>
          </h4>
          <div className="peg-perm-matrix__items">
            {g.permissions.map((p) => (
              <span key={p} className="peg-chip peg-chip--mono">
                {p}
              </span>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Select-or-create combobox
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * A controlled vocabulary that stays extensible: known values come from a `<select>`,
 * and "Outro…" reveals a free-text field. Used for entity types, which were a raw text
 * input even though the domain has a known set.
 */
export function CreatableSelect({
  label,
  value,
  options,
  onChange,
  hint,
  otherLabel = "Outro…",
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  hint?: string;
  otherLabel?: string;
}) {
  const known = options.includes(value);
  const [custom, setCustom] = useState(!known && value !== "");

  return (
    <div className="peg-stack">
      <Select
        label={label}
        hint={hint}
        value={custom ? "__other__" : value}
        onChange={(e) => {
          if (e.target.value === "__other__") {
            setCustom(true);
            onChange("");
          } else {
            setCustom(false);
            onChange(e.target.value);
          }
        }}
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        <option value="__other__">{otherLabel}</option>
      </Select>
      {custom && (
        <Input label="Novo tipo" autoFocus value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}
