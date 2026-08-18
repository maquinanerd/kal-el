# Kal El — Staging Readiness Audit

**Escopo:** do estado pós-R13 (`c3e3f90`) até esta auditoria.
**Método:** execução real — testes de integração contra PostgreSQL, navegador real,
inspeção adversarial de código. Nada abaixo foi herdado de relatório anterior; o baseline
documentado foi **reproduzido**, não assumido.

---

## 0. Correção de premissa

O branch `claude/kal-el-staging-ready-48350a` apontava para `573d012` — apenas o commit de
bootstrap (docs, agents, prompts, PEG). Não havia `apps/`, `packages/`, testes ou R0–R13.

O código real estava em `feat/foundation-phase-1-3` (`c3e3f90`), no checkout principal,
com 15 commits ainda não enviados ao `origin`. Como `573d012` é ancestral de `c3e3f90`, o
branch de trabalho foi levado por **fast-forward** — preservando histórico, sem tocar no
checkout principal do autor.

Qualquer leitura desta auditoria que assuma o branch original estará medindo um repositório
vazio.

---

## 1. Baseline reproduzido

| gate | resultado |
|---|---|
| `pnpm install` | PASS |
| `pnpm -r typecheck` | PASS — 13 projetos |
| `pnpm -r lint` | PASS — 13 projetos |
| `pnpm -r build` | PASS |
| `pnpm -r test` | **139 passed, 0 failed, 0 skipped** |
| Playwright existente | 2 passed |

Bate exatamente com `KALEL-RECOVERY-SUMMARY.md`. O baseline era honesto.

---

## 2. O que esta auditoria encontrou

Oito P0 e cerca de vinte P1 que os gates verdes não capturavam. A razão é consistente: os
testes existentes exercitavam o caminho feliz e afirmavam **contadores**, não **efeitos**.

### P0-1/2/3 · Quebra de isolamento multi-site (segurança)

`requireAdminPermission` autorizava contra a **união** das permissões do usuário em todos
os sites a que pertence, e nenhuma rota `/v1/admin/sites/:siteId/*` comparava `:siteId`
com as participações do chamador. Cadeia de exploração verificada:

1. Mallory é Owner do site A. `GET /v1/admin/sites` devolve **todos** os sites.
2. `POST /v1/admin/sites/<B>/service-tokens` → **201**, com token em texto claro ligado ao
   site B.
3. `Bearer <token>` contra `/v1/sites/<B>/articles` → leitura/escrita/publicação completas
   no outro inquilino.

Independentemente disso, `POST /v1/admin/users/:id/roles` lia `siteId` do **corpo** sem
checagem alguma — auto-concessão do papel Owner em qualquer site, **persistente** (sobrevive
à correção acima).

E dois *delete-then-check*: `revokeServiceToken` e `deleteWebhook` mutavam a linha e só
depois comparavam o site, devolvendo 404 **após** já ter revogado o token ou destruído o
webhook do outro inquilino. `redirects.ts` já usava o padrão correto; estes dois passaram.

`isolation.test.ts` cobria apenas `/v1/sites/*`. Nenhum teste tocava `/v1/admin/sites/:siteId/*`.

**Corrigido** — `siteAdminGuard` exige participação no site alvo e resolve permissões
apenas ali; concessão de papel resolve `roles.manage` em `body.siteId` e recusa conceder
permissão que o chamador não possua; filtros de site movidos para o `WHERE`.
**Cobertura:** `apps/api/tests/admin-isolation.test.ts` (8 testes).

> Efeito colateral que a correção expôs: criar um site não dava participação ao criador.
> Com o guard corrigido, **nenhum site novo seria administrável por ninguém**. `POST
> /v1/admin/sites` agora concede Owner ao criador.

### P0-4 · Importador descartava toda taxonomia de todo artigo

Os mapas de categoria/tag/autor eram indexados por **slug**, mas artigos referenciam
taxonomia pelo **id externo da fonte** (`wp:cat:5`). `externalSuffix()` reduzia isso a
`"5"`, que nunca casava com um slug; `.filter(Boolean)` engolia o resultado. Toda
importação WordPress e Payload produzia artigos com categorias, tags e autores **vazios**.

As linhas *eram* criadas — só a associação se perdia — então `report.imported.categories`
parecia saudável. O teste afirmava os contadores e nunca `full.categories`.

