"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, EmptyState, PageHead, Table, type Column } from "@kal-el/design-system";
import { useAuth } from "../../../lib/auth";
import { listArticles, type ArticleSummary } from "../../../lib/api";

export default function CalendarPage() {
  const router = useRouter();
  const { activeSiteId } = useAuth();
  const [items, setItems] = useState<ArticleSummary[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  // "Nada agendado" from first paint until up to twenty sequential requests resolve is the
  // same wrong answer the pagination was added to remove, just earlier in the sequence
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!activeSiteId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    // an editorial calendar that stops at the API default of 25 is worse than no
    // calendar: the missing rows look like nothing is scheduled
    void (async () => {
      const all: ArticleSummary[] = [];
      let cursor: string | undefined;
      let note: string | null = null;
      let failedRun = false;
      const MAX_PAGES = 20;
      for (let page = 0; page < MAX_PAGES; page++) {
        // a site switch used to keep paging the old site for up to seventeen more requests
        if (cancelled) return;
        try {
          const res = await listArticles(activeSiteId, { status: "scheduled", limit: 100, cursor });
          all.push(...res.items);
          if (!res.nextCursor) break;
          cursor = res.nextCursor;
          // silently stopping here would recreate the defect this loop replaced, only
          // further along: an empty calendar reads as "nothing scheduled"
          if (page === MAX_PAGES - 1) note = `Mostrando os primeiros ${all.length} agendamentos.`;
        } catch {
          note = all.length === 0 ? "Falha ao carregar o calendário." : "Falha ao carregar parte do calendário.";
          failedRun = true;
          break;
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

  const columns: Column<ArticleSummary>[] = [
    {
      key: "title",
      header: "Título",
      render: (a) => (
        <button type="button" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit" }} onClick={() => router.push(`/articles/${a.id}`)}>
          {a.title}
        </button>
      ),
    },
    // the API nulls publishedAt while an article is scheduled, so reading it here
    // rendered an em dash on every single row
    { key: "scheduledAt", header: "Agendado para", render: (a) => (a.scheduledAt ? new Date(a.scheduledAt).toLocaleString("pt-BR") : "—") },
  ];

  return (
    <>
      <PageHead title="Calendário editorial" description="Artigos agendados para publicação." />
      {notice && <Alert tone="warning">{notice}</Alert>}
      {loading ? (
        <p className="peg-table__muted">Carregando…</p>
      ) : items.length === 0 && failed ? (
        // "Nada agendado" on a page that failed to find out is the same wrong answer the
        // pagination and the loading state were added to remove, one case further along
        <EmptyState title="Não foi possível carregar" body="Tente novamente em instantes." />
      ) : items.length === 0 ? (
        <EmptyState title="Nada agendado" body="Agende artigos para aparecerem aqui." />
      ) : (
        <Table columns={columns} rows={items} selectable={false} />
      )}
    </>
  );
}
