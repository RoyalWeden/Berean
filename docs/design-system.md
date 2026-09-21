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

Geometry rules (pass 4 — Apple's control-shape rule [WWDC25, official]: mini/small/medium controls
are **rounded rectangles**, large/extra-large are **capsules**):
- Rounded rectangle: `Button xs` (`rounded-control-sm` 6) · `Button sm|md`, `IconButton`, `Chip
  kind="filter"`, `Select`, `TextField`, segments, sidebar rows, verse badge, calendar cells
  (`rounded-control-md` 7) · segmented **track** and menu rows (`rounded-card` 8).
- Capsule (`rounded-control`): `SearchField`, `Button lg`, `Button primary|prominent`, `Chip
  kind="token|badge"`, `Badge`, `Switch`, progress bars, floating pills (rail handle, presenter pill).
- Grouped controls share one container (`ControlGroup`, `rounded-row` 10) with flat 7px items.
- Concentric rule applies only where an inner surface shares a corner with its container (inner =
  outer − inset): window 20 → corner surface 12 · group 10 → item 7 · menu 14 → row 8 · segmented
  track 8 → thumb 7 · card 8 → chip 4. Elsewhere every element uses its ROLE radius.
- Heights (single authority): all toolbars 44 (macOS 27 uniform toolbars) · **bar controls 36** (one
  height for every control in a bar, via `BarMetrics` — see below) · compact contexts (inspector,
  popover, floating editor toolbar → `CompactMetrics`) 24 · sidebar rows 28 · list rows 36 (28
  dense) · menu rows 28 · calendar cells 22. A segmented control's TRACK is the 32px control; its
  segments are inset at 28.
- **`BarMetrics`** (pass 5) is the mirror of `CompactMetrics`: inside a `Toolbar` — and the
  sidebar's search row, which is a bar without being a `Toolbar` — every sized primitive steps one
  size UP (Button sm→md, IconButton 24→28→32, fields and segmented tracks to 32), so a bar renders
  ONE control height regardless of which size each call site asked for. It crosses `TabHeaderPortal`
  alongside the control surface. Dense contexts still step DOWN; a control is never both.

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

