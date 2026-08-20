# Kal El — Final Visual Report

Encerramento da camada visual/UX do CMS. Esta rodada não é auditoria de backend: é a
implementação do pacote de design executável do PEG sobre o produto real, fechando os
defeitos que um revisor encontrou usando o CMS no Chrome.

---

## Fontes

**Design usado** — `design-system/references/kal-el-final/`, extraído do pacote
`PEG Product Design System Audit - Kal EL.zip` (19/08/2026):

| Arquivo | Papel |
|---|---|
| `standalone/kal-el.html` | design executável — precedência máxima |
| `KAL_EL_INVENTORY.md` | valores literais e regras invioláveis |
| `spec/10_KAL_EL_COMPLETE_DESIGN.md` | especificação de produto |
| `tokens/kal-el-tokens.css` | tokens do produto |

Nada disso é dependência de runtime. A implementação é
`packages/design-system/src/tokens.css`, derivada de `tokens/kal-el-tokens.css`.

Três telas têm design executável e foram comparadas lado a lado: **Article Editor**,
**Articles Index**, **Media Library**.

**Product review usado** — sessão real no Chrome em `localhost:3000` como Owner, com
medições (alturas de conteúdo × viewport, contraste efetivo, deslocamento de layout).
Não é hipótese.

### Divergências deliberadas do pacote

| Token | Pacote | Implementado | Motivo |
|---|---|---|---|
| `text-tertiary` | `#8B8D86` | `#6B6E65` | 2.95:1 → 4.56:1 sobre surface-muted |
| `border-strong` | `#C7C7C7` | `#8B8E86` | 1.69:1 → 3.33:1, WCAG 1.4.11 |

Ambos permanecem na família neutra quente do Kal El. `#C7C7C7` foi preservado como
`--peg-rule` para as hairlines decorativas, que é onde o pacote realmente o usa.

`spec/00_AUDIT_RESULT.md` cita `Kal El #2F6BFF` — resíduo cross-product, ignorado. O
accent é `#BF5252` / `#B51B1B`.

---

## P0 — corrigido

**Scroll da aplicação.** A aplicação não rolava em nenhuma página maior que a viewport.
Medido: editor 2067px em 847px visíveis; audit 1291px em 847px; mobile 2767px em 776px.
No editor isso deixava categorias, tags, entidades, autores, imagem destacada, SERP
preview, social preview e revisões **inalcançáveis**.

Causa: um flex item tem `min-height: auto` por padrão e se recusa a encolher abaixo do
conteúdo. `.peg-content` tinha `flex: 1; overflow-y: auto` mas nenhum `min-height: 0`,
então crescia até a altura total do conteúdo em vez de ser limitado pelo frame — o
`overflow-y` nunca teve overflow para resolver e o `overflow: hidden` do frame recortou o
resto.

Corrigido na arquitetura do shell: `min-height: 0` na cadeia inteira e três containers de
scroll declarados explicitamente — workspace, inspector, sidebar nav. Dois defeitos
menores apareceram na medição: um container flex em coluna não conta o próprio
`padding-bottom` no `scrollHeight` (o espaço final virou um flex item de conteúdo zero) e
`#conteudo` precisava de `flex-shrink: 0` para não ser espremido com o conteúdo vazando.

---

## P1 — corrigidos

