# Kal El — Visual / Responsive / Accessibility Audit

**Método:** navegador real (Chromium via Playwright), medição mecânica + inspeção de código
e de screenshots. Nenhum item abaixo é inferido a partir de relatório anterior.

**Harness reproduzível:**

```bash
pnpm --filter @kal-el/cms exec playwright test audit-responsive
```

```bash
pnpm --filter @kal-el/cms exec playwright test a11y
```

O primeiro é diagnóstico (coleta evidência, nunca falha); o segundo é gate (falha com
qualquer violação `critical` ou `serious` do axe).

**Cobertura:** 19 superfícies × 5 breakpoints (375 / 390 / 768 / 1024 / 1440) × 2 temas
= **190 medições**, mais screenshot de cada combinação em `apps/cms/artifacts/shots/`.

*Media Detail* entrou na cobertura na rodada de fechamento. Ela era pulada **em toda
execução anterior** e a razão não era a biblioteca vazia: o harness procurava
`a[href^='/media/']` para descobrir um id, mas a grade renderiza cada asset como
`<button aria-label="Abrir …">`. O seletor nunca casava, e o laço simplesmente seguia.
Agora as varreduras semeiam um asset pela API.

---

## 1. Resultado mecânico — antes × depois

| métrica | antes | depois |
|---|---|---|
| Medições com navegação inalcançável | **107 / 180** | **0 / 190** |
| Controle para abrir a navegação existe | **não** (nenhuma superfície) | **sim** |
| Overflow horizontal | 0 | 0 |
| Erros de console durante a varredura | 90 | 0 |
| Dark mode alcançável pelo produto | **não** | sim |
| Violações axe `critical`/`serious` | 6 (2 regras) | **0** |

Distribuição do bloqueio original, por largura:

```
375px  34 medições    (17 superfícies autenticadas × 2 temas)
390px  34
768px  34
1024px  2   (artefato de medição — shell ainda montando)
1440px  3   (idem)
```

Ou seja: **100% das superfícies autenticadas** ficavam sem navegação em 375, 390 e 768px.

### Gate axe

76 varreduras (19 superfícies × 2 viewports × 2 temas), WCAG 2.1 A + AA.

```
AXE_TOTAL_VIOLATION_INSTANCES=0
AXE_DISTINCT_RULES=0
```

As 6 instâncias da primeira execução, todas corrigidas:

| regra | onde | causa |
|---|---|---|
| `color-contrast` ×2 | Dashboard, dark, 1440 e 390 | botão sem cor própria: o reset base definia `font-*` mas **não** `color`, então um botão sem chrome caía no `buttontext` do UA (escuro) sobre superfície escura |
| `color-contrast` ×2 | Sites, light, 1440 e 390 | `.peg-badge--success` usava `--peg-success` sobre o próprio tint de 10% = 2,96:1 |
| `scrollable-region-focusable` ×2 | Audit log, 390, ambos os temas | `.peg-table-wrap` (introduzido nesta passagem) rola horizontalmente e não tinha filho focável |

Correções: `color: inherit` no reset de controles; tokens `--peg-badge-*-fg` dedicados
(escurecidos no claro, mantendo os valores brilhantes no escuro); `tabIndex={0}` no wrapper
de tabela.

Além do axe, três testes de comportamento que ferramenta automática não cobre:

- navegação primária alcançável e operável sem mouse em 390px;
- `Modal` move o foco para dentro ao abrir e fecha em `Escape`;
- a varredura axe em si.

---

## 2. P0 — corrigidos

### P0-1 · Navegação primária inalcançável abaixo de 1024px

`packages/design-system/src/styles.css` movia `.peg-sidebar` para `translateX(-100%)`
abaixo de 1024px e definia `.peg-sidebar--open` para trazê-la de volta — mas **nenhum
componente aplicava essa classe**: `Sidebar` não recebia estado de abertura, e não havia
hambúrguer em lugar nenhum do produto. Abaixo de 1024px o usuário não tinha navegação
degradada; tinha navegação **ausente**.

`design-system/03_APPLICATION_SHELLS.md` (Shell F) exige "hamburger/drawer".

**Correção:** `Sidebar` passa a aceitar `open`/`onClose`, move foco para dentro ao abrir,
fecha em `Escape` e em mudança de rota, e devolve o foco ao gatilho. Novo `MenuButton`
(oculto por CSS a partir de 1024px) e scrim que fecha ao clique. O drawer fechado recebe
`visibility: hidden` — sem isso seus botões continuariam na ordem de tabulação e o foco
sumiria para fora da tela.

**Evidência:** `NAV_UNREACHABLE` 107 → 0.

