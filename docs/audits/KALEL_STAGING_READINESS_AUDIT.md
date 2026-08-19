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
| `pnpm -r test` | **222 passed, 0 failed, 0 skipped** (era 139) |
| Playwright | **24 passed, 0 failed, 0 skipped** (era 2) |
| axe (WCAG 2.1 A+AA, 76 varreduras) | **0 violações** |
| Navegação alcançável (190 medições) | **190/190** |
| Overflow horizontal | 0 |
| Erros de console na varredura | 0 |

Distribuicao dos 222: api 146 · importer 18 · contracts 15 · db 8 · worker 8 · editor 7 ·
auth 5 · sdk 5 · design-system 5 · fixture 4.

*Media Detail* entrou nas varreduras nesta rodada (180 → 190 medicoes, 72 → 76 varreduras
axe). Ela era pulada silenciosamente em toda execucao anterior: o harness procurava
`a[href^='/media/']`, mas a grade renderiza cada asset como `<button>`, entao o id nunca era
encontrado. As varreduras agora semeiam um asset.

> **Nota sobre a medicao de navegacao.** Execucoes anteriores reportaram 1/180 falha
> ocasional, sempre numa largura diferente e sempre com 0 erros de console — artefato de
> tempo de render do proprio harness, nao estado do produto. Com a suite serial e a espera
> explicita pela shell, a medicao ficou deterministica: **190/190**.

### Nota sobre a suíte E2E

A primeira execução completa da suíte Playwright teve 2 falhas que passavam quando os
specs rodavam isolados. A causa não era flakiness genérica: `POST /v1/auth/login` tem rate
limit de 10 por minuto — que é o controle de força bruta, funcionando corretamente — e a
suíte fazia ~13 logins (um por teste). Os últimos recebiam 429 e o spec falhava num
redirect para `/login`.

Corrigido pelo lado da suite, nao do produto: um projeto `setup` do Playwright autentica
uma vez e grava `storageState`, que os demais specs reutilizam. O `rbac.spec.ts` continua
fazendo logins proprios (precisa de um autor real), mas sao poucos. O limite permanece
inalterado — afrouxar um controle de seguranca vivo para fazer teste passar trocaria uma
protecao real por um numero verde.

O mesmo padrao voltou na rodada de fechamento, agora contra o **rate limit global de 600
req/min**: com quatro workers paralelos, as ~190 navegacoes da varredura mais os outros
specs ultrapassavam o limite, `/v1/auth/me` passava a responder 429 e o CMS caia para
`/login` no meio do teste. Cinco specs falharam assim antes de a causa ficar clara. A suite
passou a rodar **serial** — os specs sempre compartilharam um servidor e um banco, entao o
paralelismo nunca foi isolamento real.

Essa mudança, por sua vez, quebrou o teste "escrita não autenticada é rejeitada": com a
sessão compartilhada ele passou a receber **403 (CSRF)** em vez de **401 (sem sessão)** —
controles diferentes. Isolado num `describe` com `storageState` vazio.

E o teste de ciclo editorial passava isolado mas falhava na suíte completa, afirmando o
rótulo transitório "Salvo". Sob carga o rótulo pode assentar de um ciclo de debounce
anterior ao que carrega a mudança. Passou a esperar a **resposta PATCH aceita pelo
servidor** e a verificar que ela carrega o título novo — afirma o efeito, não a UI.

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

## 5. Rodada de fechamento - P1-A ... P1-I

Segunda passagem, iniciada de `e031aed`. Os nove P1 listados na versao anterior desta
auditoria foram fechados, cada um com regressao propria.

### P1-A - Relacoes de artigo sem escopo de site

`replaceRelations` inseria `authors`/`categories`/`tags`/`entities` direto nas tabelas de
juncao sem checar o site - inconsistente com `assertMediaInSite`, que valida. Um artigo do
site A podia manter FK para a taxonomia do site B (entao o site B apagando a propria tag
cascateava no artigo alheio), e o endpoint virava **oraculo de existencia**: id estrangeiro
real devolvia 201, id inventado devolvia 400.

`assertRelationsInSite` roda na mesma transacao, antes da escrita, em create e update. Id
estrangeiro e id inexistente agora falham de forma **identica** - isso e afirmado em teste.
**8 testes** (`relation-isolation.test.ts`).

