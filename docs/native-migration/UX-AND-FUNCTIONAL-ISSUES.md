# UX and functional issue register (native apps)

Stable IDs; issues are never deleted — fixed ones stay with their evidence.

**Severity.** P0 crash, data loss or sync corruption · P1 major missing or broken workflow · P2 usability or incomplete · P3 polish.

**Status.** OPEN · IN PROGRESS · FIXED (verified how, where) · WONTFIX (reason).

Each row gives: issue (expected vs actual, how to reproduce) · platform · severity · feature · status / evidence / commit.

## Open

| ID | Issue | Plat | Sev | Feature | Status |
|---|---|---|---|---|---|
| SHARED-FUNC-006 | Study Trail map, automatic recording, and connection editing missing. | both | P1 | U14 | Trail browsing, manual recording, connection reading, explicit creation and stop/connection note editing implemented. Navigable branch map implemented. Opt-in automatic chapter recording implemented. Cross-reference and inline Strong’s capture, library search, and manual trail ordering are implemented. Full graph controls, additional automatic connection types, and relationship editing remain open. |
| SHARED-DATA-001 | No native sync; native libraries are isolated dev copies (by design until the M4 gates). | both | P1 | A01 | OPEN (gated, OD-5) |
| IOS-FUNC-002 | Verify cross-verse touch handles, copy output, highlight/reopen and swipe arbitration on device. | iOS | P2 | S07/H02 | IN PROGRESS: single TextKit document shipped on review branch; word selection, Strong’s, nonconsecutive whole-verse Copy and Highlight verified on iPhone 18 Pro Simulator. |
| MAC-UI-008 | Strong's search snippets should highlight the matched words, including when Word Replacer changes their positions. | both | P3 | Q03 | Highlighting implemented. Regression test covers identical display text with remapped positions. Live Mac and iPhone visual checks pending. |
| MAC-UI-009 | Strong's hover gloss tooltip (original: word, transliteration, short definition) missing; click works. | Mac | P2 | S05 | FIXED earlier (ChapterTextView `.toolTip` from `strongsTooltips`) — status corrected 2026-11-14 by the audit |
| IOS-UI-030 | Verse action capsule: words behind the regular Liquid Glass read through the icons over red-letter text (simulator). | iOS | P3 | S08 | Backing opacity increased for both Scripture capsules. Light and Dark Mode simulator captures verified improved icon contrast over red-letter text. Physical iPhone and Reduce Transparency checks remain open (AUDIT D/I25). |
| MAC-FUNC-030 | Native Lexicon search misses multi-word glosses only partly; untagged-word dashed underline + click (original Strong's mode) not reproduced — replaced by the reader context-menu “Look Up in Lexicon”. | Mac | P3 | D1 | OPEN (design difference, recorded) |
| MAC-FUNC-037 | **Compare renders blank on Mac** (P1). Repro (Dev library): open John 3 (KJVA) in the "standard" layout, click the Compare toolbar button → toolbar switches to Compare (columns menu lists two "John 3" columns) but the content area is empty; Home/scroll shows nothing; exiting Compare restores the reader. Tab state: `{"bookId":"JHN","chapter":3,"compareMode":true,"translation":"kjva","scriptureLayout":"standard","rightPanelTab":"lexicon",...}` with no `compareColumns`. **Pre-existing:** reproduced identically on a clean build of `64df1059` (before the Claude session). Also blank on **Genesis 1** (KJVA + LXX both have text), so it is not the missing-NT-in-LXX case; even the column header row is missing and no ProgressView shows, so check so check `CompareView.body` GeometryReader/`ViewThatFits` sizing and the `scriptureLayout` container in `ScriptureLayouts.swift`. **Probe results (20:20–20:25, reverted):** a temp-file log inside `CompareView`'s root `GeometryReader` recorded `size (935.0, 0.0)` with `loadedPassage == passage`, 2 columns, all following — i.e. data is loaded but the view is offered **zero height**. Adding `.frame(maxWidth: .infinity, maxHeight: .infinity)` and then `minHeight: 200` to `CompareView` in `ScriptureView.body` did not change the result, and after relaunch (tab restored in Compare) the GeometryReader closure did not re-evaluate at all. Next: inspect what wraps `ScriptureView` in `MacRootView` for bible tabs (the `.inspector(isPresented:)` + `ScriptureLayouts` `scripture` frame) and whether CompareView's `.toolbar`/`.sheet` modifiers or the iOS-only `.safeAreaInset` branch collapse it on macOS; try rendering CompareView without the outer GeometryReader. **Tried 20:27 (reverted): replacing the GeometryReader with a `Group` + `onGeometryChange` width — still blank**, so the root container is not the cause; next suspect the content itself (`alignedComparison`'s `ScrollView { ViewThatFits(in: .horizontal) { comparisonGrid; stackedComparison } }`, the `Grid` with `gridCellUnsizedAxes` Divider, or a `.background`/overlay in `comparisonText`). A quick split test: temporarily return `Text("compare")` from `alignedComparison` and bisect. | Mac | P1 | Compare | **FIXED 2026-11-14 20:29**: cause was `CompareView`'s `.safeAreaInset(edge: .top)` whose body is `#if os(iOS)`-only — on macOS the empty inset collapsed the content to zero height. The modifier is now iOS-only; Mac Dev verified Genesis 1 KJVA/LXX compare renders. |
| SHARED-UI-038 | Stacked Compare dropped verse 1 and left a gap under the column headers. | both | P2 | Compare | **FIXED 2026-11-14 20:31**: header rows (ids 0, 1…) collided with verse rows' `.id(verse)` in one LazyVStack; headers now share one container. Mac and iPhone simulator verified Genesis 1 shows verse 1. |
| MAC-UI-039 | Aligned Compare always uses the stacked layout, even in a 1700pt-wide window; the side-by-side `comparisonGrid` (original's columns) never wins `ViewThatFits(in: .horizontal)`, likely because grid cells' text reports its full single-line ideal width. Fix idea: choose grid vs stacked by measured width (`onGeometryChange`, ≥ 280pt per column) instead of `ViewThatFits`. | Mac | P2 | Compare | **FIXED 20:36**: layout chosen by measured width (≥280 pt per column → grid); Mac verified side-by-side KJVA/LXX at 1700 pt. |
| SHARED-FUNC-010 | Verse actions lack Play Audio From Here (Copy Reference and Compare This Verse added). | both | P3 | S08 | OPEN (waits for Read Aloud) |
| SHARED-FUNC-011 | Notes editor: tables as source text, images as captions, columns/threads without chrome (ADR-0014 limits). | both | P2 | N04/N05 | OPEN |
| SHARED-FUNC-017 | Today’s Note needs the legacy sunrise boundary and a no-location fallback. | both | P2 | N12 | Sunrise with manual local coordinates and midnight fallback implemented. Native location acquisition remains open. |
| SHARED-UX-020 | Many unnamed workspaces and tabs accumulate during normal study. Find by contained passages, reuse eligible tabs, and support reversible bulk archive. | both | P1 | workspace/tab navigation | IN PROGRESS. Mac and iPhone Go reuse, workspace previews, open-tab search and reversible archive implemented. Simulator verified search, single-tab restore and tab moves. Duplicate workspace names and large lists still need runtime coverage. |
| SHARED-FUNC-014 | Settings still missing: Texts (enable / reorder), Notes, Hermas translation choice, Read Aloud / AI / YouTube sections (verse-number and red-letter toggles, Shortcuts and About added). | both | P2 | U12/S11 | OPEN (partly fixed) |
| MAC-UI-015 | Sidebar drag: no drop line and no auto-scroll near the edges; no pinned-tab grid; no density setting. | Mac | P2 | U02 | OPEN |
| SHARED-FUNC-016 | Tag graph (visual relationships) missing; the Tag Manager now exists. | both | P3 | U16 | OPEN (graph only) |
| MAC-FUNC-017 | Single window only: no floating tabs, presenter or secondary windows. | Mac | P2 | U07 | OPEN |
| SHARED-FUNC-018 | PDFs, YouTube, Read Aloud, Ask Berean not ported. | both | P2 | U17/M01/M05/G01 | OPEN |
| SHARED-FUNC-019 | Deep links (`berean://`) not handled natively. | both | P2 | A06 | OPEN |
| IOS-FUNC-004 | Verify iPhone Go opens a note by title and body match. | iOS | P2 | Q09 | iPhone 18 Pro Simulator verified immediate exact-title submission and body-only search with an excerpt. Tapping the body match dismissed Go, opened the note, and preserved the 16-tab count. |
| SHARED-UI-020 | Accessibility: no full VoiceOver pass; dark mode checked only on the reader, search and sidebar. | both | P2 | A14 | OPEN |

## Fixed

| ID | Issue | Plat | Sev | Fix and evidence |
|---|---|---|---|---|
| MAC-FUNC-001 | Note Share / Export did nothing (SwiftUI fileExporter never presented; sandbox lacked user-selected file access). | Mac | P1 | Native NSSavePanel + entitlement; `npm run native:ui:smoke` PASS; PR #22 (26a3835) |
| MAC-FUNC-002 | An open note did not refresh after import. | Mac | P2 | Reloads on `notesRevision` unless editing; PR #22 |
| SHARED-DATA-002 | textId `lxx` served from `lxx.db` instead of `lxx_brenton.db` (the existing app's mapping). | both | P1 | `Corpora.files`; PR #23 (04db467) |
| MAC-FUNC-020 | Reader crashed when restoring an empty selection after a chapter change (NSSelectionArray empty). | Mac | P0 | Restore a zero-length selection instead; PR #23 |
| MAC-FUNC-021 | Right-clicking verse text showed the system text menu, hiding the verse actions. | Mac | P1 | Verse number / row menu; PR #23 |
| IOS-FUNC-003 | iPhone Plus opened a clipped 520-pt palette with no buttons. | iOS | P1 | NewSheet; real taps in Simulator; PR #23 (35b48b6) |
| MAC-UI-001 | Sidebar button blocked by a full-height window-drag area. | Mac | P1 | Drag area below the title bar only; verified; PR #23 |
| SHARED-FUNC-022 | **Single-chapter books showed no chapter to pick** (owner report 2026-11-12); Sirach / 1 Clement prologue (chapter 0) unreachable; last chapter dropped. | both | P1 | Chapter lists from real chapters; single-chapter books open directly; stepping over real chapters; all-books test over 19 texts; verified Philemon / Jude 5 / Sirach 0 in the running app; PR #23 |
| SHARED-FUNC-023 | Bare book names and "Jude 5" did not resolve (also absent in the original parser). | both | P2 | PassageResolver; verified "jude 5" → Jude 1:5; PR #23 |
| MAC-UI-024 | Switching to a passage with the same verse count kept the old scroll position. | Mac | P2 | Scroll kept only within one passage; verified; PR #23 |
| SHARED-FUNC-025 | **Clicking a verse number opened a menu instead of selecting the verse** (owner report). | both | P1 | Click toggles selection, ⇧-click range, selection bar, ⌘C copies verses, Esc clears; right-click opens actions; verified John 3:14–16 (Mac); PR #23 (a07ae1d) |
| MAC-UI-026 | **Back / Forward not in the sidebar** (owner report). | Mac | P2 | [sidebar ‹ ›] group in the sidebar title bar, same place when collapsed; verified both states; PR #23 |
| SHARED-SEARCH-001 | **Search limited to one text, no scope control, no Strong's queries, weak options** (owner report). | both | P1 | ScriptureSearchView + ScriptureSearch engine: All Texts default, scope menu, per-text counts, options, Strong's, phrase, history; verified "watchers" (22 results, 4 texts) and G5485 (284); 6 engine tests; PR #23 (d3e9342) |
| SHARED-SEARCH-002 | Strong's bridge and Strong's search missed most occurrences of common numbers (the 1000-row, book-id-ordered cap also exists in the original). | both | P2 | Search uses uncapped occurrences; tests (Ps 23:1 via Yehovah; Gen 1:1 for H7225 + H430) |
| MAC-FUNC-003 | ⌘K did not find notes. | Mac | P1 | Grouped palette: Recent · Go to · Lexicon · Search · Notes · Commands, with ↑/↓ and Return; verified "grace" listing 2 notes; PR #23. iPhone Go also supports Notes hits (IOS-FUNC-004). |
| MAC-FUNC-004 | No find in chapter. | Mac | P1 | ⌘F find bar with match count and next/previous, ⌘G; verified "world" (5 matches) in John 3; PR #23 |
| MAC-FUNC-007 | Notes home was a filtered list only. | both | P1 | Folders home (All Notes, system folders, folder tree with counts, Trash, Recently Edited) · folder view (subfolders, Pinned, recency sections, sort, group by status / folder / type) · previews · row menu (pin, move, status, duplicate, export, trash) · folder menu (new subfolder, rename, move, delete keeping or trashing notes) · Trash (restore, delete permanently, empty). Services tested. Verified on the Mac (create folder, move note, open folder, note → back to its folder) and on the iPhone (home renders); PR #23 (9b69814) |
| IOS-FUNC-005 | New sheet stayed open after Return (`dismiss()` ineffective after navigation). | iOS | P1 | Closes through the presenter's binding; verified "obadiah" → Obadiah 1 with the sheet closed (Simulator); PR #23 |
| IOS-UI-006 | The verse selection bar overlapped the bottom bar. | iOS | P2 | Raised 72 pt on iPhone; PR #23 |
| MAC-FUNC-005 | No highlight from a partial text selection. | Mac | P1 | Context menu → Highlight Selection ▸ colour; selection split per verse, display offsets → stored offsets (OffsetMap) → character highlight. Verified John 3:16: stored 50–69 = "begotten Son, that", the shown words; PR #23. (iPhone partial selection waits for IOS-FUNC-002.) |
| IOS-FUNC-001 | iPhone reader had no swipe chapter change. | iOS | P1 | Horizontal swipe (> 90 pt, mostly horizontal, not from the very edge) → next / previous chapter over real chapters and books. Verified in the Simulator: Obadiah 1 → Jonah 1 → Obadiah 1, and vertical scroll unaffected; PR #23. Edge-tap paging not added (the system back gesture owns the edge). |
| MAC-FUNC-027 | Found by exploratory testing: single-digit verse numbers were nearly impossible to click — the tap landed on the gutter tab before the right-aligned number. | Mac | P1 | The whole gutter (both tabs and the number) is the verse-number target; verified that a click on "3" selects it and ⌘C copies "John 3:3 …"; PR #23 |
| MAC-FUNC-028 | Found by exploratory testing: app shortcuts such as ⌘⇧D did nothing while the reader had focus (NSTextView swallowed them). | Mac | P1 | The reader passes unhandled key equivalents to the menus; verified ⌘⇧D → today's note `daily-2026-11-12` (the existing app's id format); PR #23 |
| SHARED-FUNC-012 | No History screen. | both | P2 | `HistoryService` port (shared `history` table, device-local; 5-minute duplicate rule; cap 5000; tested). Records passages, notes, Strong's and searches. History tab (Search space, as in the original): by day, filter, type picker, reopen, remove, clear, Show Older. ⌘Y, ⌘K Commands, iPhone New sheet. Verified on the Mac (Romans 8 + "grace" listed); PR #23 |
| SHARED-FUNC-029 | No Tag Manager. | both | P2 | Tags tab (Notes space, as in the original): filter, coverage per tag, open verses, rename, colour slot, merge into, delete (asks again when notes mention #tag), new tag. Go ▸ Tags, ⌘K, iPhone New. Verified on the Mac (#Gospel listed); PR #23 |

### 2026-11-12 review branch

- MAC-FUNC-013 — Calendar opened from Mac Go/⌘K and iPhone More. Selected month and date use existing tab-state keys. Mac opened an existing daily note; iPhone opened a newly created Dev daily note. Sunrise parity tracked separately.
- SHARED-FUNC-018 — Both targets now bundle the full Scripture catalog via explicit read-only lists. Mac ⌘K opened Didache 1 and rendered its text.
- IOS-UI-020 — Scripture link underlines removed. Compact dock labels its three controls and shows the open-tab count. Go reuses compatible unpinned tabs.

### 2026-11-14 evening (Claude Code, `native/reader-notes`)

- MAC-UI-031 — FIXED: native controls (buttons, pop-ups, segmented pickers, toolbar items) showed the arrow; now the pointing hand,
  disabled toolbar items keep the arrow and update when enabled (`ClickableCursor.swift`; verified with `screencapture -C`).
- MAC-FUNC-031 — FIXED: ⌘K ran a Scripture search for a typed command name ("notes home"); commands now rank first (`68c75906`).
- SHARED-UI-032 — FIXED: whole-chapter labels said "Psalms 3" in Go/palette history; now "Psalm 3" (`3fbbc918`).
- IOS-UI-033 — FIXED: Go sheet rows rendered as blue links; now primary text with tinted icons (`3fbbc918`, simulator).
- IOS-UI-034 — FIXED: Psalm title line used the verse hanging indent on iPhone (`30fc3d29`, simulator).
- SHARED-FUNC-035 — FIXED: lexicon search missed accent-free spellings (shalom, chesed) (`639b41ad`).
- SHARED-UI-036 — FIXED: destructive note/history/tag actions swallowed errors; now reported through `userMessage` (`b6223db3`).
- Full list of the session's features and their verification: HANDOFF.md "2026-11-14 evening checkpoint" + AUDIT-2026-11-14.md.

### 2026-11-17 current-location follow-up

- Fixed Command-L Search All Texts inheriting filters from the replaced search. Back and Forward now distinguish destinations with the same query and different result restrictions. Mac runtime verified testament restoration. Both Dev builds passed.
- Cursor tracking review retained AppKit's superview-coordinate hit-test contract. Continuous pointer-motion verification remains open, along with IME Find input and compact Find layouts.

### 2026-11-17 Notes browse follow-up

- Added adaptive Notes Gallery on both platforms. Mac selection/search/Back and simulator opening/return passed live QA.
- Fixed Notes folder resetting to the folders screen on relaunch by persisting `listFolderId` locally. Both apps reopened All Notes in Gallery after relaunch. All 148 Swift tests passed.
- Long-gallery positions, accessibility sizes, iPhone gallery bulk actions and custom-folder relaunch remain to verify.

### 2026-11-17 Notes section follow-up

- Added collapsible section headings on both platforms, including note counts, disclosure accessibility values and retained state per folder/grouping.
- Fixed reproduced gallery history loss. Mac scroll-bar position returned from 1 to about 0.058 before the correction and stayed at 1 through repeated Back/Forward afterward.
- Mac verified search through collapsed sections, disclosure persistence and selection counts. Simulator verified tapping headings away from the chevron and selected counts after collapse. Custom-folder disclosure, touch scroll restoration and accessibility sizes remain open.

### 2026-11-17 Notes targets and cursor follow-up

- Mac Notes has glass groups and leading aligned content. Whole-row opening passed in Mac custom folders and simulator All Notes.
- Updated shared Mac clickable cursor handling to settle after dispatch and use the delivered event point. Sampled SwiftUI disclosure and enabled toolbar controls retained the hand after movement, while disabled Back retained the arrow. Broader control and manual-motion coverage remains open.

### 2026-11-17 home and floating control follow-up

- Fixed a sampled arrow cursor over floating Scripture Copy, caused by its hosting-view hit relationship. Repeated drag produced hand/hand after rebuilding.
- Mac Notes home now retains its viewport across recent-note navigation and ordinary tab switches. The note editor's return label identifies its real destination.
- Mac runtime passed repeated lower-card navigation and home tab-switch restoration. Missing-recent fallback, iPhone home scrolling and wider manual cursor coverage remain open.

Cursor follow-up matrix: verify inactive-window hover after preserving the delivered event window; verify SwiftUI enabled-state changes under a stationary pointer; sample native switch-style toggles. Floating Copy's arrow/hand regression was reproduced and corrected, but these cases are still open.

### 2026-11-17 switch and iPhone home follow-up

- Native switch movement is runtime verified (Verse Numbers, hand/hand), and its QA preference was restored. SwiftUI enabled-state refresh is implemented, with stationary-pointer runtime verification remaining.
- iPhone Notes home recent-note return now restores the lower viewport; repeated third/last recent note return passed in Simulator. Ordinary touch-scroll saving and missing-recent fallback remain unverified.

### 2026-11-17 location-editing regression

Cross-type Cmd+L is fixed for the directly exercised Scripture/Search/Lexicon/Note matrix; stable ID/order/count and untouched peers were verified in the QA library. Pinned Compare round trip and ordinary Cmd+K/Shift-Return behavior passed. Explicit Notes Search/Lexicon Search/utility combinations and exact long-scroll equality remain QA work. Blank sidebar now explicitly resets to arrow; live sample passed.

During palette QA, Gallery returned imported note hits while Gallery QA 07 did not, despite a direct read-only FTS query matching the imported title. Cause remains unverified; investigate separately from tab replacement.

### 2026-11-17 note completion refinements

Native [[ note-title suggestions now work on both platforms. Mac keyboard and pointer choice, Escape/query editing, plus iPhone touch insertion/Undo/Redo passed. Mac still sometimes undoes completion and following typing together (source restored correctly). Manual wheel/touch scrolling with the chooser open, software keyboard resizing, hardware IME and accessibility sizes need QA.

### 2026-11-17 verified query and undo refinements

- Fixed reproduced stale visible Lexicon query and blank Cmd+L Notes query. Notes and Lexicon query Back/Forward passed; Calendar/History/Tags remained in the current tab.
- Simulator verified Hebrew elohim query/language persistence after relaunch.
- Mac completion following-typing undo coalescing is fixed for the exercised native editor path: first Undo only later typing, second only completion, Redo completion. This supersedes the earlier open entry for that path.
- Numeric full-title palette lookup still reproduces; package FTS helper and read-only database queries succeed. Keep diagnosis at the UI/runtime boundary before changing data/search semantics.

### 2026-11-17 Lexicon result follow-up

iOS 27 Simulator verified recovery after rapid typing and Return, Clear refocus, and deep result viewport restore after entry return and relaunch. Mac hover/activation, history across queries and tabs, and accessibility/device checks remain open. Keep numeric full-title palette lookup open pending safe Mac QA targeting.

Final Lexicon follow-up: Hebrew/Greek switching reproduced a several-row offset shift. Eager measurement of the SQL-bounded results fixes the exercised round trip, retaining the exact saved1551.333 offset in Simulator. Deep Back/Forward and seeded resets remain open.

### 2026-11-18 owner UX checks

Verified iPhone Verse Notes creation/return, date-aware daily reuse, empty-folder centering and independent nested disclosure. Mac marked QA verified unpin/repin, no overflow at tested width, and passive-space arrow/active-row hand after fixing distant region matches. Explicit large Notes title removes observed inherited inline/blank-title case after reinstall. Continue broad cursor motion/resize, compact toolbar widths, quick formatting, Compare validity, selection clipping/highlight geometry, chapter gestures and tab-switch timing. Read Aloud still requires original Kokoro quality.

### 2026-11-18 — Compare and character selection checkpoint
- Mac QA: invalidLXXRomans5 shows one repair row, not blank verse cells. ChoosePassage→Isaiah52LXX works. FollowMain disabled; close-last exits, Back/Forward restores. Left gutter numbers and no repeated per-verse Mac ellipses verified. Phone compact Compare, drag/reorder and broader resize matrix still require runtime coverage.
- Mac native character drag Mark13:7–9 and saved yellow partial highlights follow words across wraps; no number/gutter/trailing fill. Offscreen renderer regression covers Strong’s exclusion and retained tag fill. iPhone word selection and simultaneous verse actions exercised; handle extension across several verses not established. Inspect adjacent dashed-outline grouping on phone again: screenshot after mixed native/tap selection appeared separated, not yet reproduced from a clean selection state.
- QA process lesson: /tmp and /private/tmp aliases produced two isolated QA processes during diagnosis. Relaunch pattern must match both; verify exactly one QA process and berean-native-qa-sidebar-toggle before UI mutation. Regular Dev remains untouched.

### 2026-11-18 — Notes follow-up verification
Daily-folder calendar markers/date reuse verified on both platforms. Mac Checklist/Table available directly; preexisting formatting/typing Undo coalescing fixed and live checklist Undo/Redo/follow-on typing tested. iPhone blank large-title area reproduced on tab/folder return, replaced with explicit fixed accessible heading; verified Notes and DailyNotes after return. Tiny widths, DynamicType and VoiceOver remain unverified. Continue broader formatting/IME Undo checks.