### P0-2 · Dark mode inalcançável

Os tokens `[data-theme="dark"]` existiam e eram bons (superfícies próprias, não inversão),
mas `apps/cms/app/layout.tsx` fixava `data-theme="light"` no `<html>`, sem toggle e sem
detecção de sistema. `design-system/ACCEPTANCE_CHECKLIST.md` exige "Dark mode validado"
para fechar a fase.

**Correção:** `ThemeToggle` na topbar + script de bootstrap inline que aplica o tema antes
da primeira pintura (localStorage → `prefers-color-scheme`), portanto sem flash. O
`suppressHydrationWarning` no `<html>` elimina os 90 erros de console que a divergência
servidor/cliente nesse atributo produzia.

### P0-3 · Modal sem qualquer gestão de foco

`Modal` declarava `role="dialog"` e `aria-modal="true"` — afirmando que o fundo está
inerte — mas não movia foco, não prendia foco, não tratava `Escape` e não devolvia o foco
ao fechar. É o único caminho para inserir imagem, galeria, imagem de destaque, imagem
social e link interno (`MediaPicker`, `InternalLinkPicker`), ou seja, está no fluxo
central de escrita.

**Correção:** foco entra ao montar, `Tab`/`Shift+Tab` ciclam dentro do diálogo, `Escape`
fecha, clique no backdrop fecha, foco retorna ao gatilho.

### P0-4 · Checkboxes de taxonomia invisíveis no editor

`CheckboxGroup` (editor de artigo) renderizava `<label class="peg-checkbox">` com o input
nativo, mas **sem** o `<span class="peg-checkbox__box">` que é o controle visual do design
system — e o input nativo é escondido por CSS (`opacity: 0; width: 0; height: 0`).
Resultado: categorias, tags, entidades e autores eram selecionáveis mas **nada era
desenhado**; nenhum usuário enxergava o que estava marcado. Contraste efetivo 1:1
(WCAG 1.4.11).

**Correção:** o box visual passa a ser renderizado.

---

## 3. P1 — corrigidos

### P1-1 · `border: var(--peg-border)` é declaração inválida

`apps/cms/app/globals.css` escrevia `border: var(--peg-border)` e
`border-bottom: var(--peg-border)`. `--peg-border` é uma **cor** (`#e5e5e7`), não um
shorthand — a declaração é inválida em tempo de valor computado, a propriedade cai para
`initial` (`medium none currentcolor`) e **o editor renderizava sem borda nenhuma**, assim
como o divisor entre toolbar e superfície de escrita. É a mesma classe de defeito que o
commit `3a96a3a` corrigiu para tipografia, sobrevivendo em bordas.

### P1-2 · Tokens inexistentes com fallback hardcoded quebravam o dark mode

`globals.css` referenciava `--peg-surface-hover` e `--peg-border-color`, **nenhum dos dois
definido** em `tokens.css`. Os fallbacks literais (`#f3f4f6`, `#e5e7eb`) são cores de tema
claro, então no dark mode o hover dos botões do editor era cinza-claro sobre superfície
escura. Também havia `var(--peg-accent, #2563eb)` — azul, quando o accent PEG é vermelho
editorial.

### P1-3 · Cores semânticas nunca redefinidas no dark

O bloco `[data-theme="dark"]` sobrescrevia canvas/surface/border/text/accent/shadow mas
deixava `--peg-info`, `--peg-danger`, `--peg-success` e `--peg-warning` nos valores claros.
Medições contra as superfícies escuras:

| par | antes | mínimo |
|---|---|---|
| info `#2563eb` sobre canvas `#19191b` | 3,40:1 | 4,5:1 |
| info sobre surface-muted `#2d2d30` | 2,66:1 | 4,5:1 |
| danger `#dc2626` sobre surface `#202022` | 3,37:1 | 4,5:1 |
| accent `#e6455f` sobre surface-muted | 3,52:1 | 4,5:1 |
| text-tertiary `#8c8c91` sobre surface-muted | 4,10:1 | 4,5:1 |

**Correção:** valores próprios para dark (`--peg-info: #7aa5f5`, `--peg-danger: #f87171`,
`--peg-success: #4ade80`, `--peg-warning: #fbbf24`, `--peg-accent: #ff7089`,
`--peg-text-tertiary: #9a9aa0` = 4,91:1).

### P1-4 · `--peg-text-tertiary` reprovava contraste no tema claro

`#8e8f94` medido contra as quatro superfícies claras:

| fundo | ratio |
|---|---|
| `#ffffff` surface | 3,23:1 |
| `#fafafa` canvas | 3,09:1 |
| `#f7f7f8` surface-subtle | 3,01:1 |
| `#f2f2f3` surface-muted | **2,88:1** |

