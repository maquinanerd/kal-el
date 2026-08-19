"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, EmptyState, Input, PageHead, Select } from "@kal-el/design-system";
import { useAuth } from "../../../lib/auth";
import { ApiError, createSite, listSites, updateSite, type SiteInfo } from "../../../lib/api";

/** Mirrors `primaryDomainSchema` on the API, so the field can say no before the request. */
function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "")
    .toLowerCase();
}

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function domainError(raw: string): string | undefined {
  const host = normalizeDomain(raw);
  if (host === "") return undefined;
  return HOSTNAME.test(host) ? undefined : "Informe um domínio válido, por exemplo maquinanerd.com.br";
}

export default function SitesPage() {
  const { activeSiteId, setActiveSite } = useAuth();
  const [sites, setSites] = useState<SiteInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDomain, setEditDomain] = useState("");
  const [editStatus, setEditStatus] = useState("active");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setSites(await listSites());
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.status === 403
            ? "Sem permissão para gerenciar sites"
            : err.message
          : "Falha ao carregar",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate() {
    setCreating(true);
    setError(null);
    try {
      const host = normalizeDomain(domain);
      await createSite({ slug, name, ...(host ? { primaryDomain: host } : {}) });
      setSlug("");
      setName("");
      setDomain("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao criar site");
    } finally {
      setCreating(false);
    }
  }

  async function onSave(id: string) {
    setError(null);
    setSaving(true);
    try {
      const host = normalizeDomain(editDomain);
      await updateSite(id, { name: editName, primaryDomain: host || null, status: editStatus });
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(s: SiteInfo) {
    setEditingId(s.id);
    setEditName(s.name);
    setEditDomain(s.primaryDomain ?? "");
    setEditStatus(s.status);
  }

  const createDomainError = domain ? domainError(domain) : undefined;
  const editDomainError = editDomain ? domainError(editDomain) : undefined;
  const missingDomains = sites.filter((s) => !s.primaryDomain).length;

  return (
    <>
      <PageHead title="Sites" description="Os portais desta instalação e o domínio de cada um." />
      {error && <Alert tone="danger">{error}</Alert>}
      {missingDomains > 0 && (
        <Alert tone="warning" title={`${missingDomains} ${missingDomains === 1 ? "site sem domínio" : "sites sem domínio"}`}>
          Sem o domínio principal, a prévia de busca, os endereços canônicos e as URLs
          editoriais não têm como ser montados.
        </Alert>
      )}

      <div className="peg-card">
        <div className="peg-card__header">
          <h3 className="peg-card__title">Novo site</h3>
        </div>
        <div className="peg-card__body kalel-site-form">
          <Input label="Nome" value={name} placeholder="Máquina Nerd" onChange={(e) => setName(e.target.value)} />
          <Input label="Slug" value={slug} placeholder="maquina-nerd" hint="Identificador interno." onChange={(e) => setSlug(e.target.value)} />
          <Input
            label="Domínio principal"
            optional
            value={domain}
            placeholder="maquinanerd.com.br"
            hint="Sem https:// e sem barra final — é normalizado automaticamente."
            error={createDomainError}
            onChange={(e) => setDomain(e.target.value)}
          />
          <Button variant="primary" onClick={() => void onCreate()} disabled={creating || !name || !slug || Boolean(createDomainError)}>
            {creating ? "Criando…" : "Criar site"}
          </Button>
        </div>
      </div>

      {sites.length === 0 ? (
        <EmptyState title="Nenhum site" body="Crie o primeiro portal desta instalação." />
      ) : (
        <div className="peg-table-wrap">
          <table className="peg-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Slug</th>
                <th>Domínio principal</th>
                <th>Status</th>
                <th className="peg-table__actions"><span className="peg-sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {sites.map((s) => {
                const editing = editingId === s.id;
                return (
                  <tr key={s.id}>
                    <td>{editing ? <Input value={editName} aria-label="Nome do site" onChange={(e) => setEditName(e.target.value)} /> : s.name}</td>
                    <td className="peg-table__muted">{s.slug}</td>
                    <td>
                      {editing ? (
                        <Input
                          value={editDomain}
                          aria-label="Domínio principal"
                          placeholder="exemplo.com.br"
                          error={editDomainError}
                          onChange={(e) => setEditDomain(e.target.value)}
                        />
                      ) : s.primaryDomain ? (
                        <span className="kalel-domain">{s.primaryDomain}</span>
                      ) : (
                        <span className="peg-table__muted">Não definido</span>
                      )}
                    </td>
                    <td>
                      {editing ? (
                        <Select value={editStatus} aria-label="Status" onChange={(e) => setEditStatus(e.target.value)}>
                          <option value="active">Ativo</option>
                          <option value="inactive">Inativo</option>
                        </Select>
                      ) : (
                        <Badge tone={s.status === "active" ? "success" : "neutral"} dot>
                          {s.status === "active" ? "Ativo" : "Inativo"}
                        </Badge>
                      )}
                    </td>
                    <td className="peg-table__actions">
                      {editing ? (
                        <div className="peg-row">
                          <Button size="xs" variant="secondary" onClick={() => setEditingId(null)}>
                            Cancelar
                          </Button>
                          <Button size="xs" variant="primary" disabled={saving || Boolean(editDomainError)} onClick={() => void onSave(s.id)}>
                            {saving ? "…" : "Salvar"}
                          </Button>
                        </div>
                      ) : (
                        <div className="peg-row">
                          <Button size="xs" variant="secondary" onClick={() => startEdit(s)}>
                            Editar
                          </Button>
                          <Button size="xs" variant="secondary" disabled={s.id === activeSiteId} onClick={() => setActiveSite(s.id)}>
                            {s.id === activeSiteId ? "Em uso" : "Usar"}
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
