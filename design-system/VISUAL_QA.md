# Visual QA Protocol

## Classificação

- **P0** — descaracteriza o design system ou quebra uso.
- **P1** — divergência visual/UX perceptível.
- **P2** — refinamento de precisão.

## Checklist por tela

### Typography
- Família correta.
- Peso visual compatível.
- Line-height equivalente.
- Hierarquia não exagerada.

### Geometry
- Sidebar width.
- Topbar height.
- Inspector width.
- Control height.
- Table row height.
- Card/modal dimensions.
- Radius.

### Spacing
- Page padding.
- Section gaps.
- Internal padding.
- Label/control gaps.
- Density equivalente.

### Color / surfaces
- Canvas.
- Surface hierarchy.
- Border contrast.
- Text secondary/tertiary.
- Semantic colors.

### Overlays
- Anchor.
- Width.
- Offset.
- Shadow.
- Overlay opacity/blur.
- Keyboard/escape behavior na implementação.

### Responsive
- Navigation muda de padrão corretamente.
- Inspector não comprime conteúdo.
- Tables mantêm informação prioritária.
- Action bars continuam utilizáveis.

## Método

Para cada screen/reference pair:
1. comparar lado a lado;
2. comparar em overlay visual se a ferramenta permitir;
3. registrar P0/P1/P2;
4. corrigir P0;
5. corrigir P1;
6. só então avançar.

## Critério de sucesso

Remover logo, textos e cor de accent. Mesmo assim, a nova interface deve ser reconhecível como pertencente à mesma família dos screenshots.
