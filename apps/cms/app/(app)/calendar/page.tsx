"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  CalendarGrid,
  CalendarNav,
  EmptyState,
  PageHead,
  SegmentedControl,
  calendarTitle,
  type CalendarEntry,
  type CalendarView,
} from "@kal-el/design-system";
import { useAuth } from "../../../lib/auth";
import { listArticles, listAuthors, type ArticleSummary, type Author } from "../../../lib/api";

/**
 * The calendar shows what is committed to a date: scheduled pieces and what already went
 * out. A draft has no date, so it has no place on a calendar - it belongs in the queue.
 */
const DATED_STATUSES = ["scheduled", "published"] as const;

function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n, 1);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Anything scheduled in the past has missed its slot and the worker has not taken it. */
function warningFor(a: ArticleSummary): string | null {
  if (a.status !== "scheduled" || !a.scheduledAt) return null;
  if (new Date(a.scheduledAt).getTime() < Date.now()) return "Horário já passou e o artigo não foi publicado.";
  return null;
}

export default function CalendarPage() {
  const router = useRouter();
  const { activeSiteId } = useAuth();

  const [view, setView] = useState<CalendarView>("month");
  const [cursor, setCursor] = useState(() => new Date());
  const [items, setItems] = useState<ArticleSummary[]>([]);
  const [authors, setAuthors] = useState<Author[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!activeSiteId) {
      setLoading(false);
      return;
    }
    listAuthors(activeSiteId).then(setAuthors).catch(() => {});
  }, [activeSiteId]);

  useEffect(() => {
    if (!activeSiteId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;

    // A calendar that stops at the API default of 25 is worse than no calendar: the
    // missing rows look like nothing is scheduled. Paged to exhaustion, with an explicit
    // notice if the ceiling is ever reached - a silent truncation reads as "covered".
    void (async () => {
      const all: ArticleSummary[] = [];
      let note: string | null = null;
      let failedRun = false;
      const MAX_PAGES = 20;

      for (const status of DATED_STATUSES) {
        let cursorToken: string | undefined;
        for (let page = 0; page < MAX_PAGES; page++) {
          if (cancelled) return;
          try {
            const res = await listArticles(activeSiteId, { status, limit: 100, cursor: cursorToken });
            all.push(...res.items);
            if (!res.nextCursor) break;
            cursorToken = res.nextCursor;
            if (page === MAX_PAGES - 1) note = `Mostrando os primeiros ${all.length} itens datados.`;
          } catch {
            note = all.length === 0 ? "Falha ao carregar o calendário." : "Falha ao carregar parte do calendário.";
            failedRun = true;
            break;
          }
        }
      }

      if (!cancelled) {
        setItems(all);
        setNotice(note);
        setFailed(failedRun);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeSiteId]);

  const authorName = useMemo(() => new Map(authors.map((a) => [a.id, a.name])), [authors]);

  const entries: CalendarEntry[] = useMemo(
    () =>
      items
        .map((a): CalendarEntry | null => {
          const iso = a.status === "scheduled" ? a.scheduledAt : a.publishedAt;
          if (!iso) return null;
          return {
            id: a.id,
            title: a.title || "Sem título",
            when: new Date(iso),
            status: a.status,
            author: a.authors.length ? (authorName.get(a.authors[0] as string) ?? null) : null,
            warning: warningFor(a),
            onOpen: () => router.push(`/articles/${a.id}`),
          };
        })
        .filter((e): e is CalendarEntry => e !== null),
    [items, authorName, router],
  );

  function step(direction: 1 | -1) {
    setCursor((c) => (view === "month" ? addMonths(c, direction) : addDays(c, direction * (view === "week" ? 7 : 30))));
  }

  const lateCount = entries.filter((e) => e.warning).length;

  return (
    <>
      <PageHead title="Calendário editorial" description="O que sai hoje, esta semana e no resto do mês." />

      {notice && <Alert tone="warning">{notice}</Alert>}
      {lateCount > 0 && (
        <Alert tone="warning" title={`${lateCount} ${lateCount === 1 ? "agendamento venceu" : "agendamentos venceram"}`}>
          O horário passou e o artigo continua agendado. Verifique o worker de publicação.
        </Alert>
      )}

      <div className="kalel-cal-toolbar">
        <CalendarNav
          label={calendarTitle(view, cursor)}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          onToday={() => setCursor(new Date())}
        />
        <span className="kalel-cal-toolbar__spacer" />
        <SegmentedControl
          options={[
            { value: "month", label: "Mês" },
            { value: "week", label: "Semana" },
            { value: "agenda", label: "Agenda" },
          ]}
          value={view}
          onChange={(v) => setView(v as CalendarView)}
        />
      </div>

      {loading ? (
        <p className="peg-table__muted">Carregando…</p>
      ) : !activeSiteId ? (
        <EmptyState title="Nenhum site disponível" body="Selecione um site para ver o calendário." />
      ) : entries.length === 0 && failed ? (
        <EmptyState title="Não foi possível carregar" body="Tente novamente em instantes." />
      ) : (
        <CalendarGrid
          view={view}
          cursor={cursor}
          entries={entries}
          emptyLabel="Nada datado neste período. Agende um artigo para vê-lo aqui."
        />
      )}
    </>
  );
}
