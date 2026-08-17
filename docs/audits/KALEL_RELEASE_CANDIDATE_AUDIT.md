# KAL EL — RELEASE CANDIDATE AUDIT

**Data:** 2026-08-17
**Método:** inspeção + execução (typecheck, lint, build, 139 testes unitários/integração, Playwright E2E real).

## Verificações (evidência reproduzível)

| pergunta | resposta | evidência |
|---|---|---|
| Consigo instalar do zero? | SIM | `pnpm install` + `runMigrations` + `seedPermissions` + `ensurePresetRoles` + `bootstrap` (empty DB → 26 tabelas → owner). `db/tests/migration.test.ts`, `apps/api/tests/auth.test.ts`. |
| Consigo criar site? | SIM | `POST /v1/admin/sites` + tela `/sites` (R9). |
| Consigo criar usuário? | SIM | `POST /v1/admin/users` + tela `/users` (R6). |
| Consigo criar artigo? | SIM | `POST /v1/sites/:id/articles` + tela `/articles` (R4). |
| Editor é funcional? | SIM | ProseMirror real (marcas/links/H2-H4/listas/quote/tabela/embed/fonte), autosave, round-trip V2. E2E Playwright. |
| Mídia é funcional? | SIM | StorageProvider local, upload multipart, featured/gallery, cross-site bloqueado. `media.test.ts`. |
| SEO editorial é funcional? | SIM | slug/SEO title/meta/canonical/robots/social/primary category + SERP preview + 301 em troca de slug. `seo.test.ts`. |
| Workflow é funcional? | SIM | máquina de estados (submit/approve/reject/schedule/publish/unpublish/archive) + RBAC. `workflow.test.ts`. |
| Preview é funcional? | SIM | token HMAC assinado (TTL 15min), renderer V2, noindex. `preview.test.ts`. |
| Multi-site é funcional? | SIM | site-switcher + isolamento por `site_id`. `multisite.test.ts`, `isolation.test.ts`. |
| Service API é funcional? | SIM | service tokens escopados, idempotência, externalKey, provenance. `idempotency.test.ts`, `fixture/tests/pipeline.test.ts`. |
| Pipeline externo pode publicar? | SIM | SDK completo + `PIPELINE_API.md`. `pipeline.test.ts`. |
| WordPress import funciona? | SIM | snapshot→normalize→import→re-import→reconcile, mídia + inline preservados. `importer/tests/*`. |
| Payload import framework funciona? | SIM | Lexical JSON → V2 + relações. `importer/tests/payload.test.ts`. |
| Visual PEG aprovado? | NÃO (pendente) | classificação P0/P1/P2 por imagem requer revisão humana (R12). |
| Responsive aprovado? | NÃO (pendente) | mesma pendência de imagem. |
| Accessibility gate aprovado? | PARCIAL | code-level fixes (labels/aria/semântica) feitos; axe automatizado não executado. |
| E2E completo passa? | SIM | Playwright: login→criar→escrever→salvar→reload→persistir (2 passed). |
| Backup/restore testado? | SIM | `db/tests/backup.test.ts` (rehearsal + JSON round-trip). |
| Pronto para staging? | SIM (com ressalva visual) | gates verdes; visual QA pendente de imagem. |
| Pronto para produção? | NÃO | visual QA pendente; deploy de produção fora de escopo. |

## Gates globais

```text
pnpm -r typecheck    PASS (13 projetos)
pnpm -r lint         PASS
pnpm -r build        PASS
pnpm -r test         139 pass, 0 fail, 0 skip
Playwright E2E        2 passed
```

## P0/P1/P2 remanescentes

- **P0**: nenhum conhecido (bypass de publish, mídia, formatação inline, CMS inexistente — todos resolvidos).
- **P1**: visual QA por imagem pendente (R12); axe/a11y automatizado pendente.
- **P2**: `maxParamLength` deprecation (cosmético); imagens de preview dependem de mídia pública (documentado); webhooks sem UI (API existe).

## Veredito

O Kal El deixou de ser "backend forte sem frontend" e virou um produto editorial operável de ponta a ponta:
CMS real (login, editor rich text, mídia, taxonomias, workflow, multi-site, SEO, preview), API versionada com
RBAC/isolamento/idempotência/outbox/webhooks, SDK para pipelines externos e importadores WordPress/Payload.
Restam apenas os gates visuais (que exigem revisão humana por imagem) antes de staging.