| # | Defeito | Correção |
|---|---|---|
| 9 | `.peg-btn--primary` com contraste 1:1 | `.peg-body button { color: inherit }` (0,1,1) vencia `.peg-btn--primary` (0,1,0). Reset envolvido em `:where()` → especificidade zero. Corrigido na primitive, não tela a tela. |
| 10 | Ctrl+B / Ctrl+I inertes | `baseKeymap` não contém marks nem histórico, e `history()` é só o plugin de estado. Keymap próprio: Mod-B/I/E/K/Z/Shift-Z e Mod-Alt-0/2/3/4. |
| 11 | Autosave deslocava a página ~28px | Indicador movido para a topbar, com largura reservada e altura fixa. Layout shift medido: **0px**. |
| 12 | Slug não acompanhava o título | Slug segue o título até alguém editá-lo. Sessão nova infere pelo valor armazenado. Publicado/agendado sempre travado. |
| 13 | Preview 200 mas nada aparecia | `window.open` depois do `await` perdia o gesto do usuário e o Chrome bloqueava. Virou drawer no editor com desktop/tablet/mobile + âncora real para nova aba. |
| 14 | `window.prompt()` em link e agendamento | `LinkDialog`, `DateTimeDialog`, `UrlDialog`, `SourceDialog` — validados, canceláveis, navegáveis por teclado. Link agora também remove. |
| 15 | Calendário era tabela de 2 colunas | Mês, semana e agenda; hoje marcado; item com hora, título, status e autor; agendamentos vencidos sinalizados. |
| 16 | Site sem domínio | `sites.primary_domain`, normalizado na entrada. SERP e social preview usam o domínio real. |
| 17 | Article Index sem busca/filtro/paginação | Tabs por status com contagem, busca, filtros com chips, ordenação, paginação por cursor, 7 colunas densas. |
| 18 | Roles/Users sem permissões nem memberships | `listRoles` devolve as permission keys; `/v1/admin/users` devolve memberships por site; UI com resumo, matriz agrupada e diálogo de atribuição. |
| 19 | Workflow sem contexto editorial | Rejeição exige comentário escrito; submit/approve/unpublish aceitam opcional. Comentário lido de volta do audit trail e exibido na fila. |
| 20 | SEO sem orientação | Contadores objetivos (`42 / 60`), sem score. Robots e canonical em linguagem humana. |
| 21 | Salvar jogava para o topo | Save aplica só a nova versão ao estado local. Sem remount, sem `router.refresh()`. |

---

## P2 — corrigidos

- **Status humanizados** — mapa único em `packages/design-system/src/status.ts`. Nenhuma
  tela imprime enum cru.
- **Breadcrumbs** — na topbar, publicados pela página via `lib/chrome.tsx`, com fallback
  derivado da rota.
- **H1 do editor ao vivo** — acompanha o estado local, sem reload nem remount.
- **Slash menu no caret** — `coordsAtPos`, limitado à superfície, com flip quando não cabe.
- **Taxonomias escaláveis** — `TokenPicker` pesquisável para tags, autores e entidades.
- **Entities** — combobox creatable (o `type` é string livre e extensível na API).
- **Authors** — bio e e-mail passam a ser editáveis, não só definidos na criação.
- **Revisões** — autosaves consecutivos da mesma hora agrupados, com as versões
  individuais ainda restauráveis.
- **404** — dentro do shell, com Voltar / Dashboard / Artigos.
- **Dashboard** — contadores que são filas clicáveis + listas operacionais. O painel
  operacional elogiado no review foi preservado como estava.

### P2 adiados (com motivo)

- **Coleções de mídia** — o pacote desenha uma árvore de coleções; a API não tem o
  conceito. Inventar no cliente seria ficção.
- **Usage / references de mídia** — não existe endpoint. O estado "em uso" aparece onde a
  API realmente o reporta: no 409 do delete.
- **Author platform** (avatar, links sociais, contagem de conteúdo, artigos recentes) — o
  schema tem `name`, `slug`, `bio`, `email`. Criar dezenas de campos para cumprir um
  screenshot não era o objetivo desta rodada.
- **Busca global na topbar** — a busca foi entregue no Article Index. Nenhum botão morto
  foi deixado na topbar.
- **Bulk actions na tabela** — o pacote desenha a barra flutuante; nenhum endpoint de
  operação em lote existe.

---

## Telas implementadas

Dashboard · Articles · Article Editor · Media · Workflow · Calendar · Sites · Users ·
Roles · Entities · Authors · 404. Audit, Webhooks, Tokens, Settings, Categories, Tags e
Sources herdam shell, tokens, tabela e status sem alteração própria.

## Responsivo e tema

- Desktop 1440 / 1526, tablet 768, mobile 390.
- Sidebar vira drawer e o inspector vira bottom sheet abaixo de 1024px — no editor,
  aberto por um botão explícito, não empilhado sob o artigo.
- Alvos de 44px nas ações mobile do editor.
- Dark mode com surfaces próprias (`#101210` canvas, `#181A17` surface), não inversão.
  Não foi redesenhado — o review o elogiou.

## Medições

| Gate | Resultado |
|---|---|
| Primary button, light | 12.89:1 |
| Primary button, dark | 16.79:1 |
| Secondary, light / dark | 7.99:1 / 10.37:1 |
| Layout shift do autosave | 0px |
| Header / row da tabela | 38px / 44px (48px com avatar) |
| Divisor de row | `1px dotted #D9D9D6` |
| Coluna do editor | 820px |
| Título do editor | 36/44, 600, −0.025em |
| Inspector | 336px |

## Verificação

