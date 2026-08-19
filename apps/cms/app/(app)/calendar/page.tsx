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

  useEffect(() => {
    if (!activeSiteId) return;
    let cancelled = false;
    // an editorial calendar that stops at the API default of 25 is worse than no
    // calendar: the missing rows look like nothing is scheduled
    void (async () => {
      const all: ArticleSummary[] = [];
      let cursor: string | undefined;
      let note: string | null = null;
      const MAX_PAGES = 20;
      for (let page = 0; page < MAX_PAGES; page++) {
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
          break;
        }
      }
      if (!cancelled) {
        setItems(all);
        setNotice(note);
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
      {items.length === 0 ? <EmptyState title="Nada agendado" body="Agende artigos para aparecerem aqui." /> : <Table columns={columns} rows={items} selectable={false} />}
    </>
  );
}