**Layering with the OS (pass 4):** the main window is transparent with native `sidebar` vibrancy and
`visualEffectState: followWindow`, so macOS already provides desktop blur + tint + inactive dimming +
opacity under Reduce Transparency behind the whole page. CSS decides only how much shows through
(alpha) and the text-tinted frost; **bars, sidebar and inspector never use `backdrop-filter`** (it
would blur our own content). `backdrop-filter` is legitimate only on surfaces floating over Berean's
own content (popovers, menus, elevated windows, sheets, floating control groups) — and never blur
over blur (`PopoverSurface opaque` over a sheet; the split sheet's sidebar column is opaque).
`html[data-increase-contrast]` (nativeTheme.shouldUseHighContrastColors) strengthens hairlines,
control borders and the focus ring.

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
`z-raised` 10 · `z-overlay` 100 · `z-modal` 200 · `z-critical` 300 · `z-popover` 400 · `z-menu` 450
(menus/popovers spawn from inside modals and critical windows, so they sit above both; a menu
opened from inside a popover — a Select in the Filters popover — sits above the popover).

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
| `Badge` | non-interactive status: `variant count\|dot\|live\|text`, `tone`; via `Button/IconButton badge` (NSItemBadge) |
| `TabStrip` | the one document/panel tab primitive: `variant sidebar\|inspector\|segmented`, layoutId pill, roving keys, close ×, drag handlers, context menu |
| `useContextMenu` | contextual menus at the pointer or below a focused row (Shift+F10); focus return; Escape/outside/scroll/blur dismissal |
| `MenuGroup` / `MenuSub` | a menu section reserves its icon column when any item has an icon (Apple 26/27); submenus open right, ←/Esc close |
| `ScrollContainer` | the one scroll root: overlay auto-hide scrollbar, native momentum, contained overscroll, `data-scroll-root` |
| `OverflowSection` | groups controls that fold as one labelled section of the More menu (`items` metadata → MenuItems with icon/label/shortcut/checked) |
| `CompactMetrics` | context: every sized primitive steps one size down (popovers, menus, inspector) |
| `MenuSurface` / `MenuItem` / `MenuSeparator` / `MenuLabel` | menus + context menus (position with `MenuPositioner`); arrow-key roving built in |
| `PopoverSurface` + `Popover`/`PopoverTrigger` | Radix popover pre-styled |
| `Sheet` | modal dialog shell (overlay + sheet material + header) |
| `TextField` / `SearchField` | capsule inputs; `SearchField` has clear + Esc |
| `Select` | custom listbox — never a native `<select>` |
| `Tooltip` | label + optional shortcut keycaps |
| `ToolbarSpacer` | the named group boundary between two logical toolbar groups: `flexible` (absorbs slack) / `fixed` (a deliberate gap) — replaces bare `<div className="flex-1" />` so a bar's grouping is legible in the markup |
| `CardButton` | content-layer action card: a block of rich content that is itself one button (AI-lookup results, search result rows, video cards). `surface elevated\|glass\|plain`, `icon`, `chevron`, `focused`, `selected`, `density`. Never glass by default, never scales on press |
| `Toolbar` | M1 bar row; `edge="auto"` scroll-edge; children default to glass controls; `gap-2` between groups |
| `ListRow` | the one list/tree/sidebar row: leading · title/subtitle · meta · trailing; `selected`/`current`/`dense`/`flush`/`titleSize` |
| `Sheet` | dialog shell: `size alert\|sm\|md\|lg\|xl`, `scrim modal\|light`, `onDefaultAction`, `layout split` |
| `useScrollEdge` / `useRovingNav` / `useRovingGridNav` (`src/lib`) | scroll-edge observer; arrow-key roving for lists, tab strips, calendar grids |
| `Chip` | capsule filter/tag/badge; `selected`, `count`, `tint`, `onRemove` — never changes weight |
| `Checkbox` / `Radio` / `Slider` / `TextArea` / `OptionCard` / `DisclosureRow` / `SectionHeader` / `ColorSwatchRow` | form + list building blocks |
| `EmptyState`, `SectionLabel`, `RefChip`, `Divider`, `Kbd`, `Switch`, `ActionPillGroup` | |

### Pill taxonomy (pass 4 — one primitive per role; never one generic pill)
| Role | Primitive |
|---|---|
| Filter toggle (multi-state row) | `Chip kind="filter"` (rounded rectangle) |
| Removable token (tag, alias) | `Chip kind="token"` (capsule) |
| Static label badge | `Chip kind="badge"` or `Badge text` |
| Count / status / live dot | `Badge count\|dot\|live` |
| Mutually exclusive mode / scope / sort / language | `SegmentedControl` (≤ 4 options) else `Select` |
| Menu trigger | `Button variant="menu"` / `Select` |
| Sort direction | `IconButton` |
| Disclosure | `DisclosureRow` |
| Verse / Strong's reference | `RefChip` (clickable = navigates; never a badge) |

### Control taxonomy (pass 5 — every control classified before it is styled)

The rule this pass enforces: **classify first, style second.** A control's visual treatment is
decided by its semantic role, never by what looks tidy next to it. Shape is *not* shared across
roles — uniformity of appearance is a failure mode, consistency of design language is the goal.
What every role DOES share: tokens, typography, icon sizing, interaction states, focus, spacing,
motion, accessibility.

| Role | Primitive | Shape | Resting surface |
|---|---|---|---|
| Push / action button (labelled) | `Button variant="secondary\|ghost"` | rounded rect (`sm\|md`) | glass in a bar, ghost in content |
| Default action on a surface | `Button variant="primary"` | capsule | accent fill |
| Important but not default | `Button variant="prominent"` | capsule | accent-muted glass |
| Destructive | `Button variant="destructive"` (fill) or `ghost danger` (quiet) | per variant | destructive fill / text-until-hover |
| Icon-only control | `IconButton` | square in bars/groups, round standalone | glass in a bar, ghost in a row |
| Toolbar item | `IconButton`/`Button` inside `Toolbar` | as above | **glass, shared per group** (see below) |
| Grouped controls | `ControlGroup` owns the container; children render flat | `rounded-row` 10 → items 7 | one glass container |
| Group boundary | `ToolbarSpacer` (`flexible\|fixed`) | — | none (spacing, not a divider) |
| Mutually-exclusive choice (≤4) | `SegmentedControl` | track 8, thumb 7 | glass track + raised thumb |
| Mutually-exclusive choice (>4) | `Select` | rounded rect | field |
| On/off setting | `Switch` | capsule | — (never a capsule button) |
| Menu / pop-up trigger | `Button variant="menu"` (trailing ▾) or `Select` | rounded rect | glass |
| Toolbar title + picker | `TitleControl` | one `ControlGroup` | glass |
| Overflow / More | `OverflowGroup` + `OverflowSection` | — | one primitive, never per-workspace |
| Search | `SearchField` | capsule | `control-field` |
| Text entry | `TextField` / `TextArea` | rounded rect | `control-field` |
| Document / panel tab | `TabStrip` | per variant | — (navigation, not a button) |
| Sidebar navigation row | `ListRow` | inset 7 | `surface-selected` when current |
| List / tree row | `ListRow` | inset 7 | hover only |
| Menu row | `MenuItem` | `rounded-card` 8 | accent fill on hover (NSMenu) |
| Disclosure | `DisclosureRow` | row | — |
| Filter toggle | `Chip kind="filter"` | rounded rect | glass |
| Removable token | `Chip kind="token"` | capsule | glass |
| Static status | `Badge` / `Chip kind="badge"` | capsule | — (**never clickable**) |
| Verse / Strong's reference | `RefChip` | capsule | — (clickable = navigates) |
| Selectable choice card | `OptionCard` | `rounded-card` 8 | glass; **radio semantics** |
| Rich content that IS a button | `CardButton` | `rounded-card` 8 | `surface-elevated`; content layer, never glass |
| Confirm dialog | `AlertSheet` | sheet 20 | `material-sheet` |
| Window / titlebar | native traffic lights; `WindowControls` on Windows | — | never styled as content buttons |

**Toolbar items share glass per logical group.** Apple's rule for the new design (WWDC25, *Build a
SwiftUI/AppKit app with the new design* — official): on the macOS window toolbar, toolbar items are
automatically grouped and are "given a glass background effect that is **shared with other items in
the same logical grouping**"; a `ToolbarSpacer` is what splits items into separate groups. So the
earlier reading that macOS toolbar items carry *no* bezel describes pre-macOS-26 AppKit and does not
apply here. In Berean this means: related adjacent toolbar controls belong in ONE `ControlGroup`
(back/forward, ‹ title ›, undo/redo, a view pair); a genuinely standalone action (sidebar toggle,
inspector toggle) is its own group of one and keeps its own glass; and unrelated neighbours are
separated by a `ToolbarSpacer`, not by giving each its own pill. Grouping is semantic — proximity
alone is never a reason to group.

