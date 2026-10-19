# iOS performance & Liquid Glass stability QA

Record of the 2026-10-08 iOS performance / Liquid Glass pass (branch `feature/qa-pass-1007`).
Every **PASS / FAIL / FIXED** here was exercised in the running app in the simulator; nothing is inferred
from code alone. Status values: `PASS` · `FAIL` · `FIXED` (failed → fixed → re-tested) · `BLOCKED` ·
`NOT TESTED` · `N/A`. A blank cell never means success.

## Environment and method

| | |
|---|---|
| Simulator | iPhone 18 Pro (D0CC2F4C-AC47-4648-AC5C-0DC128CFCE7D), iOS 27.0, 60 Hz |
| App | Berean Dev `com.berean.app.dev` 0.7.1 (3), Debug, `BEREAN_E2E_PROBE=1 npm run ios:sync:dev && npm run ios:build`, installed with `simctl install`. Production `com.berean.app` on the same simulator was never touched. Ended with `npm run ios:sync` (production, no probe) + `audit:prod` clean. |
| Data | Existing Dev data (4 tabs, 1 note). Temporary test data, all removed afterwards: 60 short notes + one 79 KB / 373-block note (tag `perf-qa`), plus 3 extra tabs. One accidental highlight (Genesis 1:8) created by a mis-tap was removed immediately. |
| Interaction | Xcode 27 MCP (`xcrun mcpbridge` → `DeviceInteractionSynthesize`): real taps, swipes, holds, typing. Gestures are chained in one call where timing matters (see limits). |
| Observation | `simctl io recordVideo` → ffmpeg frames at 15–30 fps; per-frame top/bottom-bar strips; full-resolution frame stacks for transitions; pixel traces for launch. |
| Measurement | In-page rAF frame monitor via the dev probe: avg fps, p50/p95/p99, frames > 25/50/100 ms, DOM nodes before/after — counted only up to 500 ms after the last scroll event. ProseMirror transactions timed through a probe-build-only `window.__pmView`. |

**Limits (affect how numbers read):**
- **60 Hz simulator:** no ProMotion, so frame numbers are relative.
- **Main thread only:** the rAF monitor measures the WebView main thread, not the compositor.
- **No heap figures:** Safari exposes no `performance.memory`, so memory is approximated by DOM node counts.
- **No Instruments:** no attachable profiling session was available through MCP.
- **Accessibility capture stalls the web view:** every MCP interaction captures the accessibility tree, which stalls WKWebView's main thread on large documents (15 s for the 7,066-node note). Measurements therefore chain gestures in one call and exclude the trailing capture. Taps sent during such a stall can be dropped, which looks like "tap didn't focus".
- **Faulty hit points:** the accessibility hit-points for the verse sheet's action buttons are wrong (frames 717 pt tall), so those taps use screenshot coordinates.

## Liquid Glass architecture (as found)

- **Native glass (UIKit, iOS 26+):** `ios/App/BereanNative/Sources/BereanNative/BereanGlassPlugin.swift`.
  - A pass-through overlay above the WKWebView holds clusters (`UIGlassContainerEffect`) of items: `UIGlassEffect(.regular, interactive)` plus a `UIButton` with an SF Symbol.
  - Driven from React by `useLiquidGlassControls` (`src/platform/liquidGlass/react.tsx`) through `window.__bereanGlass`.
  - Three clusters: `bottom-nav` (tabs, +, caret), `reader-title` (Scripture passage capsule), `tab-switcher` (grid button).
- **Web placeholders:** each native item has an invisible web twin.
  - The twin owns layout, is the fallback without native glass, and drives occlusion.
  - When a sheet, popover or scrim covers it, the web twin shows under the overlay and the native item hides.
- **CSS glass** everywhere else (`src/styles/glass.css`, `--m-glass-*`, `backdrop-filter`): sheets, popover menus, the Notes search field, the selection bar, cards. Never over Scripture text.

### Glass-surface inventory

