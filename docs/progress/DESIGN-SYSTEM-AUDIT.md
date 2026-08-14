# DS-0 — PEG Reference Audit

Status: complete (catalog + baseline). Visual pixel measurement: pending (no
image-capable reviewer in this session — see Limitation).
Date: 2026-08-14
Reference: `design-system/00_REFERENCE_AUDIT.md`, `design-system/01_FOUNDATIONS.md`

## Scope

Inventory of the bundled PEG corpus and the extraction of baseline tokens,
geometry and families, separating **evidenced** items from **inferred** ones.

## Corpus integrity

- 20 reference `.webp` assets; `SHA256SUMS.txt` verified 35/35 (0 mismatches).
- Two assets are byte-identical (`788d320d...` and `788d320d..._template_exemple`),
  so 19 unique screenshots.

## Families (evidenced)

| Family | Reference(s) | Components evidenced |
|---|---|---|
| App shell | `0a542d2b…`, `3cf289a1…`, `4e7cbd33…` | full sidebar, workspace, dense table |
| Shell + inspector | `3a0c7358…`, `788d320d…`, `0f3e66aa…` | editor canvas + contextual rail, inline toolbar, breadcrumb |
| Dense data | `3cf289a1…`, `0a542d2b…` | toolbar, tabs, search/filter, table, pagination |
| Overlay workflow | `0cae1b20…`, `07aa6cf2…` | compact modal, background blur, footer actions |
| Responsive dual-state | `1f3531c6…`, `3b1f1c0d…`, `4e7cbd33…` | desktop shell / mobile drawer, light/dark variants |
| Marketing/focused | `46f4ebc8…`, `5e3babbb…`, `11dc1f00…`, `0e54556a…` | centered workflows, pricing, steppers |

## Baselines (evidenced in specs, to be calibrated against screenshots)

- Neutrals: canvas `#FAFAFA`, surface `#FFFFFF`, borders `#E5E5E7`.
- Type: Inter-like; body 14/21, label 13/18/500, caption 12/17.
- Radius: xs 4, sm 6, md 8, lg 12, xl 16. Elevation: 0–3 (subtle → modal).
- Control heights: xs 28, sm 32, md 36, lg 40.
- Geometry targets: sidebar 232–248, rail 60–64, topbar 48–56, inspector
  300–360, editor 720–900, table row 48–56.
- Density: medium/high; borders are primary hierarchy; shadows functional only.

## Inferred items (explicitly marked INFERRED — must not be treated as reference-matched)

- Empty-state illustration style (`INFERRED`, no reference).
- Toast geometry (`INFERRED`; only inline alerts evidenced).
- Account switcher layout details (`INFERRED`; anchored-popover pattern
  evidenced in `56d881bb…`).
- Breadcrumb glyph/height (`INFERRED`; low-contrast pattern evidenced).
- Icon set (stroke style evidenced; exact glyphs `INFERRED`).

## Limitation (this session)

This model cannot view images, so pixel-level overlay comparison and the
P0/P1/P2 classification gate (DS-3, `design-system/VISUAL_QA.md`) must be
performed by a vision-capable reviewer (human or model) using the screenshot
harness produced in DS-2/DS-3. The implementation below (DS-1) follows the
specified tokens, geometry and density directly.