`pnpm -r typecheck`, `pnpm -r lint` e `pnpm -r build` limpos nos 13 pacotes. Os 161 testes
da API passam.

A varredura visual (`apps/cms/e2e/visual-validation.mjs`) roda contra o build de produção
e percorre 13 telas × 4 viewports × 2 temas:

```
captured 78 combinations
actually measured     : 78
nav errors            : 0
shell did NOT render  : 0
invisible CTAs        : 0
unreachable content   : 0
double scrollbars     : 0
```

O `actually measured` existe por um motivo. Na primeira execução a varredura reportou zero
defeitos em tudo — e todas as capturas eram, na verdade, a tela de erro do Next: um build
de produção rodando em paralelo havia corrompido o `.next` do dev server. Zero achados
sobre um objeto que nunca renderizou é o resultado mais perigoso possível, porque é
indistinguível de aprovação. A varredura agora registra, por combinação, se o shell do CMS
apareceu, calcula os contadores só sobre o que foi realmente medido, e sai com código
diferente de zero imprimindo `SWEEP INCONCLUSIVE` quando algo não navega ou não renderiza.

Uma observação sobre "enum cru": a checagem acusava seis ocorrências na tela de Webhooks.
São `article.published` / `article.scheduled` — nomes de evento, exatamente as strings que
um assinante recebe, não rótulos de status. O detector passou a ignorar identificadores
que terminam nessas palavras.

---

## Ambiente local

```bash
node packages/testkit/dev-db.mjs                 # PostgreSQL local na 55432
set -a && . ./.env && set +a && pnpm dev:api     # API   http://localhost:3001
set -a && . ./.env && set +a && pnpm --filter @kal-el/worker dev
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 pnpm --filter @kal-el/cms dev   # CMS 3000
```

Login: `owner@kalel.dev` / `kalel-dev-password-1`.

**Não rode `next build` com o `next dev` no ar.** Os dois compartilham `apps/cms/.next` e
o build corrompe o dev server em execução — foi o que invalidou a primeira varredura
visual.

### Dados do product review

Os resíduos do revisor (artigo "Teste Editorial Kal El" agendado para 15/09/2026, e a
categoria/tag/autor criados junto) **não estão mais no banco**. Eles foram removidos como
efeito colateral de uma execução da suíte de testes com `DATABASE_URL` apontando para o
banco local — o harness derruba e recria o schema `public`. Isso era permitido para
exatamente este banco (`postgresql://kalel:kalel@localhost:55432/kalel`, smoke local), mas
aconteceu por acidente, não por limpeza deliberada.

O defeito latente que permitiu isso foi corrigido: `freshTestDb` derrubava só o schema
`public` e deixava a tabela de controle de migrations, no schema `drizzle`, afirmando que
tudo já estava aplicado — o banco ficava vazio e a suíte inteira falhava com 42P01. Agora
derruba os dois.

O banco atual tem um dataset de smoke coerente: 10 artigos cobrindo os seis estados, 4
categorias, 8 tags, 3 autores, o site com domínio `maquinanerd.com.br` e os cinco papéis
padrão.

## Evolução de produto que continua aberta

Coleções de mídia, usage tracking, author platform, busca global, bulk actions, saved
views, colunas customizáveis, assignments e times. Nada disso é defeito: é o produto de
longo prazo descrito na especificação completa, fora do escopo desta rodada.

---

# Final acceptance closure

Segundo product review no Chrome: **P0 = 0, P1 = 6**. Esta seção fecha os seis, o bloco
mobile que o review não conseguiu percorrer, e os P2 baratos.

O achado que atravessa quase tudo: **nenhum dos seis era problema de estilo.** Lista e
citação não eram criadas; o ciclo automático do slug era desligado pela própria
deduplicação do servidor; o diálogo de link não enxergava o link em que o cursor estava; e
a linha de identidade do drawer era um botão de logout. Estilo era a consequência, não a
causa.

## P1-1 — Listas e citação sem representação visual

**Original.** Lista, lista numerada e citação pareciam parágrafos, no editor e no Preview.

**Causa.** `listItem` e `blockquote` estavam declarados `content: "inline*"` — uma forma em
que nenhum parágrafo pode ser embrulhado. `findWrapping` procura um caminho do content
match do wrapper até o bloco selecionado, e `inline*` não admite bloco algum. Então
`wrapInList` e `wrapIn` **retornavam false e não despachavam nada**: os botões, os comandos
de barra e os atalhos eram no-ops silenciosos e o parágrafo continuava parágrafo. Medido
antes da correção, contra o schema real:

```
wrapInList(bulletList) applicable: false
wrapInList(orderedList) applicable: false
wrapIn(blockquote)     applicable: false
```

Havia um segundo defeito por baixo, que sozinho já impediria qualquer um dos três:
`documentToProseMirror` construía o **próprio** `Schema` e ignorava o do chamador, então o
editor rodava com um state cujo schema e cujo documento vinham de dois objetos `Schema`
diferentes. ProseMirror compara tipos de nó por identidade — content matching, todo
`findWrapping`, todo teste de igualdade de tipo — e nada jamais coincidia.

**Correção.** Os dois nós passam a conter parágrafos; o contrato de wire não muda (`quote`
continua um inline run, `list` um run por item) e os conversores põem e tiram esse
parágrafo na fronteira. `documentToProseMirror` recebe o schema do state. Desfazer a lista
passou a usar `liftListItem` — o `lift` genérico deixa a lista em volta do item. Citação
virou toggle. O CSS de marcador, indentação e trilho entrou nas **duas** superfícies,
editor e renderer do preview.

**Verificação.** `apps/cms/e2e/p1-closure.spec.ts`, em Chromium real, afere o estilo
computado e não só a tag: `list-style-type: disc` na lista, `decimal` na numerada,
`border-left-width` de no mínimo 2px na citação, e indentação acima de 8px. O DOM produzido
contra o build de produção:

```
ul > li > p  ×3   (Primeiro / Segundo / Terceiro item)
editor  -> ul=1 ulLi=3 ol=1 olLi=3 blockquote=1
preview -> ulLi=3 olLi=3 blockquote=1
```

Nesting não é suportado, deliberadamente: o item de lista do contrato é um único inline
run, então uma lista aninhada não teria onde ser guardada e sumiria no save. Recusar é
honesto; aceitar e descartar não.

## P1-2 — Slug novo nascia manual

**Original.** Um artigo novo abria já dizendo "Definido manualmente — o título não altera
mais este endereço", antes de o título ser digitado.

**Causa.** O ciclo automático existia e era desligado no nascimento pelo servidor.
`uniqueSlug` acrescenta `-2` quando a base já existe, então o segundo rascunho chamado
"Novo artigo" é gravado como `novo-artigo-2`; o cliente comparava com `novo-artigo`, achava
diferença e concluía que um humano havia escolhido.

**Correção.** A forma de colisão passa a contar como automática, e um slug automático
acompanha a deduplicação do servidor no save em vez de exibir uma URL que o artigo não tem.
O lock virou state, não ref, então o hint reflete o modo em que o campo está. Só uma edição
real trava, e existe uma volta explícita — **"Gerar a partir do título"** — em vez de
esvaziar o campo, que ninguém adivinha e que lê como "apagar a URL". O corte do `slugify`
do cliente foi alinhado ao do servidor (120), porque em 96 um título longo gerava um slug
que o servidor nunca escreveria e a comparação lia isso como edição deliberada.

**Verificação.** Artigo novo → hint automático. Título `Acceptance Slug Automatic` → slug
acompanha (`acceptance-slug-automatic`, com sufixo se deduplicado) e **continua
automático**. Edição manual → trava e sobrevive a uma troca de título. "Gerar a partir do
título" → volta ao automático. A captura de tela mostra o caso exato do defeito:
`acceptance-visual-kal-el-2`, deduplicado pelo servidor, com o hint "Gerado a partir do
título".

## P1-3 — Ctrl+B / Ctrl+I destruindo marca já escrita

**Original.** `AAA` · Ctrl+B · `BBB` · Ctrl+B · `CCC` perdia o negrito de `BBB`.

**Causa.** No nível de comando o toggle sempre esteve correto — `toggleMark` com seleção
colapsada mexe em `storedMarks`, e uma reprodução headless do caso exato devolve
`AAA` normal, `BBB` em negrito, `CCC` normal. O que quebrava era o schema duplo descrito em
P1-1: marcas criadas pelo comando pertenciam a um `Schema` e o documento a outro, e a
reconciliação de DOM do ProseMirror parte de `view.state.schema`.

**Correção.** A mesma: um único schema. Nenhuma reescrita do toggle foi necessária, e por
isso nenhuma foi feita.

**Verificação.** Os dois casos exatos do briefing, em Chromium: exatamente um `strong` com
texto `BBB`, parágrafo `AAA BBB CCC`. Idem para itálico com `em`.