**Where Berean deliberately differs from a consumer Apple app.** Study controls keep their labels
and their density: Strong's toggles, translation pickers, scope/mode/word-mode selectors, tag
filters, cross-reference and morphology controls stay explicit rather than collapsing into icons or
progressive disclosure. Semantic colour stays on study meaning (tags, highlight pigments, graph node
types, note status, trail palette, presenter state) while the chrome layer stays neutral — native
structure, Berean meaning.

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

## Reading column (pass 4 §26–27)
Left-anchored (Michael's decision). `--reading-max-ch` (86) × the Scripture font's `ch` caps the
measure; `--reading-margin: clamp(24px, 6%, 72px)` scales with the pane; compact/compare views have
no cap. Measured in the app at 16px system serif: 1ch ≈ 10px → 72ch rendered ~72 chars/line but
~190px narrower than the old 768px cap, so the token was raised to 86 (≈ 90 chars/line, ~720px of
text). Tune the ONE token; per-font overrides are allowed if a family lands outside 60–90.

## Keyboard model (pass 4)
- Scripture verses: badges are focusable (Tab in / click a number); ↑/↓ move, ⇧↑/↓ extend, Enter
  toggles selection, Escape clears, Shift+F10 opens the verse menu; Space / Page keys / Home / End
  stay native scroll keys.
- Sidebar rows / notes lists / calendar: roving ↑/↓/Home/End (`useRovingNav`), Shift+F10 context menu;
  closing stays ⌘W / hover × / menu (no Delete binding).
- Inspector strip (`TabStrip`): ←/→, Enter; click-active closes the slot.
- Transient menus focus their first item on open; ↑/↓/Home/End/typeahead; Escape returns focus.
- Rail: Tab reaches the handle, Enter/Space expands, Escape collapses.
- Graph canvas: arrows pan (⇧×5), +/−/0 zoom, Tab cycles nodes, Enter opens, Escape clears.
- Presenter: controls rows are `role="switch"` buttons; viewer ⌘±/0 zoom; zoom overlay on focus.

## Presenter state (pass 4 §62–63)
The outline derives from the shared verse-fraction geometry (unchanged pipeline) and is the only
presenter UI inside Scripture: 1.5px dashed accent (warning while paused), 0.035 tint, hugging the
reading column, `height` eases, `top` never. State text lives in the rail button badge/tooltip
("On presenter · v.1–6") and the presenter-controls pill.

## Visual QA (running app)
`BEREAN_CDP_PORT=9222 npm run dev` exposes the Chrome DevTools Protocol (dev only); the renderer
also exposes `window.__bereanStore` in dev. A small driver (`scratchpad/p3/cdp.mjs` during pass 3:
`shot <png>`, `eval <js>`, `size <w> <h>|reset`) captured every workspace × theme × width to find
"old font / old button / old border / old radius / old shadow / old panel / old menu" leftovers.
Pass-3 findings fixed from screenshots: inspector pane overflowed its wrapper (min-w-0), inspector
tab labels clipped (truncate, icons stay), editor toolbar folded everything into "…" (OverflowGroup
`fit="offsetParent"` for floating bars), active sidebar tab is accent-tinted only in the key window.

## Consistency gate (must return 0 / allowlist before merge)
See the "Phase 9" commands in the plan; summary: no `text-[Npx]`, no hex outside
`src/styles`/`tagPalette`/`highlightPalette`/`trailGraph`, no Tailwind palette classes, no
`hover:bg-[rgb(var(--color-surface-…))]`, only named z-indexes, no `backdrop-blur` in TSX, no
`<select>`, no legacy `glass-panel`/`context-menu`/`sidebar-vibrant`/`topbar-vibrant` classes,
no inline Radix `Tooltip.Content`, no inline `fontFamily:'serif'`. Pass 3 adds: no `ActionPillGroup`
(alias only), no `!text-/!rounded-/!px-/!h-` utilities, no `title=` on ui buttons (→ `tooltip`), no
`opacity-*` on muted text (→ `text-text-quaternary`/`text-meta`), no numeric `zIndex` outside the
Study Trail graph overlay allowlist (`MapView.tsx` band/marker layers), inline uppercase labels only
as badges (section labels use `SectionLabel`).

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
- 2026-09-20 — Pass 4 waves: window (fullscreenable per kind, viewer drops always-on-top in
  fullscreen, bounds persistence for all window kinds, display re-clamp); toolbar overflow with one
  More menu per bar (folded controls keep icon/label/shortcut/state); inset sidebar rows; rail
  keyboard; workspace cross-fade; keyboard verse model; inspector on TabStrip/ResizeHandle/compact;
  presenter badge + dashed outline; graph keyboard; AlertSheet for tag delete; menus auto-focus.
  Follow-ups landed the same day: Search secondary filters behind one Filters popover, History
  visit counts as Badge + disclosure, Notes link editor popover (Apply/Remove/Cancel), per-tab
  panel isolation (Lexicon/Search keyed by tab, Notes home-view snapshot), note editor popups
  portaled to body, cross-tab back history (a note becomes the Scripture/Lexicon tab's previous
  entry; no "back to note" pills); NoteSidePanel already sits on material-inspector + SectionHeader/ListRow.
  Search: scope · mode · word-mode right-aligned in the actions zone at one 28px/footnote size; the
  Filters popover hosts result length + the tag checklist (stays open while picking; trigger names
  the chosen tags, +N beyond two); a menu opened from inside a popover sits above it (z-menu 450).
- 2026-09-20 — Pass 4 foundation: control shapes follow Apple's rule (capsules reserved for search
  fields, lg/primary/prominent buttons, tokens, badges, switches; everything else rounded rectangles);
  `Badge`, `TabStrip`, `useContextMenu`, `MenuGroup`/`MenuSub`, `ScrollContainer`, `CompactMetrics`;
  popovers collide against the shell content row and open opaque over sheets; `Toolbar edgeStyle="hard"`;
  `html[data-increase-contrast]`. Decisions: reading column stays left-anchored with a wider,
  measured cap; sidebar rows are inset rounded (7px); presenter state = toolbar badge + control pill.
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
- 2026-09-20 — Pass 5 (control & button system): **toolbar glass belongs to the GROUP, not the
  item.** Apple's new-design rule is official (WWDC25, *Build a SwiftUI/AppKit app with the new
  design*): macOS window-toolbar items are auto-grouped and share one glass background per logical
  grouping, split by a `ToolbarSpacer`. The competing reading — "toolbar items have no bezel" —
  describes pre-macOS-26 AppKit and is NOT the target; Berean's `ControlGroup` already was the
  correct container, so this pass moved adjacent related toolbar controls into it rather than
  leaving each with its own pill. Standalone actions (sidebar/inspector toggle) remain their own
  group of one. Grouping is semantic: proximity is never a reason to group.
  New primitives: `CardButton` (the content-layer action card — `Button` is for labelled actions and
  `OptionCard` is a radio, so neither covered "this whole card opens something"; the recipe had been
  hand-copied across AI lookup / Scripture search / YouTube) and `ToolbarSpacer` (the other half of
  the grouping API). A full **control taxonomy** now precedes the consistency matrix: every role maps
  to exactly one primitive, and shape is decided by role, not by tidiness — uniform appearance is a
  failure mode, consistent design language is the goal.
  Intentionally unchanged: `SearchField` (already the restrained Mac search field — capsule,
  `control-field`, leading icon, NSSearchField-style filled clear button, Escape-clears,
  `role="searchbox"`); `Switch`, `SegmentedControl`, `TabStrip` (correct distinct primitives — a
  toggle must not become a capsule button, a tab must not become a segment); the `disabled:opacity-40`
  recipe (matches macOS's own disabled control dimming, and `IconButton` keeps pointer events so its
  tooltip can still explain why); accepted raw controls (grid cells, verse-level reader controls,
  composite controls, ProseMirror node views, the pre-CSS crash overlay). YouTube/media poster
  `group-hover:scale-105` stays — a media-card affordance on an `<img>`, not a control.
