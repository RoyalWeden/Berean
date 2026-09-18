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

## Layers (pass 3 — "macOS 27 functional glass layer + clean content layer")
| Layer | What | Material |
|---|---|---|
| **Content** | Scripture, references, note text, definitions, cross refs, graphs | `.material-content` — flat. Never glass, never cards per paragraph. |
| **Chrome** | window toolbar, sidebar, attached inspector, tab lists, rails | `.material-bar` / `.material-sidebar` / `.material-inspector` (no blur — the transparent window's vibrancy is the blur) |
| **Controls** | buttons, icon buttons, tabs, segmented, fields, pickers | `.control-glass` / `.control-field` / `ControlGroup` — tactile, never a plain HTML button on the ground |
| **Transient** | menus, popovers, tooltips, ⌘K, History, expanded rail, sheets | `.material-popover` / `.material-elevated` / `.material-sheet` — strongest depth; originate from their trigger |

Geometry rules (§17/§53): compact icon buttons are **rounded squares** (`rounded-compact`, 7px);
grouped controls share **one container** (`ControlGroup`, `rounded-row`); capsules are for search
fields, text buttons, chips, segmented tracks, badges and `Button variant="primary|prominent"`.
Concentric rule: inner radius = outer − inset (compact inside row inside menu inside sheet/window).

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

### Material hierarchy (M0–M4) — "chrome is glass, content is clean"
| Level | Class / token | Used for |
|---|---|---|
| M0 Content | `.material-content` / `bg-surface-3` | Scripture, notes, lexicon, any reading/information surface. Opaque, quiet. |
| M1 Integrated | `.material-bar`, `.material-sidebar` | Window toolbar, sidebar ground, panel/list headers, filter rows (`Toolbar`). Translucent only on the vibrant main window; lifted 3% toward text + inset top highlight so it separates from M0 on every theme. |
| M2 Interactive glass | `.control-glass`, `.control-field`, `bg-control(-hover/-pressed/-selected)` | Every visible control at rest: toolbar buttons, secondary buttons, chips, segmented tracks, fields, pill groups. Built from text-tinted `--lift-*` so it shows on dark/light/saturated/muted presets alike. |
| M3 Elevated glass | `.material-popover`, `.material-elevated`, `.material-panel` | Menus, popovers, tooltips, hover cards; History/⌘K/Tab Switcher (`elevated`: 24px blur, light scrim); Scripture side panel (`panel`). |
| M4 Modal | `.material-sheet` | Settings, importers, onboarding, print preview — denser, dark scrim + 4px blur. |

### Control state matrix (every primitive)
| State | Recipe |
|---|---|
| rest | ghost = transparent; glass = `control-glass` (lift-2 + hairline + inset highlight + shadow-1); field = `control-field` |
| hover | `bg-control-hover` (lift-3); fields lift to surface-1/75 |
| pressed | `bg-control-pressed` (lift-4) + 0.97 scale on icon buttons; filled buttons go to `accent-pressed` |
| selected (neutral current) | `bg-control-selected` raised thumb (segmented, IconButton `selected`) or `bg-surface-selected` (rows) |
| active (accent "mode on") | `bg-accent-muted text-accent` → hover `accent-hover` → pressed `accent-active` |
| focus-visible | `.focus-ring` (1.5px ground + 3.5px accent) — never on mouse clicks (fields ring on focus, like NSTextField) |
| disabled | `opacity-40`; IconButton keeps pointer events so the tooltip can explain why |
| menu hover | NSMenu: `bg-accent text-white` (danger: destructive fill) |

### Materials (`.material-*` classes)
| Class | Where | Recipe |
|---|---|---|
| `.material-bar` | toolbars, sidebar ground | surface-2 @ 0.6, **no blur** (native window vibrancy shows through); opaque on non-vibrant windows (`html:not([data-vibrant])`) |
| `.material-panel` | inset contextual panels (Scripture side panel) | surface-2 @ 0.78 + 14px blur + hairline + shadow-2 |
| `.material-popover` | menus, context menus, dropdowns, tooltips, hover cards | surface-1 @ 0.86 + 14px blur + hairline + shadow-2 |
| `.material-sheet` | dialogs / sheets | surface-1 @ 0.94 + 16px blur + border + shadow-3 |
| `.material-control` | a lone floating capsule control | surface-2 @ 0.72 + 10px blur |

| `.material-inspector` | ATTACHED inspector pane (Scripture side panel, Notes side panel) | `--surface-inspector` (surface-2/3 mix), hairline-left, **no radius / blur / shadow**, width 260–420 |
| `.material-elevated` | ⌘K, History, Tab Switcher, expanded rail | surface-1 @ 0.84 + 24px blur + hairline + shadow-3 |
| `.material-popover-dense` | hover cards sitting over body text | surface-1 @ 0.96 |

**Glass knobs** (§67/§108): every material's `blur()`/`saturate()`/`contrast()` is computed from
`--glass-blur`, `--glass-saturate`, `--glass-contrast`, `--glass-tint` (frost mixed into bars),
`--glass-highlight` (top-edge alpha), `--glass-shadow`, `--glass-alpha-mult`. Settings → Appearance →
Glass appearance stamps `html[data-glass="clear|regular|tinted"]`, which swaps the whole knob set
(more transparent / regular / more tinted) — no component changes, no user slider.
`src/main.tsx` stamps `data-window` and `data-vibrant` (main window on mac only).

**Window states**: `html[data-inactive]` (electron forwards blur/focus) drops accent to neutral,
flattens controls, recedes bar text — content untouched. `html[data-reduce-transparency]`
(`nativeTheme.prefersReducedTransparency`) + `@media (prefers-reduced-transparency)` swap every
material for its `*-bg-opaque` twin and remove backdrop filters.

**Scrims**: `.scrim-modal` (sheets) and `.scrim-light` (transient app windows) — the only two.

**Scroll-edge** (§37/§61): bars are seamless at rest. `Toolbar edge="auto"` (default) observes the
scroll root beneath (`scrollRef`, auto-detected next scrollable sibling, or a `scrolled` prop fed
from a store slice) and sets `data-scrolled` → hairline + `0 4px 12px -4px` shadow. Permanent
hairlines (`edge="bottom"`) only where nothing ever scrolls under the bar.

### Radii (macOS 27 scale; concentric rule inner = outer − inset; window = 20pt)
`rounded-chip` 4 · `rounded-compact` 7 (icon buttons / segments inside a group) · `rounded-card` 8 ·
`rounded-row` 10 (ControlGroup container, list rows) · `rounded-window` 12 · `rounded-menu` 14 ·
`rounded-sheet` 20 · `rounded-control` capsule (text buttons, fields, chips, segmented tracks). Legacy aliases: `rounded-shell` = menu,
`rounded-shell-lg` = sheet, `rounded-panel` = card. Tailwind's default `rounded-sm/md/lg/xl`
are being migrated OFF (grep gate).

### Elevation
`shadow-1` (controls) · `shadow-2` (popovers/panels) · `shadow-3` (sheets). Light schemes halve
shadow alpha via `--shadow-strength`.

### Layering
`z-raised` 10 · `z-overlay` 100 · `z-modal` 200 · `z-critical` 300 · `z-menu` 400 · `z-popover` 450
(menus/popovers spawn from inside modals and critical windows, so they sit above both).

### Motion
CSS: `duration-fast/base/slow` (100/150/220ms) + `duration-popover/panel/workspace` (160/240/280),
`ease-mac`, `ease-mac-out`. **Origin rule** (§57/§103): `MenuSurface` animates with `.animate-menu-in`
from `--menu-origin` (set by `MenuPositioner` from the side it flipped to); `PopoverSurface`/`Tooltip`
inherit Radix's `--radix-*-content-transform-origin`; `Sheet` animates an INNER wrapper (Radix
Content keeps the centring translate — animating transform on the same element rendered every sheet
off-centre for a frame). Press: buttons `active:scale-[0.98]` + pressed fill; rows/segments never
scale; the interactive-glass spring is reserved for `prominent`/`primary` and rail controls.
JS: `src/lib/motion.ts`
(`SPRING_SNAPPY`, `SPRING_GENTLE`, `TWEEN_*`, `POP_IN`, `DROP_IN`). Reduced motion is honored
globally (CSS media rule + `<MotionConfig reducedMotion="user">` in `main.tsx`).

