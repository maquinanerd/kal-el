"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { EmptyState, PageHead, Table, type Column } from "@kal-el/design-system";
import { useAuth } from "../../../lib/auth";
import { listArticles, type ArticleSummary } from "../../../lib/api";

export default function CalendarPage() {
  const router = useRouter();
  const { activeSiteId } = useAuth();
  const [items, setItems] = useState<ArticleSummary[]>([]);

  useEffect(() => {
    if (activeSiteId) listArticles(activeSiteId, { status: "scheduled" }).then((p) => setItems(p.items)).catch(() => {});
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
    { key: "scheduledAt", header: "Agendado para", render: (a) => (a.publishedAt ? new Date(a.publishedAt).toLocaleString("pt-BR") : "—") },
  ];

  return (
    <>
      <PageHead title="Calendário editorial" description="Artigos agendados para publicação." />
      {items.length === 0 ? <EmptyState title="Nada agendado" body="Agende artigos para aparecerem aqui." /> : <Table columns={columns} rows={items} selectable={false} />}
    </>
  );
}