- 2026-09-20 — Pass 5 running-app QA found the pass's headline defect, which no amount of code
  reading had surfaced: **exactly one `ControlGroup` in the app was drawing its glass container.**
  `Toolbar` publishes `ControlSurfaceContext='glass'`, but every panel's toolbar content is
  portaled in through `TabHeaderPortal`, and React context follows the React tree rather than the
  DOM tree — so portaled groups never saw that provider and fell back to the `ghost` default,
  rendering their hairline dividers floating in the bar with no container. Only ShellHeader's own
  leading nav cluster (a direct `Toolbar` child) looked right. `TabHeaderPortal` now re-provides
  'glass' inside the portal. The floating notes-editor toolbar is unaffected and stays flat — it
  sets `itemVariant="ghost"` deliberately, because it already floats on its own glass surface and
  boxing each button there would be glass-on-glass.
  Also: `ColorSwatchRow` itself carried `hover:scale-110`; swatches now hold their geometry and
  respond with brightness. All 82 off-scale Lucide sizes (11/13/15/7/26 — `DisclosureRow` among
  them) normalized to the 12/14/16/18/20/24 scale. Every `transition-all` is now an explicit
  property list. `Chip` gained the `tooltip` prop it was missing, and the last `title=` attributes
  on primitives became real tooltips.
  Verification note: `npm test` is `vitest` in WATCH mode and never exits — use `npx vitest run`.

