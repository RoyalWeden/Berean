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

Chapter gesture follow-up: deterministic fresh-edge/hysteresis regression and builds pass. iPhone13→12 end and12→13 start work. Repeated activation at a later13end viewport not established: inspect real scroll begin offset versus2pt edge tolerance and dock/contentInset settling. Do not silently lower arm threshold before measuring. Cue rendering/haptic timing, Mac physical trackpad stillpending.

18Nov follow-up: late Mac hover gloss arrival caused full reader rebuild through Key.tooltips; now metadata-only with actual-helper regression. Whole-app tab latency still needs measurement. iPhone pan trace proves211pttop navigation; many failed bottom attempts have0actualinput and are inconclusive. Physical/haptic checks remain. Scripture detail viewport is memory-only and relaunch returned to top; persist validated local-only native viewport records next (TASKS/HANDOFF).

### 2026-11-18 — Relaunch loses native Scripture position
Resolved underlying memory-only storage with local bounded validated viewport checkpoints. MacQA and iPhone27 simulator deep position restored after relaunch. Mac switch-away/back also retained position. Do not equate this with measured instant switching throughout the app; other tab types, explicit jump/end/resize/LXX matrices remain open.


Phone selection recheck18Nov: final Mark12:37–39 renders one faint-filled rounded dashed group and floating action bar with text below; persisted verse/endVerse37/39 confirmed. An earlier number tap appeared to replace prior selection; repeat clean number-only and body/number mixed sequences before closing touch consistency.

### 2026-11-18 — Exact note title lookup repaired
Palette stale cache suppressed GalleryQA07/01 despite correct FTS results. Current-query fallback now renders correct title after rapid typing/replacement, removes old hits on no-match, and Return opens correct note (Mac verified). iPhone Go replacement and note opening also passed. onChange alone was insufficient; fallback is essential. Native DB helper/FTS unchanged. Full query/IME/metadata-refresh matrix remains open.


18Nov note-title truncation: GoSubmitFollowupQA was truncated in phone editor. Now full2line title displays; Mac multiline paste preserves single-line metadata and Return enters body on both platforms. More than5lines/accessibility/software-keyboard/IME remain manual acceptance.


18Nov owner report OPEN: occasional Scripture scroll stutter, brief chapter-loading spinner, bottom pull not working when chapter is shorter than viewport, and top-pull feel. Investigate current reader lifecycle/cache/metadata and geometry at coincident edges; alwaysBounceVertical is already enabled. Preserve selection and deliberate-edge guards. Speech compatibility expanded to exact original phoneme output; audible backend still absent.

### 2026-11-18 — Reader gesture checkpoint
iPhone short-page pulls now use passive raw touch travel; deliberate chapter turns have explicit start/end arrival. Mac scroll checkpoints reuse one idle timer; short pages allow elasticity. Both builds and intent checks pass; simulator boundary cycle and Mac checkpoint/relaunch verified. Loading flash and physical gesture feel remain open. See HANDOFF latest checkpoint for evidence and continuation.

### 2026-11-18 — Prepared chapter-turn checkpoint
Added16chapter read-only preparation cache, shared in-flight loads, actual-neighbor prefetch, outgoing viewport capture and atomic destination rows/annotations/selection for explicit turns. Both native builds pass; Mac history/selection and iPhone short-page cycle checked. Removed iPhone empty system glass circle when chrome tucks. Other navigation paths can still show loading; global frame pacing remains open. See latest HANDOFF for scope, exact evidence and queued CI status.

### 2026-11-18 — Compare follow-up from reader regression pass
Mac toolbar Compare on/off and chapter-next rendered correctly. Existing persisted LXX New Testament column remains recoverable as unavailable (Choose Passage/Remove), rather than being deleted. One CUA ⌥⌘C attempt did not toggle Compare despite visible help; ⌥⌘→ worked in same pass. Reproduce with/without native text focus and inspect responder/menu conflicts; do not claim fixed from this single observation. Latest fixture Mac13single, iPhonePsalm119mid.

### 2026-11-18 — Direct warm Scripture presentation
Cached chapters and revision-scoped annotations now render directly for warm navigation; location-scoped selection/scroll targets prevent stale state. Native view reuse captures outgoing viewport;16entry cache protects visible chapter and coalesced waiters publish before returning. Both final native builds pass; Mac34step boundary/history test, local selection/highlight refresh, phone mapped Psalm return and tab restoration checked. Cold misses/frame pacing remain open. Prior-head CI cancelled before runner assignment due hosted macOS capacity; see HANDOFF for exact evidence and next work.

