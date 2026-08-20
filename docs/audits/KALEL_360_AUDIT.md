# KAL EL — Auditoria 360° do Repositório

**Data:** 2026-08-17
**Método:** inspeção de código + execução real (lint, typecheck, build, 87 testes, boot da API com PostgreSQL real, requisições HTTP ponta a ponta, consultas SQL diretas).
**Regra aplicada:** o código executável é a fonte de verdade. Nenhum relatório anterior, TODO, nome de arquivo ou documento `DONE` foi aceito como prova.

---

## ETAPA 0 — PROVA DO REPOSITÓRIO

### Descoberta crítica de partida

O worktree em que a auditoria foi iniciada **não contém o código do produto**. A árvore real está em outro branch.

```text
worktree da auditoria:  C:\Users\pablo\Documents\OpenCode\Kal El\.claude\worktrees\kal-el-repository-audit-c088db
branch:                 claude/kal-el-repository-audit-c088db
HEAD:                   573d0125fe3bc47be5b69ef0fc6bb5918eafba2c
conteúdo:               76 arquivos — SOMENTE docs/, agents/, prompts/, design-system/
código de aplicação:    NENHUM (apps/.gitkeep, packages/.gitkeep)
```

```text
worktree do produto:    C:\Users\pablo\Documents\OpenCode\Kal El
repository:             https://github.com/maquinanerd/kal-el.git
remote:                 origin (fetch/push idênticos)
branch:                 feat/foundation-phase-1-3
HEAD:                   3a96a3a9aca4d4f6d0b08bdb26583e1f96af9ab4
last_commit:            "fix(design-system): valid font shorthand tokens (broke all typography),
                         system font stack, base reset and polish"
                        Pablo Eduardo <amaquinanerd@gmail.com>, Fri Aug 14 16:55:53 2026 -0300
worktree:               clean
untracked_files:        0 rastreados pelo git (ignorados presentes: node_modules/, kal-el-repository-v2.zip)
tracked_files:          261
node_version:           v24.19.0
package_manager:        pnpm
package_manager_version: 11.15.1 (declarado em package.json e usado)
```

**Divergência P1 de processo:** `main` (`573d012`) e `origin/main` estão no commit de bootstrap. Todo o produto vive apenas em `feat/foundation-phase-1-3`. **Nada do CMS está em `main`.**

### Árvore real do produto

```text
apps/
  api/        Fastify REST /v1  — 21 arquivos .ts, código real
  worker/     outbox dispatcher + scheduler — código real
  fixture/    consumidor de referência (revalidation) — código real
  (NÃO EXISTE apps/cms)
packages/
  auth/       Argon2id, tokens opacos, RBAC helpers
  contracts/  schemas zod + tipos + gerador OpenAPI
  db/         Drizzle schema + 1 migration + runner + backup
  design-system/  tokens PEG, primitivos React, shell, harness de calibração
  editor/     protótipo headless ProseMirror/TipTap (sem UI)
  events/     assinatura HMAC-SHA256 de webhook
  importer/   pipeline WordPress + adapter Payload
  sdk/        cliente tipado MN26/MNScr
  testkit/    PostgreSQL embutido para testes
docs/         13 docs de especificação + 7 ADRs + 11 relatórios de progresso
prompts/      7 prompts de orquestração
agents/       10 definições de agente
design-system/  contrato visual PEG (8 specs + tokens + 20 referências .webp)
scripts/      backup.ts, dev-api.ts
.github/workflows/ci.yml
docker-compose.yml, docker-compose.prod.yml, apps/{api,worker}/Dockerfile
```

**Ausentes:** `services/`, `tests/` (testes vivem junto de cada pacote), e — o mais importante — **qualquer aplicação de CMS**.

---

## ETAPA 1 — INVENTÁRIO COMPLETO

| nome | caminho | responsabilidade aparente | código real? | testes? | usado por outra parte? | status |
|---|---|---|---|---|---|---|
| @kal-el/api | `apps/api` | REST /v1: auth, RBAC, sites, artigos, taxonomia, SEO, audit | SIM | SIM (31) | SIM (fixture, importer) | **REAL** |
| @kal-el/worker | `apps/worker` | dispatcher de outbox + promoção de agendados | SIM | SIM (8) | SIM (fixture e2e) | **REAL** |
| @kal-el/fixture | `apps/fixture` | frontend de referência que revalida cache | SIM | SIM (2) | só em testes | **REAL** (é fixture por design) |
| @kal-el/contracts | `packages/contracts` | schemas zod, tipos, OpenAPI | SIM | SIM (9) | SIM (todos) | **REAL** |
| @kal-el/db | `packages/db` | schema Drizzle, migration, backup | SIM | SIM (8) | SIM (api, worker) | **REAL** |
| @kal-el/auth | `packages/auth` | Argon2id, tokens, RBAC | SIM | SIM (5) | SIM (api) | **REAL** |
| @kal-el/events | `packages/events` | assinatura HMAC de webhook | SIM | NÃO (script `test` inexistente) | SIM (worker, fixture) | **REAL** |
| @kal-el/sdk | `packages/sdk` | cliente MN26/MNScr | SIM | SIM (5) | SIM (importer, e2e) | **REAL** |
| @kal-el/importer | `packages/importer` | WordPress → Kal El; framework Payload | SIM | SIM (8) | não em runtime | **PARCIAL** (perde toda mídia e formatação inline) |
| @kal-el/testkit | `packages/testkit` | PostgreSQL embutido | SIM | NÃO | SIM (todos os testes) | **REAL** |
| @kal-el/editor | `packages/editor` | engine de editor | SIM (schema/round-trip) | SIM (6) | **NÃO** — nada importa em runtime | **NÃO UTILIZADO** (protótipo headless) |
| @kal-el/design-system | `packages/design-system` | tokens PEG + primitivos + harness | SIM (componentes) | SIM (5) | **NÃO** — nenhuma app consome | **DEMO** (galeria estática) |
| — | `apps/cms` | CMS editorial | **NÃO EXISTE** | — | — | **NÃO IMPLEMENTADO** |

**Observação sobre contagem de arquivos:** 261 arquivos rastreados, mas 20 são imagens de referência `.webp`, 4 são screenshots, e ~40% do restante é documentação Markdown. O código executável são ~120 arquivos TS/TSX.

---

## ETAPA 2 — BACKEND

**Arquitetura efetivamente implementada:** monolito modular Fastify + Drizzle ORM + PostgreSQL, com worker separado consumindo uma tabela de outbox. REST `/v1` é canônico. OpenAPI 3.0.3 é gerado a partir dos schemas zod e **servido de verdade** em `/docs` (`apps/api/src/app.ts:44-45`).

### Todas as rotas reais

Verificadas por leitura (`apps/api/src/routes/*.ts`) e confirmadas contra o servidor em execução.

#### Públicas / auth
| rota | método | auth | RBAC | validação | persistência | erro | testes |
|---|---|---|---|---|---|---|---|
| `/v1/health` | GET | não | — | — | — | — | indireto |
| `/v1/ready` | GET | não | — | — | ping DB real | sim | indireto |
| `/v1/auth/login` | POST | — | — | zod | PostgreSQL (sessions) | sim | SIM |
| `/v1/auth/logout` | POST | cookie | — | — | PostgreSQL (delete) | sim | SIM |
| `/v1/auth/me` | GET | cookie/bearer | — | — | PostgreSQL | sim | SIM |
| `/v1/bootstrap/init` | POST | `X-Bootstrap-Token` + só se 0 usuários | — | zod | PostgreSQL (tx) | sim | SIM |
| `/docs` | GET | **não** | — | — | — | — | não |

#### Admin (`/v1/admin`) — permissão exigida na união de todos os sites do usuário
| rota | método | permissão | validação | persistência | testes |
|---|---|---|---|---|---|
| `/sites` | GET | `sites.read` | — | PostgreSQL | SIM |
| `/sites` | POST | `sites.create` | zod | PostgreSQL | SIM |
| `/sites/:siteId` | PATCH | `sites.create` | zod + uuid | PostgreSQL | não |
| `/users` | GET | `users.read` | — | PostgreSQL | SIM |
| `/users` | POST | `users.create` | zod | PostgreSQL (Argon2id) | SIM |
| `/users/:userId/roles` | POST | `roles.manage` | zod + uuid | PostgreSQL | SIM |
| `/roles` | GET/POST | `roles.manage` | zod | PostgreSQL (tx) | SIM |
| `/sites/:siteId/service-tokens` | GET/POST | `tokens.manage` | zod | PostgreSQL (hash) | SIM |
| `/sites/:siteId/service-tokens/:id/revoke` | POST | `tokens.manage` | uuid | PostgreSQL | não |
| `/sites/:siteId/webhooks` | GET/POST/DELETE | `tokens.manage` | zod | PostgreSQL | SIM |

#### Site-scoped (`/v1/sites/:siteId`) — `requireSiteScope` + permissão por rota
| rota | método | permissão | validação | persistência | erro | testes |
|---|---|---|---|---|---|---|
| `/articles` | GET | `articles.read` | zod (cursor/filtros) | PostgreSQL | sim | SIM |
| `/articles` | POST | `articles.create` | zod + Idempotency-Key | PostgreSQL (tx + outbox + audit) | sim | SIM |
| `/articles/:id` | GET | `articles.read` | uuid | PostgreSQL | sim | SIM |
| `/articles/:id` | PATCH | `articles.update` | zod + If-Match (optimistic lock) | PostgreSQL (tx + revisão + audit) | sim | SIM |
| `/articles/:id/revisions` | GET | `articles.read` | uuid | PostgreSQL | sim | SIM |
| `/articles/:id/publish` | POST | `articles.publish` | zod | PostgreSQL (tx + outbox + audit) | sim | SIM |
| `/articles/:id/schedule` | POST | `articles.schedule` | zod | PostgreSQL (tx + audit) | sim | SIM |
| `/categories` | GET/POST | `taxonomy.categories.manage` | zod | PostgreSQL | sim | SIM |
| `/tags` | GET/POST | `taxonomy.tags.manage` | zod | PostgreSQL | sim | SIM |
| `/entities` | GET/POST | `taxonomy.entities.manage` | zod | PostgreSQL | sim | SIM |
| `/authors` | GET/POST | `taxonomy.authors.manage` | zod | PostgreSQL | sim | SIM |
| `/sources` | GET/POST | `taxonomy.sources.manage` | zod | PostgreSQL | sim | SIM |
| `/redirects` | GET/POST/DELETE | `seo.manage` | zod | PostgreSQL | sim | SIM |
| `/audit-log` | GET | `audit.read` | — | PostgreSQL | sim | SIM |
| `/audit-log/:objectType/:objectId` | GET | `audit.read` | uuid | PostgreSQL | sim | SIM |

**Total: 38 endpoints reais.**

### Natureza dos endpoints

Provado por execução contra PostgreSQL real:

- **Acessam PostgreSQL:** todos os 38. Nenhum retorna fixture, mock, JSON local ou objeto hardcoded.
- **Memória:** nenhum.
- **Stubs:** nenhum.

### Rotas que NÃO existem (provado com HTTP 404 no servidor em execução)

```text
POST /v1/sites/:id/media                 -> 404      GET /v1/media                    -> 404
POST /v1/sites/:id/articles/:id/submit   -> 404      .../approve                      -> 404
POST /v1/sites/:id/articles/:id/preview  -> 404      .../unpublish                    -> 404
POST /v1/sites/:id/analytics             -> 404      /v1/sites/:id/workflow           -> 404
```

Também ausentes: DELETE de artigo (a permissão `articles.delete` existe e nunca é usada), PATCH/DELETE de taxonomia, endpoint de mídia de qualquer tipo.

---

## ETAPA 3 — POSTGRESQL E PERSISTÊNCIA

