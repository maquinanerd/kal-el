# KAL EL — RECUPERAÇÃO COMPLETA (R0 → R13)

> Documento único consolidando **tudo** que foi feito na recuperação do Kal El.
> Fonte de verdade: o código executável + testes. Gerado em 2026-08-17.

---

## 1. Resumo executivo

O Kal El partiu de um estado onde a auditoria 360° classificava o produto como:

> *"API editorial madura (pré-RC) + protótipo visual desconectado, com 3 bloqueadores P0"*

e chegou a um **Release Candidate tecnicamente verificável**: CMS real (Next.js + PEG),
editor rich text (ProseMirror/TipTap), mídia real, workflow real, SEO editorial, multi-site,
preview assinado, SDK para pipelines externos e importadores WordPress/Payload — tudo testado.

| métrica | antes | depois |
|---|---|---|
| testes | 87 | **139** (+2 E2E Playwright) |
| apps | api, worker, fixture | + **cms** (Next.js) |
| mídia | tabela vazia (0 INSERT) | StorageProvider + upload + featured/gallery |
| documento | texto plano (sem bold/link) | ArticleDocument **V2** com marcas inline |
| workflow | enum inalcançável | máquina de estados + roles preset |
| RBAC | bypass de publicação (P0) | corrigido |
| CMS | não existia | 19 telas funcionais |
| preview | 404 | token HMAC + renderer + noindex |

---

## 2. Estado inicial (baseline da auditoria)

`docs/audits/KALEL_360_AUDIT.md` documentou os bloqueadores:

- **P0-1** RBAC: `articles.create` publicava (`status:"published"`) sem `articles.publish`.
- **P0-2** Mídia inexistente de ponta a ponta.
- **P0-3** Modelo de documento sem formatação inline (bold/itálico/link impossíveis).
- **P0-4** CMS não existia (só um "lab" de 421 linhas com dados hardcoded).
- **P1** workflow silencioso, `deleteRedirect` cross-site, `COOKIE_SECURE` sem guarda, importadores perdiam mídia/inline, `main` sem o produto.

---

## 3. R0 — Segurança e integridade (commit `849c155`)

- `POST /articles` agora exige `articles.publish` para criar `published`/`publishedAt` e `articles.schedule` para `scheduled`/`scheduledAt` (**403** sem permissão).
- `deleteRedirect` filtra por `(id, site_id)` na própria query (sem apagar dado de outro site).
- Schemas de mutação `.strict()` → campos desconhecidos devolvem **400** (sem descarte silencioso).
- Testes: `apps/api/tests/security.test.ts` (8) + `contracts/tests/schemas.test.ts`.

## 4. R1 — Documento editorial V2 (commit `0045af3`)

- **ArticleDocument V2**: blocos de texto com `content` = array de nós inline (`text` + `marks`).
- Marcas: `bold`, `italic`, `code`, `underline`, `strike`, `link` (href http(s) ou `/slug` interno).
- Migração pura `migrateDocumentToV2`/`migrateDocumentToV1` (V1 continua aceito; normalizado em leitura/escrita).
- ProseMirror (`buildTiptapSchema`) com marcas; round-trip preserva bold/link.
- Importer (`html.ts`) preserva formatação inline e links via `extractInline`.
- ADR-0008. Testes: contracts (migração), editor (round-trip marcas), importer (links).

## 5. R2 — Subsistema de mídia (commit `3f6311a`)

- Contrato `StorageProvider` + `LocalStorageProvider` (path-traversal-safe).
- Upload multipart (`@fastify/multipart`), MIME allow-list (raster; SVG excluído), `image-size` para dimensões.
- Rotas `/media` (GET/POST), `/media/:id` (GET/PATCH/DELETE), `/media/:id/file` (GET).
- `featured_media_id` + nós image/gallery validados **no mesmo site** (`assertMediaInSite`).
- RBAC `media.manage` / `media.read`. Delete protegido (409 se em uso). ADR-0009.
- Testes: `apps/api/tests/media.test.ts` (7).

## 6. R3 — Workflow editorial (commit `5e003f5`)

