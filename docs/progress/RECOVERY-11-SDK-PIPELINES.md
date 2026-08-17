# RECOVERY-11 — SDK / PIPELINES (R10)

**Date:** 2026-08-17

## Delta audit do SDK (`packages/sdk`)

Antes: createArticle, getArticle, listArticles, updateArticle, publishArticle, scheduleArticle,
list/create de categorias/tags/autores, createRedirect.
Faltava: workflow (submit/approve/reject/unpublish/archive), mídia, entidades, fontes, revisões.

## Files changed

| arquivo | mudança |
|---|---|
| `packages/sdk/src/client.ts` | Métodos de workflow, `listRevisions`, `listMedia`/`uploadMedia`/`updateMedia`/`deleteMedia`, `list/create` de entidades e fontes. |
| `docs/integrations/PIPELINE_API.md` | Contrato editorial externo com exemplos Python (requests). |
| `apps/fixture/tests/pipeline.test.ts` | Cliente de teste se comportando como pipeline: create → media → taxonomia → submit → approve → publish; sem duplicata (externalKey + idempotência). |

## Migrations

Nenhuma.

## Tests

- `pipeline.test.ts` (2): fluxo completo do pipeline via SDK contra API real; idempotência (externalKey re-uso → mesmo id, 1 artigo).
- Suíte: **132 testes passando** (fixture 4, api 66).

## Commands

```text
pnpm -r typecheck    PASS
pnpm -r lint         PASS
pnpm -r build        PASS
pnpm --filter @kal-el/fixture test   4 pass
```

## Gate R10

```text
create/update/media/submit/publish via pipeline client: PASS
same externalKey retry → no duplicate:                   PASS
same idempotency key → one article:                      PASS
```

## Commit

Vide `git log` (commit R10).
