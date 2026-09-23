# Post-migration architecture (testing wave 2026-09-22)

Architecture added or changed while working through `testing-backlog-2026-09-22.md`. The
migration architecture (`architecture.md`) is unchanged and still authoritative; this file
documents the pieces this wave introduced, one section per concern, updated as each wave lands.

---

## 1. Shared Scripture navigation fallbacks (Wave 1 — TEST-009, TEST-025)

`src/lib/textCoverage.ts` is the one place that knows which books a Bible text can show:

- `textHasBook(textId, bookId)` — coverage from the bundled DBs. Only texts whose book list
  differs from the canonical set carry a table (`lxx`: `SELECT id FROM books` of
  `lxx_brenton.db` — no New Testament, no Hebrew Esther `EST`, it has Greek Esther `ESG`);
  dedicated texts (Enoch, Jubilees, …) use the existing `getTranslationForBook` rules.
- `resolveTextForBook(currentTextId, bookId)` — the text a navigation should land in:
  dedicated text for a dedicated book; the current text when it has the book; otherwise
  **KJV (`kjva`)**. `navigateToVerse` (src/lib/verseNavigation.ts) — the single navigation
  function used by cross references, search, lexicon occurrences, note links, the iPhone reader
  and picker — calls it, so LXX → New Testament cross reference opens in KJV on both platforms.
  The previous text stays in `scriptureBack`, so Back returns to the LXX passage.
- `chapterForBookSwitch(bookId, chapter, chapterCount?)` — a chapter the book does not have
  opens chapter 1. Applied in `navigateToVerse` (static chapter table) and in the iPhone reader
  once the loaded text's real chapter count is known (covers translation switches with different
  chapter counts). Hermas is excluded — it has its own numbering and clamp (`hermasMap`).

## 2. Verse-selection model (Wave 1 — TEST-001, TEST-007, TEST-019)

- **State:** `selectedVersesByTab[tabId]: SelectedVerseRef[]` (unchanged shape). New store
  actions: `setVerseSelection(tabId, refs)` (replace), `beginVerseDrag` / `updateVerseDrag` /
  `endVerseDrag(commit)` with `verseDrag: { tabId, anchor, current, before, pointer }`.
- **Model:** `src/lib/verseSelection.ts` — `verseRange` (forward/backward → ascending, clamped
  to the anchor's text/book/chapter, skips verses a chapter lacks), `selectionKind`
  (`none | single | range | multiple`), `selectionAllows(sel, action)` — the single rule for
  which actions a selection enables (`add-note`, `verse-notes`, `cross-refs` → single verse
  only), `selectionLabel`, `versesSpanned` (text selection → verse selection).
- **Gesture:** `src/components/bible/verseDragSelect.ts` — a press on a VerseRow verse number
  becomes a range drag after 6 px of travel; the verse under the pointer is hit-tested through
  `[data-verse-row]` attributes (`data-book`, `data-chapter`, `data-text`, `data-verse`). The
  live range is written into the tab's selection, so rows show the selected treatment (plus an
  inset accent outline while `verseDrag` is active) **during** the drag; `VerseDragIndicator`
  (mounted by both shells) shows "Genesis 1:3–7 · 5 verses" next to the pointer. Release
  commits, Escape / pointercancel restore the previous selection, the click that ends a drag
  never toggles (`consumeDragClick`), autoscroll near the scroller edges. The badge has
  `touch-action: none`, so the same gesture works with a finger on the iPhone.
- **Consumers:** desktop `VerseSelectionBar` and iPhone `SelectionBar` gate "Add note" through
  `selectionAllows(sel, 'add-note')` (disabled on desktop with an explanatory label, hidden on
  the phone).

## 3. History model (Wave 1 — TEST-002)

`src/lib/historyModel.ts` holds every history entry type the app writes (audited writers:
`bible`, `compare`, `strongs-click`, `lexicon`, `note`, `search`, `youtube`, `import`), the
categories (`all`, `scripture` = bible + compare, `notes`, `lexicon` = lexicon + Strong's,
`youtube`, `search`, `imports`), and the filter (`filterHistory`, `countByCategory`,
`isRoutineRead`, `shouldLoadMoreHistory`). Both the desktop History modal and the iPhone History
page use it.

Root causes fixed:
1. "Study only" (default on in the Scripture category) removed **every** `bible` entry, leaving
   only Compare rows — the Scripture filter looked empty. It now hides only routine reads
   (a Scripture visit with no target verse).