### 2026-11-18 — Working tabs first on iPhone
Tab overview now opens expanded and shows current tabs before creation/cleanup/archive controls and recent duplicates. Existing actions and optional compact detent remain. Simulator existing119→G5463→119 navigation preserves viewport; nine tabs unchanged. Final iOS build passes. See HANDOFF for exact evidence, remaining large-workspace/accessibility checks and hosted CI capacity cancellation.

### 2026-11-18 — Passage preview prepares the reader
Shared previews now reuse a bounded prepared chapter with separately retained raw rows, warming both Mac palette/CmdL and iPhoneGo destinations without changing excerpts or navigation semantics. Both builds and raw LXXPsalm 3 heading→bodyverse2 UI checks pass; current-tab reuse leaves13MacQA/9phone tabs unchanged. Fast submit before preview is ready can still be cold. See HANDOFF for oracle/evidence and remaining selection/performance work.


### 2026-11-18 — Reader selection gesture checkpoint
Targeted fix: rapid adjacent iPhone verse-body taps no longer become UIKit word selection; number taps no longer double-toggle/select words. Intentional native word selection removes whole-verse outline/bar. Final clean simulator checks pass; physical phone/VoiceOver/accessibility timing remain open. General scrolling smoothness and cold quick-submit spinner remain measured-work items, not declared resolved. Latest HANDOFF contains exact evidence.


### 2026-11-18 — Reader release and sidebar restoration
Fixed reproduced short-page pull arrival regression: outgoing momentum no longer scrolls incoming chapter away from its intended edge after release. Final simulator117→116END→117START→118START passes. Restored Mac Sidebar/Back/Forward to sidebar title area at user request; hide/show/history checks pass. Pin idle-right/hover-left implementation builds, idle-right screenshot verified; physical hover and narrow-window layout still need verification. General scrolling FPS and cold-cache flash are not declared universally fixed.

### 2026-11-18 — latest reader requests
Psalm numbering must use body-first Brenton rendering (title belongs to body1), superseding separately numbered titles. Check input/labels/copy/Compare/flip against both Psalm 3 and two-title Psalm 50 while retaining raw annotation identities. LXX badge hover implemented; physical motion check outstanding. Mac slow-pull packet regression covered; actual trackpad/FPS remains unverified. Cursor and arbitrary tab splitting audits exist, implementation pending.

Latest verification: full Swift suite192tests/55suites PASS; focused Psalm suite8 PASS; slow-pull harness PASS. Both final ancillary-label builds PASS (/tmp/berean-psalm-label-consistency-{mac,ios}.log). Mac/simulator reader UI checks described in HANDOFF. Scope is body-first Brenton presentation with unchanged storage IDs, plus LXXbadge/native-menu/pull refinements; generic splits/cursor replacement and notes-generated reference-link semantics audit remain open.


## 2026-11-18 — location input, native cursor ownership and iPhone verse taps