- **Schema:** Drizzle, 6 módulos (`sites`, `identity`, `editorial`, `media`, `system`).
- **Migrations:** **1** baseline versionada — `packages/db/drizzle/0000_furry_psynapse.sql` (343 linhas), journal Drizzle v7 consistente. Reversibilidade testada (`migration.test.ts`: "down migration is reversible and re-appliable").
- **ORM:** Drizzle (ADR-0002). Sem query builder cru exposto; `sql` template usado pontualmente para cursor e advisory lock.
- **Repositories:** camada `services/` faz o papel de repositório (não há camada repository separada — decisão consciente, não uma lacuna).
- **Connection pooling:** `pg.Pool` (`packages/db/src/client.ts`).
- **Transactions:** reais e corretas em create/update/publish/schedule/bootstrap/roles/idempotency.
- **Constraints/FK:** 26 FKs com `ON DELETE cascade`/`set null` explícitos.
- **Indexes:** 28 índices, incluindo únicos compostos por `site_id` (isolamento no nível do banco).
- **Seeds:** **não existem seeds de conteúdo.** O único seed é `seedPermissions()` (21 chaves de permissão), executado no boot da API (`apps/api/src/server.ts:14`).

### Tabelas realmente existentes (26 — confirmadas em banco vivo)

`article_authors`, `article_categories`, `article_entities`, `article_revisions`, `article_tags`, `articles`, `audit_log`, `authors`, `categories`, `entities`, `idempotency_keys`, `media`, `outbox_events`, `permissions`, `redirects`, `role_permissions`, `roles`, `service_tokens`, `sessions`, `sites`, `sources`, `tags`, `user_roles`, `users`, `webhook_deliveries`, `webhooks`

Consulta em banco vivo: `select count(*) from information_schema.tables where table_schema='public'` → **26**.

### Persistência real por domínio

| domínio | tabela existe | escrita real por código | status |
|---|---|---|---|
| Sites | SIM | SIM | **REAL** |
| Users | SIM | SIM | **REAL** |
| Roles | SIM | SIM | **REAL** |
| Permissions | SIM | SIM (seed no boot) | **REAL** |
| Articles | SIM | SIM | **REAL** |
| Article Versions | SIM (`article_revisions`) | SIM (create/update/publish/schedule) | **REAL** |
| Categories | SIM | SIM | **REAL** |
| Tags | SIM | SIM | **REAL** |
| Entities | SIM | SIM | **REAL** |
| **Media** | SIM | **NÃO — zero INSERT em todo o repositório** | **MODELO APENAS** |
| SEO | SIM (`articles.seo` jsonb) | SIM | **REAL** |
| Workflow | parcial (`articles.status`) | **transições `in_review`/`blocked` inalcançáveis** | **PARCIAL** |
| Scheduling | SIM (`articles.scheduled_at`) | SIM (+ worker promove) | **REAL** |
| Redirects | SIM | SIM (+ 301 automático em troca de slug) | **REAL** |
| Audit Log | SIM | SIM (toda escrita) | **REAL** |
| API Clients | SIM (`service_tokens`) | SIM (hash, escopo, revogação, expiração) | **REAL** |
| Idempotency | SIM | SIM (advisory lock + replay) | **REAL** |
| Outbox | SIM | SIM (chave determinística) | **REAL** |
| Webhooks | SIM (`webhooks`, `webhook_deliveries`) | SIM (HMAC, retry, dead-letter) | **REAL** |

### Pergunta obrigatória

> **Se eu apagar todos os seeds e reiniciar o sistema com PostgreSQL vazio, consigo operar o Kal El normalmente criando meus próprios dados?**

**SIM — pela API. NÃO pela interface.**

Explicação técnica, verificada por execução:

1. Não existem seeds de conteúdo para apagar. O CMS nunca teve dados de demonstração no banco.
2. Com banco vazio: `runMigrations()` cria as 26 tabelas; no boot `seedPermissions()` insere as 21 permissões; `POST /v1/bootstrap/init` (guardado por `X-Bootstrap-Token` **e** só se `users` estiver vazia) cria em uma transação o primeiro site, o primeiro usuário e o papel `owner` com todas as permissões.
3. Executei exatamente esse caminho contra um PostgreSQL vazio: bootstrap → HTTP 201, login → 200, criar artigo → 201, publicar → 200, ler de volta → 200 com o documento íntegro.
4. **Porém não há interface para operar.** Não existe `apps/cms`. Toda operação exige `curl`/SDK/Swagger.
5. **E mídia é impossível em qualquer cenário** — não há endpoint de upload.

---

## ETAPA 4 — DADOS QUE APARECEM NA INTERFACE ⚠️ CRÍTICO

**Esta é a conclusão mais importante da auditoria.**

A tela preenchida que foi vista **não é o CMS**. É `packages/design-system/dev/main.tsx` — um arquivo único de 421 linhas, um "Lab" de calibração do design system, servido por Vite (`pnpm dev:site`).

Provas mecânicas:

```text
grep -rn "fetch|axios|useQuery|swr|react-router|Route" packages/design-system/src packages/design-system/dev
  -> ZERO OCORRÊNCIAS

grep -rn "\"next\"|react-router|@tanstack/react-query" --include=package.json apps packages
  -> NENHUM

ls apps/  ->  api  fixture  worker      (não existe cms)
```

Não há cliente HTTP, não há roteador, não há gerenciamento de estado remoto. **Nenhum pixel daquela tela está conectado a nada.**

### Origem de cada dado visível

| TELA | DADO | ORIGEM | CLASSIFICAÇÃO | ARQUIVO |
|---|---|---|---|---|
| Lab (única) | 5 artigos ("Gladiador II…", "Análise: o retorno de Ridley Scott…", etc.) | array literal `const articles: ArticleRow[]` | **HARDCODED** | `packages/design-system/dev/main.tsx:67-73` |
| Lab | autores "Ana Souza", "Bruno Lima", "Carla Mendes", "Diego Rocha" | strings dentro do mesmo array | **HARDCODED** | `dev/main.tsx:67-73` |
| Lab | categorias "Filmes", "Crítica", "Lista", "Vídeo", "Áudio" | strings no array + `<option>` estáticos | **HARDCODED** | `dev/main.tsx:67-73, 256-260, 341-343` |
| Lab | KPIs "24 publicados hoje", "3 em revisão", "38 min", "12,4 mil" | props literais de `KpiCard` | **HARDCODED** | `dev/main.tsx:235-238` |
| Lab | contadores de abas (Todos 120, Draft 8, Em revisão 3, Agendados 2, Publicados 107) | props literais de `Tabs` | **HARDCODED** | `dev/main.tsx:215-219` |
| Lab | paginação "120 itens" | prop literal `total={120}` | **HARDCODED** | `dev/main.tsx:243` |
| Lab | perfil "Pablo Eduardo / pablo@kalel.app" | props literais de `ProfileCard` | **HARDCODED** | `dev/main.tsx:168-169` |
| Lab | contas "Kal El" / "Commerce Wayne" | array literal em `AccountSwitcher` | **HARDCODED** | `dev/main.tsx:307-309` |
| Lab | corpo do editor ("O editor de artigos é o coração do Kal El…") | JSX estático dentro de `EditorSurface` | **HARDCODED** | `packages/design-system/src/components/Editor.tsx:25-38` |
| Lab | revisões "r4 · há 12 min", "r3 · há 1 h" | JSX estático | **HARDCODED** | `dev/main.tsx:356-360` |
| Lab | badge sidebar "Artigos 12" | JSX estático | **HARDCODED** | `dev/main.tsx:145` |
| Lab | menus, alertas, toast, empty state | JSX estático | **HARDCODED** | `dev/main.tsx:288-383` |

### Diferenciação obrigatória

```text
dados de demonstração persistidos no PostgreSQL:  NENHUM (zero linhas; não há seed de conteúdo)
dados falsos existentes apenas no frontend:       100% do que aparece na tela
```

**Nenhum seed, fixture, MSW, faker ou fake API foi encontrado.** É mais simples e mais grave do que isso: são literais JSX/TS numa galeria de componentes. Não existe fallback silencioso porque não existe chamada nenhuma a cair para trás.

Consulta em banco vivo após bootstrap limpo confirma: `media` = 0 linhas; artigos só os 3 que eu mesmo criei via HTTP.

---

## ETAPA 5 — FRONTEND CMS

**Não existe CMS.** Existe uma tela de laboratório.

| ROTA | COMPONENTE | STATUS | FONTE DOS DADOS | API REAL? | INTERAÇÃO REAL? | PERSISTE? | TESTADA? |
|---|---|---|---|---|---|---|---|
| `/` (única, Vite) | `Lab` em `dev/main.tsx` | **VISUAL APENAS** | literais no arquivo | NÃO | parcial (só estado local: tema, tab, modal, checkbox) | NÃO | 5 testes de primitivo |

Auditoria das telas exigidas:

| Tela exigida | Existe? | Status |
|---|---|---|
| Login | NÃO | **NÃO IMPLEMENTADO** |
| Dashboard | parcialmente como bloco de KPIs no Lab | **VISUAL APENAS** |
| Articles | tabela no Lab, 5 linhas hardcoded | **VISUAL APENAS** |
| Article Editor | `EditorSurface` com `contentEditable={false}` | **VISUAL APENAS** |
| Preview | NÃO | **NÃO IMPLEMENTADO** |
| Media Library | NÃO (só ícone na sidebar) | **NÃO IMPLEMENTADO** |
| Media Detail | NÃO | **NÃO IMPLEMENTADO** |
| Categories | NÃO (só item de menu) | **NÃO IMPLEMENTADO** |
| Tags | NÃO (só item de menu) | **NÃO IMPLEMENTADO** |
| Authors | NÃO | **NÃO IMPLEMENTADO** |
| Sources | NÃO | **NÃO IMPLEMENTADO** |
| Editorial Calendar | NÃO (só item de menu) | **NÃO IMPLEMENTADO** |
| Workflow | NÃO (só item de menu) | **NÃO IMPLEMENTADO** |
| AI / Automations | NÃO (só item de menu) | **NÃO IMPLEMENTADO** |
| SEO | dois inputs no inspector do Lab | **VISUAL APENAS** |
| Redirects | NÃO | **NÃO IMPLEMENTADO** |
| Analytics | NÃO | **NÃO IMPLEMENTADO** |
| Users | NÃO (só item de menu) | **NÃO IMPLEMENTADO** |
| Roles & Permissions | NÃO | **NÃO IMPLEMENTADO** |
| Audit Log | NÃO | **NÃO IMPLEMENTADO** |
| Settings | NÃO (só item de menu) | **NÃO IMPLEMENTADO** |

**0 de 21 telas funcionais.** Os "itens de menu" são entradas de array na sidebar sem destino — não há roteador.

---

## ETAPA 6 — ARTICLE EDITOR

**Engine:** duas coisas distintas e desconectadas foram construídas.

1. `packages/editor` — protótipo **headless** ProseMirror (`@tiptap/pm/model`). Converte `ArticleDocument` ↔ nó ProseMirror e valida via schema. **Sem UI, sem React, e nada em runtime o importa** (ADR-0007 documenta como escolha de engine + protótipo).
2. `packages/design-system/src/components/Editor.tsx` — `EditorSurface`, uma `<div contentEditable={false}>` com parágrafos estáticos, e `InlineToolbar`, botões sem `onClick`.

**Não existe editor utilizável.** O que se parece com um editor é explicitamente não-editável.

