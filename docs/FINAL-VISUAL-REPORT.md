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

`pnpm -r typecheck` e `pnpm -r lint` limpos nos 13 pacotes. Os 161 testes da API passam.
A varredura visual (`apps/cms/e2e/visual-validation.mjs`) percorre 12 telas × 4 viewports
× 2 temas medindo scroll alcançável, CTA invisível, scroll duplo e enum cru na interface.

---

## Evolução de produto que continua aberta

Coleções de mídia, usage tracking, author platform, busca global, bulk actions, saved
views, colunas customizáveis, assignments e times. Nada disso é defeito: é o produto de
longo prazo descrito na especificação completa, fora do escopo desta rodada.
