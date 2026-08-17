# RECOVERY-08 — PREVIEW (R7)

**Date:** 2026-08-17

## Scope

Preview editorial real com token assinado, renderização do ArticleDocument V2 e proteção contra indexação.

## Files changed

| arquivo | mudança |
|---|---|
| `apps/api/src/services/preview.ts` | Token assinado (HMAC-SHA256, TTL 15 min) + `resolvePreview`. |
| `apps/api/src/routes/preview.ts` | `GET /v1/preview/:token` público (valida assinatura/expiração, header `x-robots-tag: noindex`). |
| `apps/api/src/routes/site.ts` | `POST /articles/:id/preview` (articles.read) devolve URL assinada. |
| `apps/api/src/app.ts` | `maxParamLength: 1024` (token na rota); registra `previewRoutes`. |
| `apps/cms/lib/renderDocument.ts` | Renderer seguro do ArticleDocument V2 (marks, blocos, tabela, embed YouTube, fonte; escapa todo texto). |
| `apps/cms/app/preview/[token]/page.tsx` | Página pública de preview (noindex via metadata) que consome o endpoint público. |
| `apps/cms/app/(app)/articles/[id]/page.tsx` | Botão "Preview" abre a URL assinada. |
| `apps/cms/lib/api.ts` | `getPreviewUrl`. |

## Migrations

Nenhuma.

## Tests

`apps/api/tests/preview.test.ts` (2): draft não é público (401 direto), URL assinada serve o draft; token adulterado → 401.

Suíte: **125 testes passando** (api 61).

## Commands

```text
pnpm -r typecheck    PASS
pnpm -r lint         PASS
pnpm -r build        PASS
pnpm --filter @kal-el/cms build   PASS (rota /preview/[token])
pnpm --filter @kal-el/api test    61 pass
```

## Known gaps

- Imagem real no preview depende de mídia pública (endpoint de arquivo é autenticado); galeria renderiza contagem, imagem renderiza alt/caption. URLs de mídia assinadas ficam para depois.
- Preview usa `SESSION_SECRET` como chave de assinatura (agora com propósito real).

## Gate R7

```text
draft não público:                 PASS (401 sem token)
preview renderiza conteúdo atual:  PASS (endpoint + renderer)
URL não indexável:                 PASS (x-robots-tag + metadata noindex)
```

## Commit

Vide `git log` (commit R7).
