# Testing backlog — 2026-09-25 (Bible-first UX pass)

Source: the developer's `September 25, 2026 – Testing.md` (in `~/Downloads/`, not copied) and the
Sept 25 brief. The permanent product rules extracted from it live in
[../ux-principles.md](../ux-principles.md) (principles, current-tab vs new-tab, interaction-depth
audit, before/after navigation map, feature-placement matrix, new-user / power-user audit, history,
sheet-gesture and Scripture-theme models). The e-Sword screenshot was used only as evidence that
power does not require clutter — nothing was copied.

"Sim" = verified in the iOS simulator through the probe harness (synthetic touches). **Dev** =
needs the physical iPhone. macOS rows were built and unit-tested, not run (Michael's manual pass).

## Source requirements (testing notes)

| ID | Requirement | Implementation | Files | Platform | Automated | Manual | Status |
|---|---|---|---|---|---|---|---|
| SEP25-001 | Learning curve too big; easy for a non-technical user, depth for power users | UX principles + audits; compact verse sheet; fewer controls; ⌘L caret; Filters collapsed | docs/ux-principles.md, below | both | — | Dev pass | COMPLETE |
| SEP25-002 | mac: chapter switch must not carry verse filters (Heb 10:9 → Zech 4); new tab starts clean | `verseFilterForChapter` drops filters outside the tab's book/chapter (render + saved state); Duplicate tab clean | src/lib/scriptureContextFilters.ts, BiblePanel.tsx, TabBar.tsx | macOS | 10 tests | Mac pass | COMPLETE |
| SEP25-003 | mac: Advanced Scripture Search from floating search while editing the current tab changes that tab | `advancedSearchInPlaceTabId`; all four entry points; history step recorded | src/components/shell/advancedSearchTarget.ts, FloatingSearch.tsx | macOS | 5 tests | Mac pass | COMPLETE |
| SEP25-004 | mac: Lexicon side-panel selected verses — Strong's hover like the reader | StrongsTooltip around each number; click opens entry | SelectedVersesStrongs.tsx | macOS | 1 assertion | Mac pass | COMPLETE |
| SEP25-005 | mac: selecting verses auto-filters cross references (TSK/e, Classic, My Notes; multi-verse) | selection > manual filter > chapter; per-verse grouping kept; shared My Notes loader | BibleRightPanel.tsx, scriptureContextFilters.ts, src/lib/notesCrossRefs.ts | macOS | tests | Mac pass | COMPLETE |
| SEP25-006 | mac: note images Copy + macOS-like controls | native Electron menu (Copy Image / Save Image As… / Delete Image), bitmap to clipboard, save dialog, compact token-styled buttons | electron/ipc/noteImages.ts, preload.ts, pm/nodeViews.ts, pmEditor.css | macOS | 3 + 2 tests | Mac pass (native menu) | COMPLETE |
| SEP25-007 | iPhone: history must capture everything per tab (Notes was way off) | Root causes: async history push after a restore truncated forward history; page back / wikilinks bypassed history; editor pages stacked. Fixed: one editor page (replace), sync push skipped while restoring, list + folder/filter as `home` steps, retitle, generic `state` snapshots; Search / Settings / Compare recorded | src/store/index.ts (restoreTabNavEntry, retitleTabNav), types, MobileApp.tsx, notes/notesHistory.ts, NotesHomePage.tsx, NoteEditorPage.tsx, search/searchHistory.ts, settings/settingsRoutes.ts | iPhone (+shared store) | 5 + 6 tests | Sim: B → A → list → A → B; page back = list step | COMPLETE |
| SEP25-008 | iPhone: still a blur around the notch | Scripture header no longer glass-behind-the-status-bar: solid Scripture-colour band with a 12 px fade, no backdrop filter anywhere near the cutout | reader/readerChrome.css | iPhone | — | Sim screenshots; Dev | COMPLETE |
| SEP25-009 | Caret search = ⌘L (current tab), floating search = ⌘T | `CaretGoTo` on the shared destinations (`destinationQuery`, target current-tab) + passage resolver; every caret has it (Reader, Compare, Notes, Search, Lexicon, YouTube, PDF, Tags, fallback) | commands/CaretGoTo.tsx, navigation/destinationQuery.tsx, staticCommands.ts, ReaderPage/ComparePage | iPhone | 11 tests (destinations) | Sim: "Genesis 10 LXX" → this tab, LXX; no new tab | COMPLETE |
| SEP25-010 | Sheets: no overscroll; move the sheet at the content's top / bottom | `sheetGesture.ts` decision per touchmove, continuous hand-off from the boundary, velocity settle, keyboard blur on move, overscroll none | primitives/Sheet.tsx, sheet.css, sheetGesture.ts | iPhone | 10 + 2 tests | Sim: body drag moved sheet 1:1 and closed; Dev (momentum) | COMPLETE |
| SEP25-011 | Colour presets only for Scripture, never the whole app | `applyMobileAppearance`: app keeps Default Light/Dark; presets → `--scripture-*` vars scoped to reader/compare | settings/scriptureTheme.ts, reader/scriptureTheme.css, MobileApp.tsx, ThemePresetPage.tsx | iPhone | 10 tests | Sim: black preset in System Light → reader black, app light | COMPLETE |
| SEP25-012 | Edit the verse note from the sheet, not another tab | Notes (verse sheet) → list → edit in place (`SheetNoteEditor`, shared autosave hook) → "Open in Notes" optional | study/VerseNotesSheet.tsx, notes/useNoteAutosave.ts | iPhone | typecheck | Sim: New note edited in sheet, space stays Scripture | COMPLETE |
| SEP25-013 | Verse-note label "Deuteronomy 29:3" (+ " LXX" only for LXX) | `verseRefDisplay` shared; note editor meta, notes list, search results | src/lib/parseRef.ts, notes pages, SearchPage.tsx | both (helper) | 4 tests | Sim | COMPLETE |
| SEP25-014 | Tapping a verse lists the notes that reference it | Notes action (badge count) → notes on that verse in the sheet | study/VerseActionSheet.tsx, VerseNotesSheet.tsx | iPhone | — | Sim | COMPLETE |
| SEP25-015 | Compare: same collapse of top / bottom; text continues past the bottom buttons (and other tab types) | Compare uses the Scripture chrome + hide-on-scroll + compact pill; bottom controls float over EVERY tab with measured end room | ComparePage.tsx, readerChrome.css, MobileApp.tsx | iPhone | — | Sim: compare collapsed, text to bottom | COMPLETE |
| SEP25-016 | Caret cross-reference section has "My Notes" | Segmented TSK/e · Classic · My Notes (also in the verse sheet) | ReaderPage.tsx, CrossRefsSheet.tsx | iPhone | — | Sim | COMPLETE |
| SEP25-017 | Note / cross-ref indicators inside the verse number | Touch: note colour + underline, corner dot for note cross refs, tag tint; VoiceOver label; desktop pill unchanged | VerseRow.tsx, readerChrome.css | iPhone | typecheck | Dev (visual) | COMPLETE |
| SEP25-018 | Verse sheet modes (brief ↔ verse with Strong's) | Strong's action toggles Brief / Strong's (remembered per device); drag up = Expanded | study/verseSheetMode.ts, VerseActionSheet.tsx | iPhone | — | Sim | COMPLETE |
| SEP25-019 | Picker: chapter tap updates Scripture, stays open on verses, dismiss keeps the chapter; remove chapter/verse toggle | `onChapter`; verse grid; lowered to medium so the chapter shows; toggle removed | reader/PassagePicker.tsx, ReaderPage.tsx, ComparePage.tsx | iPhone | 7 tests | Sim: ROM 8 live, verse 28 closes | COMPLETE |
| SEP25-020 | Tabs: Recent / Custom toggle; reorder in Recent → Custom (overwrite); custom remembered | segmented control; `tabSort.ts`; persisted `mobileTabSort` + session display order | tabs/TabCardsSheet.tsx, tabSort.ts, store | iPhone | 5 tests | Sim (control); Dev (drag) | COMPLETE |
| SEP25-021 | Too busy (e-Sword is compact) | reader density (verse rhythm, margins), compact verse sheet, one Filters row, 6-icon floating search | mobile.css, study.css, SearchPage, NewTabSheet | iPhone | — | Sim / Dev | COMPLETE |
| SEP25-022 | Too many taps | interaction-depth audit (ux-principles §3) and the changes it lists | docs/ux-principles.md | both | — | Dev | COMPLETE |
| SEP25-023 | Feels like Safari / an interactive web thing | no top bar (floating capsule), native grouped menus/sheets, no address-bar floating search, Scripture-first layers (see final audit) | many | iPhone | — | Dev | COMPLETE (judgement — confirm on device) |

## Brief requirements (UX-xxx)

| ID | Requirement (phase) | Implementation | Platform | Automated | Status |
|---|---|---|---|---|---|
| UX-001 | Phase 0 audit | done before edits (architecture, navigation, history, sheets, reader, notes, search, themes, picker, tabs) | — | — | COMPLETE |
| UX-002 | Phase 1 ledger | this file | — | — | COMPLETE |
| UX-003 | Phase 2 product UX audit | ux-principles §3–6 + final audit below | — | — | COMPLETE |
| UX-004 | Phase 3 before/after navigation map | ux-principles §4 | — | — | COMPLETE |
| UX-005 | Phase 4 Bible-first iPhone | verse-context actions (notes edit, Strong's, refs, copy) stay in the verse sheet; compare in-tab | iPhone | — | COMPLETE |
| UX-006 | Phase 5 top bar: no bar, floating glass capsule, collapse to island/notch, no halo | readerChrome.css Scripture chrome | iPhone | — | COMPLETE (Dev: material feel) |
| UX-007 | Phase 6 reader density | verse row 1 px rhythm / 2 px padding, column margins | iPhone | — | COMPLETE |
| UX-008 | Phase 7 verse tap = whole verse; long-press = partial; compact first sheet; Share secondary | unchanged selection model; Notes · Strong's · Refs · Copy; Share in expanded list | iPhone | — | COMPLETE |
| UX-009 | Phase 8 modes Brief / Expanded / Strong's without an extra button | Strong's action is the mode switch; detent is Expanded | iPhone | — | COMPLETE |
| UX-010 | Phase 9 verse notes in the sheet | SEP25-012/014 | iPhone | — | COMPLETE |
| UX-011 | Phase 10 reference format | SEP25-013; multi-verse labels keep `rangesLabel` / `refLabel` | both | 4 tests | COMPLETE |
| UX-012 | Phase 11 compact indicators incl. tags | SEP25-017 | iPhone (mac unchanged) | — | COMPLETE |
| UX-013 | Phase 12 cross refs TSK/e · Classic · My Notes, auto-filter by selection | iPhone: verse sheet / multi-verse Refs / selection bar; mac: SEP25-005; shared My Notes loader | both | 2 tests (filter) | COMPLETE |
| UX-014 | Phase 13 Strong's slightly larger, coherent; mac hover; iPhone tap | 0.8 em reader + sheets; mac SEP25-004; iPhone tap → entry | both | — | COMPLETE |
| UX-015 | Phase 14 picker hierarchy + search + live chapter flow | SEP25-019; KJV (OT · Apocrypha · NT), LXX, single-book libraries skip the book level; search every level | iPhone | 7 tests | COMPLETE |
| UX-016 | Phase 15 Recent / Custom | SEP25-020 | iPhone | 5 tests | COMPLETE |
| UX-017 | Phase 16 per-tab history architecture | SEP25-007; Scripture (text, book, chapter, verse, scroll, compare), Notes (note, folder, filter), Search (query, scope, filters, scroll), Settings (section), Lexicon / YouTube (entry / video via existing typed entries) | iPhone + shared store | 11 tests | COMPLETE |
| UX-018 | Phase 17 current tab vs new tab | SEP25-009; compare / advanced search / results / history rows act on the current tab; new tab only when labelled | both | tests | COMPLETE |
| UX-019 | Phase 18 advanced search first-class, polished, Filters | Filters row with summary + count → grouped sheet (Match, Search in: Text / Books / Tags, Sort, Reset) | iPhone | 11 tests | COMPLETE |
| UX-020 | Phase 19 search tap = current tab; long-press menus across lists | Search, History (Open / New Tab / Copy / Remove), Lexicon results | iPhone | tests | COMPLETE (YouTube lists are the hosted desktop panel — unchanged) |
| UX-021 | Phase 20 floating search | 6 destinations, 5 recents + All History, no Compare / Workspaces | iPhone | tests | COMPLETE |
| UX-022 | Phase 21 caret language | every caret: go-to field + ‹ › + tab-specific commands | iPhone | — | COMPLETE |
| UX-023 | Phase 22 sheet gestures + keyboard | SEP25-010 | iPhone | 12 tests | COMPLETE (Dev: momentum hand-off) |
| UX-024 | Phase 23 Scripture-only presets | SEP25-011 | iPhone | 10 tests | COMPLETE |
| UX-025 | Phases 24–28 macOS | SEP25-002…006 | macOS | tests + build | COMPLETE (manual pass pending) |
| UX-026 | Phase 29 top/bottom collapse (reader + compare) | reader + compare set chrome; bottom controls slide away | iPhone | — | COMPLETE |
| UX-027 | Phase 30 compare inherits reader behaviour | SEP25-015; independent columns / selection unchanged | iPhone | — | COMPLETE |
| UX-028 | Phase 31 content boundaries on every tab (central) | one rule: overlay controls + `--m-nav-h` end room for page bodies, reader / compare ends, hosted panels, note editor | iPhone | — | COMPLETE (Dev: each tab) |
| UX-029 | Phase 32 archive in the same sheet | already an in-sheet push (verified) | iPhone | — | COMPLETE |
| UX-030 | Phase 33–34 real materials, not overused | capsule + bottom controls + sheets only; Scripture never translucent; see design-system notes | iPhone | — | COMPLETE |
| UX-031 | Phase 35 accessibility | 44 pt targets, VoiceOver labels (verse marks, actions, caret), Reduce Transparency / Increase Contrast for the capsule, reduced motion | iPhone | — | COMPLETE (Dev: VoiceOver) |
| UX-032 | Phase 36 feature placement matrix | ux-principles §5 | — | — | COMPLETE |
| UX-033 | Phase 37 new user / power user | ux-principles §6 | — | — | COMPLETE |
| UX-034 | Phase 38 macOS regression | shared: store history restore, VerseRow (touch-only branches), My Notes loader, parseRef helper; desktop build + full vitest | macOS | 214 files / 4394 tests | COMPLETE (manual pass pending) |
| UX-035 | Phase 39 automated tests | listed per row | both | typecheck 0 errors; vitest 214 / 4394 | COMPLETE |
| UX-036 | Phase 40 physical-device guide | final report | — | — | COMPLETE |
| UX-037 | Phase 41 docs | ux-principles.md; this ledger; mobile-navigation.md §8; ios-design-system.md (Scripture chrome, themes) | — | — | COMPLETE |
| UX-038 | Phases 42–43 final design + requirement audits | below | — | — | COMPLETE |

## Final design audit

- **Bible app, Scripture at the centre?** Yes: the reader opens with no bar; everything about a verse
  happens from the verse; the passage capsule is the only chrome at the top.
- **Non-technical user without a tutorial?** The reader shows three bottom controls and one
  capsule; the verse sheet has four labelled buttons. Sessions / history / databases never need to
  be understood to read, change chapter, search or write a note.
- **Power user still fast?** Advanced search is one Filters row away; Strong's mode is remembered;
  ⌘L-style caret field; ‹ › on every tab; Recent / Custom tabs.
- **Safari feeling?** The address-bar-like top bar is gone (floating capsule), floating search is a
  short destination list, not a URL bar. Remaining risk: the tab cards grid is still browser-like —
  kept because it is the persistent tab model the developer asked for; Recent sort makes it read
  as "recent studies".
- **Web-thing patterns replaced:** separate card-per-row menus → grouped iOS menus; stacked note
  pages → one editor + history; rubber-band sheets → boundary hand-off; app-wide theme flips →
  Scripture-only.
- **Busy?** Reduced: search filters collapsed, floating search 8 → 6 destinations, verse indicators
  moved into the number, compact verse sheet.
- **Too sparse?** Reader rhythm tightened; line height stays the user's setting.

## Known limits / follow-ups

- WKWebView paints an outer drop shadow under a backdrop-filtered element as a square — the capsule
  therefore has edge + specular line only (no float shadow).
- Built-in presets keep their light / dark variants with the system appearance (custom themes are
  fixed colours); pinning built-ins to one variant is a one-line change if wanted.
- Search: an automatic prune of a deleted verse tag from the filters records a history step.
- Tab "Move earlier / later" computes its order once per push (pre-existing).
- Physical-device checks: sheet hand-off during native momentum, notch devices, VoiceOver.