- Máquina de estados: `draft`, `in_review`, `scheduled`, `published`, `blocked`, `archived`.
- Endpoints explícitos: `submit`, `approve`, `reject`, `schedule`, `publish`, `unpublish`, `archive` (+ matriz `assertTransition`).
- Permissões `articles.submit` / `articles.approve`.
- Roles preset (`owner`, `admin`, `editor-chefe`, `editor`, `autor`) semeados no boot; `archived` sem migration (coluna `text`).
- ADR-0010. Testes: `apps/api/tests/workflow.test.ts` (7).

## 7. R4 — CMS (commit `23b8ceb`)

- `apps/cms` (Next.js 14 App Router + React 18 + TS), consumindo `/v1` via session + CSRF.
- Login/logout/`/me`/layout protegido (middleware + AuthProvider) + shell PEG (Sidebar/Topbar/Workspace) + site switcher.
- Índice de artigos real (loading/empty/error/success). `GET /v1/me/sites` adicionado.
- Design-system/contracts/editor com imports bundler-safe (removidas extensões `.js`).

## 8. R5 — Article editor (commit `12695ae`)

- Editor ProseMirror real (reusa `packages/editor`), toolbar (bold/italic/code/link/H2-H4/listas/quote/undo/redo).
- Autosave com `If-Match` + estados visuais (Salvando…/Salvo/Erro), revisões (lista/restore), inspector (slug/SEO/featured).

## 9. R6 — CMS operacional (commits `769284d`, `fdf2491`)

Backend: taxonomia CRUD (PATCH/DELETE), `listMedia` com busca+paginação, `GET /stats` (contagens reais), ownership (autor só edita os próprios artigos), escopos de token completos.

