# 00 — Reference Audit

## Objetivo

Catalogar o corpus visual antes de criar qualquer tela. Cada screenshot deve ser tratado como evidência de tokens, componentes, estados, shells e comportamento responsivo.

## Inventário inicial

| Arquivo | Padrão principal observado | Evidências úteis |
|---|---|---|
| `0a542d2b9c9c08e4e094a2d143dc650e.webp` | Dashboard + sidebar + customer list | sidebar full, KPI cards, upgrade card, profile row, tabela/lista |
| `0cae1b20f6f4fb585d379e6baf70c800.webp` | Modal de pagamento PayPal | overlay blur, modal compacto, tabs, payment account, footer actions |
| `0e54556a0235b46c6fb571f9b029d935.webp` | Comparação de planos + footer | table de features, check states, CTA row, footer multicoluna |
| `0f3e66aa2734c5778ed5d05b8c18c73e_template_exemple.webp` | Editor responsivo | editor mobile/desktop, sidebar de produto, toolbar inline, breadcrumbs |
| `0fe4e8bc24836d8a330d84853f823304.webp` | Onboarding + dashboard | branding setup, theme selector, color swatches, application shell |
| `1f3531c6f08da67e7e1bb683bafa5aef.webp` | Settings / Security dark | dark tokens, responsive shell, toggles, QR block, device list |
| `3a0c7358f1cdb01ece5c2e96776b9b0d_template_exemple.webp` | Editor desktop completo | editor amplo, right rail contextual, content tools, author/profile card |
| `3b1f1c0d1ebebdd3c60de5e0124fa342.webp` | Settings / Security light | light tokens, same responsive structure, semantic green |
| `3cf289a1d60985cfb4c814c52088709f.webp` | File explorer desktop | sidebar, create cards, tabs, search/filter, dense table, pagination |
| `4e7cbd336479e72e59317b65081e8afe.webp` | File explorer responsivo | mobile stacked actions, desktop shell, horizontal overflow patterns |
| `5e3babbbb2178340509f8c4782688ddd.webp` | Pricing full page | navbar, pricing cards, long comparison table, footer |
| `6ce3ca22379ee75b92eeddc7eb703822.webp` | Navbar / mega menu responsivo | desktop dropdown, mobile drawer, mixed media mega menu |
| `07aa6cf200c66b0177a3742c197d6d6f.webp` | Modal cartão | field layout, tabs, card visual, modal footer, background blur |
| `9d8476131467ab423e88ea73907c4b57_template_exemple.webp` | Upgrade / Billing | product sidebar, checkout form, summary rail, selected radio cards |
| `11dc1f00f718c59c12fbba9e28b27cb2.webp` | Pricing responsive | mobile card rail, desktop pricing, hero hierarchy |
| `46f4ebc8f646af94fc54697c72f55344.webp` | Onboarding / assinatura | centered form, progress steps, illustration/pattern, browser shell |
| `56d881bb5cdd13886428d6759a9878a3_template_exemple.webp` | Account switcher/menu | anchored popover, account rows, active indicator, destructive/utility action |
| `673b976fee61d95226089128e406adbc.webp` | Navbar + resource mega menu | compact nav, rich dropdown, video/media card, CTA |
| `788d320d39ce858cf1d77116dd2098d6.webp` | Profile/content editor | large editor, persistent right preview/profile rail, publish controls |
| `788d320d39ce858cf1d77116dd2098d6_template_exemple.webp` | Profile/content editor duplicate | confirmação de layout, proporções e hierarquia |

## Linguagem visual identificada

- Produto B2B/SaaS de alta clareza e densidade média/alta.
- Neutros dominantes: branco, off-white, cinzas e quase-preto.
- Accent usado com moderação.
- Tipografia sans-serif de interface próxima de Inter/Geist.
- Borders finas são parte central da hierarquia.
- Shadows discretas e funcionais, principalmente em overlays.
- Radius moderado; o sistema não depende de "rounded cards" exagerados.
- Tabelas e listas têm row heights compactos.
- Sidebar full ~220–260 px; rail compacto ~56–72 px.
- Topbars baixas e horizontais.
- Controles majoritariamente 32–40 px de altura.
- Editor utiliza canvas visualmente calmo e inspector contextual.
- Mobile mantém os mesmos componentes, mas reorganiza a navegação e disclosure.
- Dark mode possui surfaces próprias e não simples inversão de cores.

## Famílias de padrões

1. **App shell** — sidebar + workspace.
2. **App shell com inspector** — sidebar + workspace + contextual rail.
3. **Dense data** — toolbar + tabs + search/filter + table/list + pagination.
4. **Focused workflow** — onboarding/checkout/signature em área central.
5. **Overlay workflow** — modal compacto sobre contexto desfocado.
6. **Marketing shell** — navbar + hero + pricing/comparison + footer.
7. **Responsive dual-state** — desktop shell / mobile drawer.

## Regra para Claude Design

Antes de reconstruir qualquer componente, localizar no corpus pelo menos uma referência equivalente. Se não houver referência, criar o componente como extensão conservadora da foundation já calibrada e marcar como `INFERRED`, nunca como `REFERENCE-MATCHED`.
