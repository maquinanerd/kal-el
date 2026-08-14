# 01 — Foundations

## Direção

A interface deve transmitir precisão, baixa fricção e densidade controlada. A estética não pode depender de efeitos decorativos. Tipografia, spacing, border hierarchy e proporções fazem a identidade.

## Color system

### Light — baseline

| Token | Valor inicial | Uso |
|---|---:|---|
| `canvas` | `#FAFAFA` | fundo geral |
| `surface` | `#FFFFFF` | painéis, cards, editor |
| `surface-subtle` | `#F7F7F8` | áreas secundárias |
| `surface-muted` | `#F2F2F3` | hover leve, menu selected |
| `border` | `#E5E5E7` | divisor padrão |
| `border-strong` | `#D5D5D8` | inputs/cards enfatizados |
| `text-primary` | `#171719` | títulos e conteúdo principal |
| `text-secondary` | `#5F6065` | metadata e descrições |
| `text-tertiary` | `#8E8F94` | captions e hints |
| `text-disabled` | `#B6B7BB` | disabled |

### Dark — baseline

| Token | Valor inicial | Uso |
|---|---:|---|
| `canvas` | `#19191B` | fundo geral |
| `surface` | `#202022` | surface principal |
| `surface-subtle` | `#262629` | áreas secundárias |
| `surface-muted` | `#2D2D30` | selected/hover |
| `border` | `#353538` | divisor padrão |
| `border-strong` | `#454549` | inputs e nested surfaces |
| `text-primary` | `#F5F5F5` | principal |
| `text-secondary` | `#B6B6BA` | metadata |
| `text-tertiary` | `#8C8C91` | captions |

### Semantic

- Success: verde sóbrio, usado em estado/segurança/confirmação.
- Warning: âmbar discreto.
- Danger: vermelho funcional, não decorativo.
- Information: azul de sistema.
- Product accent: configurável por produto, sempre secundário à hierarquia neutra.

## Typography

Baseline recomendada: **Inter**. Se a implementação final usar Geist, deve preservar métricas visuais próximas e ser recalibrada.

| Style | Size | Line-height | Weight |
|---|---:|---:|---:|
| Display | 48 | 56 | 500/600 |
| H1 | 36 | 44 | 600 |
| H2 | 30 | 38 | 600 |
| H3 | 24 | 32 | 600 |
| H4 | 18 | 26 | 600 |
| Body lg | 16 | 24 | 400 |
| Body | 14 | 21 | 400 |
| Body sm | 13 | 19 | 400 |
| Label | 13 | 18 | 500 |
| Caption | 12 | 17 | 400/500 |
| Micro | 11 | 16 | 500 |

Regras:

- Evitar peso 700 salvo em números/KPIs ou casos de forte ênfase.
- Labels curtos devem preferir 500.
- Metadata deve usar secondary/tertiary color antes de reduzir demais a fonte.
- UI densa não pode virar texto de 10 px ilegível.

## Spacing

Escala oficial:

`4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64`

Regras:

- 4–8 px: relação intracomponente.
- 12–16 px: padding de controles/cards compactos.
- 20–24 px: seções internas.
- 32–48 px: separação de grupos e page sections.
- 64 px apenas em marketing/onboarding de baixa densidade.

## Radius

- `xs`: 4 px
- `sm`: 6 px
- `md`: 8 px
- `lg`: 12 px
- `xl`: 16 px

Nunca usar radius extremo como linguagem dominante.

## Border

- 1 px padrão.
- Divisores horizontais são comuns e devem permanecer visíveis sem alto contraste.
- Focus ring deve ser claro, curto e consistente.
- Cards não devem depender de shadow para existir.

## Elevation

- `0`: nenhuma sombra.
- `1`: popover/control elevated sutil.
- `2`: dropdown/context menu.
- `3`: modal/drawer.

Em light mode, shadow deve ser baixa opacidade e ampla. Em dark mode, diferenciar principalmente por surface/border, não por sombra preta pesada.

## Control heights

- `xs`: 28 px
- `sm`: 32 px
- `md`: 36 px
- `lg`: 40 px

Inputs de uso geral: 36–40 px.

## Iconography

- Stroke icons simples.
- 16 px para ações compactas.
- 18–20 px em navegação.
- Evitar misturar famílias visuais.
- Ícones nunca substituem labels em ações críticas sem tooltip.

## Layout metrics

- Sidebar full: alvo 232–248 px.
- Compact rail: alvo 60–64 px.
- Topbar: alvo 48–56 px.
- Inspector: alvo 300–360 px.
- Editor/content column: preferir 720–900 px conforme contexto.
- Tables: row target 48–56 px.

Todos os valores são baseline. A fase de calibration deve medir os screenshots e ajustar.