### Typography (chrome only — Scripture/Notes bodies use the user's font settings)
`text-micro` 9 · `text-caption2` 10 · `text-caption` 11 · `text-footnote` 12 · `text-subhead` 13 ·
`text-body` 14 · `text-title3` 15 · `text-title2` 17 · `text-title1` 20. UI font = SF system stack
(`--font-ui`). Hebrew/Greek lemmas use `font-lemma`. Text roles: `text-text-primary/secondary/tertiary/
quaternary/disabled`; **`text-meta`** (caption2 + tertiary + tabular) is the one recipe for counts,
timestamps, word counts and status — never stack `opacity-*` on muted text. `SectionLabel` is the only
uppercase recipe.

### Spacing
4px grid (Tailwind default scale). Toolbar height 44 (`h-header`), traffic-light inset 76
(`pl-traffic-lights`), controls 24/28/32, rows 28–32, panel padding 12–16.

### Icons
`lucide-react` only. Scale 12 / 14 / 16 / 18 / 20 / 24; `IconButton` maps 20→12, 24→14, 28→16,
32→18. Stroke 1.75 (2 when active/selected), 1.5 in content. `SFIcon` is keycap-only.

## Primitives (`@/components/ui`)
| | |
|---|---|
| `Button` | `variant primary\|prominent\|secondary\|ghost\|menu\|destructive`, `size sm\|md`, `icon`, `loading`, `selected`, `tooltip` (replaces `title=`) |
| `IconButton` | `icon`, `label` (a11y + tooltip), `size 20\|24\|28\|32`, `shape square\|round` (auto), `active`, `selected`, `danger`, `filled` |
| `ControlGroup` | ONE container for a cluster of independent controls (back/forward, ‹ title ›, LXX \| Strong's); children read `useInControlGroup()` and render flat — replaces `ActionPillGroup` (alias) |
| `TitleControl` | toolbar context-zone title: ‹ [title · detail ▾] › as one ControlGroup; the trigger anchors the picker popover |
| `OverflowGroup` | folds trailing controls into a `…` popover when the row is narrow — nothing hides, nothing scrolls sideways |
| `SegmentedControl` | mutually-exclusive selector with sliding thumb; `variant segmented\|inspector`; arrow keys / Home / End |
| `AlertSheet` | the one confirm dialog: icon · title · message · Cancel/Confirm; Enter = default, Esc = cancel |
| `MenuSurface` / `MenuItem` / `MenuSeparator` / `MenuLabel` | menus + context menus (position with `MenuPositioner`); arrow-key roving built in |
| `PopoverSurface` + `Popover`/`PopoverTrigger` | Radix popover pre-styled |
| `Sheet` | modal dialog shell (overlay + sheet material + header) |
| `TextField` / `SearchField` | capsule inputs; `SearchField` has clear + Esc |
| `Select` | custom listbox — never a native `<select>` |
| `Tooltip` | label + optional shortcut keycaps |
| `Toolbar` | M1 bar row; `edge="auto"` scroll-edge; children default to glass controls; `gap-2` between groups |
| `ListRow` | the one list/tree/sidebar row: leading · title/subtitle · meta · trailing; `selected`/`current`/`dense`/`flush`/`titleSize` |
| `Sheet` | dialog shell: `size alert\|sm\|md\|lg\|xl`, `scrim modal\|light`, `onDefaultAction`, `layout split` |
| `useScrollEdge` / `useRovingNav` / `useRovingGridNav` (`src/lib`) | scroll-edge observer; arrow-key roving for lists, tab strips, calendar grids |
| `Chip` | capsule filter/tag/badge; `selected`, `count`, `tint`, `onRemove` — never changes weight |
| `Checkbox` / `Radio` / `Slider` / `TextArea` / `OptionCard` / `DisclosureRow` / `SectionHeader` / `ColorSwatchRow` | form + list building blocks |
| `EmptyState`, `SectionLabel`, `RefChip`, `Divider`, `Kbd`, `Switch`, `ActionPillGroup` | |

## Consistency matrix (verified in code, pass 2 — 2026-09-18)
| Component | Typography | Material | Border | Radius | Hover | Press | Selected | Focus | Dark/Light |
|---|---|---|---|---|---|---|---|---|---|
| Primitives (ui/) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Toolbar / window header | ✓ | ✓ bar | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Sidebar + tab rows (ListRow) | ✓ | ✓ sidebar | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Calendar | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Scripture header + reader chrome | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Side panel (Notes/Lexicon/Cross Refs) | ✓ | ✓ panel | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Scripture search / pickers | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Notes (home, tree, list, editor chrome) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Lexicon | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Tags | ✓ | ✓ sidebar | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| History | ✓ | ✓ elevated | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| ⌘K palette / Find / Tab switcher | ✓ | ✓ elevated | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Menus / popovers / tooltips | ✓ | ✓ popover | ✓ | ✓ | ✓ accent | ✓ | ✓ | ✓ | ✓ |
| Settings / dialogs / onboarding | ✓ | ✓ sheet | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Study Trail chrome | ✓ (timeline titles mono-italic by design) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| YouTube / AI lookup / audio / PDF / viewer | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Accepted raw controls (documented exceptions to "no `<button>` outside ui/"): grid cells (calendar
days, book/chapter picker cells), verse-level controls inside the reader (number badge, margin
note/xref pill, tag badges), rich content cards with no primitive equivalent (YouTube video cards,
AI-lookup result cards, virtualized Scripture-search result cards, `CrossRefCard`), composite
controls (`CircularPlayButton`, `Switch`, Windows `WindowControls`), the pre-CSS crash overlay in
`main.tsx`, ProseMirror node views, pm/Toolbar's focus-mode `motion.button`, and the Verse Picker's
font-scaled Scripture text. All carry `focus-ring` + hover/pressed lift states.

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
- 2026-09-17 — Pass 2: Default dark/light palettes re-tuned to macOS-like separation (named
  presets untouched); materials/controls built from text-tinted `--lift-*` so hierarchy is
  theme-independent; menu hover is NSMenu accent+white; History/⌘K/Tab Switcher use
  `.material-elevated` with a light scrim (Spotlight-class); Study Trail keeps its mono-italic
  timeline titles as a feature identity while its chrome uses system controls.
- 2026-09-18 — Pass 3 foundation: not everything is a capsule (square icon buttons in groups/bars;
  `ControlGroup` owns the container, children render flat — no `!important`); `Toolbar` bars are
  seamless at rest with a scroll-edge hairline; menus/popovers/sheets grow from their trigger;
  glass is parameterised by the `--glass-*` knobs (`html[data-glass]`); inactive-window and
  reduce-transparency states exist at the token level; the attached inspector is a pane
  (`.material-inspector`), not a floating card; `AlertSheet` replaces hand-rolled confirms;
  `text-meta` is the one status-text recipe. Toolbar zones: Leading (sidebar · nav group) ·
  Context (title control) · Actions (one group) · Trailing (view pair · inspector · overflow).
- 2026-09-18 — Pass 2 complete: `.native-buttons` retired (primitives own press/focus); every
  Toolbar child is glass at rest; History/⌘K/Tab Switcher are `material-elevated`; all list/tree
  rows are `ListRow` (keyboard reachable, single selection color); `Sheet layout="split"` hosts
  Settings. Gate: zero legacy `text-xs/sm`, `font-bold`, `hover:bg-surface-N`, `rounded-shell`,
  4-digit z-indexes; raw controls only per the accepted list above.
