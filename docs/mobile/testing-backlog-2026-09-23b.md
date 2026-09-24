# Testing backlog — 2026-09-23 (second device round)

Source: the developer's notes `September 23, 2026 – Testing(1).md` (kept in `~/Downloads/`, not
copied here) plus his answers to the clarification questions; both are requirements. Builds on
[testing-backlog-2026-09-23.md](testing-backlog-2026-09-23.md) (T23-001–035, complete). Status values
as in that file; **Dev** = needs the physical iPhone to be fully verified.

Design model for the whole iPhone app: **Tabs → current tab → contextual caret / sheet → sub-view
in the same sheet → back.** Persistent, content-rich experiences are tabs; contextual actions,
settings, filters and choices are sheets; nested choices change the current sheet (same detent,
position and size) with a contextual back at its top.

## Requirement ledger

| ID | Requirement (notes line) | Implementation | Status | Verified | Platform | Dev |
|---|---|---|---|---|---|---|
| NEW-001 | Audit side panels / sheets / tabs app-wide; persistent → tab, contextual → sheet, nested → same sheet (L14) | Surface classification below; History / Settings requests always open their TABS (Shell `openMore`, More rows, caret, deep links, Color view); in-sheet views for Search → History, Tabs → Archive / Sessions, note Move, trail Sticky notes / Tags, session Icon; `ActionList` rows with `view` push instead of stacking | COMPLETE | Simulator: History / Archive / Sessions / Books open in the same sheet (1 sheet, same top) | iPhone | no |
| NEW-002 | Changing a sheet keeps its position / sizing (L22) | `Sheet.push` no longer changes the detent (`expand` removed everywhere); scroll memory per view | COMPLETE | Simulator: sheet top identical (332 px) before / after Archive, Sessions, History, Books | iPhone | yes (feel) |
| NEW-003 | Tabs sheet scrolls when half open (L16) | Sheet body scrolls at every detent (padded for the off-screen part); body drag moves the sheet only on a downward drag at scroll-top or an upward drag with nothing to scroll (decided on the native touchmove) | COMPLETE | Simulator: half-open Tabs sheet scrollable (scrollTop 400) | iPhone | yes |
| NEW-004 | Sessions and Workspaces are one concept; no second data system (L36) | Audit: `sessions` (live tab groups) vs `savedWorkspaces` (frozen snapshots) — two stores, the old iPhone "Workspaces" page listed snapshots. Terminology unified to the desktop's: **Sessions** (live) and **Saved sessions** (snapshots, desktop Settings section renamed); iPhone Sessions page lists live sessions (+ Saved sessions one level down); no data migration, IDs untouched | COMPLETE | Typecheck, vitest (src/mobile, src/store); simulator: Sessions view in the Tabs sheet | both | no |
| NEW-005A | KJV/LXX switch text flashes above the sheet (L18) | Double-buffered center pane: the outgoing text (same keyed DOM, same scroll) stays on top until the incoming one has loaded and restored its verse anchor; swap in one commit; 1.5 s safety release | COMPLETE | Simulator: held pane present while the new one is hidden, then swapped | iPhone | yes |
| NEW-005B | Switching to a text without the book leaves an empty Matthew 22 (L19) | `passageForTextBooks` (textCoverage, shared rule with desktop BiblePanel): missing book → text's first book, chapter 1; out-of-range chapter → clamped; applied when the new text's book list loads | COMPLETE | Simulator: MAT 22 → 1 Enoch → ENO 1 with 9 verses | both (shared helper) | no |
| NEW-005C | Fast chapter swipes get stuck between chapters (L20) | Pager transition policy: one chapter per accepted swipe; no new drag while settling (`dragListener` off), edge taps ignored; settle always completes (spring end or 450 ms guard — a stopped spring used to leave `settling` stuck); any chapter change resets the track | COMPLETE | Simulator (synthetic drags): overlapping swipes ignored, track always at rest, shown chapter = state chapter | iPhone | yes |
| NEW-006 | Less bottom padding under tabs / plus / caret (L23) | Bottom bar padding inside the home-indicator inset: `max(6px, safe-bottom − 12px)` (controls stay clear of the indicator) | COMPLETE | Simulator: caret 22 pt above the screen edge (was 42) | iPhone | yes |
| NEW-007 | Collapsed header merges with the notch / island, compact, all devices (L29) | `CompactPassageHeader`: a black shape joining the cutout — island (≥51 pt inset) grows downward, notch (40–50) extends, home-button devices get a small pill; book + chapter + LXX; tap → passage picker; status band stays opaque | COMPLETE | Simulator: iPhone 17 Pro (island, 126×71 at y 11) and iPhone 17e (notch, 164×65 at y 0) | iPhone | yes |
| NEW-008 | Slightly less top padding in the Scripture top bar (L30) | Reader header row 48 → 44 px (`--m-header-h` scoped to the reader) | COMPLETE | Simulator screenshot | iPhone | yes |
| NEW-009 | Strong's numbers ~1.5× (L25) | `.strongs-sup` / study / compare superscripts 0.7em → 1em (line box unchanged) | COMPLETE | Simulator screenshot | iPhone | yes (readability) |
| NEW-010 | Caret: no "Switch text" label on the KJV/LXX button (L26) | Tile = icon + target text; spoken label "Switch to the Septuagint / King James Version"; top bar forced shown with the caret (T23-014) | COMPLETE | Simulator | iPhone | no |
| NEW-011 | Book/chapter picker: Roman numerals; hierarchy (L27–28) | `PassagePicker`: Library → collection → book (testament groups) → chapter → optional verse, all in one sheet; search resolves collections ("LXX"), books and passages (`passageDestinations.ts`); used by the reader and Compare. Names fixed at the source: `bibleService.getBooks` → `displayBookName` (kjva/kjv DB store "III John") | COMPLETE | Unit tests; simulator: "1 Samuel", "3 John", LXX search, "psalm 23:1" | both (names) | no |
| NEW-012 | Collapse bottom buttons while scrolling down (L31) | `chromeState`: on the reader the bar overlays the text and slides away with the same hysteresis signal as the header; frozen while a sheet is open | COMPLETE | Simulator: `is-nav-collapsed`, bar translated out | iPhone | yes |
| NEW-013 | Floating search: no Compare, no Workspaces; recent scrolls + dismisses keyboard; compact icon buttons; smaller More (L35–39) | Plus sheet: one row of 44 pt icon buttons (VoiceOver labels), More is its last icon, recent list up to 12, touch-scroll blurs the input | COMPLETE | Simulator: 8 icons in a 44 pt row, no Compare / Workspaces | iPhone | yes (keyboard) |
| NEW-014 | Search caret: remove Scope; History changes the sheet (L41–42) | Scope row removed (the page's own switch); History = in-sheet `HistoryView` (shared `HistoryPage` module) | COMPLETE | Simulator: "‹ Search", same sheet top | iPhone | no |
| NEW-015 | Books filter: individual books, everywhere (L43) | Shared helpers (`scriptureSearchFilters.ts`: sections, summary, select/clear group); iPhone `BooksFilterView`; desktop Scope modal lists individual books with section select-all / clear | COMPLETE | Unit tests; simulator (iPhone) | both | no |
| NEW-016 | Tabs → Archive changes the sheet (L33) | `ArchiveView` pushed in the Tabs sheet; restore returns to the cards | COMPLETE | Simulator | iPhone | no |
| NEW-017 | macOS top bar: equal gaps above / below the controls (L11) | Toolbar vertically centred in the 52 px bar: 8 / 8 px (was 4 / 12), same centre line as the traffic lights | COMPLETE | Typecheck + build; not run in the app (developer's manual pass) | macOS | n/a |

## Surface classification (NEW-001)

| Surface | Kind |
|---|---|
| Scripture, Compare, Notes (list + editor), Search, History, Settings, Lexicon, YouTube, PDF, Tags graph | tabs |
| Caret (per tab), verse sheet, tab cards, plus / floating search, passage picker, Strong's entry from the text, audio player | sheets |
| All Translations, Font, Color, Tag chapter, Search filters (Text / Books / Verse tags), Search → History, Tabs → Archive / Sessions / tab actions / Move to session / New tab, note Status / Icon / Folder / Move, trail Sticky notes / Tags, session Icon, verse Notes / Cross refs / Tag / Strong's | sub-views of the current sheet |
| More (utilities: study trail, verse tags, read-aloud queue, PDF library, transcript packs, sessions, archive, diagnostics) | pages under More — a destination, not a panel over a tab |

## Physical-device pass
1. Tabs sheet half open: scroll the cards; hold-drag a card; flick down on the grabber to close.
2. Caret → All Translations → back, and Tabs → Archive → back: the sheet must not move or resize.
3. Scripture KJV ⇄ LXX from the caret: no flash above the sheet.
4. Rapid swipes forward / back / alternating: always lands on one chapter.
5. Scroll down: the passage joins your Dynamic Island / notch; the bottom bar slides away; scroll up returns both.
6. Bottom bar sits closer to the edge but clear of the home indicator.
7. Floating search: scroll the recent list → keyboard goes away.