2. Paging stopped whenever any filter was active, so a category only ever saw the newest 300
   rows (mostly routine reads) — rarer types looked "missing". Filtered views now keep paging
   until enough rows are visible, and the scroll loader works with filters on.
3. `import` entries had no category (reachable only through All) — now "Imports".
4. The type chips inside a category show only that category's types.

## 4. Scroll-state audit (Wave 1 — TEST-003, TEST-008)

Rule kept: exact scroll offsets are **device-local presentation state** — they live in the tab's
local state (`LOCAL_FIELDS` in `src/platform/sync/tabFields.ts`, `local_state_json` in SQLite)
and are never synchronised through iCloud.

| Surface | Where the offset lives | Flush / restore | Status after this wave |
|---|---|---|---|
| Scripture reader (desktop) | `tab.state.scrollPosition` + live `scrollByTab` | `berean:saveScrollBeforeTabChange` (fired by `setActiveTab`) → BiblePanel `onSave`; restore on tab/space activation | **Fixed (TEST-003)** — two root causes, below |
| Scripture side panel (cross refs / notes / lexicon) | `rightPanelScrollTops` / `…B` (per sub-tab) | `useKeyedScrollMemory` (src/hooks) — capture-phase scroll listener per `data-scroll-key`, restore with retry on sub-tab change and on mount | **Fixed (TEST-008)** — was one shared value restored only on mount, and hidden (`display:none`) sub-tabs lose their offset in Chromium/WebKit |
| Notes panel | `scrollTop`, `listScrollTop`, `cursorPos` | ref-tracked values flushed on the switch event | OK (saves tracked values, not the hidden DOM) |
| Lexicon panel | `scrollTop`, `searchScrollTop` | own save/restore (`LexiconPanel.scrollPersistence.test.tsx`) | OK |
| Scripture Advanced Search | `searchScrollTop`, `searchScrollAnchor` | BiblePanel search view | OK (unchanged) |
| Search / PDF / YouTube tabs | `scrollTop` | their panels | OK (unchanged) |
| Workspace switch | the same per-tab local state travels with the tabs | same restore paths | unchanged |
| iPhone reader | — | — | Wave 3 (reader redesign) |

TEST-003 root causes (reproduced in the running desktop app over CDP, then verified fixed):
1. `setActiveTab` captured `state = get()`, dispatched the flush event (which writes the live
   offset), then committed `set({ tabs: { ...state.tabs … } })` from the **pre-flush** snapshot —
   putting the old tab state straight back. Every tab switch discarded the position it had just
   saved. It now re-reads the store after the flush and no longer rewrites `tabs`.
2. Switching **back** to Scripture fires the flush again; the hidden Bible panel (display:none,
   offset already dropped to 0) answered it and saved 0. `onSave` now ignores the event when its
   scroller is not rendered.

## 5. Presenter sync after a verse jump (Wave 2 — TEST-004)

Reproduced in the running desktop app (CDP, presenter window open) and fixed at each link:

1. **Payload lost the verse.** ChapterView scrolls to `targetVerse` and clears it in a *child*
   effect, which runs before App's `useViewerSync` push effect — the payload carried neither a
   verse nor a percent. `useViewerSync` now records every jump synchronously with a store
   subscription (`setLastBibleVerse` + a **jump anchor**).
2. **Jump anchor.** While `jumpAnchor` matches the chapter, the payload carries the verse and
   no scroll percent, and BiblePanel's proportional pushes (scroll handler, settle, centred
   model step) stand down. The user's own wheel / touch / scroll-key input clears it, after
   which the presenter mirrors the reader proportionally again.
3. **Presenter side.** A verse-only payload releases the live percent ref (`ViewerApp`) so the
   rAF apply loop stops pulling the presenter back to an earlier position; centring on the verse
   is instant (`behavior: 'auto'`), like the find-bar path.
4. **Main side.** Region-arrival seeding of the centred model and the band clamp skip while a
   jump owns the passage; a landed jump (cached chapter) is honoured by the chapter-reset paths
   for 1.5 s (`verseJumpOwnsPassage`). This last part also fixed a pre-existing bug: cross-chapter
   search / cross-ref jumps into an already-cached chapter landed on verse 1.

## 6. Layering and menus (Wave 2 — TEST-005/006/012/017/018)

- Layer tokens stay `--z-popover` (400) < `--z-menu` (450). A popover must carry its layer on
  the **fixed** element that forms its stacking context — `MenuPositioner` does this; the layout
  picker now uses it instead of a z-index-less fixed wrapper.