## P1-4 — Link não carregava a URL atual e não removia

**Original.** Criar link funcionava; com o cursor dentro de um link existente o diálogo
abria vazio e sem remover.

**Causa (duas).** `currentLink` lia `$from.marks()`, que reporta as marcas do caractere
**anterior** à posição — então um cursor no primeiro caractere do link, e toda seleção
feita com duplo clique na palavra (cujo `from` é exatamente essa posição), voltava "não é
link". E o `state.selection` do ProseMirror atrasa em relação ao DOM: o observer de DOM
faz flush assíncrono, então `Shift+End` seguido de Ctrl+K chegava com a seleção ainda
colapsada no caret. Medido:

```
DOM selection   : anchor=0 focus=6 "OpenAI"
state.selection : {from: 7, to: 7}
resultado       : OpenAI + link novo com a URL como texto
```

**Correção.** O intervalo é lido de volta do DOM via `posAtDOM` — API pública, mesma fonte
que o observer usará — e o diálogo **guarda o intervalo com que foi aberto**, porque abrir
o modal tira o foco da superfície e colapsa a seleção: na hora do "Aplicar" as palavras já
não estão selecionadas em lugar nenhum. Remover tira só a mark. A bubble toolbar reflete o
estado: dentro de um link o botão fica `aria-pressed` e aparece uma ação de remover ao
lado. O campo "Texto" do diálogo passou a ser aplicado, em vez de editável e ignorado.

**Verificação.** Aplicar → reabrir → URL já preenchida → "Remover link" → texto permanece,
a âncora some. E a bubble toolbar marcando o link como ativo.

## P1-5 — "Owner" no drawer mobile fazia logout

**Original.** No drawer de 390px, tocar em **Owner** encerrava a sessão. Foi o que
interrompeu o review anterior antes do bloco mobile.

**Causa.** O rodapé da sidebar era um único botão rotulado com o nome do usuário cuja ação
era `signOut`. No desktop a topbar já tem um "Sair" explícito, então ninguém o pressionava;
a 390px o rodapé do drawer é a única superfície de conta.

**Correção.** Identidade virou texto: avatar, nome, e-mail. Sair é uma ação rotulada, com
ícone próprio, abaixo. Sem modal de confirmação — logout é reversível e não destrói nada, e
um modal só acrescentaria um passo. O desktop herda a mesma separação.

**Verificação.** A 390px, em contexto e sessão próprios: a linha de identidade não contém
nenhum botão, tocá-la não desloga, e só a ação "Sair" leva para `/login`.

## P1-6 — Comentário de bloqueio não aparecia no artigo

**Original.** O autor abria um artigo bloqueado e via "Bloqueado" e "Reenviar p/ revisão" —
o estado e a saída, nunca o motivo.

**Causa.** O comentário era persistido e exibido na fila de revisão, mas só existia no
audit trail, atrás de `audit.read` — permissão que um autor não tem. A única coisa possível
com o que estava na tela era devolver o artigo sem mudar nada.

**Correção.** O DTO do artigo passa a **derivar** a nota da transição que produziu o status
atual. Nada novo é armazenado, então não há segunda cópia para divergir do log. Escopado à
transição que produziu o estado em que o artigo está, e não à nota mais recente de qualquer
tipo: um "enviado para revisão" antigo apresentado como motivo de bloqueio seria pior que
não mostrar nada.

**Verificação.** Teste de API dedicado (`workflow.test.ts`): o autor lê a nota da rejeição
com a mesma permissão de leitura que já tem, e reenviar não carrega a nota adiante. Na UI,
banner "Alterações solicitadas" com o texto, o autor e a data, sobrevivendo a um reload.

## P2

| Item | Resultado |
|---|---|
| Autosave text | "Salvando…" desde a tecla. `idle` renderiza slot vazio, então cada edição apagava o indicador durante toda a janela de debounce. |
| Role descriptions | Traduzidas. Uma instalação já semeada é migrada — só onde o texto ainda é o nosso default intocado, para não reverter um papel que um operador renomeou. |
| Permission display | "Gerenciar autores" em vez de `taxonomy.authors.manage`, com a key no tooltip e sob o checkbox (é o que um caller de API envia). |
| User chip | `.peg-chip` é flex container e o espaço inicial do separador era colapsado: "Owner· Portal A". Corrigido na caixa, não no texto. |
| Agenda navigation | As setas moviam uma janela que ninguém lia — mês e semana fatiam por `calendarRange`, a agenda listava tudo e ignorava o cursor, sob um header fixo em "Próximos 30 dias". Agora fatia pelo mesmo range e nomeia o intervalo. |
| Autosave revision noise | A API escreve nota própria em toda revisão (`created`, `updated`, `published`) e o painel tratava qualquer nota como nome editorial: nenhum agrupamento acontecia e a lista mostrava onze linhas seguidas escritas `updated`. Marcadores viraram marcadores. Nada é escondido; toda revisão continua listada e restaurável. |
| Webhook disabled button | A coluna é `align-items: stretch` e a ação ocupava o card inteiro. |

