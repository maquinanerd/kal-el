"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Badge, PageHead } from "@kal-el/design-system";
import { useAuth } from "../../../../lib/auth";
import { ApiError, getArticle } from "../../../../lib/api";

export default function ArticlePage() {
  const params = useParams<{ id: string }>();
  const { activeSiteId } = useAuth();
  const [title, setTitle] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeSiteId) return;
    getArticle(activeSiteId, params.id)
      .then((a) => {
        setTitle(a.title);
        setStatus(a.status);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Falha ao carregar"));
  }, [activeSiteId, params.id]);

  return (
    <>
      <PageHead title={title ?? "Artigo"} description="Editor em construção (fase R5)." />
      {error && <p className="peg-field__error">{error}</p>}
      {status && <Badge tone="neutral">{status}</Badge>}
      <p className="peg-table__muted" style={{ marginTop: 12 }}>
        O conteúdo e o editor rich text serão conectados na próxima fase.
      </p>
    </>
  );
}