### P1-B - Modelo de identidade autor x usuario

`articleAuthors.authorId` e FK para `authors.id` - uma assinatura editorial - mas
`assertCanEdit` comparava contra `actor.userId`. Espacos de UUID disjuntos: `isListedAuthor`
era **sempre falso** e ownership colapsava em `createdBy`. Um coautor legitimamente creditado
levava 403 no proprio artigo. Falhava fechado, por isso nada pegou.

A relacao foi **modelada**, nao a checagem afrouxada. `authors.userId` (migration 0001,
nullable, `ON DELETE set null`) liga assinatura a conta quando existe uma; colaborador
convidado e autor importado seguem com `userId = null`. Indice unico `(site_id, user_id)`:
uma conta tem no maximo uma assinatura por site. Vincular exige que a conta seja membro
daquele site. **9 testes** (`author-ownership.test.ts`).

### P1-C - Re-import insert-only

Titulo, slug, corpo, excerpt, relacoes ou SEO alterados na origem nunca chegavam ao Kal El:
a segunda execucao de uma sincronizacao semanal contava "existing" e seguia. `reconcile`
relatava `extraArticles` sem escrever nada.

O re-import agora faz diff **campo a campo** contra o que um update pode carregar, e so
escreve quando algo difere - origem inalterada nao produz escrita nenhuma. Comparar objetos
inteiros marcaria "changed" sempre, porque o artigo armazenado tem a forma SEO normalizada
completa enquanto a origem fornece poucas chaves.

Midia nao tinha identidade de origem, entao cada execucao com `fetchMedia` rebaixava e
regravava todos os binarios - copias sem referencia, que nem o guard de "em uso" conseguia
recuperar. `media.external_key` + indice unico `(site_id, external_key)` (migration 0002).

Dois achados menores no caminho: `reconcile` usava `startsWith(prefix)`, entao "imp"
reivindicava "impx:999"; e o service token do importador nao tinha `articles.update` - que e
justamente o escopo que separa sincronizar de so inserir. **+3 testes**.

### P1-D - Retry de workflow

O SDK anexa `Idempotency-Key` a submit/approve/reject/publish/unpublish/archive e repete em
erro de rede e 5xx; a API ignorava o header em todos. Resposta perdida -> o pipeline reenvia
`submit` -> o servidor avalia `in_review -> in_review` -> **409**. Falha dura para uma escrita
que ja tinha dado certo.

Duas correcoes, ambas necessarias: reaplicar uma transicao que o artigo ja sofreu virou
**no-op devolvendo 200** (so `publishArticle` ja fazia isso), e toda rota de workflow passou
a honrar a chave.

### P1-E - Codigos de erro

`IDEMPOTENCY_REPLAY` e `VERSION_CONFLICT` eram documentados como codigos e lancados via
`conflict()`, que fixa `CONFLICT` e empurra o codigo real para `details`. No fio, conflito de
versao, conflito de slug e replay eram indistinguiveis. Viraram codigos de primeira classe,
com `INVALID_TRANSITION` carregando `from`/`to`.

### P1-F - Escopo e TTL da chave de idempotencia

Chave escopada so por ator. O `requestHash` embute a URL (que carrega o siteId), entao a
mesma chave mirada em outro site devolvia 409 "reused with a different request" para uma
escrita legitimamente diferente. Service tokens escapavam por acidente (token e preso a um
site) - a garantia mudava de forma conforme a credencial. Agora o escopo e ator + site.

O TTL de 24h era escrito e nunca comparado nem coletado: a tabela crescia uma linha por
escrita, cada uma com um corpo de resposta inteiro, e uma chave reusada meses depois
replicava resposta velha. A busca filtra expiracao e o worker purga a cada tick.

**14 testes** cobrindo D+E+F (`retry-contract.test.ts`), mais o especifico descrito abaixo.

### P1-G - Contrato do pipeline

Diff mecanico de quatro vias entre `PIPELINE_API.md`, as rotas, os schemas, o OpenAPI e o
SDK. Existem **59 rotas**; o documento descrevia 12, varias erradas.