| item | status | evidência |
|---|---|---|
| texto normal | **VISUAL** | `contentEditable={false}` — `Editor.tsx:18` |
| parágrafos | **PARCIAL** | tipo `paragraph` existe no schema; sem UI |
| H2 / H3 / H4 | **PARCIAL** | schema aceita `level: 2..4`; sem UI |
| bold | **NÃO IMPLEMENTADO** | schema do documento não tem marks; `content: z.string()` |
| italic | **NÃO IMPLEMENTADO** | idem |
| links | **NÃO IMPLEMENTADO** | idem — botão 🔗 é decorativo (`Editor.tsx:65`) |
| listas | **PARCIAL** | nó `list` no schema; sem UI |
| quotes | **PARCIAL** | nó `quote` no schema; sem UI |
| slash commands | **NÃO IMPLEMENTADO** | nenhuma ocorrência no repo |
| drag & drop | **NÃO IMPLEMENTADO** | nenhuma ocorrência |
| paste de imagem | **NÃO IMPLEMENTADO** | nenhuma ocorrência |
| upload | **NÃO IMPLEMENTADO** | zero `multipart`; endpoint 404 |
| media library | **NÃO IMPLEMENTADO** | zero INSERT em `media` |
| featured image | **PARCIAL** | coluna `featured_media_id` + FK existem; **impossível popular** (sem mídia) |
| gallery | **PARCIAL** | nó `gallery` exige `mediaIds` uuid; impossível popular |
| YouTube embed | **PARCIAL** | nó `embed` (url/provider) validado; sem UI |
| tabelas | **PARCIAL** | nó `table` no schema + round-trip testado; sem UI |
| fontes/referências | **PARCIAL** | nó `source` (label/url/kind); sem UI |
| autosave | **NÃO IMPLEMENTADO** | nenhuma ocorrência |
| recovery | **NÃO IMPLEMENTADO** | nenhuma ocorrência |
| revisions | **REAL** | `article_revisions` gravada em create/update/publish/schedule; endpoint GET testado; confirmei 1 revisão após criar artigo |
| diff | **NÃO IMPLEMENTADO** | nenhuma ocorrência |
| preview | **NÃO IMPLEMENTADO** | rota → 404 |
| SEO inspector | **VISUAL** | dois inputs sem binding (`dev/main.tsx:350-353`) |
| categories | **REAL na API** / **VISUAL na UI** | endpoints testados; `<option>` estáticos na tela |
| tags | **REAL na API** / ausente na UI | endpoints testados |
| entities | **REAL na API** / ausente na UI | endpoints testados |
| scheduling | **REAL na API** / ausente na UI | endpoint + worker + 3 testes |
| publish | **REAL na API** / **VISUAL na UI** | endpoint testado; modal "Publicar agora" sem handler |

### Lacuna estrutural P0 do modelo de conteúdo

`packages/contracts/src/editorial.ts:36-38` define os nós de texto como **strings planas**:

```ts
z.object({ type: z.literal("paragraph"), attrs: …, content: z.string() })
z.object({ type: z.literal("heading"),   attrs: { level }, content: z.string() })
```

Não há array de marks, não há nós inline. **Negrito, itálico e link dentro de um parágrafo são estruturalmente impossíveis de armazenar**, independentemente de qualquer UI futura. Isso é inaceitável para um CMS editorial e exige uma migration de schema (documento v2) para corrigir. O `docs/FINAL-REPORT.md:106-107` reconhece isso honestamente.

### Pergunta obrigatória

> **Eu consigo escrever uma matéria completa manualmente, salvar, fechar o navegador, voltar, editar, adicionar mídia, configurar SEO, visualizar e publicar?**

**NÃO.**

Sem relativizar: não existe navegador em que isso aconteça. Não há tela de escrita, não há mídia (nem por API), não há preview. Via `curl` eu consegui criar → salvar → reler → editar → configurar SEO → publicar; **mas mídia e preview falham até por API**, e "manualmente" no sentido de um jornalista trabalhando não existe.

---

## ETAPA 7 — MEDIA LIBRARY

**Upload não é real. Não existe absolutamente nada de mídia funcional.**

Fluxo exigido, resultado real:

```text
arquivo          -> não há endpoint que aceite arquivo (zero multipart no repositório)
validação        -> mediaSchema existe em contracts, nunca usado num handler
upload           -> INEXISTENTE
storage          -> INEXISTENTE
registro no PG   -> tabela `media` existe; ZERO INSERT em todo o código; 0 linhas em banco vivo
URL              -> INEXISTENTE
editor           -> nó `image` exige mediaId uuid → impossível de satisfazer
frontend/preview -> INEXISTENTE
```

Provas:

```text
grep -rn "multipart|upload|StorageProvider|sharp|s3|r2" apps packages scripts
  -> 4 ocorrências, TODAS irrelevantes:
     packages/contracts/src/media.ts:17   (campo storageKey no schema)
     packages/db/src/schema/media.ts:23   (coluna storage_key)
     packages/design-system/src/icons.tsx:59 (path SVG de um ícone)
     packages/importer/src/import.ts:101  (comentário: "deferred until the StorageProvider (Phase 5)")

HTTP contra servidor vivo:
  GET  /v1/sites/:id/media   -> 404
  POST /v1/sites/:id/media   -> 404
  GET  /v1/media             -> 404

SQL em banco vivo: select count(*) from media -> 0
```

| item | situação |
|---|---|
| onde o arquivo físico fica | **em nenhum lugar** — nada é gravado |
| existe StorageProvider? | **NÃO** — apenas mencionado num comentário e no `.env.example` |
| local storage funciona? | **NÃO** — `.env.example` declara `MEDIA_STORAGE_PROVIDER=local` e `MEDIA_LOCAL_PATH=./uploads`, mas `apps/api/src/config.ts` **não lê nenhuma das duas**. Configuração documentada para um recurso inexistente. |
| interface preparada para R2/S3? | **NÃO** — não há abstração |
| alt text / caption / credit | colunas existem; nunca escritas |
| dimensions (width/height) | colunas existem; nunca escritas |
| MIME | coluna existe; nunca escrita |
| focal point (focal_x/y) | colunas existem; nunca escritas |
| crop | **inexistente** em qualquer camada |
| featured image | FK `articles.featured_media_id` existe; impossível popular |
| gallery | nó de documento exige uuids de mídia; impossível popular |

**Partes meramente visuais:** o item "Mídia" na sidebar do Lab (`dev/main.tsx:154`) e o ícone `IconImage`. É a totalidade da "media library".

---

## ETAPA 8 — AUTENTICAÇÃO E PERMISSÕES

### Autenticação — REAL e sólida

- Argon2id (`@node-rs/argon2`) para senhas.
- Sessões: token opaco `ke_s.<random>`, armazenado **hasheado**, cookie `HttpOnly; SameSite=Lax; Path=/` (+ `Secure` quando `COOKIE_SECURE=true`).
- CSRF double-submit: cookie `ke_csrf` legível + header obrigatório `x-kal-el-csrf` em todo método não-GET. **Verifiquei ao vivo: POST sem o header → HTTP 403.**
- Service tokens: `ke_st.<random>`, hasheados, com escopos, expiração, revogação e `last_used_at`.
- Rate limit: global 600/min + login 10/min.
- Helmet ativo — confirmei os headers na resposta: `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`.
- `GET /v1/sites/...` sem cookie → 401 (dados não são públicos).

### Papéis

**Não existem papéis pré-definidos.** O único papel semeado é `owner` (todas as 21 permissões), criado no bootstrap.

```text
Admin          -> NÃO EXISTE (o mais próximo é `owner`)
Editor chefe   -> NÃO EXISTE
Editor         -> NÃO EXISTE
Autor          -> NÃO EXISTE
```

O modelo é permissão-a-permissão via `POST /v1/admin/roles`. É flexível e correto como mecanismo, mas **a hierarquia editorial do produto não está materializada** — cada instalação teria de inventá-la.

### 🔴 P0 — RBAC ESTÁ QUEBRADO (bypass de publicação confirmado)

O teste que a Etapa 8 exige — *"Autor → chamar API diretamente → publicar"* — **funciona**.

Executei ao vivo contra o servidor:

```text
1. criei usuário autor@kalel.dev                                        -> 201
2. criei papel "autor" com APENAS: articles.create, articles.read, articles.update
                                   (SEM articles.publish, SEM articles.schedule)  -> 201
3. atribuí o papel ao usuário no site                                   -> 201
4. login como autor                                                     -> 200

5. POST /articles/:id/publish                                           -> 403 FORBIDDEN  ✅
6. POST /articles/:id/schedule                                          -> 403 FORBIDDEN  ✅

7. BYPASS: POST /articles  com body {"status":"published"}               -> 201  🔴
   resultado: status=published, publishedAt=2026-08-17T12:57:41.662Z
```

Confirmação em banco:

```text
select status, count(*) from articles group by status
  -> published: 2   (um deles é "bypass-publish", criado pelo autor sem permissão)

select event_type, status, payload->>'slug' from outbox_events
  -> article.published | pending | auditoria-360
  -> article.published | pending | bypass-publish     <-- vai revalidar os frontends
```

**Causa raiz:** `apps/api/src/routes/site.ts:77` protege `POST /articles` apenas com `articles.create`. O `createArticleBodySchema` aceita `status` e `publishedAt` (linhas 117-120 de `contracts/src/editorial.ts`, comentadas como "Import/automation path"), e `createArticle()` (`apps/api/src/services/articles.ts:186-235`) honra ambos **sem verificar nenhuma permissão**.

**Impacto:** qualquer ator com `articles.create` publica conteúdo em produção, define `publishedAt` arbitrário (backdating) e dispara o evento de revalidação para os frontends. Esconder o botão no frontend não mitiga — não existe frontend, e o bypass é pela API.

**Ponto positivo:** os testes de isolamento (`isolation.test.ts`, 6 testes) cobrem corretamente site-scope e escopo de service token. Eles simplesmente **não testam esse caminho**.

---

## ETAPA 9 — MULTI-SITE

**Classificação: REAL** (com uma falha pontual de isolamento, abaixo).

O modelo é multi-site de verdade, não uma coluna decorativa:

- `sites` com slug único; `site_id NOT NULL` em articles, authors, categories, tags, entities, media, sources, redirects, outbox_events, service_tokens, webhooks.
- Índices **únicos compostos** por site: `articles(site_id, slug)`, `articles(site_id, external_key)`, `categories(site_id, slug)`, `tags(site_id, slug)`, `authors(site_id, slug)`, `redirects(site_id, source_path)`. Ou seja, dois sites podem ter o mesmo slug — requisito real de multi-portal.
- Associação usuário↔papel é **por site**: PK composta `user_roles(user_id, role_id, site_id)`.
- `requireSiteScope` exige membership naquele site específico; `getEffectivePermissions(userId, siteId)` é calculado por site.
- Service tokens são amarrados a um único site (`row.siteId !== siteId` → 403 `SITE_SCOPE_MISMATCH`).
- Toda query de leitura filtra por `site_id`.

Verificado por teste automatizado real (`isolation.test.ts`, todos passando):
- editor do site A criando no site B → 403 `SITE_SCOPE_MISMATCH`
- lendo artigos do site B → 403
- busca no site A não retorna "Segredo do portal B" → confirmado
- service token do site A no site B → 403
- service token sem escopo → 403

> **Consigo criar Máquina Nerd, Cinerie, Portal Economia, Portal Futebol como sites independentes na mesma instalação?**

**SIM, pela API.** `POST /v1/admin/sites` funciona (criei um segundo site ao vivo). Cada um teria usuários, artigos, categorias, tags, mídia (quando existir), SEO e permissões isolados.

> `Article.site_id = Cinerie` aparece nas consultas do Máquina Nerd?

**NÃO.** Isolamento comprovado por teste negativo e por leitura de todas as queries.

| dimensão | isolado? |
|---|---|
| sites | SIM |
| usuários por site | SIM (`user_roles.site_id`) |
| artigos por site | SIM |
| categorias | SIM |
| tags | SIM |
| mídia | schema SIM, irrelevante (sem mídia) |
| SEO | SIM (jsonb no artigo) |
| permissões | SIM (por site) |

### 🟠 P1 — falha de isolamento em `deleteRedirect`

`apps/api/src/services/redirects.ts:44-48`:

```ts
const [row] = await db.delete(redirects).where(eq(redirects.id, redirectId)).returning();
if (!row || row.siteId !== siteId) throw notFound("redirect not found");
```

O DELETE **não é filtrado por `site_id`**. A linha é apagada e comitada; só depois o código compara o site e lança 404. Um usuário com `seo.manage` no site A que conheça (ou acerte) o UUID de um redirect do site B **apaga o redirect do site B** e recebe um 404 enganoso. Não há transação para reverter.

---

## ETAPA 10 — SEO

### SEO editorial do Kal El — o que existe DE VERDADE