- `MenuItem.selectionStyle: 'check' | 'highlight'` — `highlight` draws no check column and gives
  the selected row the selected-row treatment; semantics (`aria-checked`) unchanged. Used by the
  session menu and every `OverflowGroup` ("…") menu.
- `Select` aligns its menu to the trigger (`align: 'auto'`, `resolveSelectAlign`) and matches the
  trigger's width.

## 7. Floating tabs (Wave 2 — TEST-013)

`src/lib/floatingTab.ts` is the single entry for opening a floating window (`openFloatingTab`,
`floatingTabState` drops null/undefined before the state is serialised into the window URL).
`FloatingShell` gives an independent window its own Scripture tab before applying the
requested passage — since the Phase 5 SQLite tab mirror, independent windows start with no
active tab and every floating Scripture window had opened at Genesis 1.

## 8. iPhone Scripture reader + verse selection (Wave 3)

- **Verse model** (`src/mobile/reader/verseSheets.tsx`, shared by the reader and Compare page):
  tap anywhere on a verse → single-verse selection + verse sheet at its LOW position (tap again →
  deselect + close; another verse → selection moves, sheet keeps its height); long-press → native
  iOS text selection; one `selectionchange` listener finds the verse through a registry of
  per-row context builders (`VerseInteraction.registerRow`) and shows the verse sheet in
  selection mode, forced back to LOW while the handles move; clearing the selection closes it and
  selects nothing. `VerseRow` (touch) implements the tap: movement, hold time, taps on Strong's
  chips / buttons and "tap that only dismissed a selection" are excluded.
- **Two root causes found on the simulator:** framer-motion's pager drag set `user-select: none`
  on the whole track (Scripture text was never selectable on the phone) — panes re-enable it; and
  the current pane rendered `aria-hidden="false"`, which `charOffsetInVerse` treated as hidden
  text, so every selection offset was 0 — now only `aria-hidden="true"` is skipped.
- **Sheet detents** (`src/mobile/primitives/Sheet.tsx`): `detents` (fractions) + optional
  `lowDetent` (px, verse sheets only) + `undimmedThrough` + `forceDetent`; ✕ only at the low
  position (visually hidden Close elsewhere for VoiceOver); a fast fling closes from any position
  (`settleDetent`); taller grab strip.
- **Verse sheet** (`VerseActionSheet`): LOW = reference, highlight colours, Copy / Note / Refs /
  Share / More tiles; MEDIUM+ = the study view (`VerseStudy`: verse with Strong's superscripts +
  dense cross references, TSKe/Classic) and every other verse action.
- **Reader** (`ReaderPage`): compact layout (mobile.css; text ≈ 90% of width), inline superscript
  Strong's on touch (`StrongsInline` touch variant; no overlap spacing), edge taps + swipe pager,
  overlay top bar hidden on downward scroll (`useHideOnScroll`), per-tab scroll memory
  (`readerScrollMemory`, device-local), passage navigator on the title (`ReferencePicker`),
  continuous scroll fixed (flex pane), line height via the shared `useBibleLineHeight`.
- **Simulator automation** (`src/platform/ios/devProbe.ts` + `scripts/ios/probe-server.mjs`):
  a JS evaluation channel compiled in ONLY for `BEREAN_E2E_PROBE=1` builds (dev CSP), used to
  verify UI flows with real WKWebView rendering. Never in normal / TestFlight / App Store builds.

## 9. Compact, e-Sword-inspired study presentation (Wave 5)

- The reader keeps Scripture dominant: verse number near the left edge, text ≈ 90% of the width,
  tight verse rows, Strong's numbers inline as small accent superscripts (no pills, no extra line
  height). Dynamic Type scales the whole reading column (`zoom: var(--m-type-scale)`) on top of
  the user's Reading text size — compactness comes from spacing, never from small text.
- The verse sheet at its medium position is the "lower pane": the verse as `(KJVA+)` with tappable
  Strong's superscripts, then its cross references as a dense list of links (TSKe / Classic,
  looked up for the current text). The page behind stays interactive: tapping another verse
  updates the pane in place and scrolls that verse above it (`keepVerseAboveSheet`), so a chapter
  can be studied verse by verse without closing anything.
- Visuals are Berean's (tokens, materials, typography); only the density and the reader + study
  pane arrangement are taken from the reference.