Todos os consumidores são texto de 11–13px (`th` de tabela, hints de campo, estado de
autosave, breadcrumb, labels de grupo da sidebar, títulos do inspector, placeholders),
portanto nenhum se qualifica como texto grande. **Corrigido para `#6e6f74`** — 4,62:1 na
superfície mais escura em que aparece.

> Nota de contexto: uma auditoria anterior do PEG registrou que este token é compartilhado
> com Commerce Wayne e Aluguei e por isso não fora alterado, existindo apenas uma camada
> opt-in `[data-contrast="aa"]`. Essa camada **não existe neste repositório** — nem o
> atributo, nem o bloco de tokens. Como o valor reprovava AA em todas as superfícies e o
> `ACCEPTANCE_CHECKLIST` exige o gate de acessibilidade fechado, o token foi corrigido na
> origem. Se a partilha entre produtos for confirmada, a decisão deve ser reavaliada.

### P1-5 · Bordas de controle a 1,46:1

`--peg-border-strong: #d5d5d8` contra branco = **1,46:1**, onde WCAG 1.4.11 pede 3:1 para
o limite visual de um componente. É a borda de todo `input`, `textarea`, `select`, do
`checkbox__box`, do `radio__dot` e do estado OFF do switch — na prática, um checkbox
desmarcado era invisível. **Corrigido para `#949499`** (≈3:1).

### P1-6 · Anel de foco abaixo do mínimo, e removido nos botões

`--peg-focus-ring` era `0 0 0 2px var(--peg-surface), 0 0 0 4px rgba(37,99,235,0.45)`. O
anel interno opaco pinta por cima do azul, sobrando uma faixa a 45% de alfa composta
contra a superfície:

| contexto | ratio efetivo |
|---|---|
| claro sobre `#ffffff` | 1,96:1 |
| claro sobre canvas `#fafafa` | 2,03:1 |
| escuro sobre `#202022` | 1,59:1 |

Pior: `.peg-btn:focus-visible` definia `outline: none`, removendo o único indicador que
**passava** (o outline global, 5,17:1). **Corrigido:** anel externo sólido via novo token
`--peg-focus`, e o outline dos botões preservado.

### P1-7 · Inspector do editor esmagava a superfície de escrita no mobile

O `<aside>` do editor era `width: 320px; flex-shrink: 0` dentro de um flex sem
`flex-wrap`. Em 375px isso deixava ~35px para o texto. **Corrigido:** layout movido para
CSS (`.kalel-editor-layout`), empilhando o inspector abaixo do conteúdo abaixo de 1024px —
conteúdo permanece dominante, inspector permanece contextual.

### P1-8 · Estado de autosave sem região viva

"Salvando… / Salvo / Erro ao salvar" era passado como `description` do `PageHead`,
renderizando um `<p>` comum. Sem `aria-live`, um usuário de leitor de tela não recebia
confirmação de que o trabalho foi salvo (WCAG 4.1.3). **Corrigido:** elemento próprio com
`role="status"` / `aria-live="polite"`.

### P1-9 · Checkboxes de seleção de tabela não clicáveis e sem função

`Table` usava `<span class="peg-checkbox">` em vez de `<label>`, sem `id`/`htmlFor`, com o
input real em 0×0 — alvo de ponteiro efetivamente nulo. Pior: `selectable` era `true` por
padrão e nenhuma ação em massa existe, então toda listagem do produto injetava N+1
controles focáveis e inertes na ordem de tabulação. **Corrigido:** `<label>`, rótulos em
pt-BR e com nome legível via `rowLabel`, e `selectable` passa a ser `false` por padrão.

### P1-10 · Sem link de salto

Toda página repetia 16 itens de navegação antes do conteúdo. **Corrigido:** link "Pular
para o conteúdo" como primeiro elemento focável, visível apenas em foco.

---

## 4. P2 — registrados, não corrigidos nesta passagem

| id | item | por que fica |
|---|---|---|
| P2-1 | `Card` emite `<h3>` direto sob o `<h1>` do `PageHead`; nenhum `<h2>` no CMS | mudança transversal de hierarquia; sem impacto funcional |
| P2-2 | `Tabs` declara `role="tab"` sem `aria-controls`/`tabpanel` e sem roving tabindex | componente **não é usado** em `apps/cms`; latente |
| P2-3 | `FieldShell` coloca erro/hint dentro do `<label>` (vira nome, não descrição) | a prop `error` nunca é passada no CMS; validação sobe por `Alert role="alert"` |
| P2-4 | 3 mensagens de erro sem `role="alert"` (dashboard, media detail, audit) | inconsistência pontual; o resto do app usa `Alert` |
| P2-5 | Botões-badge de permissão/escopo com 22px de altura (< 24px de WCAG 2.2 AA) | telas de admin, baixa frequência |
| P2-6 | `Search` sem nome acessível (placeholder como rótulo) | corrigível com uma prop; afeta 3 chamadas |
| P2-7 | Toolbar do editor sem `aria-pressed` nos toggles | ver seção 6 |
| P2-8 | `Tab`/`Shift+Tab` consumidos dentro de listas do editor | comportamento convencional de rich text; falta apenas documentar a saída |

