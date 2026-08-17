# RECOVERY-06 — EDITOR (R5)

**Date:** 2026-08-17

## Scope

Conectar o editor rich text real (ProseMirror/TipTap, reusando `packages/editor`)
à tela de artigo do CMS, com autosave real, revisões e inspector.

## Files changed

| arquivo | mudança |
|---|---|
| `apps/cms/components/editor/RichTextEditor.tsx` | Editor ProseMirror real (EditorView + schema de `@kal-el/editor`), toolbar (bold/italic/code/link/H2-H4/listas/quote/undo/redo), round-trip V2 com marcas. |
| `apps/cms/app/(app)/articles/[id]/page.tsx` | Tela de artigo: título/dek, editor, inspector (slug/SEO/featured), autosave com If-Match + estados visuais, revisões com restore. |
| `apps/cms/lib/api.ts` | `updateArticle` (PATCH + If-Match), `listRevisions`, `getArticle`/`ArticleDetail`. |
| `apps/cms/app/globals.css` | Estilos do editor (toolbar, ProseMirror, listas/quote/link). |
| `apps/cms/next.config.mjs` | `transpilePackages` inclui `@kal-el/editor` e `@kal-el/contracts`. |
| `packages/contracts/src/*.ts`, `packages/editor/src/index.ts` | Removidas extensões `.js` dos imports internos (compatibilidade com bundler Next/webpack). |

Dependência: `@kal-el/editor` (workspace) + `@tiptap/pm` no CMS.

## Migrations

Nenhuma.

## Tests

- Suíte completa: **119 testes, todos passando** (api 55, importer 9, worker 8, db 8, editor 7, contracts 15, auth 5, sdk 5, design-system 5, fixture 2).
- `next build` do CMS OK (rota `/articles/[id]` dinâmica, 180 kB first-load).

## Commands

```text
pnpm -r typecheck    PASS (13 projetos)
pnpm -r lint         PASS
pnpm -r build        PASS
pnpm -r test         119 pass
```

## PASS / FAIL

PASS: todos os gates. FAIL: nenhum.

## Known gaps

- Inserção de nós atômicos (imagem/galeria/embed/tabela/fonte) via UI e slash commands: pendente — media library (R6) e editor de blocos.
- Autosave cobre documento + título/dek/slug/SEO/featured; estados visuais (Salvando…/Salvo/Erro) presentes.
- Diff entre revisões não renderizado (lista + restore funcionais).
- Browser E2E (Playwright) do fluxo completo fica para R12/R13.

## Gate R5

```text
editor real (ProseMirror):          PASS
rich text com marcas persiste:       PASS (round-trip V2 via packages/editor)
bold/link sobrevivem:                PASS
autosave real (If-Match + estados):  PASS
revisions (lista + restore):         PASS
inspector real (slug/SEO/featured):  PASS
```

## Commit

Vide `git log` (commit R5).
