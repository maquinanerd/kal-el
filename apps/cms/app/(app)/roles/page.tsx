"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  EmptyState,
  Input,
  Modal,
  PageHead,
  PermissionMatrix,
  RolePermissionSummary,
  Search,
  groupPermissions,
  permissionGroupLabel,
  permissionLabel,
} from "@kal-el/design-system";
import { ApiError, createRole, listPermissions, listRoles, type PermissionInfo, type Role } from "../../../lib/api";

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [available, setAvailable] = useState<PermissionInfo[]>([]);
  /* An empty `available` means two different things: the fetch has not answered yet, or
     there is genuinely nothing to grant. Only the second one may disable the button. */
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Role | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);

  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [permQuery, setPermQuery] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, p] = await Promise.all([listRoles(), listPermissions().catch(() => [] as PermissionInfo[])]);
      setRoles(r);
      setAvailable(p);
    } catch (err) {
      setError(
        err instanceof ApiError ? (err.status === 403 ? "Sem permissão para gerenciar papéis" : err.message) : "Falha ao carregar",
      );
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(p: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  async function onCreate() {
    setCreating(true);
    setError(null);
    try {
      await createRole({ key, name, permissions: [...selected] });
      setKey("");
      setName("");
      setSelected(new Set());
      setComposerOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao criar papel");
    } finally {
      setCreating(false);
    }
  }

  /** Grouped by prefix, so the composer reads as capabilities rather than 40 flat chips. */
  const grouped = useMemo(() => {
    const q = permQuery.trim().toLowerCase();
    const keys = available.map((p) => p.key).filter((k) => !q || k.toLowerCase().includes(q));
    return groupPermissions(keys);
  }, [available, permQuery]);

  return (
    <>
      <PageHead
        title="Papéis"
        description="Quem pode fazer o quê. Papéis são globais e atribuídos por site."
        actions={
          <Button variant="primary" onClick={() => setComposerOpen(true)} disabled={loaded && available.length === 0}>
            Novo papel
          </Button>
        }
      />
      {error && <Alert tone="danger">{error}</Alert>}

      {roles.length === 0 ? (
        <EmptyState title="Nenhum papel" body="Os papéis padrão são criados na instalação." />
      ) : (
        <div className="peg-table-wrap">
          <table className="peg-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Chave</th>
                <th>Permissões</th>
                <th className="peg-table__actions"><span className="peg-sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {roles.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div className="kalel-role__name">{r.name}</div>
                    {r.description && <div className="kalel-role__desc">{r.description}</div>}
                  </td>
                  <td className="peg-table__muted">
                    <span className="peg-chip peg-chip--mono">{r.key}</span>
                  </td>
                  <td>
                    {/* count + the first few groups: fifty flat chips in a table cell is
                        not readable, and the group is the unit an admin reasons about */}
                    <RolePermissionSummary permissions={r.permissions} />
                  </td>
                  <td className="peg-table__actions">
                    <Button size="xs" variant="secondary" onClick={() => setDetail(r)}>
                      Ver
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <Modal title={`${detail.name} — permissões`} width={560} onClose={() => setDetail(null)}>
          <div className="peg-stack">
            <p className="peg-field__hint">
              <span className="peg-chip peg-chip--mono">{detail.key}</span>
              {detail.description ? ` · ${detail.description}` : ""}
            </p>
            <PermissionMatrix permissions={detail.permissions} />
          </div>
        </Modal>
      )}

      {composerOpen && (
        <Modal
          title="Novo papel"
          width={620}
          onClose={() => setComposerOpen(false)}
          footer={
            <>
              <span className="peg-table__muted">{selected.size} selecionada(s)</span>
              <span style={{ flex: 1 }} />
              <Button variant="secondary" onClick={() => setComposerOpen(false)}>
                Cancelar
              </Button>
              <Button variant="primary" onClick={() => void onCreate()} disabled={creating || !name || !key || selected.size === 0}>
                {creating ? "Criando…" : "Criar papel"}
              </Button>
            </>
          }
        >
          <div className="peg-stack">
            <div className="peg-row">
              <Input label="Nome" value={name} placeholder="Editor de vídeo" onChange={(e) => setName(e.target.value)} />
              <Input label="Chave" value={key} placeholder="editor-video" hint="Identificador estável." onChange={(e) => setKey(e.target.value)} />
            </div>
            <Search placeholder="Filtrar permissões…" value={permQuery} onChange={(e) => setPermQuery(e.target.value)} />
            <div className="kalel-perm-picker">
              {grouped.map((g) => (
                <section key={g.group} className="kalel-perm-picker__group">
                  <div className="kalel-perm-picker__head">
                    <h4 className="peg-inspector-section__title">{permissionGroupLabel(g.group)}</h4>
                    <Button
                      size="xs"
                      variant="tertiary"
                      onClick={() => {
                        const allOn = g.permissions.every((p) => selected.has(p));
                        setSelected((prev) => {
                          const next = new Set(prev);
                          for (const p of g.permissions) {
                            if (allOn) next.delete(p);
                            else next.add(p);
                          }
                          return next;
                        });
                      }}
                    >
                      {g.permissions.every((p) => selected.has(p)) ? "Limpar" : "Tudo"}
                    </Button>
                  </div>
                  <div className="kalel-perm-picker__items">
                    {g.permissions.map((p) => (
                      <label key={p} className="peg-checkbox kalel-perm-picker__item">
                        <input type="checkbox" checked={selected.has(p)} onChange={() => toggle(p)} />
                        <span className="peg-checkbox__box" aria-hidden="true">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="m5 13 4 4L19 7" />
                          </svg>
                        </span>
                        {/* the human name is what the choice is about; the key stays
                            visible underneath because it is what the API contract uses */}
                        <span className="kalel-perm-picker__text">
                          <span className="kalel-perm-picker__label">{permissionLabel(p)}</span>
                          <span className="kalel-perm-picker__key">{p}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
