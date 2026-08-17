# RECOVERY-14 — HARDENING + E2E (R13)

**Date:** 2026-08-17

## Scope

Hardening de segurança (P1/P2 remanescentes da auditoria) + Playwright E2E real + correções de bugs reais encontrados pelo E2E.

## Security hardening

| achado | fix |
|---|---|
| `COOKIE_SECURE` sem guarda de produção | `loadConfig` falha o boot em `NODE_ENV=production` sem `COOKIE_SECURE=true` ou com `SESSION_SECRET` default. |
| CORS `origin: true` (reflete qualquer origem) | allowlist `CORS_ORIGINS` (default `APP_BASE_URL`) + `methods`/`allowedHeaders` explícitos. |
| Swagger `/docs` aberto | opt-in via `ENABLE_DOCS`; desabilitado por padrão em produção. |
| SSRF via webhooks | `assertSafeWebhookUrl` bloqueia IPs privados/link-local/metadata e hostnames `.local`/`.internal`; permitido localmente só fora de produção. |
| Service tokens com escopos incompletos | `VALID_SCOPES = ALL_PERMISSIONS` (R6). |

## Bugs reais encontrados/corrigidos pelo E2E

1. **CORS não permitia PATCH/DELETE** — `@fastify/cors` default `methods` era `GET,HEAD,POST`; autosave falhava com "Failed to fetch". Fix: `methods` + `allowedHeaders` explícitos.
2. **Editor não recarregava o documento após o load assíncrono** — `RichTextEditor` montava com documento vazio e não reagia ao `document` prop; após reload o conteúdo sumia. Fix: `key` inclui `article.id`.
3. **Autosave com closure stale** — `save` capturava estado desatualizado no debounce. Fix: `draftRef` sempre atualizado, `save` lê do ref.

## Playwright E2E

`apps/cms/playwright.config.ts` + `apps/cms/e2e/editorial.spec.ts`:
- webServer boots API (embedded postgres + bootstrap) e Next.js CMS.
- Fluxo: login → novo artigo → escrever título + parágrafo → autosave → reload → persistência confirmada.
- Negativo: `POST status=published` sem sessão → 401 (autoridade no backend).

## Migrations

Nenhuma.

## Tests

- `apps/api/tests/hardening.test.ts` (6): guards de produção, CORS origins, SSRF.
- Playwright: **2 passed**.
- Suíte completa: **139 testes passando** (api 72, importer 10, fixture 4, worker 8, db 8, editor 7, contracts 15, auth 5, sdk 5, design-system 5).

## Commands

```text
pnpm -r typecheck        PASS
pnpm -r lint             PASS
pnpm -r build            PASS
pnpm -r test             139 pass, 0 fail, 0 skip
pnpm --filter @kal-el/cms exec playwright test   2 passed
```

## Known gaps

- Visual QA P0/P1/P2 por imagem continua pendente de revisão humana (documentado em R12).
- Backup/restore já testado no baseline (`db/tests/backup.test.ts`); volume de mídia documentado no ADR-0009.

## Commit

Vide `git log` (commit R13).