| ID | Surface | Screen(s) | Impl | Lifecycle / notes | Tests | Status |
|---|---|---|---|---|---|---|
| GS-1 | Bottom nav (tabs · + · caret) | every tab | native cluster `bottom-nav` | collapses on scroll-down (slides off bottom), hidden under sheets / keyboard | cold & warm launch, scroll / reversal / overscroll, press-and-hold, sheet open / close, tab switch | PASS after G-02, G-03, G-04, G-07, G-08 |
| GS-2 | Passage title capsule | Scripture | native `reader-title` | now collapses with the header (top edge) | as GS-1, plus header hide / return | PASS after G-02, G-03 |
| GS-3 | Grid button (tab type) | every tab | native `tab-switcher` | hidden while the page is collapsed; its own menu + scrim cover it | cold launch, scroll, menu open / close, press | PASS after G-02, G-05 |
| GS-4 | Compact passage title (island) | Scripture, scrolled | web (opaque capsule) | appears when the header hides | scroll / reversal | PASS (cross-hands with GS-2 as designed) |
| GS-5 | Sheets (search, tab cards, caret, verse, cross references) | all | CSS sheet glass | drag-dismiss; covering the bar hands GS-1 to its placeholders | open / scroll / dismiss ×n | PASS after G-07, G-08 |
| GS-6 | Popover menu (Search "…") | Search tab | CSS glass | dismiss by outside tap | open, dismiss, scroll beneath | PASS |
| GS-7 | Notes floating search field + compose | Notes list | CSS glass | takes the nav's place while collapsed | list scroll matrix | PASS |
| GS-8 | Header buttons (Notes / Lexicon / Search / Settings) | page headers | CSS fill (not glass) | static | scroll matrices | PASS |

Inconsistencies found: the placeholders of GS-1, GS-2 and GS-3 did not look like their native twins: different glyph colour, size, weight and shape (G-05). All other surfaces use the shared CSS tokens.

## Issues

