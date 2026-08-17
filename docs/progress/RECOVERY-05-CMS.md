# RECOVERY-05 — CMS (R4)

**Date:** 2026-08-17

## Scope

Criar `apps/cms` (Next.js App Router + React 18 + TypeScript) consumindo a API
real via session + CSRF, com shell PEG e tela de artigos real (sem dados falsos).

## Files changed

| arquivo | mudança |
|---|---|
| `apps/cms/**` | App Next.js: login, layout protegido, shell PEG, índice de artigos, detail stub. |
| `apps/cms/lib/api.ts` | Cliente browser (fetch + credentials + `x-kal-el-csrf`). |
| `apps/cms/lib/auth.tsx` | AuthProvider (me + sites + signIn/signOut). |
| `apps/cms/components/AppShell.tsx` | Shell PEG (Sidebar/Topbar/Workspace) + site switcher. |
| `apps/cms/middleware.ts` | Gate por cookie `ke_session`. |
| `apps/api/src/routes/auth.ts` | `GET /v1/me/sites` (sites do usuário, para o switcher). |
| `apps/api/tests/auth.test.ts` | +2 testes para `/me/sites`. |
| `packages/design-system/src/{index,components/FormControls,Table,Overlays}` | Removidas extensões `.js` dos imports internos (compatibilidade com bundler Next/webpack). |

Dependências: `next@14.2`, `react@18`, `react-dom@18`.

## Migrations

Nenhuma.

## Tests

- API: 55 testes passando (inclui 2 novos `/me/sites`).
- Design-system: 5 testes passando após remoção de extensões `.js`.
- CMS: `next build` OK (6 rotas: `/`, `/login`, `/articles`, `/articles/[id]`, `/_not-found`), typecheck e lint OK.

## Commands

```text
pnpm -r typecheck    PASS (13 projetos, incl. cms)
pnpm -r lint         PASS
pnpm --filter @kal-el/cms build    PASS
pnpm --filter @kal-el/api test     55 pass
```

## PASS / FAIL

PASS: todos os gates. FAIL: nenhum.

## Known gaps

- Browser E2E (Playwright) do fluxo login→artigos fica para R12/R13, conforme plano.
- Editor rich text (R5) ainda não conectado; `/articles/[id]` é stub.
- `origin: true` no CORS (P2) será revisado em R13; suficiente para dev local.

## Gate R4

```text
apps/cms real:        SIM (Next.js, consome /v1)
login/session/CSRF:   SIM (cliente com credentials + x-kal-el-csrf)
protected layout:     SIM (middleware + AuthProvider)
shell PEG:            SIM (Sidebar/Topbar/Workspace + site switcher)
artigos (real API):   SIM (loading/empty/error/success)
```

## Commit

Vide `git log` (commit R4).