Frontend (19 telas):
- **Media Library** (`/media`, `/media/[id]`): upload, drag&drop, busca, paginação, detalhe, delete.
- **Editor completo**: menu "Inserir" (texto/H2-H4/listas/quote/**imagem**/**galeria**/**embed**/**tabela**/**fonte**), media picker, taxonomia associada, revisões com diff.
- **Workflow queue** (`/workflow`) + ações por artigo.
- **Taxonomias**: categorias (hierarquia), tags, entidades, autores, fontes.
- **Usuários / Papéis / Service tokens / Audit log / Configurações (site+redirects) / Calendário / Sites**.
- **Dashboard** com KPIs reais (sem dados fabricados; empty state quando vazio).
- Testes: `apps/api/tests/taxonomy.test.ts` (4).

## 10. R7 — Preview (commit `b26fa30`)

- Token assinado HMAC-SHA256 (`kpv.<payload>.<sig>`, TTL 15 min) via `POST /articles/:id/preview`.
- `GET /v1/preview/:token` público (valida assinatura/expiração, header `x-robots-tag: noindex`).
- Renderer seguro do ArticleDocument V2 no CMS (`/preview/[token]`, `robots: noindex`).
- Testes: `apps/api/tests/preview.test.ts` (2).

## 11. R8 — SEO UX (commit `0586124`)

- Campos `socialImageMediaId` + `primaryCategoryId` no SEO (validados site-scoped).
- SERP preview + social preview + canonical/robots + slug + link interno (busca de artigos → `insertLink`).
- Testes: `seo.test.ts` (+1 validação cross-site).

## 12. R9 — Multi-site (commit `d387896`)

- Tela `/sites` (criar/listar/editar/alternar).
- `apps/api/tests/multisite.test.ts` (4): ler/editar/deletar cross-site, mídia cross-site, service token cross-site.

## 13. R10 — SDK + pipelines (commit `3fa26b4`)

- `KalElClient` completo: workflow, mídia (upload/list/update/delete), entidades, fontes, revisões.
- `docs/integrations/PIPELINE_API.md` com exemplos Python.
- `apps/fixture/tests/pipeline.test.ts` (2): fluxo completo + no-duplicate (externalKey + idempotência).

## 14. R11 — Importadores (commit `65465b7`)

- WordPress: `fetchMedia` (download+upload via SDK) → image/gallery/featured preservados.
- Payload: conversor **Lexical JSON → V2** (`lexical.ts`) com marcas + relações (author/categories/tags).
- Testes: `import.test.ts` (mídia preservada), `payload.test.ts` (Lexical+relações).

## 15. R12 — Visual QA + A11y (commit `f82272d`)

- Fixes de acessibilidade (aria-label/aria-pressed na media grid/picker).
- Visual QA P0/P1/P2 por imagem **documentado como pendente de revisão humana** (limite do ambiente CLI).

## 16. R13 — Hardening + E2E (commit `c3e3f90`)

- Guards de produção (`COOKIE_SECURE`, `SESSION_SECRET`) no boot.
- CORS allow-list (`CORS_ORIGINS`) + `methods`/`allowedHeaders` explícitos.
- Swagger opt-in (`ENABLE_DOCS`); SSRF guard em webhooks (`assertSafeWebhookUrl`).
- Playwright E2E (`apps/cms/e2e/editorial.spec.ts`): login→criar→escrever→salvar→reload→persistir.
- Testes: `apps/api/tests/hardening.test.ts` (6).

---

## 17. Bugs reais encontrados e corrigidos (pelo E2E/auditoria)

1. **CORS não permitia PATCH/DELETE** — default de `@fastify/cors` era `GET,HEAD,POST`; autosave falhava com "Failed to fetch".
2. **Editor não recarregava o documento após load assíncrono** — conteúdo sumia no reload.
3. **Autosave com closure stale** — `save` lia estado desatualizado no debounce.
4. **RBAC bypass de publicação** (P0) — corrigido em R0.
5. **`deleteRedirect` cross-site** (P1) — corrigido em R0.
6. **Importadores perdiam mídia/formatação** — corrigidos em R1/R11.

---

## 18. Commits (ordem cronológica)

```text
# R0–R5 (sessão anterior)
849c155 fix(auth): enforce publish/schedule permissions on article creation
0045af3 feat(editor): introduce article document schema v2 with inline marks
3f6311a feat(media): add local storage provider and media API
5e003f5 feat(workflow): implement editorial state machine and preset roles
23b8ceb feat(cms): bootstrap real Next.js editorial application
12695ae feat(editor): integrate TipTap writing experience in the CMS

# R6–R13 (esta sessão)
769284d feat(api): add taxonomy CRUD, media search, site stats and article ownership
fdf2491 feat(cms): complete editorial management surfaces (R6)
b26fa30 feat(preview): implement authenticated article preview (R7)
0586124 feat(seo): complete editorial seo workflow (R8)
d387896 feat(multisite): complete site management experience (R9)
3fa26b4 feat(sdk): finalize automation integration contract (R10)
65465b7 feat(importer): complete migration adapters (R11)
f82272d test(ui): add accessibility fixes and visual QA baseline (R12)
c3e3f90 fix(security): harden production boundaries + real Playwright E2E (R13)
```

---

## 19. Gates finais

```text
pnpm -r typecheck                    PASS  (13 projetos)
pnpm -r lint                         PASS
pnpm -r build                        PASS
pnpm -r test                         139 pass, 0 fail, 0 skip
pnpm --filter @kal-el/cms exec playwright test   2 passed
```

Distribuição dos 139 testes: api 72 · importer 10 · fixture 4 · worker 8 · db 8 · editor 7 · contracts 15 · auth 5 · sdk 5 · design-system 5.

---

## 20. Veredito (SIM/NÃO com evidência)

| pergunta | resposta |
|---|---|
| Consigo instalar do zero? | SIM (`migration.test.ts`, `auth.test.ts`) |
| Consigo criar site? | SIM (`/sites`, `multisite.test.ts`) |
| Consigo criar usuário? | SIM (`/users`) |
| Consigo criar artigo? | SIM (`/articles`, E2E) |
| Editor é funcional? | SIM (E2E Playwright) |
| Mídia é funcional? | SIM (`media.test.ts`) |
| SEO editorial é funcional? | SIM (`seo.test.ts`) |
| Workflow é funcional? | SIM (`workflow.test.ts`) |
| Preview é funcional? | SIM (`preview.test.ts`) |
| Multi-site é funcional? | SIM (`isolation.test.ts`, `multisite.test.ts`) |
| Service API é funcional? | SIM (`idempotency.test.ts`, `pipeline.test.ts`) |
| Pipeline externo pode publicar? | SIM (`pipeline.test.ts`) |
| WordPress import funciona? | SIM (`importer/tests/import.test.ts`) |
| Payload import framework funciona? | SIM (`importer/tests/payload.test.ts`) |
| Visual PEG aprovado? | NÃO (pendente de imagem) |
| Responsive aprovado? | NÃO (pendente de imagem) |
| Accessibility gate aprovado? | PARCIAL (code-level ok; axe não rodou) |
| E2E completo passa? | SIM (Playwright 2 passed) |
| Backup/restore testado? | SIM (`db/tests/backup.test.ts`) |
| Pronto para staging? | SIM (com ressalva visual) |
| Pronto para produção? | NÃO (visual QA pendente; deploy fora de escopo) |

---

## 21. Pendências remanescentes

*Estado em R13. Fechadas depois — ver §23.*

- **P0**: nenhum.
- **P1**: visual QA por imagem (P0/P1/P2 contra corpus PEG); axe/a11y automatizado.
- **P2**: deprecation `maxParamLength` (cosmético); preview de imagem depende de mídia pública; webhooks sem UI (API existe).

---

## 22. Artefatos gerados

- `docs/progress/RECOVERY-00` … `RECOVERY-14` — relatórios por fase.
- `docs/adr/ADR-0008` / `0009` / `0010` — decisões de documento V2, mídia, workflow.
- `docs/integrations/PIPELINE_API.md` — contrato de pipeline externo.
- `docs/audits/KALEL_RELEASE_CANDIDATE_AUDIT.md` — auditoria final.
- `apps/cms/playwright.config.ts` + `e2e/editorial.spec.ts` — E2E.

---

## 23. R14 — Staging readiness (esta sessão)

> Esta seção corrige o veredito da seção 20 com base em **execução**, não em inspeção.

O baseline da seção 19 foi **reproduzido** e estava correto: 139 testes, 0 fail, 0 skip,
typecheck/lint/build verdes, 2 Playwright. Ainda assim, a auditoria de staging encontrou
**8 P0** que os gates verdes não capturavam — porque os testes existentes afirmavam
contadores e caminhos felizes, não efeitos.

| # | P0 | por que passou despercebido |
|---|---|---|
| 1 | Rotas `/v1/admin/sites/:siteId/*` autorizavam pela **união** de permissões entre sites → tomada de controle cross-tenant | `isolation.test.ts` só cobria `/v1/sites/*` |
| 2 | `POST /users/:id/roles` lia `siteId` do corpo sem checagem → auto-promoção a Owner de qualquer site | nenhum teste |
| 3 | `revokeServiceToken`/`deleteWebhook` mutavam antes de validar o site | nenhum teste |
| 4 | Importador descartava **toda** categoria/tag/autor de **todo** artigo | o teste afirmava `report.imported.categories`, nunca `full.categories` |
| 5 | Bitmask do Lexical deslocado: sublinhado→tachado, código→sublinhado | o teste só usava `format: 1` |
| 6 | `Idempotency-Key` lida em 1 de ~20 rotas; mídia/entidades/fontes sem índice único | teste cobria só `POST /articles` |
| 7 | Navegação inalcançável abaixo de 1024px em 100% das telas | nenhum teste de navegador em largura mobile |
| 8 | Dark mode inalcançável (`data-theme="light"` fixo) | dark nunca foi exercitado |

A seção 20 registrava "Visual PEG aprovado? NÃO (pendente de imagem)". A pendência não era
de revisão humana: era de **medição**. Um harness Playwright de 180 medições (18 telas × 5
larguras × 2 temas) tornou o gate mecânico e reprodutível.

### Gates após R14

```text
pnpm -r typecheck                    PASS (13 projetos)
pnpm -r lint                         PASS (13 projetos)
pnpm -r build                        PASS
pnpm -r test                         139 → 248 (0 fail, 0 skip)
Playwright                           2 → 25 (0 fail, 0 skip)
axe (WCAG 2.1 A+AA, 76 varreduras)   0 violações
Navegação alcançável                 107/180 falhas → 190/190 ok
```

### Veredito revisado

- **P0 remanescentes: 0**
- **P1 remanescentes: 0** — os nove (P1-A … P1-I) foram fechados numa segunda rodada, cada
  um com regressão própria, sem reclassificar nada para P2
- **Pronto para staging: NÃO** — ver §8 da auditoria; P1 em aberto após oito revisões
- **Pronto para produção: NÃO** — quatro bloqueadores operacionais (logging desabilitado,
  rate limit sem `trustProxy`, oráculo no bootstrap, ciclo de vida de sessão), deixados
  para uma rodada separada por instrução explícita

## 24. R15 — Fechamento dos P1

Duas migrations novas: `0001` (`authors.user_id`, ligando assinatura editorial a conta) e
`0002` (`media.external_key`, identidade de origem que torna o re-import não-duplicante).

O padrão dos nove P1 repete o dos oito P0: nenhum era invisível no código, mas todos
passavam pelos gates porque os testes afirmavam contadores e caminhos felizes. O caso mais
claro é P1-B — `articleAuthors.authorId` comparado contra `actor.userId`, dois espaços de
UUID disjuntos, então `isListedAuthor` era **sempre falso**. Falhava fechado, e por isso
nada pegou.

Dois defeitos foram **introduzidos nesta rodada e corrigidos** antes do fechamento: o
replay de idempotência estourando 500 em criações de taxonomia (DTO montado depois do
bloco que persiste em JSONB), e um mínimo de 12 bytes na detecção de imagem quando um
cabeçalho JPEG válido tem 3. Ambos encontrados por verificação, não por sorte.

Detalhe completo em `docs/audits/KALEL_STAGING_READINESS_AUDIT.md` §5.

### Política de versionamento dos artefatos de recuperação

- `KALEL-RECOVERY-SUMMARY.md` — **versionado**. É o documento consolidado e útil.
- `docs/progress/RECOVERY-*`, `docs/audits/*`, `docs/integrations/*` — já versionados.
- `RECOVERY-REPORT.md` (293 KB) e `RECOVERY-DIFF.patch` (455 KB) — **mantidos fora do Git**.
  São artefatos históricos grandes e redundantes: o histórico de commits já contém o mesmo
  diff, de forma navegável. **Não foram apagados** — continuam no checkout do autor.

---

## 23. Depois de R13 — endurecimento e prontidão de produção

R0–R13 entregaram o produto. Duas rodadas posteriores fecharam o que faltava para
operá-lo: a auditoria de staging (`docs/audits/KALEL_STAGING_READINESS_AUDIT.md`) e esta
rodada de implementação. O relatório corrente é `docs/FINAL-REPORT.md`; o resumo:

**Fechado da auditoria de staging**

| id | o que era |
|---|---|
| A6 | documento ilegível recuperável só por SQL direto → permissão `articles.recover` + rotas de leitura bruta e substituição controlada, com os bytes anteriores preservados como revisão antes da escrita |
| F7 | nenhum índice atendia a consulta do agendador → índice parcial em `scheduled_at WHERE status = 'scheduled'`; eram 86.400 seq scans da tabela `articles` por dia |
| F9 | toda ação de service token auditada com `actor_id = NULL` → identidade e rótulo estáveis por credencial, e `worker` separado de `system` |
| F10 | `createUser` / `createSite` sem trilha → auditoria na mesma transação do insert |

**Fechado dos bloqueadores de produção**

| id | o que era |
|---|---|
| PROD-1 | `logger: false` em toda implantação → logging estruturado com redaction obrigatória; produção recusa subir com `LOG_LEVEL=silent` |
| PROD-2 | rate limit por `req.ip` sem política de proxy → `TRUST_PROXY` obrigatório em produção, `true` recusado, service tokens contados por credencial |
| PROD-3 | oráculo no bootstrap, sem limite dedicado → 5/min e uma única recusa idêntica para token errado, token ausente e sistema já inicializado |
| PROD-4 | sessão sem ciclo de vida → idle e absolute timeout, rotação com janela de graça, revogação ao desabilitar conta, `logout-all` |

**P2 com consequência operacional**

DNS rebinding na entrega de webhook (resolve-then-connect fechado dentro do lookup do
socket); post WordPress `future` com data passada auto-publicando na importação; namespace
de externalId compartilhado entre tipos; backup/restore para datasets grandes e schema que
mudou; webhooks sem UI; `allowBuilds` do pnpm com placeholders literais, que fazia todo
build script ser ignorado silenciosamente; deprecation `maxParamLength`.

**Adicionado para operar**

`/health` e `/ready` (com e sem prefixo `/v1`), `/ops-status` e painel operacional no CMS,
heartbeat do worker, graceful shutdown nos dois processos, Dockerfile do CMS, e scripts
`start:api` / `start:worker` / `start:cms` / `bootstrap` / `test:e2e` na raiz.

**Veredito atual**

| | |
|---|---|
| P0 conhecidos | 0 |
| P1 conhecidos | 0 |
| Pronto para staging | SIM |
| Código pronto para deploy de produção | SIM |
| Deploy executado | NÃO — exige instrução humana explícita |