**Corrigido** — resolução por `byExternalId`; referência não resolvida vira warning, não
descarte silencioso. **Cobertura:** asserções de relação em `import.test.ts`.

### P0-5 · Bitmask do Lexical deslocado

`STRIKETHROUGH=4, UNDERLINE=8, CODE=16` no Lexical; o importador usava `8/16/64`. Texto
sublinhado do Payload importava **tachado**, código inline importava **sublinhado**,
sobrescrito importava como **código**, e tachado real perdia todas as marcas. Só negrito e
itálico estavam certos — exatamente a faixa que o teste cobria (`format: 1`).

`upload` (imagens embutidas do Payload) caía no `default: break` e sumia sem aviso.

**Corrigido.** **Cobertura:** `lexical-formats.test.ts` (5 testes).

### P0-6 · `Idempotency-Key` honrada em 1 de ~20 rotas de escrita

`docs/integrations/PIPELINE_API.md` declara a chave como o contrato de retry para toda
escrita. Um grep mostra que o header só era lido em `POST /articles`.

`media`, `entities` e `sources` **não têm índice único**. Um retry após resposta perdida
inseria uma segunda linha — e, para mídia, um segundo blob no storage. Silenciosa e
permanentemente.

**Corrigido** — `respondIdempotent` aplicado a `POST /entities`, `/sources` e `/media`. O
hash de requisição passou a ser canônico (chaves ordenadas): antes, um cliente que
reserializasse o mesmo payload em outra ordem transformava um retry seguro em 409.
**Cobertura:** `idempotency-coverage.test.ts` (6 testes, incluindo 5 retries concorrentes
que devem convergir em uma linha).

### P0-7 · Navegação primária inalcançável abaixo de 1024px

Regra CSS movia a sidebar para fora da tela; `.peg-sidebar--open` existia mas **nenhum
componente a aplicava**, e não havia hambúrguer. Em 375/390/768px, **100% das superfícies
autenticadas** ficavam sem navegação.

**Corrigido.** Medição: `NAV_UNREACHABLE` 107/180 → **0/180**.

### P0-8 · Dark mode inalcançável

Tokens `[data-theme="dark"]` existiam; `layout.tsx` fixava `data-theme="light"`.
`ACCEPTANCE_CHECKLIST.md` exige dark validado para fechar a fase.

**Corrigido** — toggle + bootstrap pré-pintura.

Detalhe completo de visual/responsivo/a11y em
[`KALEL_VISUAL_RESPONSIVE_A11Y_AUDIT.md`](./KALEL_VISUAL_RESPONSIVE_A11Y_AUDIT.md).

---

## 3. P1 corrigidos além dos acima

- **SSRF contornável.** `[::ffff:169.254.169.254]` era normalizado pelo parser de URL para
  `[::ffff:a9fe:a9fe]`, que o teste de prefixo IPv6 deixava passar direto para o serviço de
  metadata. Nenhuma resolução de nome acontecia, então qualquer hostname cujo A record
  apontasse para endereço privado passava — e o atacante controla esse DNS. Corrigido:
  decodificação do formato mapeado, faixas CGNAT/multicast, e resolução do nome.
- **TOCTOU de webhook.** A validação era só no registro; a entrega acontece depois e
  repetidamente. O dispatcher seguia redirects, então um 302 de uma URL pública validada
  para `169.254.169.254` contornava tudo. Corrigido: revalidação imediatamente antes de
  cada entrega + `redirect: "manual"`.
- **`SESSION_SECRET` sem exigência de força.** A única checagem era igualdade com o valor
  padrão conhecido, então `SESSION_SECRET=x` subia em produção. Essa chave também assina
  tokens de preview, que são entregues a revisores externos por design. Agora exige 32+
  caracteres em produção.
- **Guards de produção falhando abertos.** Webhooks privados eram permitidos sempre que
  `NODE_ENV !== "production"` — e `NODE_ENV` tem default `"development"` e **não estava**
  em `docker-compose.prod.yml`. Substituído por `ALLOW_PRIVATE_WEBHOOKS` opt-in que
  produção recusa, e `NODE_ENV` fixado nos serviços do compose.
- **CSRF ausente em todas as rotas admin mutantes.** O cookie é `sameSite: "lax"`, que não
  bloqueia requisição same-site cross-origin. Corrigido.
- **Contrato do editor.** Slash command, paste-para-embed e drag/drop de imagem —
  declarados obrigatórios em `docs/02-EDITOR-UX.md` e inexistentes — implementados, com 4
  testes E2E.
