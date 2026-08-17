# RECOVERY-01 — SECURITY (R0)

**Date:** 2026-08-17

## Scope

Corrigir os bloqueadores de segurança/integridade identificados na auditoria 360°:

- **P0-1** — bypass de RBAC: `articles.create` publicava (`status:"published"`) e backdatava (`publishedAt`) sem `articles.publish`.
- **P1-3** — `deleteRedirect` apagava a linha antes de validar `site_id` (isolamento quebrado).
- **P1-2 / R0.3** — zod descartava campos desconhecidos em silêncio (ex.: `status` no PATCH → 200 sem efeito).

## Files changed

| arquivo | mudança |
|---|---|
| `apps/api/src/routes/site.ts` | POST `/articles` agora exige `articles.publish` para `status:"published"`/`publishedAt` e `articles.schedule` para `status:"scheduled"`/`scheduledAt`. |
| `apps/api/src/services/redirects.ts` | `deleteRedirect` filtra por `(id, site_id)` na própria query. |
| `packages/contracts/src/editorial.ts` | `.strict()` em todos os schemas de mutação (article create/update, category/tag/entity/author/source create, publish/schedule). |
| `packages/contracts/src/seo.ts` | `.strict()` em `createRedirectBodySchema`. |
| `packages/contracts/src/identity.ts` | `.strict()` em createUser/login/createRole/createServiceToken. |
| `packages/contracts/src/sites.ts` | `.strict()` em createSite/updateSite/initBootstrap. |
| `packages/contracts/src/webhooks.ts` | `.strict()` em createWebhook. |
| `apps/api/src/routes/admin.ts` | `.strict()` no schema de assign-role. |
| `packages/importer/tests/import.test.ts` | service token do importer agora inclui `articles.publish`/`articles.schedule` (o importer preserva status/datas de origem por design). |

## Migrations

Nenhuma.

## Tests added

- `apps/api/tests/security.test.ts` (8 testes):
  - autor sem `articles.publish` → POST `status:"published"` = 403 + zero eventos `article.published` no outbox;
  - autor → POST com `publishedAt` arbitrário = 403;
  - autor sem `articles.schedule` → POST `status:"scheduled"` = 403;
  - autor ainda cria draft (controle positivo);
  - dono com `articles.publish` cria publicado (controle positivo);
  - PATCH com campo desconhecido (`status`) = 400;
  - POST com campo desconhecido = 400;
  - site A não consegue deletar redirect do site B (404; linha do site B continua existindo).
- `packages/contracts/tests/schemas.test.ts` (+1): strict schemas rejeitam campos desconhecidos.

## Commands

```text
pnpm -r typecheck   PASS
pnpm -r lint        PASS
pnpm --filter @kal-el/api test        39 tests pass (incl. 8 security)
pnpm --filter @kal-el/importer test    8 tests pass
pnpm --filter @kal-el/contracts test  10 tests pass
```

## PASS / FAIL

PASS: todos os gates. FAIL: nenhum.

## Known gaps

- `status:"in_review"`/`"blocked"` ainda são alcançáveis via `POST /articles` (campo válido). Não é bypass de publicação; será endereçado em R3 (workflow state machine), que restringe transições a ações explícitas.
- `COOKIE_SECURE`/CORS/Swagger/SSRF (P2/P1 de hardening) ficam para R13, fora do escopo R0.

## Gate R0

```text
P0 security   = 0  (bypass de publish corrigido + teste negativo)
P1 isolation  = 0  (deleteRedirect site-scoped + teste negativo)
P1 silent loss= 0  (campos desconhecidos → 400)
```

## Commit

Vide `git log` (commit R0).