| item | status | evidência |
|---|---|---|
| slug | **REAL** | `articles.slug`, único por site, `slugify()` + `uniqueSlug()` com desambiguação `-2`, `-3` |
| SEO title | **REAL** | `seo.seoTitle`, máx. 160, persistido em jsonb |
| meta description | **REAL** | `seo.metaDescription`, máx. 320 |
| canonical | **REAL** | `seo.canonicalUrl`, validado como URL |
| robots | **REAL** | `robotsIndex` (index/noindex) + `robotsFollow` (follow/nofollow) |
| social image | **NÃO IMPLEMENTADO** | não há campo; dependeria de mídia, que não existe |
| Open Graph editorial | **PARCIAL** | `socialTitle` + `socialDescription` existem; sem imagem |
| primary category | **NÃO IMPLEMENTADO** | `article_categories` é N:N sem noção de primária |
| entities | **REAL** | tabela `entities` + `article_entities` + endpoints |
| internal linking | **NÃO IMPLEMENTADO** | impossível — sem marks/link no modelo de documento |
| redirect em alteração de slug | **REAL** | `upsertSlugRedirect()` cria 301 automático em `updateArticle`; coberto por `seo.test.ts` (3 testes) |
| preview SERP | **NÃO IMPLEMENTADO** | nenhuma UI |
| preview social | **NÃO IMPLEMENTADO** | nenhuma UI |
| publication dates | **REAL** | `published_at`, `scheduled_at`, `created_at`, `updated_at` com timezone |

### Separação obrigatória

```text
SEO EDITORIAL DO KALEL (implementado no backend):
  slug + unicidade por site, SEO title, meta description, canonical, robots
  index/follow, social title/description, entidades, redirects 301 automáticos
  em troca de slug, datas de publicação.

SEO TÉCNICO — RESPONSABILIDADE DOS FRONTENDS CONSUMIDORES (NÃO está no Kal El):
  sitemap.xml, robots.txt, JSON-LD / structured data, Core Web Vitals,
  renderização de meta tags, hreflang, RSS, AMP, tags canônicas no HTML.
```

**Nenhum destes últimos está implementado no Kal El, e corretamente não deveria estar.** Não declaro sitemap/JSON-LD/CWV como feitos. `apps/fixture` demonstra o contrato de consumo (cache + revalidação por webhook assinado), não SEO técnico.

---

## ETAPA 11 — PUBLICAÇÃO

Ciclo completo, com o que realmente acontece:

| etapa | realidade | status |
|---|---|---|
| Create | `POST /articles` em transação: insere artigo + revisão 1 + audit; se `status=published`, insere evento de outbox | **REAL** |
| Draft | default `status='draft'` | **REAL** |
| Autosave | **inexistente** — nenhuma ocorrência no repositório | **NÃO IMPLEMENTADO** |
| Review | **inexistente** — `in_review` existe no enum mas nenhuma rota transiciona para ele | **NÃO IMPLEMENTADO** |
| Preview | rota → 404 | **NÃO IMPLEMENTADO** |
| Schedule | `POST /articles/:id/schedule`, valida futuro, grava `scheduled_at`, audit | **REAL** |
| Publish | `POST /articles/:id/publish` em transação: status + publishedAt + nova revisão + outbox + audit; idempotente (se já publicado, retorna o artigo sem duplicar) | **REAL** |
| API delivery | `GET /articles`, `GET /articles/:id` com cursor e filtros | **REAL** |
| Event | `outbox_events` com `idempotency_key` determinística `article:{id}:publish:{ts}` + `onConflictDoNothing` | **REAL** |
| Revalidation | worker faz `SELECT … FOR UPDATE SKIP LOCKED`, assina HMAC-SHA256, entrega com headers de idempotência, retry exponencial (5 tentativas), dead-letter | **REAL** |

### 🟠 P1 — Workflow editorial não existe e falha silenciosamente

O enum tem 5 estados: `draft`, `in_review`, `scheduled`, `published`, `blocked`. Apenas 3 são alcançáveis.

`updateArticleBodySchema` **não possui campo `status`**. Como zod remove chaves desconhecidas por padrão, a API **aceita a requisição e descarta o campo sem erro**. Provei ao vivo:

```text
PATCH /articles/:id  {"status":"in_review"}
  -> 400 (só porque nenhum campo válido foi enviado)

PATCH /articles/:id  {"title":"Auditoria 360 (v2)","status":"in_review"}
  -> 200
     resultado: title atualizado ✅ | status: "published" (INALTERADO, sem aviso) 🔴
```

O cliente recebe 200 e acredita ter movido o artigo para revisão. Não moveu. **Perda silenciosa de dados** — pior que um 400.

### Busca por fraudes

| suspeita | veredito |
|---|---|
| fake publish | **NÃO** — grava status, publishedAt, revisão, outbox e audit em transação |
| mudança apenas de status | **NÃO** — o evento é criado e o worker realmente entrega |
| eventos inexistentes | **NÃO** — confirmei 2 linhas em `outbox_events` em banco vivo |
| outbox fake | **NÃO** — `FOR UPDATE SKIP LOCKED`, lock de 60s, `available_at`, `attempts`, `last_error` |
| webhook fake | **NÃO** — HMAC-SHA256 real, `timingSafeEqual` na verificação; o fixture rejeita assinatura inválida com 401 (testado) |
| revalidation fake | **NÃO** — e2e prova: publish → outbox → webhook assinado → fixture troca 404 por 200 com `cached: true` |

**Publicação duplicada e retry:** testados. `dispatcher.test.ts` (5 testes) cobre retry/backoff, dead-letter e "marca como published quando não há assinantes". `idempotency.test.ts` (5 testes) cobre replay com advisory lock e conflito por reuso de chave com corpo diferente.

---

## ETAPA 12 — MN26 / MNSCR

| contrato | existe? | como |
|---|---|---|
| POST article | **SIM** | `POST /v1/sites/:siteId/articles` + `KalElClient.createArticle()` |
| UPDATE article | **SIM** | `PATCH …/articles/:id` + `updateArticle()` com If-Match |
| SUBMIT | **NÃO** | não há transição para `in_review` |
| SCHEDULE | **SIM** | `POST …/schedule` + `scheduleArticle()` |
| PUBLISH | **SIM** | `POST …/publish` + `publishArticle()` |
| MEDIA | **NÃO** | nenhum endpoint; SDK não tem método de mídia |
| TAXONOMY | **SIM** | categories/tags/authors/sources/entities + métodos no SDK |
| ENTITY | **SIM (API)** / parcial no SDK | endpoint existe; `KalElClient` não expõe `createEntity` |

| requisito | status |
|---|---|
| service authentication | **REAL** — Bearer `ke_st.*`, hasheado, escopos, expiração, revogação |
| idempotency key | **REAL** — header `Idempotency-Key` + advisory lock + replay armazenado (TTL 24h) |
| external key | **REAL** — `articles.external_key`, único por site; re-envio retorna o existente com `created: false` |
| provenance | **REAL** — jsonb `{system, sources[{provider, externalId, externalUrl}]}` validado |
| retries | **REAL** — SDK: 2 tentativas, backoff exponencial, só em 408/429/5xx; chave de idempotência determinística por (método, path, body) |
| duplicate protection | **REAL** — três camadas: external_key, Idempotency-Key, e publish idempotente |
| OpenAPI | **REAL** — gerado dos schemas zod, servido em `/docs` |

Prova executada de ponta a ponta: `apps/fixture/tests/e2e.test.ts` — SDK autenticado por service token cria artigo, publica, o worker entrega webhook assinado, o fixture revalida o cache (404 → 200). E rejeita entrega com assinatura falsa (401).

### Pergunta obrigatória

> **Eu conseguiria hoje trocar o destino WordPress do MN26 pela API do Kal El sem criar manualmente a arquitetura fundamental que está faltando?**

**NÃO.**

O caminho de texto funciona. O que falta é bloqueante para um portal de notícias real:

1. **Mídia — P0.** MN26 publica matérias com imagem. Não há upload, não há storage, não há como definir featured image. Toda matéria chegaria sem imagem.
2. **Formatação inline — P0.** Sem bold/itálico/link no modelo. Todo texto do MN26 chegaria como parágrafos planos; links internos e externos seriam perdidos na conversão.
3. **RBAC do bypass de publish — P0.** O token de serviço do MN26 com `articles.create` publica direto, ignorando qualquer regra editorial de aprovação.
4. **SUBMIT/review — P1.** Se o fluxo do MN26 previr revisão humana antes da publicação, não existe estado intermediário alcançável.
5. **Entity no SDK — P2.** Precisaria de chamada HTTP manual.
6. **Nenhum CMS — P1 operacional.** Qualquer correção editorial pós-publicação exigiria `curl` ou Swagger.

---

## ETAPA 13 — WORDPRESS / PAYLOAD

### WordPress → Kal El: **IMPORTADOR FUNCIONAL (parcial)**

Pipeline real de 5 etapas em `packages/importer`: `wordpress.ts` (normaliza snapshot da WP REST API) → `html.ts` (HTML → nós intermediários) → `dryrun.ts` (validação sem escrita) → `import.ts` (importa **pela API REST pública**, nunca direto no PostgreSQL) → `reconcile.ts`.

Qualidades reais: idempotente por `externalKey = wp:post:{id}`, cria hierarquia de categorias (pais primeiro), preserva status e datas originais, importa redirects, gera relatório com contagens e warnings. Coberto por 8 testes, incluindo um teste de integração que importa um snapshot e verifica que a revalidação é emitida.

**Limitações graves confirmadas em código:**
- **Toda imagem é perdida.** `import.ts:105` cria `const urlToMediaId = new Map()` e **nunca o popula**. `finalizeDocument()` então descarta todo nó `image` com warning `"media not imported"` e toda `gallery` com `"gallery dropped: no media imported"`. Uma migração do Máquina Nerd chegaria sem nenhuma imagem.
- **Toda formatação inline é achatada** (consequência do modelo de documento sem marks): negrito, itálico e **todos os links** do conteúdo WordPress são perdidos.

### Payload → Kal El: **PARSER / FRAMEWORK, não importador**

`packages/importer/src/payload.ts` — `PayloadAdapter` com `fieldMap` configurável. Faz parsing real de uma forma JSON documentada, mas:
- **descarta relações**: `authorExternalIds: []`, `categoryExternalIds: []`, `tagExternalIds: []` são hardcoded como vazios (linhas 118-120);
- espera `content` como **HTML string**, enquanto Payload tipicamente exporta richtext **Lexical JSON** — o campo não seria interpretável sem conversor;
- `externalUrl: ""` fixo;
- **não há teste** cobrindo o adapter Payload (os 8 testes do importer são de WordPress/HTML).

Classificação por camada:

```text
documentação:            ADR-0006 + docs/06-MIGRATION.md — REAL
interface (CLI/UI):      NÃO EXISTE para nenhum dos dois
stub:                    —
parser:                  WordPress REAL · Payload REAL mas incompleto
importador funcional:    WordPress SIM (sem mídia, sem inline) · Payload NÃO
```

Nenhuma migração foi executada contra produção.

---

## ETAPA 14 — PEG DESIGN SYSTEM

O contrato (`design-system/`) é extenso: 8 especificações, `design-tokens.css`/`.json`, 20 imagens de referência, `SHA256SUMS.txt`, `ACCEPTANCE_CHECKLIST.md`, `VISUAL_QA.md`.

### Conformidade token a token

```text
tokens no contrato (design-tokens.css):              47
tokens na implementação (packages/design-system/src/tokens.css): 75
tokens do contrato AUSENTES na implementação:        0   ✅
```

Verificado com `comm -23` sobre os nomes ordenados: a implementação é um **superconjunto exato** do contrato. Nenhuma divergência de nomenclatura.

