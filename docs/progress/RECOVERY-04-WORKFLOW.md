# RECOVERY-04 — WORKFLOW (R3)

**Date:** 2026-08-17

## Scope

Implementar a máquina de estados editorial explícita (submit/approve/reject/
schedule/publish/unpublish/archive), permissões de transição e roles preset.

## Files changed

| arquivo | mudança |
|---|---|
| `packages/contracts/src/editorial.ts` | `archived` no `articleStatusSchema`. |
| `packages/db/src/schema/editorial.ts` | `archived` no enum TS de `status` (coluna `text`; sem migration). |
| `apps/api/src/auth-context.ts` | Novas permissões `articles.submit`, `articles.approve`. |
| `apps/api/src/services/articles.ts` | Máquina de estados (`WORKFLOW_TRANSITIONS` + `assertTransition`), funções `submitArticle`/`approveArticle`/`rejectArticle`/`unpublishArticle`/`archiveArticle`; publish/schedule restritos a from-states válidos. |
| `apps/api/src/routes/site.ts` | Endpoints `/submit`, `/approve`, `/reject`, `/unpublish`, `/archive`. |
| `apps/api/src/services/roles.ts` | `PRESET_ROLES` (owner/admin/editor-chefe/editor/autor) + `ensurePresetRoles`. |
| `apps/api/src/server.ts` | Seed de roles preset no boot. |
| `docs/adr/ADR-0010-workflow-state-machine.md` | ADR da máquina de estados e roles. |

## Migrations

Nenhuma. `archived` é valor de coluna `text` (sem CHECK constraint no schema
gerado — confirmado em `0000_furry_psynapse.sql`).

## Tests added

`apps/api/tests/workflow.test.ts` (7 testes): autor cria+submete; autor não
publica/aprova/agenda (403); chefe aprova→agenda→publica; reject→blocked→resubmit;
unpublish; archive bloqueia transições (409); matriz de permissões dos roles preset.

## Commands

```text
pnpm -r typecheck   PASS
pnpm -r lint        PASS
pnpm -r build       PASS (api 93.26 KB)
pnpm --filter @kal-el/api test   53 pass (incl. 7 workflow)
```

## PASS / FAIL

PASS: todos os gates. FAIL: nenhum.

## Known gaps

- "Autor edita apenas seus artigos" (ownership) ainda não é restrito — autor com `articles.update` pode editar qualquer artigo do site. Refinamento de ownership fica para R6/R13.
- `approve` retorna a `draft` (modelo de 6 estados sem "approved"); documentado no ADR-0010.

## Gate R3

```text
transições explícitas:    PASS (submit/approve/reject/unpublish/archive)
autorização por transição: PASS (403 em publish/schedule/approve sem permissão)
roles preset documentados: PASS (PRESET_ROLES + ensurePresetRoles)
```

## Commit

Vide `git log` (commit R3).
