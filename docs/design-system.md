# Berean Design System

> Source of truth for how Berean's chrome looks and behaves. Target: a first-class native
> **macOS 27 (Golden Gate / Liquid Glass)** app — different rooms in one house. Tokens live in
> `src/styles/global.css` + `tailwind.config.js`; primitives in `src/components/ui/`.

## Principles
- **One visual language, specialized layouts.** Scripture, Notes, Lexicon, Cross Refs, Search keep
  their own optimized layouts; they share typography, spacing, materials, radii, states, icons.
- **Native, calm, dense.** Medium information density; controls quiet until hovered; Scripture is
  always the visual priority.
- **Tokens, not literals.** No hex colors, Tailwind palette classes, arbitrary `text-[Npx]`, ad-hoc
  `backdrop-blur`, or raw z-indexes in components. The grep gate (below) enforces this.

## Tokens

### Palette (per theme — the ONLY vars a theme block defines)
`--color-surface-1..4`, `--color-accent`, `--color-text-primary/secondary/muted`,
`--color-red-letter`, `--selection-bg`, `--verse-highlight-bg` (bare `r g b` triples).

### Derived semantic layer (global `:root`, computed with `color-mix`/alpha — never per theme)
| Token | Tailwind | Use |
|---|---|---|
| `--color-separator` | `border-separator`, `bg-separator`, `divide-separator` | hairlines between regions/rows |
| `--color-border` | `border-border` | control/sheet borders |
| `--color-surface-elevated` | `bg-surface-elevated` | raised cards inside panels |
| `--color-surface-hover` / `-pressed` | `bg-surface-hover` / `bg-surface-pressed` | any interactive hover / press fill |
| `--color-surface-selected` | `bg-surface-selected` | neutral "current row" (sidebar tabs, lists) |
| `--color-accent-muted` / `-hover` | `bg-accent-muted` / `bg-accent-hover` | accent "mode on" (rail, chips, settings nav) |
| `--color-focus-ring` | `.focus-ring`, `shadow-focus` | keyboard focus (never on mouse) |
| `--color-destructive/success/warning/info` | `text-destructive`, `bg-success/15` … | status; scheme-aware via `.scheme-light` |
| `--trail-warm/--trail-cool` | `text-trail-warm` … | Study Trail feature palette |

`applyThemeToDocument()` sets `scheme-dark`/`scheme-light` on `<html>` (plus `color-scheme`) so
scheme-specific values need one rule, not 73.

### Materials (`.material-*` classes)
| Class | Where | Recipe |
|---|---|---|
| `.material-bar` | toolbars, sidebar ground | surface-2 @ 0.6, **no blur** (native window vibrancy shows through); opaque on non-vibrant windows (`html:not([data-vibrant])`) |
| `.material-panel` | inset contextual panels (Scripture side panel) | surface-2 @ 0.78 + 14px blur + hairline + shadow-2 |
| `.material-popover` | menus, context menus, dropdowns, tooltips, hover cards | surface-1 @ 0.86 + 14px blur + hairline + shadow-2 |
| `.material-sheet` | dialogs / sheets | surface-1 @ 0.94 + 16px blur + border + shadow-3 |
| `.material-control` | a lone floating capsule control | surface-2 @ 0.72 + 10px blur |

All alphas scale with `--glass-alpha-mult` (Settings → Appearance → Glass appearance:
clear 0.8 / regular 1 / tinted 1.18) — Berean's version of macOS 27's transparency slider.
`src/main.tsx` stamps `data-window` and `data-vibrant` (main window on mac only).

### Radii (macOS 27 scale; concentric rule inner = outer − inset; window = 20pt)
`rounded-chip` 4 · `rounded-card` 8 · `rounded-row` 10 · `rounded-menu` 14 · `rounded-sheet` 20 ·
`rounded-control` capsule (every control ≤ 32px tall). Legacy aliases: `rounded-shell` = menu,
`rounded-shell-lg` = sheet, `rounded-panel` = card. Tailwind's default `rounded-sm/md/lg/xl`
are being migrated OFF (grep gate).

### Elevation
`shadow-1` (controls) · `shadow-2` (popovers/panels) · `shadow-3` (sheets). Light schemes halve
shadow alpha via `--shadow-strength`.

### Layering
`z-raised` 10 · `z-overlay` 100 · `z-menu` 200 · `z-popover` 300 · `z-modal` 400 · `z-critical` 500.

### Motion
CSS: `duration-fast/base/slow` (100/150/220ms), `ease-mac`, `ease-mac-out`. JS: `src/lib/motion.ts`
(`SPRING_SNAPPY`, `SPRING_GENTLE`, `TWEEN_*`, `POP_IN`, `DROP_IN`). Reduced motion is honored
globally (CSS media rule + `<MotionConfig reducedMotion="user">` in `main.tsx`).

