# DS-1/DS-2 — Design System Implementation + Calibration Screen

Status: DS-1 complete, DS-2 harness built, DS-3 visual classification PENDING
(no image-capable reviewer in this session).
Date: 2026-08-14
References: `design-system/05_CALIBRATION_SCREEN.md`, `design-system/VISUAL_QA.md`

## Deliverables

- **`packages/design-system`** (React + plain CSS, zero UI framework):
  - `src/tokens.css` — implementation tokens with provenance to
    `design-system/design-tokens.css`/`.json` (colors light/dark, semantic,
    accent, radius, spacing, elevation, control heights, type scale, geometry).
  - `src/styles.css` — component styles (buttons, forms, tabs, segmented,
    badges, cards, KPI, table, pagination, menus, account switcher, modal,
    toast/alert, breadcrumb, sidebar, rail, topbar, inspector, editor,
    inline toolbar, empty state, responsive drawer/sheet).
  - React primitives in `src/components/*` + `src/icons.tsx` (stroke icons).
  - Unit tests (`primitives.test.tsx`, 5 tests) — classes, aria, active states.
- **Calibration harness** `dev/main.tsx` rendering the full lab screen required
  by `05_CALIBRATION_SCREEN.md`: full sidebar, compact rail, topbar, breadcrumb,
  page title, primary/secondary/tertiary/destructive/icon buttons, input,
  search, select, checkbox, radio, switch, tabs, segmented control, KPI card,
  generic card, dense table (avatar/status/kebab), pagination, open context
  menu, open account switcher, modal, editor + inline toolbar, inspector,
  toast/alert, empty state — in light/dark via `?theme=dark`.
- **Screenshot tooling**: `scripts/serve.mjs` + Edge/Chrome headless capture.

## Evidence produced

Screenshots in `docs/progress/calibration-shots/`:

| File | Viewport | Theme | Size |
|---|---|---|---|
| desktop-light.png | 1440×900 | light | 102 KB |
| desktop-dark.png | 1440×900 | dark | 102 KB |
| mobile-light.png | 390×844 | light | 34 KB |
| mobile-dark.png | 390×844 | dark | 35 KB |

Commands (reproducible):

```text
pnpm --filter @kal-el/design-system build:harness
node packages/design-system/scripts/serve.mjs packages/design-system/dist 4173
msedge --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --virtual-time-budget=6000 --user-data-dir=<tmp> \
  --window-size=1440,900 --screenshot=<out.png> "http://127.0.0.1:4173/index.html?theme=dark"
```

## Gate status (VISUAL_QA.md)

- [x] DS-0 catalog + baselines (`docs/progress/DESIGN-SYSTEM-AUDIT.md`)
- [x] DS-1 tokens/primitives implemented and unit-tested
- [x] DS-2 calibration screen built; desktop/mobile + light/dark shots captured
- [ ] DS-3 pixel classification P0/P1/P2 — **blocked**: this session's model
  cannot view images. A vision-capable reviewer (human or model) must run
  `design-system/VISUAL_QA.md` side-by-side comparison using the shots above
  and the bundled references before the calibration gate can be declared
  passed (zero P0 / zero relevant P1). Per AGENTS.md rule 17/18, no full CMS
  screen inventory may be built until that gate passes.

## Notes

- Fonts load Inter from Google Fonts in the harness; if offline, the system
  sans fallback applies (documented in tokens).
- Mobile transforms sidebar→drawer and inspector→sheet via CSS media query
  (<1024px); the captured mobile shots show the closed (drawer) state.
