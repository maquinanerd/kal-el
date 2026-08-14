# 02 — Component Library

## Política

Todos os produtos consomem a mesma biblioteca. Variantes de produto são permitidas por conteúdo, permissões e accent; não por duplicação visual arbitrária.

## Actions

### Button
Variantes:
- Primary — fundo quase-preto / texto claro.
- Secondary — surface + border.
- Tertiary — sem container permanente.
- Destructive — danger semantic.
- Icon-only.
- Split button.

Estados obrigatórios:
`default / hover / focus / pressed / disabled / loading`.

Tamanhos:
`xs / sm / md / lg`.

### Button group / segmented control
Usar para views mutuamente exclusivas. Não usar pills individuais desconectadas quando um segmented control é semanticamente correto.

## Forms

Componentes:
- Text input
- Search
- Password
- Textarea
- Number input
- Select
- Combobox
- Multi-select
- Checkbox
- Radio
- Switch
- Date picker
- Date range
- Tag input
- File upload
- Rich editor field

Todos devem suportar:
`label / optional / helper / error / disabled / focus / populated`.

## Navigation

### Full sidebar
Anatomia:
- logo/workspace;
- primary navigation;
- nested groups;
- optional browser/project tree;
- utility navigation;
- account row.

### Compact sidebar
Icon rail com tooltips e active state inequívoco.

### Top navigation
Marketing ou app contexts sem sidebar.

### Breadcrumb
Baixo contraste; última posição enfatizada.

### Tabs
Underline/subtle container. Evitar tab extremamente chamativa.

### Account/workspace switcher
Popover ancorado, rows de conta, active indicator, utility actions.

## Data display

### Table/Data Grid
Obrigatório:
- checkbox selection;
- sortable columns;
- row hover;
- compact metadata;
- optional avatar/status;
- kebab actions;
- empty state;
- loading skeleton;
- pagination;
- responsive fallback.

### Card
Card é surface delimitadora, não decoração. Usar border antes de shadow.

### KPI / Metric card
Números com hierarchy forte; delta pequeno; gráficos só se suportarem decisão.

### Badge/Status/Tag
Sem excesso de cores. Estado semântico é diferente de taxonomia.

### Profile card
Foto, identidade, metadata, ações e opcional stats.

## Overlays

- Dropdown
- Context menu
- Account menu
- Tooltip
- Popover
- Command palette
- Modal
- Confirm modal
- Drawer
- Inspector panel

### Modal
Baseline observada:
- largura compacta a média;
- header/content/footer claros;
- actions no footer;
- overlay com blur/opacidade sutil;
- radius moderado;
- shadow apenas para separar do contexto.

## Feedback

- Toast
- Inline alert
- Banner
- Progress
- Skeleton
- Empty
- Error
- Success confirmation

## Editor primitives

- Editor surface
- Inline formatting toolbar
- Block toolbar
- Slash command menu
- Drag handle
- Link editor
- Media block
- Gallery block
- Quote
- Callout
- Embed
- Table block
- Source/citation block
- Contextual inspector field group

## Responsive behavior

- Sidebar → drawer.
- Inspector → sheet/drawer.
- Table → prioritized responsive table ou list rows.
- Toolbar → primary actions + overflow.
- Dense horizontal controls podem rolar quando semanticamente adequado.
- Floating/anchored menus devem reposicionar sem sair do viewport.