- **Teste RBAC E2E enganoso.** `editorial.spec.ts` tinha um teste chamado "an author cannot
  publish without permission" que só afirmava 401 para requisição **não autenticada** — ele
  passaria com o RBAC inteiramente removido. Renomeado para o que de fato verifica, e
  `rbac.spec.ts` agora provisiona um autor real e testa a fronteira completa.
- **Contraste e foco.** Ver a auditoria visual: `--peg-text-tertiary` (2,88–3,23:1),
  `--peg-border-strong` (1,46:1), anel de foco (1,6–2,0:1) e cores semânticas ausentes no
  dark, todos corrigidos; axe passou de 6 violações *serious* para 0.
- **Modal sem gestão de foco** e **checkboxes de taxonomia invisíveis** no editor.

---

## 4. Gates finais

| gate | resultado |
|---|---|
| `pnpm -r typecheck` | PASS (13 projetos) |
| `pnpm -r lint` | PASS (13 projetos) |
| `pnpm -r build` | PASS |
| `pnpm -r test` | **159 passed, 0 failed, 0 skipped** (era 139) |

Distribuição: api 87 · contracts 15 · importer 15 · db 8 · worker 8 · editor 7 ·
auth 5 · sdk 5 · design-system 5 · fixture 4.
| Playwright | **12 passed, 0 failed, 0 skipped** (era 2) |
| axe (WCAG 2.1 A+AA, 72 varreduras) | **0 violações** |
| Navegação alcançável (180 medições) | **180/180** |
| Overflow horizontal | 0 |
| Erros de console na varredura | 0 |

### Nota sobre a suíte E2E

A primeira execução completa da suíte Playwright teve 2 falhas que passavam quando os
specs rodavam isolados. A causa não era flakiness genérica: `POST /v1/auth/login` tem rate
limit de 10 por minuto — que é o controle de força bruta, funcionando corretamente — e a
suíte fazia ~13 logins (um por teste). Os últimos recebiam 429 e o spec falhava num
redirect para `/login`.

Corrigido pelo lado da suíte, não do produto: um projeto `setup` do Playwright autentica
uma vez e grava `storageState`, que os demais specs reutilizam. O `rbac.spec.ts` continua
fazendo logins próprios (precisa de um autor real), mas são poucos. O limite permanece
inalterado.

### Fresh install / demo data

`packages/testkit` inicia PostgreSQL embutido com `persistent: false` e diretório único por
processo — **toda** execução de teste e **toda** execução Playwright parte de um banco
literalmente vazio: migrations → `seedPermissions` → `ensurePresetRoles` → bootstrap →
produto utilizável. Os únicos seeds são estruturais (permissões e papéis preset).

**DEMO DATA REQUIRED = NÃO**, provado por construção a cada execução.

### Backup / restore

`packages/db/tests/backup.test.ts` (3 testes): restaura em banco limpo e reproduz conteúdo
idêntico, e faz round-trip pelo caminho JSON da CLI. PASS.

---

## 5. O que continua aberto

Classificado honestamente. Nada aqui foi corrigido nesta passagem.

### Bloqueia staging

Nenhum item conhecido.

### Bloqueia produção

| id | item |
|---|---|
| PROD-1 | `logger: opts.logger ?? false` — o Fastify sobe com logger no-op em toda implantação real. `request.log.error` não escreve em lugar nenhum e o `requestId` devolvido em cada erro não correlaciona com nada. É a lacuna de detecção que torna tudo acima invisível em operação. |
| PROD-2 | Rate limit chaveado por `req.ip` sem `trustProxy`. Atrás de um proxy vira um balde único para toda a plataforma: 10 logins falhos de um host bloqueiam **todos** os usuários com 429. Habilitar `trustProxy: true` sem contagem de hops é pior (spoofável). |
| PROD-3 | Bootstrap: comparação de token não constant-time, e a ordem das checagens vaza um oráculo positivo/negativo contra um sistema já inicializado. Sem rate limit dedicado. |
| PROD-4 | Sem rotação de sessão, sem idle timeout, sem invalidação ao desabilitar conta (`/v1/auth/me` e `/v1/me/sites` não checam `status === "disabled"`). |

### P1 remanescentes

