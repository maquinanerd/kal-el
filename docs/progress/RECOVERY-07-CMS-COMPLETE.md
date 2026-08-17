# RECOVERY-07 — CMS COMPLETE (R6)

**Date:** 2026-08-17

## Scope

Transformar o CMS em aplicação editorial administrável: media library, editor completo, taxonomias, workflow UI, usuários/papéis/tokens, dashboard real e demais telas. Backend estendido apenas onde havia lacuna (sem duplicação).

## Backend (delta)

| arquivo | mudança |
|---|---|
| `packages/contracts/src/editorial.ts` | Schemas de update para categorias/tags/entidades/autores/fontes. |
| `apps/api/src/services/taxonomy.ts` | `update*`/`delete*` para as 5 taxonomias (category detacha filhos no delete). |
| `apps/api/src/services/media.ts` | `listMedia` com busca (`q`) + paginação offset/limit + `total`. |
| `apps/api/src/services/stats.ts` | `siteStats` (contagens reais: artigos por status, mídia, categorias, tags, autores). |
| `apps/api/src/services/articles.ts` | Ownership: autor sem publish/approve/schedule só edita os próprios artigos. |
| `apps/api/src/services/tokens.ts` | Escopos de service token aceitam todas as permissões (bug corrigido). |
| `apps/api/src/routes/site.ts` | PATCH/DELETE de taxonomia, `/stats`, `listMedia` com q/offset. |

## Frontend (apps/cms)

| tela | arquivo |
|---|---|
| Dashboard (KPIs reais) | `app/(app)/page.tsx` |
| Media Library (upload/drag-drop/busca/paginação/delete) | `app/(app)/media/page.tsx` |
| Media detail (alt/caption/credit/delete) | `app/(app)/media/[id]/page.tsx` |
| Editor completo (imagem/galeria/embed/tabela/fonte via menu Inserir) | `components/editor/RichTextEditor.tsx` |
| Article editor (workflow actions + taxonomia + revisões diff + featured) | `app/(app)/articles/[id]/page.tsx` |
| Taxonomias (categorias/tags/entidades/autores/fontes) | `components/TaxonomyManager.tsx` + 5 páginas |
| Workflow queue | `app/(app)/workflow/page.tsx` |
| Usuários | `app/(app)/users/page.tsx` |
| Papéis & permissões | `app/(app)/roles/page.tsx` |
| Service tokens | `app/(app)/tokens/page.tsx` |
| Audit log | `app/(app)/audit/page.tsx` |
| Configurações (site + redirects) | `app/(app)/settings/page.tsx` |
| Calendário editorial | `app/(app)/calendar/page.tsx` |
| Media picker (featured/image/gallery) | `components/MediaPicker.tsx` |

## Migrations

Nenhuma.

## Tests

- `apps/api/tests/taxonomy.test.ts` (4): taxonomia CRUD + ownership (autor não edita artigo de outro; editor sim) + stats.
- Suíte completa: **123 testes, todos passando** (api 59, importer 9, worker 8, db 8, editor 7, contracts 15, auth 5, sdk 5, design-system 5, fixture 2).

## Commands

```text
pnpm -r typecheck    PASS (13 projetos)
pnpm -r lint         PASS
pnpm -r build        PASS
pnpm -r test         123 pass, 0 fail, 0 skip
pnpm --filter @kal-el/cms build   PASS (18 rotas)
```

## Known gaps

- Slash command é via menu "Inserir" (não gatilho `/` inline ainda); colar URL de YouTube auto-converte em embed é parcial (prompt).
- Diff de revisões é textual (antes/depois), não visual por marca.
- Webhooks sem UI (API existe); botões de workflow confiam no backend como autoridade (403 → mensagem).

## Gate R6

```text
login → selecionar site → criar → escrever → formatar → imagem/galeria/embed → taxonomia → salvar → reabrir: PASS (via API/estado; browser E2E em R13)
```

## Commit

Vide `git log` (commit R6).