Sobre alvos de toque: WCAG **2.1** não tem critério AA de tamanho de alvo (2.5.5, 44×44, é
AAA). WCAG **2.2** adiciona 2.5.8 em 24×24. `.peg-nav-item` (32px), `.peg-rail__item`
(40×40) e os botões da toolbar (28px) **passam** em 24×24; falham apenas na régua AAA. O
número `MAX_SMALL_TARGETS_ON_A_SURFACE=53` do harness usa 44px e portanto mede a régua
AAA, não um gate de AA — está no relatório como referência, não como reprovação.

---

## 5. Geometria contra a spec PEG

Medida em `packages/design-system/src/tokens.css` contra
`design-system/01_FOUNDATIONS.md`:

| métrica | implementado | alvo PEG | |
|---|---|---|---|
| Sidebar full | 240px | 232–248 | ok |
| Compact rail | 64px | 60–64 | ok |
| Topbar | 52px | 48–56 | ok |
| Inspector | 336px | 300–360 | ok |
| Linha de tabela | 52px | 48–56 | ok |
| Coluna do editor | 840px | 720–900 | ok |
| Alturas de controle | 28/32/36/40 | 28/32/36/40 | ok |

A geometria já estava conforme. Os defeitos eram **comportamentais** (responsivo, tema,
foco) e de **token** (contraste), não métricos.

---

## 6. Contrato do editor — lacunas remanescentes

`docs/02-EDITOR-UX.md:5` lista como obrigatórios, entre outros: *slash commands*,
*drag/drop/paste de imagens*, *toolbar inline contextual*, *modo sem distração*,
*crop/focal metadata*, *destaques/cores por token*.

Verificado por busca no código (`apps/cms/components/editor/RichTextEditor.tsx` e
`packages/editor/src/`):

| recurso | estado |
|---|---|
| Parágrafo, H2–H4, listas, citação, tabela | presente |
| Negrito, itálico, código, sublinhado, tachado, link | presente |
| Imagem, galeria, embed (YouTube com allow-list), fonte | presente, via menu "Inserir" |
| Autosave, revisões, diff, preview | presente |
| **Slash command `/`** | **ausente** |
| **Drag & drop de imagem** | **ausente** (`handleDrop`/`dragover` inexistentes) |
| **Paste de imagem** | **ausente** (`handlePaste` inexistente) |
| **Toolbar inline contextual** | CSS `.peg-inline-toolbar` existe; o editor usa só a toolbar fixa |
| **Modo sem distração** | ausente |
| **Focal point / crop** | ausente |
| `aria-pressed` nos toggles da toolbar | ausente (P2) |
| Nome acessível da superfície de escrita | ausente (P2) |

**Fechado na rodada seguinte** (P1-H): slash command, drag/drop, paste, **toolbar inline
contextual**, **modo sem distrações**, **ponto focal** e **alt text**.

O alt text era o mais grave: todo nó de imagem era criado sem `altText`, então o renderer
emitia `alt=""` — que marca a imagem como decorativa e a remove inteiramente para leitores
de tela. Fotos editoriais eram silenciosamente invisíveis em todo artigo publicado. Inserir
imagem agora pergunta, com o alt da biblioteca como padrão mas não herdado em silêncio, e
"decorativa" como escolha explícita — o botão de inserir fica desabilitado até que uma das
duas seja feita.

Ver `KALEL_STAGING_READINESS_AUDIT.md` §5 para o detalhe.

---

## 7. Escopo desta auditoria

Coberto: as 18 superfícies autenticadas + login, nos 5 breakpoints e 2 temas, com medição
de overflow, alcançabilidade de navegação, tamanho de alvo e erros de console, mais
varredura axe (WCAG 2.1 A + AA) em 1440 e 390 nos dois temas.

**Não coberto:** estados interativos além do `MediaPicker` e da toolbar contextual (menus
abertos, dropdowns, toasts); leitor de tela real (NVDA/VoiceOver); `prefers-reduced-motion`
além da regra CSS adicionada; zoom a 200% e reflow (WCAG 1.4.10).
