# Shell Seam Study — making Ribbon/Sidebar/TopBar read as one surface

Brainstorm only — no code changed producing this doc. Also published as an Artifact with
diagrams: see conversation history on `feature/ui-polish-july`.

Ribbon.tsx, Sidebar.tsx, SidebarTopBar.tsx, and TopBar.tsx used to be one full-width `TopBar`.
Splitting them fixed real functional bugs (collapse toggle + nav history now "belong" to the
sidebar instead of a detached global bar) but left four visibly stitched-together panels behind.
This inventories every seam and proposes fixes, each checked against actual Electron/CSS
constraints already established on this branch.

## As-built: nine seams

1. **Double right-border** — Ribbon and Sidebar each draw their own edge, back to back. (`Ribbon.tsx:120`, `Sidebar.tsx:329`)
2. **Frosted body, flat header** — the vibrant/translucent sidebar material stops at the header row, which is a plain opaque bar. (`SidebarTopBar.tsx:103`, `TopBar.tsx:31`)
3. **Windows fallback colors disagree** — Ribbon and Sidebar each pick a different surface rung, plus a hand-rolled shadow on one but not the other. (`Ribbon.tsx:119`, `Sidebar.tsx:328`)
4. **Same-row bars, different rules** — TopBar and SidebarTopBar share a height but disagree on right padding and on when they clear the macOS traffic lights. (`TopBar.tsx:32`, `SidebarTopBar.tsx:104`)
5. **Content steps to a third shade** — only a border line marks where TopBar's surface meets the main panel's different background. (`App.tsx:962`)
6. **Three floating-panel dialects** — frosted glass, plain surface-1, and plain surface-2 all appear as "the" popover style in different files.
7. **One bar forgot the rounded corners** — every button/pill elsewhere uses a 14px radius; TopBar is flat and square.
8. **Two clocks running the collapse** — Ribbon and Sidebar animate their widths on separate timelines with no shared sync point. (`App.tsx:903, 917`)
9. **One bar has a grouped-pill control, the other doesn't** — SidebarTopBar's back/forward/history reads as one unit; TopBar's portal slot has no equivalent language.

## Structure & borders

**One shell container, one border** — `REVISE`
Wrap rail + sidebar + both header rows + content in a single frame that draws the *only* outer
border and shadow; inner pieces stop drawing their own edges. Mostly safe — dropping the doubled
border and matching the Windows fallback color are pure visual, zero risk. Softening the content
boundary is fine too, just keep some affordance there so the eye still finds it.
*Touches: `App.tsx`, `Ribbon.tsx`, `Sidebar.tsx`, `TopBar.tsx` — ref: Arc, Linear*

**Merge the rail and sidebar into one strip** — `CLEAR`
Ribbon and Sidebar share one background token with zero divider between them — a single hairline
only where the *combined* strip meets content, matching VS Code's activity-bar/file-tree pairing.
*Touches: `Ribbon.tsx` (drop `border-r`) — ref: VS Code, Zed*

**Replace hard dividers with elevation** — `CLEAR`
Kill remaining internal border lines in favor of a subtle background step; never let two borders
sit back to back. One `--hairline` token, used at most once per boundary.
*Touches: `Ribbon.tsx`, `Sidebar.tsx`, `TopBar.tsx` — ref: Linear*

## Background & material

**Let the header rows inherit the sidebar's material** — `REVISE`
Drop the opaque background from SidebarTopBar and TopBar on macOS so they show the same vibrant
material as the panes beside/below them. Confirmed safe with one change: make the header rows
transparent so the *existing* vibrant background shows through — don't add a new blur filter to
them (the sidebar's vibrancy is deliberately flat/translucent with no `backdrop-filter`, so it
wouldn't blur the header's own text). Keep one agreed opaque fallback color for Windows/Linux.
*Touches: `SidebarTopBar.tsx`, `TopBar.tsx` — ref: macOS vibrancy, Arc*

## ⚠ Hold — do not build naively

Merging SidebarTopBar and TopBar into one continuous header (so the "seam" is just where the
sidebar's width ends, no color change) would be the highest-payoff single move — **but** the two
bars clear the macOS traffic lights by *different, intentionally divergent* rules today: the
sidebar's header always insets on macOS, while the content bar only insets when the sidebar is
collapsed and its own left edge slides under the traffic-light zone. That divergence is correct,
not a bug. A naive merge risks either exposing dead space under the traffic lights or — worse —
leaving a live drag region sitting where a button should be clickable, the exact bug class already
fixed once on this branch (Focus mode's TopBar had to explicitly drop its drag-region class, not
just hide with opacity, because Electron's OS-level drag hit-testing ignores CSS visibility). The
two bars can still *look* identical if this gets picked up — but the traffic-light-clearance
branch has to stay two separate conditions, not one.

## Floating chrome

**One floating-panel language** — `REVISE`
Consolidate frosted-glass / plain-surface-1 / plain-surface-2 popovers into one shared primitive —
one radius, one shadow, one background, Raycast-style. Fine for the transient, portaled popovers
this affects (already excluded from the drag region) — but the frosted variant's blur has a real
GPU cost on every scroll frame. Standardize on it for small transient panels only; don't extend it
to any large or always-mounted surface.
*Touches: new `FloatingPanel` primitive — ref: Raycast*

## Corners & controls

**Round TopBar's controls, not the bar itself** — `REVISE`
Bring the existing 14px pill radius to whatever sits inside TopBar's portal slot. The bar itself
should stay full-bleed and square against the window edge — rounding the bar's own corners risks
exposing background behind it or nudging the traffic-light clearance. Round the buttons and,
if anything, the main content panel's top corner — not the drag bar.
*Touches: `TopBar.tsx` button classes — ref: Arc, Raycast*

**Give TopBar a matching grouped-pill control** — `REVISE`
Wherever TopBar's portal slot has related actions, group them into the same bordered,
separator-lined segmented pill SidebarTopBar's nav already uses, extracted as one shared
component both bars pull from. Not a one-line change — TopBar's content is filled per-panel
through a portal, so each panel that portals controls in would need to adopt the shared styling.
*Touches: new `SegmentedButtonGroup`, used in both bars — ref: Arc, Raycast*

## Motion

**Sync the collapse onto one timeline** — `REVISE`
Drive Ribbon and Sidebar's width transitions from one shared animation value — ideally one
`LayoutGroup` — so the two can never gap or overlap mid-motion. There are two genuinely separate
*triggers* today (entering Focus mode, and the manual collapse toggle), each with its own easing
and duration — align their timing values and share a layout group; don't merge the triggers
themselves, they're semantically different actions.
*Touches: `App.tsx`, shared transition token — ref: Arc*

## If you only do three

**Merge the rail/sidebar border** + **let the header rows inherit the vibrant material** +
**sync the collapse timeline** clear most of the "four stitched panels" feeling with the least
risk. The one-continuous-header move (see the hold box above) is the highest ceiling if it's
worth the traffic-light-logic care — everything else here is safe to build in any order.