| item | conformidade | observação |
|---|---|---|
| tokens | **CONFORME** | 47/47 presentes |
| typography | **CONFORME** (após correção) | o HEAD atual é justamente `fix(design-system): valid font shorthand tokens (broke all typography)` — havia um bug que quebrava toda a tipografia |
| sidebar | **IMPLEMENTADO** | `Shell.tsx` — `Sidebar` com grupos, labels, badges, footer |
| compact rail | **IMPLEMENTADO** | `Rail` |
| topbar | **IMPLEMENTADO** | `Topbar` (left/center/right) |
| workspace | **IMPLEMENTADO** | `Workspace`, `Content`, `AppLayout` |
| inspector | **IMPLEMENTADO** | `Inspector`, `InspectorGroup` |
| density | **IMPLEMENTADO** | tokens de espaçamento + tabela densa |
| borders | **IMPLEMENTADO** | tokens `--peg-border*` |
| shadows | **IMPLEMENTADO** | tokens de sombra |
| radius | **IMPLEMENTADO** | tokens de raio |
| accent | **IMPLEMENTADO** | tokens de accent |
| tables | **IMPLEMENTADO** | `Table` com colunas render, avatar, status, kebab |
| buttons | **IMPLEMENTADO** | 4 variantes × 3 tamanhos + iconOnly + disabled |
| inputs | **IMPLEMENTADO** | Input/Select/Textarea/Checkbox/Radio/Switch/Search com label, hint, error |
| menus | **IMPLEMENTADO** | `Menu` com separador e item danger; `AccountSwitcher` |
| overlays | **IMPLEMENTADO** | `Modal`, `Toast`, `Alert` |
| editor | **VISUAL APENAS** | `contentEditable={false}` |
| responsive | **PARCIAL** | screenshots mobile existem; sem teste de viewport |
| dark mode | **IMPLEMENTADO** | `[data-theme="dark"]` em `tokens.css:76`; toggle no harness |

### Calibration Screen

> **Existe Calibration Screen real?** **SIM.**

`packages/design-system/dev/main.tsx` implementa a tela-laboratório e existem 4 screenshots capturados em `docs/progress/calibration-shots/`: `desktop-light.png`, `desktop-dark.png`, `mobile-light.png`, `mobile-dark.png`.

Comparando com a lista exigida em `05_CALIBRATION_SCREEN.md`, estão presentes: full sidebar, compact rail, topbar, breadcrumb, page title, botões primário/secundário/terciário/destrutivo, input/search/select/checkbox/radio/switch, tabs + segmented control, KPI card, card genérico, tabela densa com avatar/status/kebab, pagination, menu de contexto aberto, account switcher aberto, modal, editor surface com inline toolbar, inspector contextual, toast/alert, empty state, light e dark.

### Divergências classificadas

| # | divergência | severidade |
|---|---|---|
| DS-1 | Nenhuma aplicação consome o design system. `packages/design-system` só é importado pelo próprio harness — o CMS que ele deveria vestir não existe. | **P0** |
| DS-2 | O gate visual P0/P1 do `ACCEPTANCE_CHECKLIST.md` **nunca foi executado**. `docs/FINAL-REPORT.md:74-80` admite: "The P0/P1/P2 classification is pending an image-capable review". Screenshots existem, avaliação não. | **P1** |
| DS-3 | Editor é a peça central do contrato (`02_COMPONENTS.md`, `04_PATTERNS.md`) e está entregue como `contentEditable={false}`. | **P1** |
| DS-4 | Responsividade sem verificação automatizada; só 5 testes de primitivo (`primitives.test.tsx`), nenhum de layout/shell. | **P2** |
| DS-5 | `20_COMMERCE_WAYNE_UI.md` faz parte do contrato mas está fora do escopo do Kal El — ruído de especificação. | **P2** |

Nenhuma correção foi feita nesta auditoria.

---

## ETAPA 15 — FRONTEND ↔ BACKEND

O fluxo canônico é **interrompido no primeiro salto** em todas as operações:

```text
CONTRATO:  UI → client → HTTP → API → service → repository → PostgreSQL
REALIDADE: UI → (nada). Não há client, não há HTTP.
```

Rastreamento das 5 operações exigidas:

| operação | UI | client | HTTP | API | service | persistência | veredito |
|---|---|---|---|---|---|---|---|
| **criar artigo** | botão "Novo artigo" (`dev/main.tsx:200`) — **sem onClick** | ✗ | ✗ | `POST /v1/sites/:id/articles` ✓ | `createArticle()` ✓ | tx: articles + revisão + outbox + audit ✓ | **quebrado na UI; REAL da API para baixo** |
| **editar artigo** | inputs do inspector — **sem binding** | ✗ | ✗ | `PATCH …/articles/:id` ✓ | `updateArticle()` ✓ (If-Match, revisão, 301 de slug) | ✓ | **quebrado na UI; REAL da API para baixo** |
| **upload mídia** | item "Mídia" na sidebar — **sem destino** | ✗ | ✗ | **404 — não existe** | **inexistente** | **inexistente** | **NÃO IMPLEMENTADO em nenhuma camada** |
| **publicar** | modal "Publicar agora" (`dev/main.tsx:402`) — **sem onClick** | ✗ | ✗ | `POST …/publish` ✓ | `publishArticle()` ✓ | tx + outbox + audit ✓ | **quebrado na UI; REAL da API para baixo** |
| **criar usuário** | nenhuma tela | ✗ | ✗ | `POST /v1/admin/users` ✓ | `createUser()` ✓ (Argon2id) | ✓ | **sem UI; REAL da API para baixo** |

**Nenhuma operação "pula a API e usa mock"** — porque nenhuma operação de UI existe. Os dados na tela são literais estáticos (Etapa 4), não mocks de um cliente.

Confirmei a metade funcional executando as 4 operações viáveis diretamente por HTTP contra PostgreSQL real (ver Etapa 17).

---

## ETAPA 16 — TESTES

Todos os gates executados no worktree do produto, em `feat/foundation-phase-1-3`.

| COMANDO | RESULTADO | TESTES | PASS | FAIL | SKIP |
|---|---|---|---|---|---|
| `pnpm -r typecheck` | **PASS** (exit 0) | 12 de 13 projetos | — | — | — |
| `pnpm -r lint` | **PASS** (exit 0) | 12 de 13 projetos | — | — | — |
| `pnpm -r build` | **PASS** (exit 0) | api 73.33 KB, worker 9.44 KB, fixture 1.71 KB | — | — | — |
| `pnpm -r test` | **PASS** (exit 0) | **87** | **87** | **0** | **0** |

Detalhamento por pacote:

| pacote | arquivos | testes | resultado |
|---|---|---|---|
| contracts | 1 | 9 | pass |
| design-system | 1 | 5 | pass |
| sdk | 1 | 5 | pass |
| editor | 1 | 6 | pass |
| db | 2 | 8 | pass |
| auth | 1 | 5 | pass |
| worker | 2 | 8 | pass |
| api | 6 | 31 | pass |
| fixture | 1 | 2 | pass |
| importer | 3 | 8 | pass |
| **TOTAL** | **19** | **87** | **87 pass, 0 fail, 0 skip** |

**Nenhum teste skipped. Nenhum `.skip`, `.todo` ou `xit` no repositório.**

### Os testes validam comportamento real ou mocks?

**Comportamento real, em grau incomum.** Verifiquei os arquivos:

- `packages/testkit` inicia um **PostgreSQL embutido real** em porta livre (`freshTestDb()`), aplica as migrations reais e devolve uma conexão real. Não há banco em memória, não há mock de ORM.
- `isolation.test.ts` — usuários, papéis, permissões e sessões reais; asserções em códigos HTTP e no conteúdo retornado.
- `e2e.test.ts` — sobe a API **em porta TCP real**, sobe o fixture em outra, usa o SDK por HTTP de verdade, roda o dispatcher de verdade, e verifica a troca de 404→200 no cache do fixture.
- `migration.test.ts` — aplica down e re-up de verdade.
- `backup.test.ts` — restaura num banco limpo e compara conteúdo.
- Único uso legítimo de dublê: `fetchImpl` injetado em `dispatcher.test.ts`/`client.test.ts` para simular falhas HTTP e testar retry — o que é a forma correta de testar backoff.

### Testes suspeitos investigados

| suspeita | conclusão |
|---|---|
| "80 testes" no `docs/FINAL-REPORT.md:65` | **desatualizado, não fraudulento** — o real é 87 (o pacote `editor` com 6 testes veio depois) |
| `packages/events` e `packages/testkit` sem script `test` | **lacuna real (P2)**: `events` contém a verificação de assinatura HMAC — código de segurança sem teste próprio (é exercitado indiretamente no e2e) |
| "close timed out after 10000ms" em 5 pacotes | **cosmético, não falha** — o processo filho do PostgreSQL embutido no Windows; exit code 0 em todos. `FINAL-REPORT.md:112-113` já documenta |
| `DeprecationWarning` do `pg` | ruído, não falha |

**Lacuna de cobertura mais importante:** nenhum teste cobre o bypass de publicação da Etapa 8. Existem 6 testes de isolamento, mas nenhum verifica que `POST /articles {"status":"published"}` deveria exigir `articles.publish`.

---

## ETAPA 17 — BUILD E EXECUÇÃO

| componente | compila | inicializa | prova |
|---|---|---|---|
| **CMS** | — | — | **não existe** |
| **API** | SIM (`dist/server.js`, 73.33 KB) | **SIM — verificado ao vivo** | ver abaixo |
| **Worker** | SIM (`dist/worker.js`, 9.44 KB) | SIM (8 testes de integração o executam contra PostgreSQL real) | `dispatcher.test.ts`, `scheduler.test.ts` |
| Fixture | SIM (1.71 KB) | SIM | `e2e.test.ts` |
| Harness DS | SIM (Vite) | SIM (`pnpm dev:site`) | é a tela que foi vista |

### Execução real da API (evidência primária)

```text
$ pnpm dev:api
[dev] embedded postgres on postgresql://kalel:kalel@localhost:64469/kalel_test
[dev] migrations applied
[dev] bootstrap -> HTTP 201
[dev] API on http://localhost:3001
[dev] OpenAPI/Swagger: http://localhost:3001/docs

GET /v1/health  -> {"status":"ok"}
GET /v1/ready   -> {"status":"ready"}
```

Ciclo editorial completo contra PostgreSQL real:

```text
1. POST /v1/auth/login                          -> HTTP 200  (cookies ke_session + ke_csrf)
2. GET  /v1/admin/sites                         -> HTTP 200  (site "portal-a")
3. POST /v1/sites/:id/articles                  -> HTTP 201  status=draft version=0 nodes=2
4. GET  /v1/sites/:id/articles/:id/revisions    -> HTTP 200  revisions=1
5. POST /v1/sites/:id/articles/:id/publish      -> HTTP 200  status=published
                                                             publishedAt=2026-08-17T12:56:15.631Z
6. GET  /v1/sites/:id/articles/:id              -> HTTP 200  documento íntegro:
   [{"type":"paragraph","attrs":{},"content":"Primeiro paragrafo real."},
    {"type":"heading","attrs":{"level":2},"content":"Uma secao"}]
```

Estado do banco após o ciclo:

```text
information_schema.tables (public) -> 26
articles by status                 -> published: 2 | draft: 1
outbox_events                      -> 2 × article.published (pending)
media                              -> 0
audit_log (articles)               -> 5 entradas (create/publish/update/create/create)
```

**Erros reais encontrados na execução:** nenhum erro de runtime. Todos os processos foram encerrados; confirmei que a instância embutida (porta 64469) foi finalizada e que o serviço PostgreSQL 17 próprio da máquina (porta 5432) segue **Running** e intacto.

---

## ETAPA 18 — SEGURANÇA

**Nenhum valor de secret foi impresso nesta auditoria.**