Na implementacao: `POST /v1/admin/service-tokens` estava registrado no OpenAPI e **nao
existe** (a rota real e escopada por site) - um cliente gerado dali da 404 na primeira
chamada. O `200` na criacao era descrito como "idempotent replay" quando e o match por
`externalKey`; um replay real devolve o status **armazenado**. Rotas de workflow e midia
foram registradas.

Na documentacao: prometia um campo `created` que nunca existiu no fio; listava 5 escopos
quando as operacoes documentadas precisam de 14 - sem `media.read`, `articles.update`,
`articles.submit` nem os `taxonomy.*.manage`, de modo que um token feito a partir do doc nao
passava da linha 43 do proprio exemplo Python; sugeria que `articles.reject` existe (reject
usa `articles.approve`); nao dizia que `approve` devolve o artigo para `draft`, que `submit`
nao e obrigatorio antes de publicar, que `If-Match` e opcional e precisa ser inteiro puro,
nem que `externalKey` e create-only.

**8 testes** (`pipeline-contract.test.ts`) prendem o que prosa nao sustenta sozinha: toda
rota do OpenAPI resolve, e a lista de escopos do doc de fato executa o fluxo do doc.

### P1-H - Contrato do editor

Todo no de imagem era criado sem `altText`, entao o renderer emitia `alt=""` - que marca a
imagem como decorativa e a descarta inteiramente para leitores de tela. Fotos editoriais
eram silenciosamente invisiveis em todo artigo publicado. Inserir imagem agora pergunta,
com o alt da biblioteca como padrao mas nao herdado em silencio, e "decorativa" como escolha
explicita.

Tambem entregues: toolbar contextual ancorada na selecao (bold/italico/link, nao uma copia
da toolbar fixa), modo sem distracoes como modo do editor e nao outra pagina, e ponto focal
como metadado no asset - sem pipeline de transformacao de imagem, mantendo o StorageProvider
independente. **+3 testes Playwright**.

### P1-I - Verificacao de conteudo no upload

`uploadMedia` checava `part.mimetype` - header escrito pelo cliente - contra a allow-list, e
`readDimensions` engolia toda falha do `image-size`. Um payload arbitrario declarado
`image/png` era armazenado e servido a partir da origem confiavel da API.

O tipo passa a ser detectado pelos bytes iniciais (JPEG/PNG/GIF/WEBP/AVIF), com recusa tanto
de conteudo irreconhecivel quanto de conteudo que discorda do tipo declarado. **O tipo
detectado - nao o declarado - e o que se persiste e se serve.** SVG fica de fora nos dois
eixos. **6 testes unitarios + 3 no nivel de rota**.

---

## 5b. Dois defeitos introduzidos nesta rodada e corrigidos

Registrados porque a origem importa: ambos foram encontrados por verificacao, nao por sorte.

1. **`respondIdempotentValue` x DTO montado depois.** O helper persiste o valor como JSONB e
   o replica literalmente; os handlers de categoria/tag/autor montavam o DTO **apos** a
   chamada, entao no replay `createdAt` ja era string e `.toISOString()` estourava **500**.
   Apareceu no diff mecanico de P1-G, foi reproduzido em teste, corrigido movendo o DTO para
   dentro do callback, e a restricao esta documentada no helper.

2. **Minimo de 12 bytes na deteccao de imagem.** Um cabecalho JPEG valido tem 3. Isso
   quebrou o fixture do importador. Passou a ser verificacao por formato.

---

## 5c. Revisao independente: o que ela encontrou, e o que isso diz

Apos o fechamento dos nove P1, tres revisoes independentes adversariais foram executadas
em sequencia, cada uma apontada para as correcoes da anterior.

| revisao | achados | criados pela correcao anterior |
|---|---|---|
| 1a | 6 | 4 |
| 2a | 8 | 3 |
| 3a | 11 | 3, mais **2 correcoes que nao existiam** |

**A taxa nao esta convergindo.** Cada rodada encontra defeitos em quantidade comparavel, e
uma fracao consistente e criada pela rodada imediatamente anterior. Isso nao e sinal de
trabalho malfeito: e o que acontece ao mexer ao mesmo tempo em workflow, idempotencia,
permissoes e contrato de integracao, onde cada correcao cria uma fronteira nova.

### O achado mais serio nao foi de codigo

