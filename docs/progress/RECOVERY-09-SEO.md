# RECOVERY-09 — SEO UX (R8)

**Date:** 2026-08-17

## Scope

Completar a experiência editorial de SEO: campos (canonical/robots/social), SERP preview, social preview, primary category, social image e link interno.

## Files changed

| arquivo | mudança |
|---|---|
| `packages/contracts/src/seo.ts` | `socialImageMediaId` + `primaryCategoryId` no metadata de SEO. |
| `apps/api/src/services/articles.ts` | Valida social image (mídia do mesmo site) e primary category (categoria do mesmo site) em create/update. |
| `apps/cms/app/(app)/articles/[id]/page.tsx` | SEO inspector completo + SERP preview + social preview + primary category + social image + link interno (busca de artigos). |
| `apps/cms/components/editor/RichTextEditor.tsx` | `insertLink(href)` no handle (link interno com path seguro). |
| `apps/cms/lib/api.ts` | Campos de SEO estendidos no `ArticleDetail`. |
| `apps/api/tests/seo.test.ts` | Teste de validação site-scoped (primary category + social image cross-site → 400). |

## Migrations

Nenhuma (campos em jsonb `seo`).

## Tests

- `seo.test.ts` (+1): social image/primary category site-scoped.
- Suíte: **127 testes passando** (api 62).

## Commands

```text
pnpm -r typecheck    PASS
pnpm -r lint         PASS
pnpm -r build        PASS
pnpm --filter @kal-el/cms build   PASS
pnpm --filter @kal-el/api test    62 pass
```

## Known gaps

- Sugestão automática de links internos (baseada em entidades) ainda não é proativa — link interno é por busca manual.
- SEO técnico (sitemap/JSON-LD/robots.txt) segue responsabilidade do frontend consumidor (não do Kal El).

## Gate R8

```text
slug change → 301 redirect:  PASS (seo.test.ts existente)
canonical + robots:          PASS (persistidos + UI)
```

## Commit

Vide `git log` (commit R8).