| área | achado | severidade |
|---|---|---|
| **RBAC** | **Bypass de publicação**: `articles.create` permite criar com `status:"published"` e `publishedAt` arbitrário, disparando revalidação nos frontends. Confirmado em execução. | **P0** |
| **Site isolation** | `deleteRedirect` apaga a linha antes de validar `site_id` — destrói dado de outro site e retorna 404 enganoso. | **P1** |
| **Workflow** | `status` descartado silenciosamente no PATCH (zod strip); cliente recebe 200 achando que transicionou. Perda silenciosa de dados. | **P1** |
| **secrets** | Nenhum secret no código-fonte. `.env.example` só com placeholders. `.gitignore` cobre `.env`, `.env.*`, `secrets/`, `*.pem`, `*.key`, `*.p12`, `*.pfx`. gitleaks no CI. | **OK** |
| **.env** | `.env.example` documenta `MEDIA_STORAGE_PROVIDER` e `MEDIA_LOCAL_PATH` que **nenhum código lê** — configuração fantasma. | **P3** |
| **auth** | Argon2id; tokens opacos armazenados hasheados; sessões com expiração; rate limit no login (10/min) e global (600/min); helmet com HSTS/nosniff/X-Frame-Options confirmados na resposta. | **OK** |
| **CSRF** | Double-submit real: cookie legível + header `x-kal-el-csrf` obrigatório em não-GET, comparado por hash contra a sessão. Verifiquei: POST sem header → 403. | **OK** |
| **CORS** | `origin: true, credentials: true` reflete **qualquer** origem (`https://evil.example.com` foi refletida com `allow-credentials: true`). Mitigado por `SameSite=Lax`, que impede o envio do cookie em fetch cross-site — por isso não é P0. Mas é configuração permissiva demais para produção e remove uma camada de defesa. | **P2** |
| **COOKIE_SECURE** | Default `false`, sem guarda para `NODE_ENV=production`. Um deploy que esqueça a variável trafega o cookie de sessão em claro. | **P1** |
| **SESSION_SECRET** | Default `"development-only-secret"`, sem guarda de produção — **porém a variável nunca é usada em nenhum lugar** do código (cookies são tokens opacos aleatórios, não assinados). Risco real nulo; é configuração morta e enganosa. | **P3** |
| **XSS** | Modelo de documento é JSON tipado com whitelist de nós; `content` é string plana (sem HTML). O importer usa `html.ts` que descarta tags desconhecidas. Sem UI, superfície de XSS praticamente inexistente hoje. Risco reaparecerá quando houver renderização. | **OK (hoje)** |
| **arbitrary HTML** | Nenhum caminho armazena HTML cru. `httpUrlSchema` restringe embeds/sources a `http(s)`. | **OK** |
| **SQL injection** | Drizzle parametrizado; `sql` template usado só com bind params (advisory lock, cursor). Advisory da drizzle-orm já corrigido por upgrade (documentado em `FINAL-REPORT.md:84`). | **OK** |
| **SSRF** | O worker faz POST para URLs de webhook cadastradas por quem tem `tokens.manage`. Sem allowlist ou bloqueio de IP privado — um admin poderia apontar webhooks para `169.254.169.254` ou rede interna. Requer privilégio alto, mas é um vetor real. | **P2** |
| **uploads** | Nenhum upload existe → nenhuma superfície de upload. Quando implementado, exigirá validação de MIME/tamanho/conteúdo. | **N/A hoje** |
| **service tokens** | Hasheados, escopados por site, revogáveis, com expiração e `last_used_at`. Segredo retornado uma única vez. | **OK** |
| **webhook validation** | HMAC-SHA256 com `timingSafeEqual` e checagem de comprimento. Fixture rejeita assinatura inválida (testado, 401). | **OK** |
| **/docs exposto** | Swagger UI servido **sem autenticação**. Expõe o mapa completo da API. Não expõe dados. | **P2** |
| **bootstrap** | Duplamente guardado: exige `X-Bootstrap-Token` **e** que a tabela `users` esteja vazia. | **OK** |
| **dependências** | `pnpm audit --prod --audit-level high` no CI; `FINAL-REPORT.md` registra 0 vulnerabilidades conhecidas após upgrades de drizzle-orm e @fastify/static. | **OK** |

---

## ETAPA 19 — O QUE É PRODUTO E O QUE É DEMONSTRAÇÃO

| Área | Visual existe | Backend existe | PostgreSQL real | Funciona ponta a ponta | Demo/Mock | Status |
|---|---|---|---|---|---|---|
| Login | NÃO | SIM | SIM | NÃO (sem UI) | — | **BACKEND REAL, SEM UI** |
| Dashboard | SIM (KPIs) | NÃO | NÃO | NÃO | **HARDCODED** | **DEMO** |
| Articles | SIM (5 linhas) | SIM | SIM | NÃO (sem UI) | **HARDCODED** | **BACKEND REAL + UI DEMO** |
| Editor | SIM (não-editável) | SIM (documento jsonb) | SIM | NÃO | **HARDCODED** | **VISUAL APENAS** |
| Media | SIM (ícone) | **NÃO** | tabela vazia, 0 INSERT | NÃO | — | **NÃO IMPLEMENTADO** |
| Categories | SIM (options) | SIM | SIM | NÃO (sem UI) | **HARDCODED** | **BACKEND REAL + UI DEMO** |
| Tags | SIM (menu) | SIM | SIM | NÃO (sem UI) | — | **BACKEND REAL, SEM UI** |
| Entities | NÃO | SIM | SIM | NÃO (sem UI) | — | **BACKEND REAL, SEM UI** |
| SEO | SIM (2 inputs) | SIM | SIM | NÃO (sem UI) | **HARDCODED** | **BACKEND REAL + UI DEMO** |
| Workflow | SIM (menu) | **PARCIAL** | status persiste, transições faltam | NÃO | — | **PARCIAL / QUEBRADO** |
| Scheduling | SIM (menu) | SIM | SIM | NÃO (sem UI) | — | **BACKEND REAL, SEM UI** |
| Users | SIM (menu) | SIM | SIM | NÃO (sem UI) | — | **BACKEND REAL, SEM UI** |
| RBAC | NÃO | SIM | SIM | **SIM (com bypass P0)** | — | **REAL MAS QUEBRADO** |
| Multi-site | SIM (switcher) | SIM | SIM | SIM (API) | **HARDCODED** | **BACKEND REAL + UI DEMO** |
| Audit | NÃO | SIM | SIM | SIM (API) | — | **REAL** |
| MN26 API | NÃO | SIM | SIM | **SIM (e2e provado)** | — | **REAL** (sem mídia/inline) |
| WordPress importer | NÃO | SIM | SIM | SIM (sem mídia/inline) | — | **PARCIAL** |
| Payload importer | NÃO | PARCIAL | — | NÃO | — | **PARSER APENAS** |
| Revalidation | NÃO | SIM | SIM | **SIM (e2e provado)** | — | **REAL** |

---

## ETAPA 20 — COMPARAÇÃO COM A ARQUITETURA ORIGINAL

Base: `AGENTS.md`, `README.md`, `docs/00`–`12`, `docs/10-ACCEPTANCE-CRITERIA.md`, `prompts/00-MASTER-ORCHESTRATOR.md`, `design-system/`.

| Requisito original | Esperado | Implementado | Evidência | Status |
|---|---|---|---|---|
| Monorepo pnpm + TS strict | workspace, CI, ADRs | sim | `pnpm-workspace.yaml`, 12 pacotes, CI com 7 gates, 7 ADRs | **DONE** |
| PostgreSQL único datastore | sem outro banco | sim | 26 tabelas, 1 migration, nenhum outro datastore | **DONE** |
| REST /v1 canônico + OpenAPI | contrato servido | sim | 38 endpoints; OpenAPI em `/docs` | **DONE** |
| Frontends nunca tocam PostgreSQL | só via API | sim | importer usa SDK/REST; fixture consome HTTP | **DONE** |
| Multi-site com isolamento | sites independentes | sim | `site_id` + índices únicos compostos + 6 testes negativos | **DONE** |
| Auth + sessões + service tokens | Argon2id, opacos, escopados | sim | `packages/auth` + 5 testes de segurança | **DONE** |
| RBAC por site | permissões efetivas por site | sim, **mas furado** | `getEffectivePermissions` real; bypass de publish confirmado ao vivo | **BROKEN** |
| Audit log em toda escrita | trilha completa | sim | `writeAudit` em todos os services; 5 entradas confirmadas em banco | **DONE** |
| Idempotência para retry | exactly-once | sim | advisory lock + replay + external_key; 5 testes | **DONE** |
| Outbox + webhooks assinados | entrega confiável | sim | SKIP LOCKED, HMAC, retry, dead-letter; 8 testes | **DONE** |
| Revalidação nos frontends | evento → cache | sim | e2e: 404 → 200 `cached:true` | **DONE** |
| Publicação + agendamento | ciclo completo | sim (API) | endpoints + worker promotor; verificado ao vivo | **DONE** |
| Revisões de artigo | versionamento | sim | `article_revisions` + endpoint; 1 revisão confirmada | **DONE** |
| Taxonomia (cat/tag/entity/author/source) | CRUD | **parcial** — só create+list | nenhum PATCH/DELETE de taxonomia | **PARTIAL** |
| SEO editorial | slug, meta, canonical, robots, redirects | sim | jsonb `seo` + 301 automático; 3 testes | **DONE** |
| **Editor document-first** | escrita contínua, H2–H4, listas, quotes, embeds | **NÃO** | protótipo headless não usado + `contentEditable={false}` | **NOT IMPLEMENTED** |
| **Formatação inline (bold/itálico/link)** | conteúdo editorial rico | **NÃO** | `content: z.string()` — sem marks no modelo | **NOT IMPLEMENTED** |
| **Media library + StorageProvider** | upload, alt, caption, focal, featured | **NÃO** | 0 endpoints, 0 INSERT, 0 linhas | **NOT IMPLEMENTED** |
| **CMS UI (apps/cms)** | inventário completo de telas | **NÃO** | `apps/` = api, fixture, worker | **NOT IMPLEMENTED** |
| **Workflow editorial (submit/review/approve)** | fluxo com aprovação | **NÃO** | `in_review`/`blocked` inalcançáveis; status descartado no PATCH | **BROKEN** |
| **Preview seguro** | pré-visualização | **NÃO** | rota → 404 | **NOT IMPLEMENTED** |
| **Autosave + recovery** | não perder texto | **NÃO** | nenhuma ocorrência | **NOT IMPLEMENTED** |
| **Diff de revisões** | comparar versões | **NÃO** | nenhuma ocorrência | **NOT IMPLEMENTED** |
| Dashboard / Analytics | métricas editoriais | **NÃO** | KPIs hardcoded no harness | **FAKE/MOCK** |
| WordPress importer | migração real | parcial | pipeline real, **toda mídia e inline perdidos** | **PARTIAL** |
| Payload importer | migração real | parcial | parser sem relações, sem teste, espera HTML | **PARTIAL** |
| PEG design system | tokens + primitivos + shells | sim | 47/47 tokens, 9 módulos de componentes, dark mode | **DONE** |
| Calibration screen | tela-laboratório + screenshots | sim | `dev/main.tsx` + 4 PNGs | **DONE** |
| **Gate visual P0/P1 do PEG** | avaliação assinada | **NÃO** | `FINAL-REPORT.md:74-80` admite pendência | **NOT IMPLEMENTED** |
| Backup/restore | rotina ensaiada | sim | `backup.ts` + CLI + 3 testes | **DONE** |
| Deploy (Docker/compose) | imagens + orquestração | sim (api/worker/db) | 2 Dockerfiles + compose prod; **sem serviço de CMS** | **PARTIAL** |
| CI com gates | lint/type/test/build/audit/secrets | sim | `.github/workflows/ci.yml`, 7 passos | **DONE** |

Não uso percentuais: 20 requisitos **DONE**, 6 **PARTIAL**, 8 **NOT IMPLEMENTED**, 2 **BROKEN**, 1 **FAKE/MOCK**.

---

## ETAPA 21 — VEREDITO

### 1. O Kal El hoje é:

> ## **B — Frontend funcional com backend incompleto**
>
> **com uma ressalva importante: os dois lados estão invertidos em relação ao rótulo.**

A opção B é a que mais se aproxima, mas preciso ser exato, porque nenhuma das letras descreve bem esta situação. O que existe é:

**Um backend editorial genuinamente forte e testado, sem nenhum frontend, e com três lacunas que impedem uso editorial real (mídia, formatação inline, RBAC de publicação).**

Justificativa com evidência:

- **O backend não é incompleto no sentido de "raso"** — é substancialmente melhor do que a média: 38 endpoints reais, 26 tabelas com FK e índices compostos, transações corretas, optimistic locking por `If-Match`, idempotência com advisory lock, outbox com `SKIP LOCKED`, webhooks HMAC com retry e dead-letter, audit em toda escrita, isolamento multi-site provado por teste negativo, 87 testes contra PostgreSQL real, CI com 7 gates. Isso é trabalho de qualidade.
- **O "frontend funcional" não existe.** Não há `apps/cms`, não há Next.js, não há roteador, não há um único `fetch`. O que foi visto preenchido é uma galeria de componentes de 421 linhas com dados literais.
- **Por isso não é C (MVP parcialmente funcional):** um MVP de CMS pressupõe que alguém consiga escrever e publicar uma matéria pela ferramenta. Ninguém consegue — não há ferramenta.
- **E não é A (protótipo visual):** seria injusto e falso. Um protótipo visual não tem 87 testes de integração contra Postgres, nem entrega webhook assinado com exactly-once comprovado em e2e.

Se eu pudesse escrever a alternativa, seria: *"API editorial madura (pré-RC) + protótipo visual desconectado, com 3 bloqueadores P0"*.

### 2. Quanto do que aparece preenchido é:

```text
BANCO REAL:  0%    — nenhum dado da tela vem do PostgreSQL (não há conexão)
SEED:        0%    — não existe seed de conteúdo no repositório
MOCK:        0%    — não há MSW, faker, fixture de frontend ou fake API
HARDCODED:   100%  — literais TS/JSX em packages/design-system/dev/main.tsx (421 linhas)
                     e src/components/Editor.tsx
```

Isto é medido, não estimado: `grep` por `fetch|axios|useQuery|swr` em `packages/design-system/` retorna **zero ocorrências**.

### 3. Se eu remover todos os dados demo hoje, o CMS continua utilizável?

> ## **NÃO**

Não porque os dados sejam necessários, mas porque **não há CMS para continuar utilizável**. Removidos os literais do `dev/main.tsx`, resta uma galeria de componentes vazia. A API, essa sim, continua plenamente utilizável — ela nunca dependeu de dado demo algum.

### 4. Consigo criar um portal vazio e operar o CMS do zero?

> ## **NÃO** (pelo CMS) — **SIM** (pela API)

Verificado ao vivo: PostgreSQL vazio → migrations → `seedPermissions` → `POST /v1/bootstrap/init` → login → criar site adicional → criar usuário → criar papel → atribuir papel → criar/publicar artigo. Tudo funcionou.
Mas "operar o CMS" no sentido do produto exige uma interface que não existe. E mídia é impossível em qualquer caminho.

### 5. Consigo criar e publicar uma matéria manualmente ponta a ponta?

> ## **NÃO**

Pela API, provei o ciclo texto-somente: criar → revisão → publicar → reler → evento de revalidação enfileirado.
Mas "manualmente" e "matéria" no sentido editorial falham em três pontos: **não há tela de escrita**, **não há como anexar uma imagem** (nem por API), e **não há como colocar um link ou negrito no texto** (o modelo de dados não suporta).

### 6. MN26 pode publicar nele hoje?

> ## **NÃO**

Tecnicamente o caminho de serviço funciona e está provado por e2e (service token → SDK → create → publish → outbox → webhook assinado → revalidação, idempotente). Mas as matérias chegariam **sem imagens** e **sem nenhum link ou formatação**, e o token com `articles.create` **publica direto ignorando o RBAC**. Não é aceitável para um portal em produção.

### 7. Está pronto para substituir Payload no Cinerie?

> ## **NÃO**

O importador Payload é um parser incompleto: descarta autores, categorias e tags; espera `content` em HTML quando Payload exporta Lexical JSON; não tem nenhum teste. Somado à ausência de CMS e de mídia, a substituição não é viável.

### 8. Está pronto para substituir WordPress no Máquina Nerd?

> ## **NÃO**

O pipeline WordPress é o mais maduro dos dois e é idempotente e testado. Mas uma migração hoje **perderia todas as imagens** (`urlToMediaId` nunca é populado; nós `image` e `gallery` são descartados com warning) e **todos os links e formatação inline**. Para um acervo de portal de notícias, isso é perda de dado inaceitável.

### 9. Está pronto para produção?

> ## **NÃO**

Três P0 bloqueiam: bypass de RBAC na publicação, ausência total de mídia, e ausência de formatação inline no modelo de conteúdo. Somados à inexistência do CMS e ao gate visual do PEG nunca executado.

---

## ETAPA 22 — GAP LIST REAL

### P0 — bloqueia produto

---

**P0-1 · Bypass de RBAC: `articles.create` permite publicar**

- **PROBLEMA:** Um ator com apenas `articles.create` cria artigo com `status:"published"` e `publishedAt` arbitrário. O artigo vai ao ar e emite `article.published` no outbox, revalidando os frontends. Permite também backdating.
- **EVIDÊNCIA:** Executado ao vivo. Papel "autor" com `articles.create`/`read`/`update` (sem `publish`): `POST …/publish` → 403; `POST /articles {"status":"published"}` → **201, status=published, publishedAt=2026-08-17T12:57:41.662Z**. Banco: `outbox_events` contém `article.published | pending | bypass-publish`.
- **ARQUIVOS:** `apps/api/src/routes/site.ts:77-101`, `apps/api/src/services/articles.ts:186-235`, `packages/contracts/src/editorial.ts:117-120`
- **COMPORTAMENTO ESPERADO:** `status:"published"`/`publishedAt` no create devem exigir `articles.publish`; `scheduled`/`scheduledAt` devem exigir `articles.schedule`. Sem a permissão: 403, ou rebaixamento explícito para `draft`.
- **DEPENDÊNCIAS:** nenhuma.
- **COMO VALIDAR DEPOIS:** teste de integração — papel sem `articles.publish` faz `POST /articles {"status":"published"}` → espera 403; e assertar que **nenhum** evento `article.published` foi criado.

---

**P0-2 · Mídia inexistente de ponta a ponta**

- **PROBLEMA:** Não há upload, storage, endpoint, nem um único INSERT na tabela `media`. Featured image e galeria são inalcançáveis. Um CMS editorial sem imagem não é utilizável.
- **EVIDÊNCIA:** `grep` por `multipart|upload|StorageProvider|sharp|s3|r2` retorna 4 ocorrências, todas inertes (2 nomes de coluna, 1 path SVG, 1 comentário "deferred until Phase 5"). HTTP: `GET`/`POST /v1/sites/:id/media` → 404. SQL: `select count(*) from media` → 0.
- **ARQUIVOS:** ausente em `apps/api/src/routes/` e `services/`; `packages/db/src/schema/media.ts` (schema pronto, sem uso); `packages/contracts/src/media.ts` (schema pronto, sem uso); `.env.example:12-13` (config fantasma).
- **COMPORTAMENTO ESPERADO:** `POST /v1/sites/:siteId/media` multipart com validação de MIME/tamanho, extração de dimensões, `StorageProvider` abstrato (local primeiro, interface para R2/S3), registro em `media`, URL servível, e CRUD de alt/caption/credit/focal point.
- **DEPENDÊNCIAS:** decisão de storage (local vs R2) — `docs/11-OPEN-DECISIONS.md`.
- **COMO VALIDAR DEPOIS:** teste de integração: upload de PNG real → 201 com id/URL; `select count(*) from media` = 1; referenciar o id num nó `image` de artigo → aceito; `GET` da URL → 200 com o byte-content correto.

---

**P0-3 · Modelo de documento sem formatação inline**

- **PROBLEMA:** `paragraph` e `heading` têm `content: z.string()` — string plana. Não existem marks nem nós inline. **Negrito, itálico e links dentro do texto são estruturalmente impossíveis de armazenar.** Isso invalida links internos (SEO), citações de fonte no texto e qualquer conteúdo editorial minimamente rico.
- **EVIDÊNCIA:** `packages/contracts/src/editorial.ts:36-38`. `buildTiptapSchema()` cria `new Schema({ nodes: {…} })` **sem chave `marks`** (`packages/editor/src/tiptap.ts:37-39`). O botão 🔗 em `Editor.tsx:65` é decorativo. `docs/FINAL-REPORT.md:106-107` reconhece.
- **ARQUIVOS:** `packages/contracts/src/editorial.ts:33-70`, `packages/editor/src/tiptap.ts`, `packages/importer/src/html.ts`
- **COMPORTAMENTO ESPERADO:** documento v2 com marks (`bold`, `italic`, `link`, `code`) e nós inline; `content` como array de nós de texto com marks; conversores e importer preservando-os.
- **DEPENDÊNCIAS:** decide o formato antes de construir o editor (P1-1) — refazer depois custaria migration de todo o acervo.
- **COMO VALIDAR DEPOIS:** round-trip: documento com `<p>texto <strong>negrito</strong> e <a href="…">link</a></p>` → persistir → reler → marks e href intactos; importer WordPress preservando links.

---

**P0-4 · CMS não existe**

- **PROBLEMA:** Não há `apps/cms`. O produto — a ferramenta que jornalistas usariam — não foi construído. As 21 telas do inventário: 0 funcionais.
- **EVIDÊNCIA:** `ls apps/` → `api fixture worker`. Nenhuma dependência `next`/`react-router`/`@tanstack/react-query` em nenhum `package.json`. Zero `fetch` em `packages/design-system`. `docker-compose.prod.yml` não tem serviço de CMS.
- **ARQUIVOS:** ausente. Base disponível: `packages/design-system/src/*` (primitivos reais), `packages/contracts` (tipos), `packages/sdk` (cliente).
- **COMPORTAMENTO ESPERADO:** aplicação (Next.js, conforme `FINAL-REPORT.md:28`) consumindo `/v1` com sessão + CSRF, cobrindo login, dashboard, lista de artigos, editor, mídia, taxonomia, usuários, RBAC, audit, settings.
- **DEPENDÊNCIAS:** P0-2 (mídia) e P0-3 (documento) devem ser decididos antes do editor; DS-2 (gate visual) antes de expandir telas.
- **COMO VALIDAR DEPOIS:** e2e Playwright: login pela UI → criar artigo → escrever com negrito e link → anexar imagem → salvar → fechar e reabrir o navegador → conteúdo íntegro → publicar → artigo publicado na API.

---

### P1 — necessário para MVP

---

**P1-1 · Editor não é editável**

- **PROBLEMA:** `EditorSurface` é `<div contentEditable={false}>` com texto estático. `InlineToolbar` tem botões sem handler. O protótipo real (`packages/editor`) é headless e **nenhum código em runtime o importa**.
- **EVIDÊNCIA:** `packages/design-system/src/components/Editor.tsx:18`; nenhum import de `@kal-el/editor` fora dos seus próprios testes.
- **ARQUIVOS:** `packages/design-system/src/components/Editor.tsx`, `packages/editor/src/tiptap.ts`
- **COMPORTAMENTO ESPERADO:** editor TipTap real, ligado ao schema v2, com H2–H4, listas, quotes, embeds, tabelas, fontes, toolbar inline funcional e slash commands.
- **DEPENDÊNCIAS:** P0-3.
- **COMO VALIDAR DEPOIS:** teste de componente: digitar, aplicar negrito, inserir link → documento serializado contém as marks.

---

**P1-2 · Workflow editorial ausente + perda silenciosa de `status`**

