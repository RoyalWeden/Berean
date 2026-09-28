# Testing backlog — 2026-09-23 refinement pass

Source: the developer's personal testing notes `September 23, 2026 – Testing.md` (kept outside the
repository, in `~/Downloads/`). As with the 2026-09-22 pass
([testing-backlog-2026-09-22.md](testing-backlog-2026-09-22.md)), the notes file is not copied here;
every line of it is converted into a tracked requirement (T23-xxx) with its outcome.

Status values: `OPEN` · `IN PROGRESS` · `COMPLETE` · `SUPERSEDED` (replacement named) ·
`DEFERRED` (reason named) · `BLOCKED` (blocker named). Columns **S / D / P** = affects shared code /
desktop / iPhone. "Complete" means implemented **and** verified at the level stated in *Verified*.

## Design direction of this pass

Berean iPhone is one navigation system: **Tab cards → Tab → contextual Caret → current Sheet →
sub-view inside the same sheet → back to the parent**. Sheets are navigable surfaces: a control
inside a sheet that shows another view of the same context replaces the sheet's content and puts a
contextual back control (`‹ Scripture`, `‹ Tabs`) at the top, instead of opening another sheet.
See [mobile-navigation.md](mobile-navigation.md) §5.

## Audit summary (before changes)

| Area | Finding |
|---|---|
| YouTube / Lexicon top | Hosted desktop panels render the desktop `PanelHeader` (44 px, 76 px macOS traffic-light inset) under only a safe-area pad (`.mobile-hosted-panel`) — a shared hosting-layer problem, not per-tab padding |
| Continuous scroll | Shared `ContinuousChapterScroll` always renders an "evicted chapters" placeholder (≈900 px × chapters before) and never scrolls past it on mount → blank screen for any chapter > 1 (latent on desktop too) |
| Translation switch | Reader pane keyed by `book-chapter-textId` → remount at scrollTop 0 under the (dimmed) sheet; scroll memory keyed by textId → position lost |
| Tab long-press | No `user-select` rule on the tab-cards sheet (stale `.mobile-tab-grid` selector); long-press relies on a timer only |
| Sheets | `SheetHost` is a flat stack; no in-sheet sub-view concept; ~15 sheet-on-sheet / sheet-replace cases (caret → translations, caret → reading options, tab cards → workspaces, search caret → filters, verse sheet → notes/refs/tags, note actions → status/icon/folder …) |
| Tabs | Tab types `bible, note, lexicon, youtube, search, pdf, tags`; History / Settings / More are pages; Search page state is local (not per tab) |
| Clement | `recog_clement.db` Book III stored contiguously 1–65; ANF numbers it 1, 12–75 (Rufinus omits 2–11) → every chapter ≥ 2 is 10 lower than ANF citations |

---

## iPhone — Bugs

| ID | Original observation (verbatim) | Platform | Implementation | Status | Verified | S | D | P | Notes |
|---|---|---|---|---|---|---|---|---|---|
| T23-001 | "the top of the youtube tab is scrunched and there isnt enough room" | iPhone | Shared hosting layer: `PanelChromeContext` 'phone' + `HostedPanel` (MobileApp): hosted desktop panels render phone header metrics (48 px, no 76 px traffic-light inset, no window drag) | COMPLETE | Simulator: hosted header 48 px under the 62 px safe area, no traffic-light inset (screenshot) |  |  | ✔ | Wave 1 · 0ea702c |
| T23-002 | "the top of the lexicon tab is scrunched and there isnt enough room" | iPhone | Same shared fix as T23-001 (Lexicon, YouTube, PDF and Tags are all hosted panels) | COMPLETE | Simulator: same measurement + screenshot for Lexicon |  |  | ✔ | Wave 1 · 0ea702c |
| T23-003 | "enabling continuous scroll makes all the text in the scripture disappear" | iPhone (+ desktop latent) | `ContinuousChapterScroll`: placeholders only for measured+evicted chapters (unvisited chapters above reserved ~900 px each → blank page); manual scroll anchoring on range changes (WebKit has no overflow-anchor); `initialAnchor`; reading position is a verse anchor shared by paged and continuous modes | COMPLETE | Simulator: Genesis 5 continuous shows text; top verse 5:12 kept across paged → continuous → LXX; unit test (anchor memory) | ✔ |  | ✔ | Wave 1 · 0ea702c |
| T23-004 | "which i switch text when the sheet is open, the text shows above the sheet for a moment" | iPhone | A remounted reader pane stays hidden until its verse anchor is restored (no top-of-chapter frame); the anchor survives the switch; translation is picked inside the caret so the sheet stays in place | COMPLETE | Simulator: after picking a text in the caret the sheet stays open; the remounted pane is hidden one frame, then shows at the same verse. Real-device feel: device pass |  |  | ✔ | Wave 1 · 0ea702c; Wave 4 · 9ab6613 |
| T23-005 | "when i hold my finger on a tab, the other menu shows but it also selects text/background or whatever. that shouldn't be possible" | iPhone | Tab cards own the gesture (press → hold → lift → drag); `selectstart`/`contextmenu` blocked while pressed; non-passive touchmove while lifted; no-select CSS on the sheet (stale `.mobile-tab-grid` selector replaced) | COMPLETE | Simulator (synthetic touch): no text selection during the press, card lifts. Real finger: device pass |  |  | ✔ | Waves 2+3 · aa04079 |

