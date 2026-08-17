"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Input, PageHead, Select, Table, type Column } from "@kal-el/design-system";
import { useAuth } from "../../../lib/auth";
import { ApiError, assignRole, createUser, listRoles, listUsers, type Role, type User } from "../../../lib/api";

export default function UsersPage() {
  const { activeSiteId } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const [u, r] = await Promise.all([listUsers(), listRoles()]);
      setUsers(u);
      setRoles(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao carregar");
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
      setEmail(""); setName(""); setPassword("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao criar usuário");
    } finally {
      setCreating(false);
    }
  }

  async function onAssign(userId: string, roleId: string) {
    if (!activeSiteId) return;
    setError(null);
    try {
      await assignRole(userId, { roleId, siteId: activeSiteId });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao atribuir papel");
    }
  }

  const columns: Column<User>[] = [
    { key: "name", header: "Nome", render: (u) => u.name },
    { key: "email", header: "E-mail", render: (u) => u.email },
    { key: "status", header: "Status", render: (u) => u.status },
    {
      key: "role",
      header: "Atribuir papel (site atual)",
      render: (u) => (
        <RoleAssign roles={roles} onSelect={(roleId) => void onAssign(u.id, roleId)} />
      ),
    },
  ];

  return (
    <>
      <PageHead title="Usuários" description={`${users.length} usuário(s)`} />
      {error && <Alert tone="danger">{error}</Alert>}

      <div className="peg-card" style={{ marginBottom: 16 }}>
        <div className="peg-card__body" style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <Input label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
          <Input label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input label="Senha (mín. 12)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button variant="primary" onClick={() => void onCreate()} disabled={creating}>{creating ? "Criando…" : "Criar"}</Button>
        </div>
      </div>

      <Table columns={columns} rows={users} selectable={false} />
    </>
  );
}

function RoleAssign({ roles, onSelect }: { roles: Role[]; onSelect: (roleId: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <Select value={value} onChange={(e) => setValue(e.target.value)} aria-label="Papel">
        <option value="">Papel…</option>
        {roles.map((r) => (
          <option key={r.id} value={r.id}>{r.name}</option>
        ))}
      </Select>
      <Button size="xs" variant="secondary" disabled={!value} onClick={() => { onSelect(value); setValue(""); }}>Atribuir</Button>
    </div>
  );
}