### Typography (chrome only — Scripture/Notes bodies use the user's font settings)
`text-micro` 9 · `text-caption2` 10 · `text-caption` 11 · `text-footnote` 12 · `text-subhead` 13 ·
`text-body` 14 · `text-title3` 15 · `text-title2` 17 · `text-title1` 20. UI font = SF system stack
(`--font-ui`). Hebrew/Greek lemmas use `font-lemma`.

### Spacing
4px grid (Tailwind default scale). Toolbar height 44 (`h-header`), traffic-light inset 76
(`pl-traffic-lights`), controls 24/28/32, rows 28–32, panel padding 12–16.

### Icons
`lucide-react` only. Sizes: 12 (inline/meta), 14 (controls), 16 (rail/nav). Stroke 1.75
(2 when active/selected). `SFIcon` is keycap-only.

## Primitives (`@/components/ui`)
| | |
|---|---|
| `Button` | `variant primary\|secondary\|ghost\|destructive`, `size sm\|md`, `icon`, `loading`, `selected` (ghost toggle) |
| `IconButton` | `icon`, `label` (a11y + tooltip), `size 20\|24\|28\|32`, `active` (accent), `selected` (neutral), `danger` |
| `SegmentedControl` | mutually-exclusive selector with sliding capsule thumb; `size sm\|md`, `fill` |
| `MenuSurface` / `MenuItem` / `MenuSeparator` / `MenuLabel` | menus + context menus (position with `MenuPositioner`); arrow-key roving built in |
| `PopoverSurface` + `Popover`/`PopoverTrigger` | Radix popover pre-styled |
| `Sheet` | modal dialog shell (overlay + sheet material + header) |
| `TextField` / `SearchField` | capsule inputs; `SearchField` has clear + Esc |
| `Select` | custom listbox — never a native `<select>` |
| `Tooltip` | label + optional shortcut keycaps |
| `EmptyState`, `SectionLabel`, `RefChip`, `Divider`, `Kbd`, `Switch`, `ActionPillGroup` | |

## Consistency gate (must return 0 / allowlist before merge)
See the "Phase 9" commands in the plan; summary: no `text-[Npx]`, no hex outside
`src/styles`/`tagPalette`/`highlightPalette`/`trailGraph`, no Tailwind palette classes, no
`hover:bg-[rgb(var(--color-surface-…))]`, only named z-indexes, no `backdrop-blur` in TSX, no
`<select>`, no legacy `glass-panel`/`context-menu`/`sidebar-vibrant`/`topbar-vibrant` classes,
no inline Radix `Tooltip.Content`, no inline `fontFamily:'serif'`.

## Decision log
- 2026-09-16 — Menus and popovers share ONE translucent material (modern macOS menus are vibrant);
  the earlier "context menus are opaque like NSMenu" call is superseded.
- 2026-09-16 — Controls are capsules (Liquid Glass); rows 10px; menus 14px; sheets 20px (= window).
  Tailwind's default `rounded-*` scale is left untouched to avoid silently shifting 240 sites;
  lanes migrate to the role-named radii deliberately.
- 2026-09-16 — Sidebar stays edge-to-edge with a slightly darker ground and colored tab icons
  (macOS 27 reverted floating sidebars). Toolbars are real bars, not floating chip clusters —
  the floating pop-out window header will become a bar too.
- 2026-09-16 — Bars never use `backdrop-filter` (the OS already blurs behind the transparent main
  window; a CSS blur there would blur our own text). Blur only on popover/panel/sheet/control.
- 2026-09-16 — Accepted literal colors (feature palettes / true colors, not chrome): macOS
  traffic-light hexes in `notes/pm/Toolbar.tsx`, Windows close `#C42B1C`, `trailGraph.ts` SVG
  colors, highlight pigments, tag palette, per-space tab icon colors (`TabBar.tsx`), note-status
  colors (`lib/noteStatus.ts`), callout tints (`lib/noteTextBlocks.ts`), print paper themes
  (`lib/notePreviewRender.ts`), idiom-export defaults, the crash overlay in `main.tsx` (runs
  before CSS), the YouTube letterbox `#000`, thumbnail overlay chips, the presenter laser red,
  and ThemePicker's 1/10-scale theme preview card.
- 2026-09-17 — Study Trail keeps its inline numeric z-indexes (separate window; reordering its
  simultaneous hover-card/menu/toast layers needs visual QA first).
- 2026-09-17 — Menu "current" items render a leading checkmark (`MenuItem active`), replacing
  the previous accent-tinted row — macOS menu convention.
- 2026-09-16 — Scripture/Notes body fonts, sizes and line-heights remain user settings; the
  design system governs chrome typography only.
- 2026-09-16 — `npm run lint` has no ESLint config in this repo (pre-existing); verification is
  `npm run typecheck` + `npm test` + the grep gate.