- **PROBLEMA:** `in_review` e `blocked` existem no enum e são **inalcançáveis**. `updateArticleBodySchema` não tem `status`, e o zod o descarta em silêncio: o cliente recebe 200 e acredita ter transicionado.
- **EVIDÊNCIA:** `PATCH {"title":"…","status":"in_review"}` → **200**, título alterado, `status` permanece `published` sem qualquer aviso. Rotas `/submit` e `/approve` → 404.
- **ARQUIVOS:** `packages/contracts/src/editorial.ts:123-139`, `apps/api/src/services/articles.ts:299-318`, `apps/api/src/routes/site.ts:108-123`
- **COMPORTAMENTO ESPERADO:** transições explícitas (`/submit`, `/approve`, `/reject`) com permissões próprias e máquina de estados validada; e o PATCH deve **rejeitar** campos desconhecidos (zod `.strict()`) em vez de descartá-los.
- **DEPENDÊNCIAS:** nenhuma.
- **COMO VALIDAR DEPOIS:** autor faz `/submit` → `in_review`; autor tentando `/approve` → 403; editor-chefe `/approve` → publicável; `PATCH` com campo desconhecido → 400.

---

**P1-3 · `deleteRedirect` apaga dado de outro site**

- **PROBLEMA:** O `DELETE` não filtra por `site_id`. A linha é apagada e comitada; só depois valida o site e lança 404. Furo de isolamento com destruição de dado.
- **EVIDÊNCIA:** `apps/api/src/services/redirects.ts:44-48` — `db.delete(redirects).where(eq(redirects.id, redirectId))` sem `site_id`, seguido de `if (!row || row.siteId !== siteId) throw notFound(...)`.
- **ARQUIVOS:** `apps/api/src/services/redirects.ts:43-49`
- **COMPORTAMENTO ESPERADO:** `where(and(eq(id), eq(siteId)))` — nada apagado quando o site não corresponde.
- **DEPENDÊNCIAS:** nenhuma.
- **COMO VALIDAR DEPOIS:** criar redirect no site B; usuário do site A tenta deletá-lo → 404 **e** o redirect ainda existe em B.

---

**P1-4 · `COOKIE_SECURE` sem guarda de produção**

- **PROBLEMA:** Default `false`, sem validação contra `NODE_ENV=production`. Um deploy que esqueça a variável trafega o cookie de sessão em claro.
- **EVIDÊNCIA:** `apps/api/src/config.ts:12-16`; cookie observado ao vivo sem `Secure`: `ke_session=…; Path=/; HttpOnly; SameSite=Lax`.
- **ARQUIVOS:** `apps/api/src/config.ts`
- **COMPORTAMENTO ESPERADO:** falhar o boot se `NODE_ENV=production` e `COOKIE_SECURE !== true`.
- **DEPENDÊNCIAS:** nenhuma.
- **COMO VALIDAR DEPOIS:** `loadConfig({NODE_ENV:"production", COOKIE_SECURE:"false"})` → lança.

---

**P1-5 · Gate visual P0/P1 do PEG nunca executado**

- **PROBLEMA:** `ACCEPTANCE_CHECKLIST.md` e `AGENTS.md` proíbem expandir a UI antes de uma avaliação visual sem P0/P1. Ela nunca foi feita.
- **EVIDÊNCIA:** `docs/FINAL-REPORT.md:74-80` — "The P0/P1/P2 classification is pending an image-capable review… Do not treat the UI as done."
- **ARQUIVOS:** `docs/progress/DESIGN-SYSTEM-CALIBRATION.md`, `docs/progress/calibration-shots/*.png`, `design-system/ACCEPTANCE_CHECKLIST.md`
- **COMPORTAMENTO ESPERADO:** revisão com capacidade de imagem comparando os 4 screenshots ao corpus, classificando cada item do gate.
- **DEPENDÊNCIAS:** bloqueia P0-4.
- **COMO VALIDAR DEPOIS:** documento de QA assinado, item por item, com zero P0/P1.

---

**P1-6 · `main` não contém o produto**

- **PROBLEMA:** `main` e `origin/main` estão no commit de bootstrap. Todo o trabalho vive em `feat/foundation-phase-1-3`. Risco de perda e ausência de histórico integrado.
- **EVIDÊNCIA:** `git branch -a -v` — `main 573d012 chore: import Kal El bootstrap`; `feat/foundation-phase-1-3 3a96a3a`.
- **ARQUIVOS:** n/a (processo).
- **COMPORTAMENTO ESPERADO:** integrar via PR revisado, após P0-1 e P1-3 (não integrar falha de segurança conhecida).
- **DEPENDÊNCIAS:** P0-1, P1-3.
- **COMO VALIDAR DEPOIS:** `git log main..feat/foundation-phase-1-3` vazio; CI verde em `main`.

---

**P1-7 · Importadores perdem mídia e formatação inline**

- **PROBLEMA:** `urlToMediaId` é criado vazio e nunca populado → todo nó `image` descartado, toda `gallery` descartada. Somado a P0-3, links e formatação também. Uma migração perderia o acervo visual e a malha de links internos.
- **EVIDÊNCIA:** `packages/importer/src/import.ts:101-105`; `html.ts:182` (`"media not imported"`), `html.ts:197` (`"gallery dropped: no media imported"`).
- **ARQUIVOS:** `packages/importer/src/import.ts`, `packages/importer/src/html.ts`
- **COMPORTAMENTO ESPERADO:** baixar cada mídia da origem, enviar pelo endpoint de upload, popular `urlToMediaId`, preservar nós `image`/`gallery` e as marks inline.
- **DEPENDÊNCIAS:** P0-2, P0-3.
- **COMO VALIDAR DEPOIS:** importar snapshot com 3 imagens e 2 links → 3 linhas em `media`, 3 nós `image` no documento, 2 links preservados, 0 warnings de mídia.

---

### P2 — necessário antes de produção

- **P2-1 · Payload importer incompleto.** Descarta autores/categorias/tags (`payload.ts:118-120`), espera HTML quando Payload exporta Lexical JSON, `externalUrl` fixo, **zero testes**. Validar com um export real do Cinerie.
- **P2-2 · CORS reflete qualquer origem com credenciais.** `origin: true, credentials: true` (`app.ts:41`); confirmei `access-control-allow-origin: https://evil.example.com` + `allow-credentials: true`. Mitigado por `SameSite=Lax`, mas deve virar allowlist de `APP_BASE_URL`.
- **P2-3 · Swagger `/docs` sem autenticação** (`app.ts:45`). Expõe o mapa completo da API. Proteger ou desabilitar em produção.
- **P2-4 · SSRF via webhooks.** Worker faz POST para URLs cadastradas sem allowlist nem bloqueio de faixas privadas/link-local. Exige `tokens.manage`, mas é vetor real. `apps/worker/src/dispatcher.ts:116`.
- **P2-5 · Taxonomia sem update/delete.** Só create+list para categories/tags/entities/authors/sources. Renomear ou remover uma categoria é impossível pela API.
- **P2-6 · `articles.delete` sem implementação.** Permissão declarada (`auth-context.ts:14`), nenhuma rota. Não há como remover artigo.
- **P2-7 · `packages/events` e `packages/testkit` sem script `test`.** `events` contém a verificação de assinatura HMAC — código de segurança sem teste próprio.
- **P2-8 · `primary category` ausente.** `article_categories` é N:N puro; SEO editorial precisa de categoria primária.
- **P2-9 · Sem preview seguro.** Rota → 404. Requisito de aceitação.
- **P2-10 · Sem autosave/recovery nem diff de revisões.** As revisões são gravadas, mas não há recuperação de rascunho nem comparação de versões.
- **P2-11 · Divergências DS-4/DS-5.** Responsividade sem teste automatizado; `20_COMMERCE_WAYNE_UI.md` fora de escopo.

### P3 — melhoria futura

- **P3-1 · Configuração fantasma.** `.env.example:12-13` declara `MEDIA_STORAGE_PROVIDER` e `MEDIA_LOCAL_PATH` que nenhum código lê.
- **P3-2 · `SESSION_SECRET` morto.** Validado em `config.ts:10` com default de desenvolvimento e **nunca usado** (tokens são opacos, não assinados). Remover ou usar.
- **P3-3 · `docs/FINAL-REPORT.md` desatualizado em pontos menores.** Diz "80 tests" (são 87) e "Dockerfiles to be added in Phase 11/12" quando `apps/api/Dockerfile` e `apps/worker/Dockerfile` já existem.
- **P3-4 · `summaryDto` devolve relações vazias.** `articles.ts:113-116` retorna `authors: []`, `categories: []`, `tags: []`, `entities: []` em toda listagem — a lista nunca mostra autor ou categoria. Consumidores precisam de N+1 chamadas.
- **P3-5 · `kal-el-repository-v2.zip` presente no diretório de trabalho** (ignorado pelo git, mas ocupa a raiz do projeto).
- **P3-6 · "close timed out after 10000ms"** em 5 pacotes no Windows — cosmético, já documentado.

---

## Apêndice — Comandos executados e resultados

| # | comando | resultado |
|---|---|---|
| 1 | `git remote -v` / `rev-parse` / `log` / `worktree list` / `status` | worktree da auditoria = bootstrap; produto em `feat/foundation-phase-1-3` |
| 2 | `git ls-files` (ambos worktrees) | 76 vs 261 arquivos |
| 3 | `node --version` / `pnpm --version` | v24.19.0 / 11.15.1 |
| 4 | `pnpm -r typecheck` | **PASS** exit 0, 12/13 projetos |
| 5 | `pnpm -r lint` | **PASS** exit 0, 12/13 projetos |
| 6 | `pnpm -r build` | **PASS** exit 0 (api 73.33 KB, worker 9.44 KB, fixture 1.71 KB) |
| 7 | `pnpm -r test` | **PASS** exit 0 — **87 testes, 87 pass, 0 fail, 0 skip** |
| 8 | `pnpm dev:api` | API subiu com PostgreSQL embutido; migrations + bootstrap 201 |
| 9 | `GET /v1/health`, `/v1/ready` | `{"status":"ok"}`, `{"status":"ready"}` |
| 10 | ciclo login→sites→create→revisions→publish→get | 200 / 200 / 201 / 200 / 200 / 200; documento íntegro |
| 11 | probe de mídia (4 rotas) | **todas 404** |
| 12 | probe de workflow/preview/analytics (6 rotas) | **todas 404** |
| 13 | `PATCH {"status":"in_review"}` | 400; com título: 200 e **status descartado em silêncio** |
| 14 | probe CORS com `Origin: https://evil.example.com` | **refletida** + `allow-credentials: true` |
| 15 | inspeção de `Set-Cookie` | `HttpOnly; SameSite=Lax`, **sem `Secure`** |
| 16 | headers helmet | HSTS, nosniff, X-Frame-Options SAMEORIGIN presentes |
| 17 | POST sem `x-kal-el-csrf` | **403** (CSRF funciona) |
| 18 | GET sem cookie | **401** (dados não públicos) |
| 19 | RBAC: autor → `/publish`, `/schedule` | **403, 403** (correto) |
| 20 | RBAC: autor → `POST /articles {"status":"published"}` | **201 PUBLICADO — P0** |
| 21 | SQL: `outbox_events`, `audit_log`, `media`, `articles`, `information_schema` | 2 eventos (incl. bypass), 5 audits, **0 mídia**, 2 published/1 draft, **26 tabelas** |
| 22 | `comm` de tokens PEG contrato × implementação | **0 tokens ausentes** (47/47) |
| 23 | `grep` fetch/axios/router em design-system | **0 ocorrências** |
| 24 | `grep` multipart/upload/StorageProvider/s3/r2 | 4 ocorrências, todas inertes |
| 25 | encerramento + verificação | porta 3001 liberada, instância embutida encerrada, serviço PostgreSQL 17 do usuário **Running** e intacto |

### Estado do git ao final

```text
worktree do produto (C:\Users\pablo\Documents\OpenCode\Kal El):
  branch feat/foundation-phase-1-3...origin/feat/foundation-phase-1-3
  git status --porcelain -> (vazio)
  NENHUM arquivo do produto foi criado, modificado ou removido.

worktree da auditoria (kal-el-repository-audit-c088db):
  único arquivo novo: docs/audits/KALEL_360_AUDIT.md (este relatório)
```

Nada foi implementado, corrigido, refatorado, apagado ou comitado. Nenhuma migration, seed ou banco de produção foi alterado. Nenhum valor de secret foi impresso.