O commit `27b9eaa` afirmava oito correcoes e continha seis. `packages/importer/src/import.ts`
e `apps/worker/src/worker.ts` nao aparecem em sua lista de arquivos. Os scripts de edicao
reportaram sucesso sem verificar que a substituicao casou, e a mensagem de commit passou a
afirmar trabalho que a arvore nao continha.

Duas consequencias que importam mais que o defeito em si:

1. **Nenhum gate pegou.** Typecheck, lint e 219 testes passavam. Uma correcao ausente e um
   teste ausente sao indistinguiveis por gate verde — se nada exercita o comportamento que
   a correcao deveria criar, sua ausencia e invisivel.
2. **O desenho descrito tambem estava errado.** O guard de documento derivaria completude
   por grep de `"media not imported"` em warnings de escopo de lote. Galeria totalmente
   perdida empurra outra string; galeria parcialmente resolvida nao empurrava nada; e
   warnings de lote fariam a falha de um artigo congelar o documento de todos os outros.
   `finalizeDocument` passou a sinalizar degradacao diretamente, por artigo.

O commit seguinte declara isso no registro permanente em vez de reescrever a historia.

### Implicacao para a Definition of Done

Declarar `P1 = 0` em sentido absoluto nao seria defensavel com esta evidencia. O que e
defensavel — e o que este documento afirma — e **zero P1 conhecidos apos tres revisoes
independentes adversariais**, com a taxa de descoberta registrada acima. Uma quarta revisao
provavelmente encontraria mais; a decisao de parar e de escopo, nao uma conclusao de que o
codigo esta livre de defeitos.

---

## 6. O que continua aberto

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

**Nenhum.** P1-A ... P1-I fechados, cada um com regressao.

Divergencias que permanecem verdadeiras estao **documentadas em vez de escondidas**, na
secao 10 de `docs/integrations/PIPELINE_API.md`: o OpenAPI descreve 16 das 59 rotas; o SDK
descarta o status HTTP e por isso nao observa created-versus-existing; nenhuma rota
`/v1/admin/*` tem metodo no SDK; `articles.delete` existe como permissao sem rota; e
`RATE_LIMITED`/`UNSUPPORTED_MEDIA_TYPE` sao declarados e nunca emitidos. Sao lacunas de
cobertura de ferramenta, nao defeitos de comportamento - e agora um teste garante que toda
rota do OpenAPI ao menos exista.

### P2 / futuro

`maxParamLength` deprecation (cosmético, visível em todo boot); webhooks sem UI (a API
existe — classificado **P2/FUTURE**, não requisito de staging); `Tabs` com padrão ARIA
incompleto (componente não usado); hierarquia de headings `h1 → h3`; `pnpm-workspace.yaml`
com `allowBuilds` contendo placeholders literais `set this to true or false`, de modo que
build scripts são silenciosamente ignorados.

---

## 7. Cobertura desta auditoria — e o que ela não cobre

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

## 8. Veredito

| | |
|---|---|
| P0 remanescentes | **0** |
| P1 remanescentes | **0 conhecidos**, apos tres revisoes independentes (ver 5c) |
| P2 remanescentes | documentados na secao 6 e na secao 10 do PIPELINE_API |
| **READY FOR STAGING** | **SIM** |
| **READY FOR PRODUCTION** | **NAO** — PROD-1...4 |

A Definition of Done exigia `P0 = 0` e `P1 = 0`. Os nove P1 originais (P1-A ... P1-I) foram
fechados, cada um com regressao propria, sem reclassificar nada para P2 para fechar o gate.
As tres revisoes independentes que se seguiram encontraram 25 defeitos adicionais, todos
corrigidos.

**A qualificacao importa.** Como a secao 5c documenta, a taxa de descoberta nao convergiu:
cada revisao encontrou defeitos em quantidade comparavel a anterior. `P1 = 0` aqui significa
"zero conhecidos apos tres passagens adversariais", nao "livre de defeitos". Uma quarta
revisao provavelmente encontraria mais.

Producao segue bloqueada por quatro lacunas operacionais (PROD-1...4 na secao 6), que por
instrucao explicita nao foram tratadas nesta rodada. A mais grave continua sendo
`logger: false`: toda implantacao real sobe sem log de servidor, o que torna invisivel em
operacao exatamente a classe de defeito que estas auditorias encontraram lendo codigo.