| ID | Sev | Area | Evidence | Root cause | Fix | Status |
|---|---|---|---|---|---|---|
| G-01 | P1 | Cold launch | `cold1` 30 fps: white → **~130 ms of dark theme** (`#17171a`) → light app | `index.ios.html` ships `<html class="dark">`; the saved appearance was applied in a `useEffect`, after React's first paint | `applyInitialMobileAppearance()` runs synchronously in `src/platform/ios/main.tsx` before rendering; the appearance and font effects are now `useLayoutEffect` | FIXED. `cold2`–`cold5`: no dark app frame (cold3's one dark frame is the system launch fade, before the launch screen) |
| G-02 | P1 | Cold launch, all native controls | `cold1` f128–f139: web placeholders for ~330 ms, then the native controls faded in over them | The first appearance used "show web until native is confirmed": a guaranteed web → native swap | Placeholders stay invisible until the FIRST native draw while native will draw (adapter installed and capabilities pending, or capabilities native). Ends on non-native capabilities or a failed bridge call, so a control is never missing | FIXED. `cold2`: controls fade in once, natively |
| G-03 | P1 | Scripture chrome on scroll | `scr1` 30 fps: every return of the header / bar showed web placeholders, then native over them for ~200 ms: **doubled "Genesis 1"**, swapped icons | Native ownership was dropped whenever a placeholder was off screen or still sliding back in its CSS transition. The reader title had no collapse support | Ownership returns to the web **only when a placeholder is covered**. Collapsed, hidden, off-screen or in a running CSS transition (`document.getAnimations()`), it stays native at its resting rect. The reader title collapses natively toward the top (`collapseEdge: 'top'`) | FIXED. `scr2`: chrome returns as native glass only |
| G-04 | P2 | Native cluster animation | Code: `GlassCluster.update` set `transform = .identity` to set `frame` on every `setControls` | Any update mid-slide snapped the cluster | Layout via bounds + center; a running collapse animator owns the transform; reversals continue from the on-screen state (`UIViewPropertyAnimator`); curve matched to the web chrome (`cubic-bezier(0.2, 0.8, 0.2, 1)`, 0.24 s) | FIXED (`scr2`) |
| G-05 | P2 | Placeholder look | `tabs1`: when a sheet covers the header, the title shows an accent-blue icon and the glyphs change weight; the tabs icon is drawn differently | Placeholders didn't match their native twins | Label-colour glyphs, native sizes and weights; tabs icon redrawn like `square.on.square` | FIXED (`tc1`, `to1`) |
| G-06 | — | — | (merged into G-05) | | | |
| G-07 | P1 | Sheet over native glass | `vs1`: the native bottom glyphs drawn **on top of** the rising verse sheet for 2–3 frames | Sheets animate by writing inline styles: no DOM insertion, no `transitionend`. Occlusion only ran on the 350 ms safety interval, tested only the placeholder's centre, and the native hide faded out over the overlay | The glass sync also observes `style` / `class` mutations (0 during ordinary scrolling, measured); occlusion samples top / centre / bottom; native hide is instant, fade-in kept | FIXED. `vsy1`, `vsy2`: no glyph over the sheet |
| G-08 | P2 | Hand-off order | `tc1`: one frame with **neither** title drawn when the tab cards opened | The native hide (instant, UI process) landed before WebKit painted the revealed placeholder (web process) | The placeholder is revealed synchronously; the native hide is sent after two animation frames (a frame with the placeholder has been produced). This is frame sequencing between two renderers, not a timeout | FIXED. `to1` (open) and `zo5`–`zo8`: no blank frame |
| S-01 | P2 | Scripture, any scroll | After a swipe a verse row stays tinted (`ovt`, `after.png`) | Shared `VerseRow` `hover:bg-lift-1`; iOS WebKit keeps `:hover` on the last touched element | Tailwind `future.hoverOnlyWhenSupported` | FIXED. Probe: 0 tinted rows after real swipes. Mac hover verified unchanged |
| P-01 | P2 | Notes editor (phone) | 5,222 of a long note's 7,066 DOM nodes were block-handle widgets; stray "+" / grip glyphs on tap | The desktop hover gutter plugin was installed on the phone | Not installed with `chrome="phone"` | FIXED. 7,066 → 1,844 nodes |
| P-02 | P3 | Notes editor (phone) | Page re-rendered on every keystroke | `persist` called `setNote` for content-only patches | Content-only patches don't re-render (the print preview reads `latest`) | FIXED; **no measurable gain** (P-03 was the cost) |
| P-03 | P1 | Notes editor, long note | First frame after a keystroke ~80 ms; `state.apply` 42 ms/key | `berean-ref-decorations` rescanned every textblock on every doc change | Incremental update: map the old set and re-scan only changed textblocks, plus those whose verse-block exclusions changed; full rebuild for > 40 blocks, suppress toggles and tag changes. Randomized equivalence test (`refDecorationsIncremental.test.ts`, mutation-checked) | FIXED. `state.apply` 42 → 1.1 ms; dispatch 58 → 17 ms; first frame 80 → 45 ms. Desktop live check: refs appear and disappear correctly |
| P-04 | P3 | Notes editor, very long note | Remaining ~13 ms/key = `serializeToMarkdown` of the whole 79 KB doc (0.86 ms under Node, 13.4 ms on the simulator's JSC) | The editor serialises the full doc on every change for `onChange` | **Not changed.** Deferring serialisation changes autosave timing and risks losing the last keystrokes on backgrounding; needs its own design. Typical notes serialise in < 1 ms | OPEN |
| O-01 | P3 | Notes editor | A note whose body opens with `# <title>` shows the title twice on iPhone | The phone has no `contentStartsWithTitle` check (the Mac has) | Out of scope | OPEN |
| O-02 | P3 | Search | "light" offers *Go to: First Epistle of Clement* | Loose book-name matching | Out of scope | OPEN |
| O-03 | P3 | Relaunch | Notes reopens at Folders, not the open note | Nested Notes navigation isn't restored | Out of scope | OPEN |
| O-04 | info | Simulator | `AppIntentsLiveEntityService` (Apple, host) crash reports at reinstall times | Apple system service; no Berean frames | N/A | N/A |

## Measurements (rAF monitor, real gestures)

| Area | avg fps | p99 ms | > 50 ms | DOM before → after |
|---|---|---|---|---|
| Scripture (slow / rapid / reversal / overscroll) | 59.6 | 32 | 0 | 1,761 → 1,761 |
| Search sheet results, keyboard up | 58.5 | 41 | 1 | 1,982 → 1,761 |
| Tab cards sheet | 58.7 | 38 | 0 | — |
| Notes list (62 notes, 40 s) | 59.8 | 28 | 0 | 635 → 635 |
| Long note (79 KB) | 59.8 | 27 | 1 | 7,066 → 7,066 (before P-01) |
| Caret sheet | 60.0 | 26 | 0 | — |
| Cross references sheet | 59.8 | 27 | 0 | 1,836 → 1,761 |
| Lexicon entry H7225 | 59.8 | 25 | 0 | 938 → 3,414 (occurrence list grows on scroll by design) |
| Search tab ("peace", 1,104 verses) | 60.0 | 25 | 0 | 516 → 516 (windowed) |
| Settings | 60.0 | 25 | 0 | 251 → 251 |
| History (+ horizontal chip row) | 60.0 | 25 | 0 | 166 → 166 |
| Calendar | 60.0 | 26 | 0 | 176 → 176 |
| Compare (KJV / LXX) | 60.0 | 25 | 0 | 2,091 → 2,091 |
| Keystroke → first frame, long note | 80 ms → **45 ms** | | | after P-01 and P-03 |

Search typing: results for "light" rendered with the keyboard up (≈2 s round trip including the automation capture; not isolated).

## Scrollable-area matrix

Test columns: N normal · R rapid · D direction changes · T top overscroll · B bottom overscroll · G glass during
scroll · E re-entry / navigation · K keyboard.

| ID | Screen / component | Container | Dir | Nested | Floating glass | N | R | D | T | B | G | E | K | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A1 | Scripture reader (`ReaderPage`) | `.mobile-reader-scroll` in framer pager | V (+ H pager) | yes | GS-1, GS-2, GS-3 | PASS | PASS | FIXED (G-03) | PASS | PASS | FIXED (G-03, S-01) | PASS | N/A | `scr1`, `scr2`, `ovt`, `ovb` |
| A2 | Compare page | `.mobile-reader-scroll` ×2 | V | yes | GS-1 | PASS | PASS | PASS | PASS | PASS | PASS | NOT TESTED | N/A | `compare` |
| A3 | Horizontal chapter pager | framer drag | H | yes | GS-1 | NOT TESTED (no chapter swipe run) | | | | | | | | — |
| B1 | Search sheet (+) | `.mobile-sheet-body` | V | no | GS-5 | PASS | PASS | PASS | PASS (drag-dismiss at top) | NOT TESTED | PASS | PASS | PASS (dismisses on scroll) | `srch2`, `k2`, `k8` |
| B2 | Search tab results | page body (windowed) | V | no | GS-1, GS-3, GS-6 | PASS | PASS | PASS | PASS | PASS | PASS | PASS | N/A | `srchtab` |
| B3 | Search filter chips | `.mobile-chip-row-scroll` | H | in B1 / B2 | — | NOT TESTED | | | | | | | | — |
| C1 | Notes folders / All Notes list | `.mobile-page-body` | V | no | GS-1, GS-7 | PASS | PASS | PASS | PASS | PASS | PASS | PASS | N/A | `nl` |
| C2 | Note editor (long) | `.berean-pm-editor` | V | no | GS-1 | PASS | PASS | PASS | NOT TESTED | PASS (reached end) | PASS | PASS | PASS (focus, type; scroll with keyboard partly) | `lnc`, `kb*` |
| C3 | Note insert menu / selection bar | `.m-note-insert-menu`, `.m-selbar` | V / H | — | — | NOT TESTED | | | | | | | | — |
| D1 | Lexicon entry | page body | V | no | GS-1, GS-3 | PASS | PASS | PASS | PASS | PASS | PASS | NOT TESTED | N/A | `lexe` |
| E1 | Cross references sheet | `.mobile-sheet-body` | V | yes (over reader) | GS-5 | PASS | PASS | PASS | PASS (drag-dismiss) | NOT TESTED | PASS | N/A | N/A | `xref`, `xr1` |
| E2 | Verse sheet (low detent) | sheet | — | — | GS-5 | N/A | | | | | FIXED (G-07) | PASS | N/A | `vsy*` |
| F1 | Tab cards sheet | sheet body | V | no | GS-5 | PASS | PASS | PASS | PASS (drag-dismiss) | NOT TESTED | FIXED (G-05, G-08) | PASS | N/A | `tabs1`, `to*` |
| F2 | Sessions list / Workspaces page | page / menu | V | — | — | NOT TESTED | | | | | | | | — |
| H1 | Caret sheet | sheet body | V | no | GS-5 | PASS | PASS | PASS | PASS (drag-dismiss) | NOT TESTED | PASS | PASS | N/A | `c2` |
| H2 | Popover menu (Search "…") | `.m-popover-menu` | V | over page | GS-6 | N/A (short) | | | | | PASS | PASS | N/A | `pm1`–`pm3` |
| H3 | Grid (tab type) menu | menu | — | — | GS-3 | N/A | | | | | PASS | PASS | N/A | `grid1` |
| I1 | Settings | `.mobile-page-body` | V | no | GS-1, GS-3 | PASS | PASS | PASS | PASS | PASS | PASS | NOT TESTED | N/A | `settings` |
| I2 | History (+ filter chips) | page body + `.mobile-chip-row` | V + H | yes | GS-1, GS-3 | PASS | PASS | PASS | PASS | PASS | PASS | NOT TESTED | N/A | `history`, `hz*` (H: 237 px → 0 with overscroll) |
| I3 | Calendar tab | page body | V (short) | no | GS-1 | N/A | N/A | N/A | PASS | PASS | PASS | NOT TESTED | N/A | `calendar` |
| I4 | Study Trail, Queue, Archive, Trash, Transcript packs, Strong's sheet | various | V | — | — | NOT TESTED | | | | | | | | — |

## Lifecycle and stability

| Scenario | Result | Evidence |
|---|---|---|
| Cold launch ×5 | PASS after G-01 / G-02 (no dark frame; controls fade in once) | `cold1`–`cold5` |
| Warm launch (3 s and 30 s in background) | PASS: glass present on the resume frame, no re-tint | `warm3`, `warm4` |
| Press-and-hold glass button | PASS: interactive glass grows and brightens; no non-glass state | `press_*` |
| Keyboard (search sheet, note editor) | PASS: native bar hidden while the keyboard is up, returns natively; scroll dismisses the keyboard | `srch2`, `kb4`, `kb5` |
| Stress: 12 rounds of tab switch + rapid scroll + tab-cards open / close + verse sheet | PASS: same PID (20091 → 20091), DOM 1,761 → 1,829 (end state differs), no Berean crash report | stress run |
| macOS shared-code check | PASS: hover tint works (`(hover: hover)` true); incremental reference decorations correct while typing and deleting; Notes top-bar order Insert · Undo · Redo · Edit/View · … · Info | desktop dev, CDP |

## 2026-10-17 pass (branch `feature/overhaul-1017`)

Simulator iPhone 18 Pro, Berean Dev probe build, **3,865 temporary notes** (3,268 BibleGateway-tagged, 471 verse, 90 daily, the rest in 14 nested test folders; all tagged `perfseed` and removed afterwards). Timings are main-thread time from the action to the first rendered frame (rAF probe); the simulator runs at 60 Hz, and device numbers will differ.

| ID | Area | Evidence | Root cause | Fix | Before → after |
|---|---|---|---|---|---|
| P-10 | Cold launch | One uninterrupted ~108 s main-thread block starting 267 ms after launch (`sample` of WebContent: a single `RegExpObject::exec`) | `extractRefsFromNote`'s book-word repeat `(?:\s+(?:of\s+)?…)*`: "of" matched both branches → exponential backtracking on long prose without chapter numbers (one 4.5 KB note: 53 s). Runs for every verse note when the cross-reference index builds | Redundant `of` branch removed, repeat capped at 8 words (`src/lib/noteRefs.ts`); regression test fails against the old regex | ~108 s → ~0.4 s (remaining: GC + first Scripture render). Mac uses the same code |
| P-11 | All Notes | 3,865 rows mounted, 37,931 DOM nodes | Unwindowed list; per-row markdown stripping on every render; `will-change` on every row | `VirtualNoteList` (windowed, grouped-card look kept), memoised rows with stable callbacks, previews cached per note object, folder labels one map per folder list, `will-change` only while dragging | 675 ms → 42 ms; DOM 37,931 → ~300–470 |
| P-12 | BibleGateway folder | | as P-11 | as P-11 | 510 ms → 29 ms |
| P-13 | Scrolling All Notes | | | | p99 20 ms, 0 frames > 50 ms (slow and fast); reaches the true end |
| P-14 | Notes large title / bar ("topper late") | | IntersectionObserver waited for the last pixel of title + subtitle + padding; every flip re-rendered all rows | Observes the title line; rows memoised | — |
| G-10 | Reader title vanishes | Native capsule showed only the book glyph after Find on Page jumped Genesis 2 → 8 (`__bereanGlassDebug`: item 55 pt wide, then a stale zero-width label) | (a) `sizeThatFits` on an existing UIButton returned the previous configuration's size; (b) re-configuring an existing button with a new attributed title kept the old label layout; (c) separately, a remounted page's stale timers could send an all-hidden spec for the shared cluster | Width measured from title + icon + insets; a new title rebuilds the button; one live owner per cluster id, stale instances never sync or remove (regression test fails without it) | Verified through Find jumps and Genesis 9 → 11 |
| G-11 | Find bar see-through | Verse text read through the bar | Backdrop blur can't reach past the reader's mask | Near-opaque fill, capsule shape | — |

Not measured: device CPU/GPU/battery, memory (no `performance.memory` in WebKit), Instruments.

### 2026-10-17, round 2 — launch audit ("ios is taking way too long to load things")

Device log (Michael): `WebProcessProxy::didBecomeUnresponsive` during launch. Re-measured on the simulator with 3,865 notes (471 verse notes now carrying references) using probe-build boot marks, a boot-time stall recorder and `perfSpan` timings (`src/lib/perfSpan.ts`, compiled out of normal builds).

| ID | Found | Fix | Before → after |
|---|---|---|---|
| P-20 | `classifyChapterNotes` 691 ms (2 calls) + `chapterXRefsFromNotes`: every chapter view rebuilt the cross-reference index by re-parsing EVERY note | Loaders take the shared per-token index (`getCrossRefSources`); references cached per note (id + title + content) | 691 ms → 2 ms; chapter change 141 / 207 ms → 25–37 / 65–104 ms (update / painted) |
| P-21 | The one first parse (~310 ms) was a single task at launch | `buildCrossRefSourcesYielding`: 60-note slices that yield | Launch stall: ~1,050 ms → none > 80 ms |
| P-22 | YouTube index merge attached/detached the 7 MB index on berean.db's connection on every launch (~0.7–1.2 s), queueing the notes / chapter reads behind it | Version check via its own read-only connection, attach only when newer, 4 s after launch | — (off the launch path) |
| P-23 | Spotlight full re-index (2,000 notes) and iCloud catch-up started during launch | Spotlight 6 s after launch; sync after first paint + 1.5 s | — |
| P-24 | Every note change event bumped the notes token → every consumer re-read all ~8 MB of notes (a sync catch-up = hundreds of re-reads) | Change notifications coalesced (60 ms) in the iOS bridge | Bursts → one refresh |
| P-25 | Warm-start snapshot serialised ~8 MB per change only to be rejected by the ~5 MB quota | Skipped (and cleared) when it can't fit | ~10–20 ms per change |
| G-20 | "whenever i click a button, it turns off the glass": a popover's transparent outside-tap layer counted as covering every native control | Occlusion looks through `data-glass-passthrough` layers (popover layer, tab-switcher scrim) | Native glass stays drawn with a popover open (verified via `__bereanGlassDebug`) |

The log's "Networking / GPU / WebContent process took 4.6 s to launch" is WebKit's own process start-up before any Berean code runs. It is typically much slower in a Debug build launched under the Xcode debugger; not measured on a Release build yet — check the TestFlight build on device.
