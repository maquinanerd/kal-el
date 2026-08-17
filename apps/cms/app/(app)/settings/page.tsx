"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Input, PageHead, Select, Table, type Column } from "@kal-el/design-system";
import { useAuth } from "../../../lib/auth";
import { ApiError, createRedirect, deleteRedirect, listRedirects, listSites, updateSite, type Redirect, type SiteInfo } from "../../../lib/api";

export default function SettingsPage() {
  const { activeSiteId } = useAuth();
  const [site, setSite] = useState<SiteInfo | null>(null);
  const [name, setName] = useState("");
  const [status, setStatus] = useState("active");
  const [redirects, setRedirects] = useState<Redirect[]>([]);
  const [src, setSrc] = useState("");
  const [dst, setDst] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeSiteId) return;
    try {
      const sites = await listSites();
      const s = sites.find((x) => x.id === activeSiteId) ?? null;
      setSite(s);
      setName(s?.name ?? "");
      setStatus(s?.status ?? "active");
      setRedirects(await listRedirects(activeSiteId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao carregar");
    }
  }, [activeSiteId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveSite() {
    if (!activeSiteId) return;
    try {
      await updateSite(activeSiteId, { name, status });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao salvar");
    }
  }

  async function addRedirect() {
    if (!activeSiteId) return;
    try {
      await createRedirect(activeSiteId, { sourcePath: src, targetPath: dst, kind: "301" });
      setSrc(""); setDst("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao criar redirect");
    }
  }

  async function removeRedirect(id: string) {
    if (!activeSiteId) return;
    try {
      await deleteRedirect(activeSiteId, id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao excluir");
    }
  }

  const columns: Column<Redirect>[] = [
    { key: "source", header: "De", render: (r) => r.sourcePath },
    { key: "target", header: "Para", render: (r) => r.targetPath },
    { key: "kind", header: "Tipo", render: (r) => <span className="peg-table__muted">{r.kind}</span> },
    { key: "actions", header: "", render: (r) => <Button size="xs" variant="destructive" onClick={() => void removeRedirect(r.id)}>Excluir</Button> },
  ];

  return (
    <>
      <PageHead title="Configurações" description="Site, redirects e SEO técnico." />
      {error && <Alert tone="danger">{error}</Alert>}

      <div className="peg-card" style={{ marginBottom: 16 }}>
        <div className="peg-card__header"><h3 className="peg-card__title">Site</h3></div>
        <div className="peg-card__body" style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <Input label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">ativo</option>
            <option value="inactive">inativo</option>
          </Select>
          <Button variant="primary" onClick={() => void saveSite()} disabled={!site}>Salvar site</Button>
        </div>
      </div>

      <div className="peg-card" style={{ marginBottom: 16 }}>
        <div className="peg-card__header"><h3 className="peg-card__title">Redirects</h3></div>
        <div className="peg-card__body" style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 12 }}>
          <Input label="De (ex: /antigo)" value={src} onChange={(e) => setSrc(e.target.value)} />
          <Input label="Para (ex: /novo)" value={dst} onChange={(e) => setDst(e.target.value)} />
          <Button variant="primary" onClick={() => void addRedirect()} disabled={!src || !dst}>Adicionar 301</Button>
        </div>
        <Table columns={columns} rows={redirects} selectable={false} />
      </div>
    </>
  );
}