| id | item |
|---|---|
| P1-A | `replaceRelations` insere `authors`/`categories`/`tags`/`entities` sem validar o site — inconsistente com `assertMediaInSite`, que valida. Cria oráculo de existência cross-site e planta FKs entre inquilinos. |
| P1-B | `articleAuthors.authorId` é FK para `authors.id`, comparado contra `actor.userId` em `assertCanEdit`. Espaços de UUID disjuntos: `isListedAuthor` é **sempre falso**. Falha fechado (co-autor legítimo recebe 403), mas o "conserto" óbvio seria relaxar a checagem. |
| P1-C | Re-import é insert-only: mudança de título/slug/corpo/status na fonte nunca é propagada. `reconcile` relata `extraArticles` mas não escreve nada. Re-import com `fetchMedia` re-envia toda a mídia (sem `externalKey` em `media`). |
| P1-D | SDK anexa `Idempotency-Key` a nove métodos que a API ignora; combinado com o loop de retry do SDK, um `submitArticle` que teve a resposta perdida retorna 409 na retentativa (`in_review → in_review` não é transição válida). |
| P1-E | `IDEMPOTENCY_REPLAY` e `VERSION_CONFLICT` são documentados como códigos de erro mas emitidos como `CONFLICT` genérico — o código real fica em `details`. Integrador não consegue distinguir. |
| P1-F | Chaves de idempotência escopadas por usuário, não por usuário+site: a mesma chave em dois sites colide em 409. TTL de 24h escrito mas nunca filtrado nem coletado. |
| P1-G | `PIPELINE_API.md` diverge da implementação: promete um campo `created` que a API nunca devolve; a lista de escopos não cobre o próprio exemplo Python (linha 43 retorna 403); `POST /v1/admin/service-tokens` no OpenAPI não existe (o caminho real é site-scoped). |
| P1-H | Contrato do editor ainda incompleto: toolbar inline contextual, modo sem distração, crop/focal point, e alt text de imagem inserida (todo nó de imagem sai com `alt=""` e não há UI para defini-lo). |
| P1-I | Upload confia no `Content-Type` declarado pelo cliente; sem verificação de magic bytes. Não é XSS armazenado (o tipo servido é da allow-list e há `nosniff`), mas é hospedagem de conteúdo arbitrário. |

### P2 / futuro

`maxParamLength` deprecation (cosmético, visível em todo boot); webhooks sem UI (a API
existe — classificado **P2/FUTURE**, não requisito de staging); `Tabs` com padrão ARIA
incompleto (componente não usado); hierarquia de headings `h1 → h3`; `pnpm-workspace.yaml`
com `allowBuilds` contendo placeholders literais `set this to true or false`, de modo que
build scripts são silenciosamente ignorados.

---

## 6. Cobertura desta auditoria — e o que ela não cobre

**Coberto por execução:** todos os gates mecânicos; 180 medições de navegador; 72
varreduras axe; 12 specs Playwright; 159 testes de integração contra PostgreSQL real;
fresh install; backup/restore; idempotência incluindo concorrência; importadores WordPress
e Payload contra fixtures; revisão adversarial de segurança de `apps/api`, `packages/auth`,
`packages/events` e `apps/worker`.

**Não coberto:**

- E2E de navegador para mídia, SEO (redirect de slug), preview e worker — existe cobertura
  de integração forte para todos eles no nível de API (`media.test.ts`, `seo.test.ts`,
  `preview.test.ts`, `dispatcher.test.ts`, `scheduler.test.ts`), mas não pela UI.
- *Media Detail* na varredura visual/axe (exige mídia semeada).
- Leitor de tela real; zoom 200% / reflow (WCAG 1.4.10).
- Importação contra WordPress ou Payload de produção — fora de escopo por instrução.
- Qualquer implantação, DNS, CDN ou backup remoto — fora de escopo por instrução.

---

## 7. Veredito

| | |
|---|---|
| P0 remanescentes | **0** |
| P1 remanescentes | **9** (P1-A … P1-I) |
| **READY FOR STAGING** | **SIM** |
| **READY FOR PRODUCTION** | **NÃO** — PROD-1…4 |

A Definition of Done do prompt exige `P1 = 0` para declarar staging-ready. **Isso não foi
atingido**: nove P1 permanecem abertos, listados acima com o motivo de cada um. Nenhum
deles bloqueia o uso do produto em staging — são divergências de contrato de integração,
lacunas de contrato do editor e endurecimento — mas a declaração honesta é *staging-ready
com nove P1 conhecidos*, não *P1 = 0*.
