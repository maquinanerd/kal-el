"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, EmptyState, Input, Modal, PageHead, Search, Select } from "@kal-el/design-system";
import { useAuth } from "../../../lib/auth";
import { ApiError, assignRole, createUser, listRoles, listUsers, type Role, type User } from "../../../lib/api";

const STATUS_TONE: Record<string, "success" | "warning" | "neutral"> = {
  active: "success",
  invited: "warning",
  disabled: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Ativo",
  invited: "Convidado",
  disabled: "Desativado",
};

export default function UsersPage() {
  const { activeSiteId, sites } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);

  const [assignFor, setAssignFor] = useState<User | null>(null);

  const load = useCallback(async () => {
    try {
      const [u, r] = await Promise.all([listUsers(), listRoles().catch(() => [] as Role[])]);
      setUsers(u);
      setRoles(r);
    } catch (err) {
      setError(
        err instanceof ApiError ? (err.status === 403 ? "Sem permissão para gerenciar usuários" : err.message) : "Falha ao carregar",
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
      await createUser({ email, name, password });
      setEmail("");
      setName("");
      setPassword("");
      setInviteOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao criar usuário");
    } finally {
      setCreating(false);
    }
  }

  async function onAssign(user: User, roleId: string, siteId: string) {
    setError(null);
    try {
      await assignRole(user.id, { roleId, siteId });
      // reload so the row shows the new grant immediately - the previous screen assigned
      // silently and left the table saying nothing had changed
      await load();
      setAssignFor(null);
    } catch (err) {
      setError(err instanceof ApiError ? (err.status === 403 ? "Sem permissão para atribuir papéis" : err.message) : "Falha ao atribuir papel");
    }
  }

  const siteName = useMemo(() => new Map(sites.map((s) => [s.id, s.name])), [sites]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }, [users, query]);

  return (
    <>
      <PageHead
        title="Usuários"
        description={`${users.length} ${users.length === 1 ? "pessoa" : "pessoas"} com acesso a esta instalação.`}
        actions={
          <Button variant="primary" onClick={() => setInviteOpen(true)}>
            Novo usuário
          </Button>
        }
      />
      {error && <Alert tone="danger">{error}</Alert>}

      <Search placeholder="Buscar por nome ou e-mail…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar usuários" />

      {filtered.length === 0 ? (
        <EmptyState title={query ? "Nenhum usuário encontrado" : "Nenhum usuário"} body={query ? "Ajuste a busca." : undefined} />
      ) : (
        <div className="peg-table-wrap">
          <table className="peg-table peg-table--avatar">
            <thead>
              <tr>
                <th>Pessoa</th>
                <th>Status</th>
                <th>Papéis por site</th>
                <th className="peg-table__actions"><span className="peg-sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="peg-cell">
                      <span className="peg-avatar">{u.name.slice(0, 2).toUpperCase()}</span>
                      <div className="kalel-user__id">
                        <span className="kalel-user__name">{u.name}</span>
                        <span className="kalel-user__email">{u.email}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <Badge tone={STATUS_TONE[u.status] ?? "neutral"} dot>
                      {STATUS_LABEL[u.status] ?? u.status}
                    </Badge>
                  </td>
                  <td>
                    {/* the grants a person already holds. Assigning without showing these
                        is how the same role got applied twice and a wrong one stayed. */}
                    {u.memberships.length === 0 ? (
                      <span className="peg-table__muted">Sem acesso a nenhum site</span>
                    ) : (
                      <div className="kalel-user__memberships">
                        {u.memberships.map((m) => (
                          <span key={`${m.siteId}-${m.roleId}`} className="peg-chip">
                            {m.roleName}
                            <span className="kalel-user__site">· {siteName.get(m.siteId) ?? "site"}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="peg-table__actions">
                    <Button size="xs" variant="secondary" onClick={() => setAssignFor(u)}>
                      Papéis
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {inviteOpen && (
        <Modal
          title="Novo usuário"
          width={460}
          onClose={() => setInviteOpen(false)}
          footer={
            <>
              <span style={{ flex: 1 }} />
              <Button variant="secondary" onClick={() => setInviteOpen(false)}>
                Cancelar
              </Button>
              <Button variant="primary" onClick={() => void onCreate()} disabled={creating || !name || !email || password.length < 12}>
                {creating ? "Criando…" : "Criar"}
              </Button>
            </>
          }
        >
          <div className="peg-stack">
            <Input label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
            <Input label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input
              label="Senha"
              type="password"
              value={password}
              hint="Mínimo de 12 caracteres."
              error={password.length > 0 && password.length < 12 ? "Muito curta." : undefined}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="peg-field__hint">O acesso a um site é concedido depois, atribuindo um papel.</p>
          </div>
        </Modal>
      )}

      {assignFor && (
        <AssignDialog
          user={assignFor}
          roles={roles}
          sites={sites.map((s) => ({ id: s.id, name: s.name }))}
          defaultSiteId={activeSiteId ?? undefined}
          onAssign={(roleId, siteId) => void onAssign(assignFor, roleId, siteId)}
          onClose={() => setAssignFor(null)}
        />
      )}
    </>
  );
}

function AssignDialog({
  user,
  roles,
  sites,
  defaultSiteId,
  onAssign,
  onClose,
}: {
  user: User;
  roles: Role[];
  sites: { id: string; name: string }[];
  defaultSiteId?: string;
  onAssign: (roleId: string, siteId: string) => void;
  onClose: () => void;
}) {
  const [roleId, setRoleId] = useState("");
  const [siteId, setSiteId] = useState(defaultSiteId ?? sites[0]?.id ?? "");

  const already = user.memberships.some((m) => m.roleId === roleId && m.siteId === siteId);

  return (
    <Modal
      title={`Papéis de ${user.name}`}
      width={520}
      onClose={onClose}
      footer={
        <>
          <span style={{ flex: 1 }} />
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
          <Button variant="primary" disabled={!roleId || !siteId || already} onClick={() => onAssign(roleId, siteId)}>
            Atribuir
          </Button>
        </>
      }
    >
      <div className="peg-stack">
        <section>
          <span className="peg-field__label">Acesso atual</span>
          {user.memberships.length === 0 ? (
            <p className="peg-table__muted">Esta pessoa ainda não tem acesso a nenhum site.</p>
          ) : (
            <ul className="kalel-membership-list">
              {user.memberships.map((m) => (
                <li key={`${m.siteId}-${m.roleId}`}>
                  <span className="peg-chip">{m.roleName}</span>
                  <span className="peg-table__muted">{sites.find((s) => s.id === m.siteId)?.name ?? m.siteId}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="peg-divider" />

        <div className="peg-row">
          <Select label="Papel" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            <option value="">Escolha…</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.permissions.length})
              </option>
            ))}
          </Select>
          <Select label="Site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        {already && <p className="peg-field__hint">Esta pessoa já tem esse papel neste site.</p>}
      </div>
    </Modal>
  );
}