## iPhone — Changes

| ID | Original observation (verbatim) | Platform | Implementation | Status | Verified | S | D | P | Notes |
|---|---|---|---|---|---|---|---|---|---|
| T23-006 | "when i click buttons at different places on a sheet, i dont like that a different panel pops up instead of just editing the current sheet" | iPhone | `Sheet` in-sheet navigation (`api.push/pop`, `useSheetApi`, contextual back, slide transitions); used by caret, verse sheet, tab cards, note caret, search caret | COMPLETE | Simulator: caret / verse / tab-cards / search / note sub-views open in the same sheet (1 sheet open, contextual back) |  |  | ✔ | 61d63bc; Waves 2–8 |
| T23-007 | Tabs: "the tabs should show lxx (or nothing)" | iPhone | `tabTextBadge`: only LXX is named (tab cards + reader title); KJV shows nothing | COMPLETE | Simulator: title shows LXX only for LXX; cards show no KJV label |  |  | ✔ | Waves 2+3 · aa04079 |
| T23-008 | Tabs: "remove the 'reorder' button and instead allow reordering tabs from how they are" | iPhone | Reorder button removed; press-hold-drag a card writes the unified display order (`reorderTabDisplay`, same as the Mac sidebar); Move earlier / later in card actions for VoiceOver | COMPLETE | Simulator (synthetic drag): card lifted, reordered, stored in the unified display order; unit tests (tabOrder). Real drag feel: device pass |  |  | ✔ | Waves 2+3 · aa04079 |
| T23-009 | Tabs: "when opening the new tab menu, all the options should open legit new tabs (i.e., a dedicated history tab, a dedicated settings tab, etc). not everything should have a tab" | iPhone (+ desktop fallback) | TabType += history / settings (search space; desktop `ToolTabFallback`; sync field rules); one navigation stack per TAB; Search / History state stored in the tab; Notes tabs reopen their note; New Tab tiles create real tabs (History, Settings, Compare when applicable); More / Workspaces stay pages | COMPLETE | Simulator: History and Settings open as tabs (no back); two Search tabs with independent queries. Desktop fallback: typecheck + build | ✔ | ✔ | ✔ | Waves 2+3 · aa04079 |
| T23-010 | Tabs: "from the new tab sheet, remove the 'search' button, and instead, if applicable, when typing show a button to open in a dedicated search tab" | iPhone | New Tab: no Search tile; typing shows "Search … in a new Search tab" (`openQueryInNewSearchTab`, always a new tab) | COMPLETE | Simulator: typing offers 'Search … in a new Search tab'; a second Search tab was created with the query |  |  | ✔ | Waves 2+3 · aa04079 |
| T23-011 | Tabs: "in the tabs sheet, i am not getting the feeling that these are like Arc with the cards" | iPhone | `TabPreview`: real preview of each tab's last state (passage text from the reading anchor, compare columns, note text, query, lexicon entry, video thumbnail, history, settings look); depth, active ring, lift | COMPLETE | Simulator screenshot: previews show each tab's content (after fix: word replacer applied, no repeated passage) |  |  | ✔ | Waves 2+3 · aa04079 |
| T23-012 | Tabs: "clicking the session shouldn't open a new sheet, instead it should change the look of the current sheet or show the option to go back to tabs (this back thing should happen whenever the sheet is changed)" | iPhone | Workspaces, workspace actions and icon, tab actions, Move to workspace and New tab open inside the tab-cards sheet with "‹ Tabs" | COMPLETE | Simulator: Workspaces and tab actions open inside the tab-cards sheet with '‹ Tabs' |  |  | ✔ | Waves 2+3 · aa04079 |
| T23-013 | Advanced scripture search tab: "remove the filter button at the top right and all the relevant filter things should be in the caret menu, make sure there is clear structure" | iPhone | Header filter button removed; Search caret: Search in / Match / Scripture filters (Text ›, Books ›, Verse tags › in-caret, Reset) / Sort (order + direction) / Clear, History | COMPLETE | Simulator: no header filter button; caret groups Search in / Match / Scripture filters / Sort; Text → LXX filtered the results |  |  | ✔ | Waves 2+3 · aa04079 |
| T23-014 | Scripture tab: "when i open the caret menu, show the top bar" | iPhone | `useHideOnScroll` `forceShown` while the caret is open | COMPLETE | Simulator: header hidden after scrolling, shown with the caret open |  |  | ✔ | Waves 4+6 · 9ab6613 |
| T23-015 | Scripture caret: "remove the 'go to' button" | iPhone | Removed; the reader title is the passage search | COMPLETE | Simulator: caret items listed — no Go to |  |  | ✔ | Waves 4+6 · 9ab6613 |
| T23-016 | Scripture caret: "remove the button to the left of the 'go to' button that is translation" | iPhone | Removed; All Translations (in-caret) | COMPLETE | Simulator: no translation tile |  |  | ✔ | Waves 4+6 · 9ab6613 |
| T23-017 | Scripture caret: "remove the part that switches between kjv/lxx and instead have a single button next to the 'strongs' button that shows to switch to kjv or lxx, whichever is applicable and only show the button for applicable book (i.e., not new testament and not a lot of some of the other books)" | iPhone | Segmented removed; one switch tile beside Strong's, only where `compareCounterpart` finds the passage in the other text (no NT, no LXX-only / KJVA-only books or chapters); chapter mapped with `mapChapterOnTranslationSwitch` | COMPLETE | Simulator: Genesis 5 (LXX) shows a KJV switch; John 3 shows neither switch nor Compare; unit tests (compareApplicable) | ✔ |  | ✔ | Waves 4+6 · 9ab6613 |
| T23-018 | Scripture caret: "remove the previous chapter and next chapter buttons" | iPhone | Removed; edge taps, swipes and the title cover chapter navigation | COMPLETE | Simulator: no previous / next chapter rows |  |  | ✔ | Waves 4+6 · 9ab6613 |
| T23-019 | Scripture caret: "when clicking the "all translations" button, it should change the sheet instead of opening a new one" | iPhone | All Translations pushes a `ChoiceList` inside the caret ("‹ Scripture") | COMPLETE | Simulator: All Translations opens inside the caret ('‹ Scripture'), picking returns to the caret root |  |  | ✔ | Waves 4+6 · 9ab6613 |
| T23-020 | Scripture caret: "on this button, show the current translation somehow to the right of the 'all translations' text" | iPhone | Row shows the current text at the right ("All Translations  KJVA ›") | COMPLETE | Simulator: row reads 'All Translations  LXX' / 'KJVA' after switching |  |  | ✔ | Waves 4+6 · 9ab6613 |
| T23-021 | Scripture caret: "remove the 'font, theme and more reading options...' and instead if some of those options arent in the current sheet, then add them" | iPhone | "Font, theme and more…" and `ReaderOptionsSheet` removed; Reading group inline: text size, line height, Font › and Color › (in-caret, previews), Appearance (Auto/Light/Dark), continuous scroll, verse numbers, red letters. There is no text-width setting on the phone (fixed ≈90% column, TEST-044) | COMPLETE | Simulator: Reading group inline incl. Font, Appearance, Color; no 'Font, theme and more…' |  |  | ✔ | Waves 4+6 · 9ab6613 |
| T23-022 | Compare: "it should split vertically with one chapter on the left and another on the right" | iPhone | ComparePage: two columns LXX / KJV side by side, one chapter each, compact header | COMPLETE | Simulator screenshot: Psalm 23 KJV (left, source) / LXX 22 (right) |  |  | ✔ | Wave 5 · a75505c |
| T23-023 | Compare: "the user should only be able to compare lxx and kjva for now and only for chapters that actually allow that comparison" | iPhone | `compareApplicable` / `compareCounterpart` (textCoverage, from bundled DB coverage); Compare only LXX ↔ KJVA; offered only where applicable (caret tile, New Tab tile); an inapplicable restored tab explains why | COMPLETE | Unit tests (compareApplicable, compareState); simulator: Compare offered for Psalm 23, not for John 3 | ✔ |  | ✔ | Wave 5 · a75505c |
| T23-024 | Compare: "scroll sync in the sheet should read differently; it especially shouldn't say "on mac"" | iPhone | "Sync Scrolling" toggle, default on, verse-correspondence sync driven by the touched column; no platform wording | COMPLETE | Simulator: caret label 'Sync Scrolling'; scrolling the left column moved the right one to the corresponding verse. Momentum on a real finger: device pass |  |  | ✔ | Wave 5 · a75505c |
| T23-025 | Compare: "there shouldn't be a 'add text' button nor 'go to' button" | iPhone | Add text / Go to / text chips removed | COMPLETE | Simulator: no Add text / Go to in page or caret |  |  | ✔ | Wave 5 · a75505c |
| T23-026 | Compare: "the strongs should show strongs numbers for both sides" | iPhone | One Strong's toggle shows numbers in both columns | COMPLETE | Simulator screenshot: Strong's numbers in both columns |  |  | ✔ | Wave 5 · a75505c |
| T23-027 | "make the strongs numbers slightly bigger" | iPhone | Strong's superscripts 0.6/0.62em → 0.7em (reader, study view, compare) | COMPLETE | Simulator screenshots (reader + compare) at 0.7em |  |  | ✔ | Waves 4+6 · 9ab6613 |
| T23-028 | "when i have one verse selected and i click another verse it should add that verse to the selection. clicking a verse that is already selected should deselect it" | iPhone | `toggleVerseInSelection`; several verses turn the verse sheet into `MultiVerseSheet` (combined label, highlight all, copy in the shared multi-verse format, tag, play, clear); drag-range selection unchanged | COMPLETE | Simulator (synthetic taps): 6 → 6,7 → 6,7,18 → remove 7 → remove 6 → remove 18 closes; copy = 'John 3:6-7, 18' + one line per verse; unit tests | ✔ |  | ✔ | Waves 4+6 · 9ab6613 |
| T23-029 | "in the sheet, remove the '(KJVA+)' text" | iPhone | "(KJVA+)" removed from the study view | COMPLETE | Code review + typecheck (label removed from VerseStudy) |  |  | ✔ | Waves 4+6 · 9ab6613 |
| T23-030 | Notes tab: "holding on a note in the list should show a menu to either delete or move (only move the note if applicable because some notes shouldn't be able to be moved)" | iPhone (+ desktop check) | Notes list long-press → Move (only when `noteIsMovable`) / Delete (to Trash, no confirm) / Cancel; shared `src/lib/noteMovability.ts`; note caret hides Move for system notes; desktop context menu already matched (checked, unchanged) | COMPLETE | Simulator: general note → Move / Delete / Cancel, verse note → Delete / Cancel; Delete moved it to Trash with no confirmation; unit tests (noteMovability) | ✔ | ✔ | ✔ | Wave 7a · d21bc8d |
| T23-031 | More section: "remove the lexicon, youtube space buttons" | iPhone | Lexicon / YouTube rows removed from More; reachable from New Tab tiles, Strong's → Open in Lexicon, search results | COMPLETE | Code review (More rows removed; Lexicon / YouTube tiles verified in the New Tab sheet) |  |  | ✔ | Waves 2+3 · aa04079 |
| T23-032 | Settings: "'colour preset' should be spelled with 'color' instead of 'colour'" | iPhone (+ desktop strings) | "Color" in Settings (row, page, hints), onboarding, tag-graph swatch labels | COMPLETE | Simulator: Settings pages contain no 'colour' |  | ✔ | ✔ | Wave 7a · d21bc8d |
| T23-033 | Settings: "in the color presets, show a preview for each" | iPhone | Preset rows show a preview card (sample Scripture in the preset's own background / text / accent); also in the caret's Color view and on the desktop Theme row | COMPLETE | Simulator screenshot: a preview card on every preset |  |  | ✔ | Wave 7a · d21bc8d |
| T23-034 | Settings: "allow the user to specifically customize the text color and the background color" | iPhone + desktop | Custom themes (text + background + optional accent), created from a copy of a preset — built-ins immutable (tested); per device, not iCloud; iPhone editor with native color inputs; desktop Settings section; every window applies them | COMPLETE | Simulator: custom theme created from Default, text/background applied to the palette vars, removed cleanly on switching back; unit tests (built-ins immutable) | ✔ | ✔ | ✔ | Wave 7a · d21bc8d |

## Ideas / Other

| ID | Original observation (verbatim) | Platform | Implementation | Status | Verified | S | D | P | Notes |
|---|---|---|---|---|---|---|---|---|---|
| T23-035 | "i think there is some numbering that is off in the recognitions of clement in book 3 i think" | Shared (data) | Investigation: Book III stored 1–65, ANF numbers 1, 12–75 (Rufinus omits 2–11). Storage unchanged (highlights / notes keyed by stored chapter); `src/lib/chapterNumbering.ts` maps display ↔ stored in shared label helpers, parseRef (ANF numbers typed; 2–11 no match), multi-book search, chapter pickers (with a gap note), tab titles / history, copy text, vault export titles — desktop and iPhone | COMPLETE | Unit tests (chapterNumbering, parseRef, multiBookSearch); simulator: stored 45 shows as 'Book 3 55' | ✔ | ✔ | ✔ | c981f6e. Side effect: references typed in old notes with the previous (1–65) numbering are now read as ANF numbers |

---

## Final audit (2026-09-23)

Every line of the 2026-09-23 notes is accounted for: **35 COMPLETE · 0 SUPERSEDED · 0 DEFERRED ·
0 BLOCKED**. "Complete" is at the verification level in each row; items that depend on a real
finger, momentum or device feel are also listed in the device pass below.

Build / test state: `npm run typecheck` clean · vitest **195 files / 4,269 tests** (before this
pass: 189 / 4,229) · `npm run build` (desktop) OK · `npm run ios:build` (normal build — probe code
absent) OK · simulator pass with the dev probe (`BEREAN_E2E_PROBE=1`). The desktop app itself was
not launched (reserved for the developer's manual pass).

Bugs found and fixed during the pass: Compare crashed with Strong's on (no Tooltip provider around
the columns); tab-card previews showed raw text ("Jesus") and repeated the passage; an empty YouTube
tab's card read "Loading…"; `openSearchTab` / `ensureTab` would have reused a History or Settings
tab as a search tab (now type-aware); the continuous-scroll placeholder bug was latent on desktop too.

Deviations / decisions:
- No text-width control: the phone has no reading-width setting (fixed ≈90% column, TEST-044).
- History / Settings tabs live in the search space; the Mac shows a small panel offering to open
  its History / Settings windows for such a tab (synced from the phone).
- Several-verse selection turns the verse sheet into a multi-verse view (one surface) rather than
  switching to the selection bar; the bar still serves drag-selected ranges.
- Recognitions Book III uses display mapping, not a data rewrite (keeps highlights/notes valid).
  Side effect: a reference typed in an older note with the previous numbering now reads as ANF.
- Move-to-workspace, workspace icon and tab actions are action lists inside the tab-cards sheet.

### For the physical-device pass (cannot be simulated)
1. Tab cards: press and hold a card with a real finger → lift + haptic; drag across the grid → the
   other cards make room; release → order kept. No text/background highlight while holding.
   A quick swipe over the cards still scrolls.
2. Hold a card and let go without moving → that tab's actions inside the sheet (‹ Tabs).
3. Compare with Sync Scrolling on: fling one column — the other follows verse-for-verse, no
   independent momentum drift; turn sync off → independent.
4. Switch KJV ⇄ LXX from the caret while it is open (Genesis): no flash of text above the sheet.
5. Continuous scroll on a late chapter, scroll up into the previous chapter → no jump.
6. Sheet sub-views: slide transitions and the back control feel native; fling-to-dismiss still works
   from a sub-view.
7. Custom color: the native iOS color picker opens from Settings → Color preset → a custom theme.
8. VoiceOver: tab cards ("Actions for …" button), sheet back buttons, Sync Scrolling toggle.