## Mobile — o bloco que não tinha sido testado

Percorrido a 390px de ponta a ponta (`apps/cms/e2e/mobile-closure.spec.ts`). As asserções
são de geometria e alcance, não de aparência: nada escapa lateralmente da viewport, todo
controle que a tarefa exige é tocável, e uma superfície mais alta que a tela rola dentro de
si em vez de empurrar a página.

| Superfície | Resultado |
|---|---|
| Editor | Título 28px, corpo com no mínimo 16px, sem overflow de página |
| Toolbar | Quebra em duas linhas, não corta; botões tocáveis |
| Actions | Quebram; Preview, Enviar, Agendar, Publicar e Documento todos dentro da viewport |
| Slash menu | Dentro da viewport mesmo com o caret junto à borda |
| Bubble toolbar | Dentro da viewport |
| Dialogs | Link e agendamento dentro da viewport, sem scroll lateral |
| Inspector | `position: fixed` e `visibility: hidden` fechado — sheet, não 2000px empilhados; abre pelas três abas, rola internamente, altura limitada pela viewport |
| Calendar | Mês, semana e agenda sem overflow de página; as setas movem o intervalo e o header o nomeia |
| Articles | Busca, tabela com scroll próprio e a ação da primeira linha, todos alcançáveis |

## Verificação desta rodada

```
pnpm -r typecheck   limpo (13 pacotes)
pnpm -r lint        limpo (13 pacotes)
pnpm -r build       limpo (13 pacotes)
API                 162 testes, 22 arquivos — verde
p1-closure.spec     10/10
mobile-closure.spec  7/7
```

Varredura visual contra o build de produção, 13 telas × 4 viewports × 2 temas:

```
captured 78 combinations
actually measured     : 78
nav errors            : 0
shell did NOT render  : 0
invisible CTAs        : 0
unreachable content   : 0
double scrollbars     : 0
raw enums in UI       : 0
SWEEP OK
```

A primeira execução voltou `SWEEP INCONCLUSIVE` com 77 de 78 sem shell — o `.next` tinha
ficado com estado de dev depois de um `next dev` na mesma pasta. Foi exatamente o defeito
que a varredura endurecida existe para pegar. Limpar `.next` e reconstruir resolveu, e a
regra continua valendo: **pare o dev antes de buildar.**

A segunda execução acusou `raw enums in UI: 4` — `published` na tela do editor. Não era
falso positivo: era a lista de revisões imprimindo a nota que a própria API escreve. Está
no P2 acima.

### Acessibilidade

O gate do axe acusava 11 instâncias sérias, todas de uma regra: `--peg-text-disabled`
(#B3B5AF, cerca de 2.1:1) usado em texto que não é controle desabilitado — a contagem de
uma aba e os dias fora do mês no calendário. Ambos passaram para `--peg-text-tertiary`, que
cumpre AA em 4.56:1, e a contagem da aba ativa para `secondary`, preservando a hierarquia.
Nenhuma cor nova. O gate está verde.

### Testes e2e que continuam vermelhos (7)

Não são defeitos de produto: são expectativas desatualizadas desde a rodada visual, em
superfícies que o review já aprovou. O `aria-label` do título virou "Título do artigo", os
status deixaram de imprimir enum cru, o gatilho de imagem destacada foi renomeado, e as
transições de workflow passaram a pedir comentário antes de disparar. Os que eram troca de
seletor foram corrigidos; restam **7** — nomes de item na grade de mídia, rótulos de campo
de SEO e a aba de status na fila do workflow. Deixados como estão de propósito:
persegui-los é uma campanha mais larga que esta rodada.

### Dados locais

A validação visual criou dois artigos no banco de smoke: `Acceptance Visual Kal El`
(bloqueado, com a nota de revisão real, útil como evidência clicável) e um `Novo artigo`
residual. **A API não expõe rota de exclusão de artigo**, então não foram removidos.