- Mac ⌘L now owns keyboard focus before its field mounts, preserves early keys/paste, selects the current destination once, and replaces the current tab across Scripture, Search, Lexicon and Notes. QA verified the original tab identity, 13-tab count and unchanged note content/update time. Explicit Shift-Return creates a tab; closing it currently selects its neighbor, not necessarily its origin.
- Removed global cursor swizzles/private toolbar hooks and forced hands. Native controls, text, links and dividers own their cursors. Source audit and builds passed; physical pointer-motion/flicker coverage remains open.
- iPhone body taps use a passive touch observer: rapid verse1/2/5 accumulation, targeted deselection, native word double-tap, 400ms taps, 900ms long-press, scroll cancellation, chapter pull and inline Strong’s were exercised in the Simulator. The new pure reader-taps harness joins CI. Physical iPhone/VoiceOver and handle dragging remain unverified.
- Added a 44pt accessible Close Study Panel control; final fresh-launch Simulator check dismissed the G2962 inspector. Restored Psalm 3 LXX, Strong’s OFF, no verse selection, 9 tabs. Both final local builds PASS: `/tmp/berean-study-close-final-mac.log` and `/tmp/berean-study-close-final-ios.log`.
- Online rendering verified again: [Brenton Psalm 3](https://biblehub.com/sep/psalms/3.htm) combines the title and first body line as verse1. [Brenton Psalm51 / LXX50](https://biblehub.com/sep/psalms/51.htm) does the same for its longer title. Preserve Septuagint chapter numbering and raw stored IDs; display/copy/accessibility numbering follows the reader. Do not reinterpret persisted links or rewrite production data.
- Next: per-edition Compare selection and whole-block dragging; generic all-tab split previews; physical cursor motion and Mac scroll/pull feel; note reference formatting/preferences; M05 Kokoro playback. These remain unfinished. Owner-only merge order #22 → #23 → draft #24 remains unchanged.


## 2026-11-18 — corpus-wide Brenton rendering and combined verse compatibility

The actual 151-Psalm corpus check found that stored LXX 115:4 contains both the cup and vows sentences, with no stored verse 5. The reader now labels that record 4–5, preserves all its words/annotation identity, resolves human-entered verse 5 to stored4, and maps KJV 116:14 to that existing record in Compare/flip. Verse6 and following keep their numbers. Labels, selected references, chapter export, partial copy and accessibility use the range. Raw persisted links, tag spans and note/highlight keys are not rewritten.

Online witnesses: [Bible Hub Psalm 3](https://biblehub.com/sep/psalms/3.htm) and [MT51/LXX50](https://biblehub.com/sep/psalms/51.htm) combine superscription and first body as verse1. [eBible Brenton115](https://ebible.org/eng-Brenton/PSA115.htm) calls the second sentence4a; [Bible Hub MT116](https://biblehub.com/sep/psalms/116.htm) separates the two sentences at13–14. Reader 4–5 is the numeric presentation of that combined record, consistent with the chosen body-first convention, rather than a claim that every online edition uses identical labels. Keep actual LXX chapter numbering; do not substitute a site's MT chapter headings.

Verification: all 195 shared tests/57 suites PASS in139.323 s from a temporary native-build source snapshot; all 120 package source/test/fixture SHA256 values were checked against the repository with zero mismatches. Log `/tmp/berean-online-brenton-final-suite.log`; manifest `/tmp/berean-online-psalter-source/source-sha256.json`. Initial corpus test correctly failed on115's gap and motivated the range fix. Direct checkout test attempts were interrupted only after diagnosing cloud-backed Git/build database waits; no caches or usage were reset.

First range builds BOTH PASS: `/tmp/berean-brenton-range-final-{mac,ios}.log`. Fresh iPhone PID32126 verified Go 115:5→115:4–5, readable gutter label, both sentences selected, verse 6 unchanged and9 tabs. Selecting6 then exposed separate outlines at the missing stored5. Final source fixes drawing/reveal grouping by actual row order while still breaking at unselected rows or real rows without layout; persistence stays unchanged. Reader tap + adjacency harness PASS with immutable inputs `/tmp/berean-final-range-selection-checks` (explicit temporary module-cache path after a sandbox cache-write failure). Final grouping builds and Mac/iPhone UI checks subsequently PASS; see verified publication checkpoint below. Reference labels also coalesce adjacent displayed ranges without changing saved raw groups.

The single4–6 outline, copy/reference labels and fixture restoration are now verified on both apps. Publish only the tested source and its checkpoint. Audit combined-record cross-reference aggregation and newly generated Markdown/link display vs raw IDs; original legacy links must keep their meaning. Generic all-tab split previews, per-edition Compare selection/whole-block drag, physical pointer/flicker, Mac scroll/pull feel and M05 playback remain open.


### Verified publication checkpoint — source `8492a161`

Both final grouping builds PASS (`/tmp/berean-brenton-group-final-mac.log`, `/tmp/berean-brenton-group-final-ios.log`). iPhone fresh PID33697 showed one outline around 4–5 + 6, correct targeted deselect/reselect and native Copy→Paste containing `Psalms 115:4-6 LXX`, range label4–5 and verse 6, without extra text/rows. Restored Psalm 3 LXX, no selection, Strong’s OFF, inspector closed,9 tabs. Mac fresh QA launch verified ⌘L115:5→115:4–5, Shift-click 6→one4–6 outline, Copy Reference→immediate ⌘L paste exactly `Psalms 115:4-6 LXX`, then restored Psalm 50:1 LXX (raw 3),13 tabs. Readonly DB confirms original tabID0456641d-da15-49d2-8620-cdf2b9d1f0bd/typeBible retained and GalleryQA07 content SHA256 AND updated_at unchanged.

Full 195 shared tests/57 suites passed; after adding corpus-version coherence assertions, the 3 focused tests passed again (`/tmp/berean-brenton-corpus-coherence-final.log`). All120 package snapshot hashes matched repo. Tap + visual-adjacency harness passed. No application code changed after final builds/UI checks. Physical iPhone/VoiceOver, physical cursor-motion/flicker, full Mac scrolling performance and combined-record cross-reference aggregation remain open.

Commits: faf8589d location focus/input;3c38eb5c native cursor ownership;819f9954 iPhone body taps/CI;59bbd436 accessible inspector close;8492a161 combined Brenton records/visual adjacency. The next docs commit records this checkpoint. Publish the complete checkpoint to **github**/native/reader-notes, existing draft24; compare remote head with local HEAD and read CI for that exact PR head. Prior74aeb6c5/CI44391471644 is historical evidence only. PR22/23/24 were rechecked OPEN,24draft/base native/m6-navigation; owner-only merge order unchanged. Do not merge or inherit old green checks.


## 2026-11-19 — Psalm rendering follow-up

- **Delivered739c5e41:** numbered superscription/body groups, repaired native title indentation, iPhone title tap selection and quiet LXX/KJV metadata with on-demand explanations. Both builds pass; actual Mac/Simulator group selection verified. ONLINE-BRENTON.md records online edition differences.
- **New confirmed issue READER-CROSSREF-IDENTITIES:** Psalm50LXX whole-chapter TSKe shows threeVerse1 groups and drops correct correspondence at the end, because service KJV source verse numbers are rendered as raw LXX IDs. Selection requests also pass raw LXX source numbers to legacy cross-reference lookup. Combined115:4 needs references from KJV116:13 AND14. Implement native reader mapping/aggregation without changing legacy conformance results; test joins/splits and both sources/scopes. Do not merely relabel duplicated groups.
- **Still open:** font/number-hidden/Dynamic Type/VoiceOver checks, full Mac title typography at varied pane widths, Compare per-column selection/whole-block drag, physical cursor/flicker/scroll matrix, generic splits, Notes parity, display-vs-raw links and real Kokoro audio.


## 2026-11-19 — native references, toolbar responsiveness and Strong’s continuity

- 42d34bbe: additive native cross-reference APIs map verified stored LXX rows to canonical sources; correct chapter grouping and combined-record aggregation. Legacy service entry points/goldens remain intact. Classic/TSKe selected and chapter UI checked on both apps; structural unverified alignments remain open.
- fce2b88e: native navigation ControlGroup replaces fixed-size HStack; measured Mac toolbar CPU loop resolved while retaining sidebar titlebar placement. Baseline99.5% CPU/AX20–40s → idle0–3.3%/AX0.1–0.4s. This supersedes prior automation-latency diagnosis; broader physical interaction checks remain.
- 3bbecdea: native readers retain the visible body line when Strong’s toggles, preferring a visible selected verse and excluding inline metadata from anchor offsets. Mac selected/unselected and iPhone mid-chapter on/off verified; physical phone and full edge/width matrix pending.
- Validation: full202 shared tests; final6 focused cross-reference checks include all151 Psalms source bounds. Fresh reader intent/reflow harness passes Unicode/metadata mapping and prior tap/adjacency checks. Both final native builds pass. See current HANDOFF for exact logs, QA restoration and remaining tasks; source corpus/production/sync/identities unchanged.


## 2026-11-19 — Compare selection and floating actions (d6f7cced)

Each edition now owns its selectable verse numbers and action target. Additive taps/Mac Shift use actual stored row order; selection itself does not change the anchor passage or history. Adjacent visible selected rows share one faint/dashed outline; stacked interleaved editions remain outside each other’s outlines. Reduced Motion pauses animation. The adaptive glass action bar reuses reader control styling and supports copy/highlight/tag/note/reference/reader/share/clear operations. iPhone dock safe-area clearance was verified after an initial hidden-bar failure. Mac Command-C was verified after fixing a focus-routing failure. Clearing and exiting Compare does not restore an old selection. Shared title rendering uses the Scripture font and folds source title newlines.

Both local Dev builds and the expanded native reader harness pass. Mac LXX50/KJV51 copy and action destinations, Mac Shift group/Escape, and iPhone stacked selection/copy feedback/reader transfer/final dock gap/clear-exit passed. See HANDOFF for exact logs and QA restoration. No note contents/timestamps changed;4 Mac/9 iPhone tabs preserved. Prior baselinecce95bf0 CI44493859591 is green, including203 shared tests; this is not evidence for the new source’s pending CI.

Remaining before full Compare parity: view-state retention across tabs/relaunch, independent/pinned/cross-chapter/duplicate/4-column/width/accessibility matrix, actual mutation-and-undo action checks, native word-copy precedence, body-tap selection, selected-line reveal, and whole-block drag previews/grab-anywhere. Generic arbitrary-tab splitting and Kokoro playback remain separate open work.


## 2026-11-19 — Compare tab return and explicit location intent (3090db5c)

A bounded local snapshot per open tab now restores the selected Compare column/edition/chapter, selected stored rows, focus and original Shift anchor across tab switches. Close/explicit Compare arrival clear the cache. It is observation-ignored memory, with no new persisted/synced fields; restart retention remains open. Incoming explicit references override old local selection, including same-chapter and repeated identical commands. A fresh jump revision also restores the requested scroll position. Ordinary Go deduplication still uses the original one-argument isShown match, which excludes Compare.

Final Mac/iOS builds pass (`/tmp/berean-compare-intent-complete-{mac,ios}.log`), and expanded native harness passes retained-anchor and unavailable-row cases. Mac UI verified LXXGenesis12 → Notes → return retaining selection; new/repeated Go to KJVGenesis11 replaces it, and repeat Go moves from near-end offset back to verse11. iPhone verified KJVPsalm3v1 → existing G5463 → return retaining that edition/selection.4 Mac/9 iPhone tabs preserved; original QA passages restored and all7 Mac QA note contents/timestamps unchanged. Earlier repeated-command failure and intermediate method-reference compile errors were corrected, not counted as passes. Full independent/pinned/history/restart/4-column/accessibility coverage, native word-copy precedence and whole-block dragging remain open.


## 2026-11-19 — Compare passage lift follow-up (7d365304)

Native Mac drag sources now cover headers, verse-cell whitespace and independent panes, with a readable glass passage preview, faded source and destination wash. Reorder remaps edition selection/scroll caches without changing legacy column records. Aligned two-edition reorder in both directions, exact mid-chapter scroll retention, Escape cancellation and native word-copy precedence passed. Both local native builds pass. Preview is a reconstructed visible excerpt; system-owned ghost pixels and physical feel were not captured. Pinned independent attempts did not demonstrate a successful drop; keep that matrix,4-column/duplicate/narrow/accessibility and selection removal/action writes open. CUA requires a final destination click to complete the native drop in this environment; do not misdiagnose its pending session as a stuck app. See HANDOFF/CHANGELOG for exact evidence/restored QA and CI scope. Generic arbitrary-tab splitting remains planned only. Strong’s body-word reading continuity is delivered; long-verse/end/width/hardware checks remain.


## 2026-11-19 — Compare Strong’s continuity (f0b8752e)

Shared Compare scroll now follows a visible verse through Strong’s reflow, preferring visible selected focus; independent and stacked hosts also receive verse-based restoration. Deferred work yields to newer explicit navigation/current-tab/passage/Compare-mode changes. Main Reader retains the finer body-word position separately. Mac aligned UI verified verse8 retained on enabling and selected11 retained on disabling; final guarded Mac/iOS builds PASS. Guard race matrix, independent/stacked/iPhone runtime and full width/long-verse/hardware checks remain. Nested drag-source removal experiment did not establish a pinned-drop fix and was fully reverted; pinned native dragging remains open. See HANDOFF/CHANGELOG for exact logs, QA restoration and CI status.


## 2026-11-19 — Notes formatting and context-menu follow-up

347cf74a routes native inline formatting through a shared, source-preserving cell edit: confirmed table pipes/rules/padding remain intact; mixed cells toggle together; existing inline constructs keep their rendering/source rather than becoming malformed enclosing marks.9 focused regressions and all212 package tests pass. Mac whole-table bold/toggle/Undo/Redo and exact persisted source verified. Arbitrary nested marks and the separate colored multi-cell highlight adapter remain open.04079bdf shortens the iPhone preview and groups Share/Print/Export; simulator now shows the entire primary menu including Trash and its action worked. Both final native builds pass. iPhone grid rendering passed; iPhone formatting/Undo remains unverified because remote keyboard input changed text unexpectedly. All original7Mac/17iOS note contents/timestamps unchanged, synthetic notes in recoverable Trash, original passages restored/4Mac/9current-iPhone tabs. Read HANDOFF for logs, simulator container relocation, input failures and next gates; no production/sync/schema changes or merge.


## 2026-11-19 — Multi-cell/multiline note highlights (8adef50b)

Default/color/Remove Highlight now share one source-preserving edit across cells and paragraphs, including partial recolor/removal and mapped selection. Color application is idempotent; structural Markdown/line endings and existing code/links/other marks survive. Other marks remain protected rather than gaining nested styling. Escape atoms stay together even under partial selection (initial failed readable-text case corrected).20 focused tests and all223 package tests pass; both native builds pass. Mac actual6-run Blue→Undo/Redo→Green→Remove restored the exact original source and grid; synthetic note in recoverable Trash, original7 note hashes/timestamps and4workspace tabs unchanged. iPhone8ade runtime and full native partial/nested/width/hardware matrix remain open. See HANDOFF for exact logs, evidence limits and pending exact-head CI.


## 2026-11-19 — Combined note rendering (09eb7d84 /6555fd0e)

Existing strong/emphasis combinations now use Foundation source positions while custom marks/raw IDs remain source-preserving. Literal code and link destinations stay intact; the native punctuation-only mark fallback remains. Bounded thread-safe process cache avoids reparsing unchanged bodies; synthetic parser timing matches the old path after caching (not a whole-editor latency claim). Highlight backgrounds now exclude hidden glyphs; real Mac empty blue strip disappeared.9new tests,46focused and all232package tests pass; both final native builds pass. Mac combined styles/table, plain copy and Command-B round trip verified with exact source retained; synthetic note trashed, original7 note hashes/timestamps and4workspace tabs unchanged. Whole protected highlight runs can be cleared; unsupported partial nested edits remain unchanged and full rich-mark mutation parity remains open. iPhone runtime/physical/accessibility/large-note matrix and GFM escaped wiki-alias identity verification remain queued. See HANDOFF for exact logs and CI scope.

## 2026-11-19 — iPhone formatting target survives Undo/Redo

All iPhone programmatic note formatting uses the existing literal-source undo path with validated text/selection bounds. This fixes Redo collapsing selection and a subsequent format button inserting empty marks at the caret. Real simulator touch Bold→Undo→Redo→Bold and Highlight→Undo→Redo→Highlight restore the exact whole original table fixture; selected Prayer retains visible handles. iOS build passes (`/tmp/berean-note-selection-undo-ios.log`). Original17 notes unchanged,47active tabs retained, synthetic notes recoverably trashed. Mac/package unchanged; previous232tests/Mac build are baseline, not fresh checks. Broader multi-cell/combined-style/color/typing/IME/accessibility parity remains open. See HANDOFF for IDs and clipboard method.

## 2026-11-19 — Combined formatting of visible note text

Shared native formatting now adds styles to existing styled text and toggles exact marked runs independently, including bold+italic shared boundaries. It verifies plain text and prior style coverage before accepting the source edit. Mac and iPhone actual UI passed a selected table word through Bold→Italic, independent Bold removal, Undo and independent Italic removal; exact saved source confirmed.236tests and both SDK27.2 builds pass (HANDOFF has logs). Partial removal inside a larger mark, whole-table combined editing and broader rich-editor parity remain open. Table wiki-link normalization is deferred because actual legacy serialization proves an identity collision; see NOTE-TABLE-LINK-COMPATIBILITY.md.

## 2026-11-19 — Remove note styles from part of a passage

Native Notes now removes a style only from selected visible text while retaining surrounding formatting, including nested emphasis. Global visible-character/semantic validation protects neighbouring styles and link/code identities. Mac and iPhone live checks passed sequential Bold/Italic removal from Bravo inside a formatted table phrase, plus exact Undo/Redo and selection retention.240tests and both final SDK27.2 builds pass; HANDOFF contains logs, initial failures and cleanup evidence. Whole-cell/table mixed hidden-syntax edits and broader rich-editor parity remain open.

## 2026-11-19 — Generic tab-split model groundwork

Added process-local pane-tree edits/geometry, atomic layout undo and scoped/versioned tab-drag payload validation.8focused tests include484ordered tab-family/edge cases. Full248tests and both SDK27.2 builds pass (`/tmp/berean-pane-layout-*` logs). No split UI, drag target/type, app command routing or persistence is enabled; TAB-SPLIT-DESIGN.md specifies the next extraction and remaining gates. Separately, actual Mac Compare independent KJV10/LXX5 reading positions survived Strong’sON/OFF; exact intra-row position and broader matrices remain open. Original notes unchanged; HANDOFF has precise evidence.

## 2026-11-19 — Explicit Mac tab content host

MacRootView now delegates its current single document to MacTabContentHost(tabID:), preserving identity/toolbar/inspector behavior and handling a stale tab explicitly. Mac build and real Scripture/Notes/Calendar/History/Tags/Lexicon/Search checks pass; exact37original tabs and7original notes preserved. Shared248tests/iOS model-build baseline unchanged. Background-pane command/focus/toolbar/editor coordination and actual drag previews/splits remain unfinished; see TAB-SPLIT-DESIGN/HANDOFF.

## 2026-11-19 — Pane selection and compact command-scope model

Added focused-document replacement, visible-tab reuse, scoped/stale command-target checks and compact focused projection retaining the full split tree.13focused model tests pass (including484family/edge cases); full253tests and both SDK27.2 builds pass (`/tmp/berean-pane-focus-*` logs). Minimums now key on TAB ID so replacements use their own document constraints. AppModel command routing, pane environment, compact picker and visible splits remain unimplemented; this is model groundwork only. HANDOFF/TAB-SPLIT-DESIGN record the exact next bridge and validation.

## 2026-11-19 — Reader annotation workflow

SHARED-UX-ANNOTATIONS (P2, both): inline tags disrupted reading. First pass implemented: notes/tags margin dot, chapter summary and contextual grouped details; Compare tag rows removed. Mac/iPhone interactions verified, both builds pass. IN PROGRESS until hidden-number/accessibility/large-type/dark/many-tag and citation-unification acceptance complete. Actual tag search/removal submissions not part of this pass. No data migration.

## 2026-11-19 — Personal references and follow-up queue

SHARED-UX-ANNOTATIONS: unified personal reference dots and contextual Related Passages route implemented, including ordinary-note ranges, while attached Notes stay distinct.254tests/both builds and Mac/iPhone route checks pass. New issues (scope/sort/filter placement/hover, release-scroll, hidden Markdown/context table menu, share anchor, history polish, auto-ref parity, BDB selection, substring highlighting) remain OPEN in FOLLOWUP-2026-11-19.md. Shared Mac QA concurrent edits require isolation before further tests.

## 2026-11-19 — Automation QA isolation

Debug-only named QA library/preferences now implemented; regular behavior/identities unchanged. Live named-suite writes and parser safety checked; full255tests/both builds pass. Use only the separate app path/profile in QA-PROFILES.md; preserve concurrent shared-QA user edits. Notes controls/viewport follow-up is validated in the worktree.

## 2026-11-19 — Study controls and viewport lifecycle

MAC-UX-VIEWPORT (P1): saved reader restore ran detached0×0 and clamped correct offset into wrong viewport; FIXED in final source, exact0.2734573119188504 Notes/Search return and fresh17jump verified, trace retained/removed from source. MAC-UX-RELEASE (P2): normal release model saves removed, physical smoothness still OPEN. Notes filter placement/redundant labels fixed and both-platform scope checks pass; initial hover controls implemented, full audit OPEN. Notes previews raw Markdown confirmed OPEN in FOLLOWUP-2026-11-19.md.

### 2026-11-19 Notes preview/table follow-up

Study-note rows now use semantic readable previews (iPhone wiki-bracket regression verified). Both editors publish retained-selection table context; Table menu adapts between insertion and row/column/delete operations. Mac contextual insertion, original-source undo and prose reset verified; iPhone context interactions/full Markdown edge cases remain open. Both builds pass. See HANDOFF dated entry for logs, disposable fixture cleanup and unchanged original note/tab/tag invariants. Remaining share/version/RTL/match/auto-reference audits are not marked complete.

### 2026-11-19 sharing, BDB and navigation increment

Mac Notes sharing now uses a stable native toolbar anchor (repeated open/cancel verified); ordinary editor/list/bulk note sharing uses readable text, explicit Markdown copy/export retained. Version history spacing/preview polished (Mac preview verified). Native BDB selectable prose uses an explicit English paragraph base; Mac mixed Hebrew/English logical copy and iPhone word handles verified. Search substring marks and Lexicon bold+faint match backgrounds verified. Found/fixed iPhone New Tab sheet intent loss: explicit H1 created a separate tab, ordinary Go reused G5463; cleanup restored exact47IDs. Final builds pass; detailed limits/paths in HANDOFF and SHARING-AUDIT.md. New Compare→Reader viewport shift is OPEN; no all-scroll/no-Markdown/all-share/all-parity completion claim.

### 2026-11-19 reader layout and reference tracking

8f680362 fixes repeated Compare→Reader width-reflow shifts by retaining the immediate restoration intent through initial layout changes, yielding to input. Final no-trace UI roundtrips retain0.5418427726120034; physical smoothness/full races still open.03697661 restores original Strong’s detection preference on both apps; Mac explicit-link independence and iPhone OFF persistence/ON restoration verified. c8fbfe2e removes canonical-name/80-result loss of ordinary-note citations; real Jn3:17 MyNotes UI and90+note/edit/Trash/restore tests pass. Full256tests/both builds pass, original13/17notes/38/47IDs/tags unchanged. HANDOFF and NOTES-REFERENCE-PARITY.md provide precise remaining matrices; broader goal remains active.

## 2026-11-19 — Personal lexicon Notes and simpler iPhone commands

Implemented shared Lexicon My Notes backlinks using normalized bare IDs and actual lexicon destinations, preserving note-title wiki identities and excluding code/images/comments/unrelated URLs. Ephemeral off-main, revision-aware index has no result cap or schema change. Mac normalized/explicit-link/edit invalidation and iPhone existing-note/open/top-Back return verified. iPhone More now groups reading/chapter/tab/study commands with Settings directly reachable; tab previews use readable excerpts. Full 258 tests and both return-fix builds passed; final disclosure polish build logs and full evidence/limits are in HANDOFF. Physical scroll/hover, compact/history/performance/reference grammar, rich tables/all sharing/live panes/Kokoro remain open. Production data/identities untouched; review guard and active goal unchanged.

## 2026-11-19 — Search/study/Compare/window follow-through

Seven focused source commits now deliver the Mac chapter share anchor (actual open/cancel twice), aligned inline search controls and grouped Options (Exact phrase/reset checked), grouped Notes inspector with compact desktop chapter scope, searchable Shortcuts (action/modifier/no-results/clear checked), iPhone Compare body selection (LXX/KJVA/number-clear checked), persistent window inspector with settled native width retention and explicit sidebar240/panel320/window1000 minimums, and local cursor-region yielding at native dividers. Both apps build; latest Mac-only limits/cursor builds pass. Physical cursor/drag/first constrained Compare reflow/all-tab history/toolbar matrices remain open. See latest HANDOFF for exact evidence, failed width experiments, source commits and safe NEW controls QA profile. All16 fresh Mac notes/37IDs and17 iPhone notes/47IDs/tags unchanged. Do not restore the now-stale prior study QA baseline.

## 2026-11-19 — Divider/Compare implementation checkpoint

Divider transient cursor report has a narrow native tracking implementation plus arranged-pane/glass-overlap regression coverage (5658bcfe); physical key-window sustained hover remains OPEN. Compare reconstructed preview is replaced by the actual rendered visible column with native pickup offset (6c351503); independent move/cancel and verse actions verified, broader interaction/2x/modes remain OPEN. Preserve the remaining owner queue in FOLLOWUP-2026-11-19.md.

## 2026-11-19 — Repeated Compare drag correctness

Source bbca520f fixes stale recognizer source identity after reorder, finishes the native gesture lifetime and masks stacked drag images to the actual source fragments. Real aligned/pinned consecutive moves, invalid-drop recovery, rendered Strong’s link and temporary three-column stacked reorder/return verified; both builds pass. Temporary column removed and reading states restored;16notes/37IDs/alltags unchanged. Blue verse-control image fidelity,2x/selected/text-selection/4column/race/physical cursor matrices remain open. Exact evidence in HANDOFF/NATIVE-COMPARE-DRAG.md. Previous718d9e2e CI44665586360 is green; new head’s checks are separate.

## 2026-11-19 — Table-safe Notes and minimal iPhone keyboard controls

713bd02e protects real note tables from paragraph/list/callout/nested-table edits and disables corresponding native controls.1b9a4074 groups the iPhone accessory into6prose/5table controls, keeps formatting in a native menu, provides contextual table operations/live cell navigation, direct keyboard dismissal, Undo/Redo availability and haptics preference support. Both final builds and265tests pass. Actual Mac shortcut/table/prose/Undo and iPhone row/column/format/Undo/Redo/navigation/heading checks passed. Original16Mac/17iPhone notes,37/47IDs/tags unchanged; disposable notes trashed/tabs closed. See HANDOFF/NOTES-KEYBOARD-AND-TABLES.md for exact scopes and open device/rich-edit matrices. d6422697 adds opt-in raw Compare diagnostics; direct pixels supersede the earlier missing-number preview interpretation. Latest owner marker/hover/replacer/auto-block requests remain OPEN in FOLLOWUP.

## 2026-11-19 — Study markers and automatic dictionary blocks

Chapter study visible wording removed while chapter access remains icon. Margin symbols identify primary material with summary and450ms personal-citation preview on Mac; citation-only click opens Cross Refs, combined opens Notes. Filter hover moved outside native Menu labels after owner report; menu clicks verified, continuous physical hover/preview lifecycle/VoiceOver still open. Native dictionary cards checked both platforms; Scripture cards remain open.
