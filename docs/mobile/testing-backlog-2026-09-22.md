# Testing backlog — 2026-09-22 validation pass

Source: the developer's personal testing notes `September 22, 2026 – Testing.md` (kept outside the
repository, in `~/Downloads/September 22, 2026 – Testing/`) and its four screenshot attachments.
The notes file itself is **not** copied here and is not the permanent backlog; future passes get
their own notes and their own backlog file. This file converts every line of the 2026-09-22 notes
into a tracked requirement (TEST-xxx) and records its outcome.

The migration ledger (`requirements.md`, R001–R143) and its architecture stay authoritative;
this backlog adds post-migration bugs, UX requirements and refinements on top.

Screenshots are **not** committed. `docs/` is the public GitHub Pages site, and screenshot 1
shows personal browser history. What each one shows:

| # | File (in the notes' `_attachments` folder) | Shows | Used for |
|---|---|---|---|
| S1 | `Screenshot 2026-09-22 at 21.50.59.png` | Arc mobile: a floating search sheet over the page (search field, then recent pages/searches), keyboard up | TEST-032 plus / new-tab surface |
| S2 | `Screenshot 2026-09-22 at 21.54.21.png` | Arc mobile page-actions sheet: a URL/nav row, then four large action tiles (Find on Page, Summarize, Pin, Share), grouped rows (Display Options ▾, Translate, Reader Mode, Page Zoom − +, Request Desktop Site), then Site Settings | TEST-033 caret sheet structure (tiles for frequent actions, grouped rows, inline steppers) |
| S3 | `Screenshot 2026-09-22 at 21.54.42.png` | Arc mobile bottom bar: tab-cards thumbnail stack at bottom **left**, a wide "+" capsule in the **centre**, a circular upward caret at bottom **right** | TEST-030/031/032/033 bottom navigation |
| S4 | `Screenshot 2026-09-22 at 22.03.20.png` | e-Sword iPhone: Genesis 1, compact verses (verse number flush left, text ~full width), selected verse tinted; a lower split pane with the selected verse as "(KJV+)" with superscript Strong's numbers (H7225, H430…) and underneath its cross references as a dense comma-separated link list | TEST-043/044 compact study presentation |

Status values: `OPEN` · `IN PROGRESS` · `COMPLETE` · `SUPERSEDED` (replacement named) · `BLOCKED` (reason named).
Columns **S / D / P** = affects shared code / desktop / iPhone.

---

## Shared

| ID | Original observation (verbatim) | Platform | Category | Implementation location | Status | Test coverage | S | D | P | Notes / deviations |
|---|---|---|---|---|---|---|---|---|---|---|
| TEST-001 | "allow the user to drag from one verse number to other verses and it selects the entire range" / "this must include some selection indicator during the drag" | Shared | Scripture selection | `src/lib/verseSelection.ts`, store `beginVerseDrag/updateVerseDrag/endVerseDrag`, `components/bible/verseDragSelect.ts`, `VerseRow` badge, `VerseDragIndicator` (both shells) | COMPLETE (desktop gesture verified by tests; iPhone device check in Wave 3) | `lib/__tests__/verseSelection.test.ts` (17: forward/backward/single/multi/cancel, mouse + touch gesture) | ✔ | ✔ | ✔ | Live range = selection state (consumable by every action); post-migration-architecture.md §2 |

## macOS

| ID | Original observation (verbatim) | Platform | Category | Implementation location | Status | Test coverage | S | D | P | Notes / deviations |
|---|---|---|---|---|---|---|---|---|---|---|
| TEST-002 | "the history modal doesnt filter correctly. when i click scripture filter, there are no options and i think the other options are missing many items too" | macOS (+ iPhone History page) | Bug · history | `src/lib/historyModel.ts`; `HistoryModal.tsx`; iPhone `HistoryPage` (MobileApp.tsx) | COMPLETE | `lib/__tests__/historyModel.test.ts` (each category, study-only, paging) | ✔ | ✔ | ✔ | Root causes: Study-only hid every Scripture visit; paging stopped under any filter; imports had no category — §3 |
| TEST-003 | "i "ctrl+tab" back to a tab and it didnt remember my scroll position" | macOS | Bug · scroll state | `store/index.ts` setActiveTab (commit from post-flush state); `BiblePanel.tsx` onSave ignores hidden panel | COMPLETE (reproduced + verified in the running desktop app via CDP) | in-app Ctrl+Tab repro (space↔space, scripture↔scripture); full vitest | ✔ | ✔ | ✔ | Two root causes — §4 |
| TEST-004 | "presenter view/outline currently doesnt scroll the outline to the verse that the search/cross ref/etc goes to" | macOS | Bug · presenter | — | OPEN | — | | ✔ | | |
| TEST-005 | "when the side panel is open on the notes tab, the dropdown for by verse/modified/created is not aligned with the button" | macOS | Bug · notes panel | — | OPEN | — | | ✔ | | |
| TEST-006 | "the change layout menu that pops up is showing the layout options needs to show above everything (side panel/"..." menu)" | macOS | Bug · layering | — | OPEN | — | | ✔ | | Fix the stacking model, not ad-hoc z-index |
| TEST-007 | "when selecting multiple verses, it doesnt make sense to add a note to all those verses, disable that" | macOS (+ iPhone selection bar) | Bug · selection actions | `selectionAllows(sel, add-note)` in `VerseSelectionBar.tsx` (disabled + label) and iPhone `SelectionBar.tsx` (hidden) | COMPLETE | `verseSelection.test.ts` (add-note/notes/cross-refs single-only) | ✔ | ✔ | ✔ | Single-verse note creation unchanged |
| TEST-008 | "when i have the side panel open and scroll through the cross refs tab (or any of the tabs probably), the scroll position doesnt save again for when i switch tabs" | macOS | Bug · scroll state | `src/hooks/useKeyedScrollMemory.ts`; `BibleRightPanel.tsx` (`data-scroll-key` per sub-tab); tab local fields `rightPanelScrollTops(B)` | COMPLETE (verified in-app: 700 → hidden 0 → restored 700) | `hooks/__tests__/useKeyedScrollMemory.test.tsx` (4, incl. local-not-synced) | ✔ | ✔ |  | Device-local only (LOCAL_FIELDS) — §4 |
| TEST-009 | "when i click a cross ref when already on septuagint to a verse in the new testament, it needs to go back to the kjv because the new testament doesnt have septuagint (i supposed this would apply to iPhone as well)" | Shared | Bug · navigation | `src/lib/textCoverage.ts` → `navigateToVerse` | COMPLETE | `lib/__tests__/textCoverage.test.ts` (LXX→NT, LXX→OT, KJV→NT, missing book, override) | ✔ | ✔ | ✔ | Shared: desktop + iPhone; LXX kept in scriptureBack — §1 |
| TEST-010 | "bigger padding above and below the buttons and such in the top bar" | macOS | Change · chrome | — | OPEN | — | | ✔ | | Change the bar metric once, not per button |
| TEST-011 | "if i click the the "month year" in the calendar in the sidebar, it should open a menu to quickly flip between the years and months" | macOS | Change · calendar | — | OPEN | — | | ✔ | | |
| TEST-012 | "in the session menu that pops up when clicking the session in the top left, instead of showing the space for the checkmark, highlight the session item instead" | macOS | Change · menus | — | OPEN | — | | ✔ | | |
| TEST-013 | "when the floating search is open and the user right clicks one of the options, show a menu to either open, open in new tab, open in floating tab" | macOS | Change · floating search | — | OPEN | — | | ✔ | | Reuse existing open paths |
| TEST-014 | "the selection menu that pops up when selecting text across several verses should have the same background as when selecting text in a singular verse" | macOS | Change · selection menu | — | OPEN | — | | ✔ | | |
| TEST-015 | "a similar background fix is needed for the cross refs that cite a chapter when hovering on those options at the top of the chapter" | macOS | Change · cross refs | — | OPEN | — | | ✔ | | |
| TEST-016 | "all the highlight options for when selecting across several verses or in a singular verse should be two rows instead of three or one" | macOS | Change · highlight palette | — | OPEN | — | | ✔ | | One layout for both modes |
| TEST-017 | "the "..." menu that opens, there is some blank space on the left of that, push everything to the left so its left aligned and no blank space on the sides" | macOS | Change · menus | — | OPEN | — | | ✔ | | |
| TEST-018 | "instead of showing a check when selected, highlight the option" ("..." menu) | macOS | Change · menus | — | OPEN | — | | ✔ | | Same semantic state (aria-checked kept) |
| TEST-019 | "if i select text across several verses, include an option in the menu to select verses for quick multiple verse selection" | macOS | Change · selection | — | OPEN | — | ✔ | ✔ | | Uses the TEST-001 selection model |
| TEST-020 | "if the user selects verse(s), in the side panel notes tab, adjust the filter for those verses" | macOS | Change · notes panel | — | OPEN | — | ✔ | ✔ | | Driven by the selection state itself |
| TEST-021 | "make the roundness of the "all scripture" dropdown button the same roundness as the rest of the buttons" (Advanced scripture search tab) | macOS | Change · controls | — | OPEN | — | | ✔ | | |

## iPhone

| ID | Original observation (verbatim) | Platform | Category | Implementation location | Status | Test coverage | S | D | P | Notes / deviations |
|---|---|---|---|---|---|---|---|---|---|---|
| TEST-022 | "it seems that tab types are being separated when they should all be grouped in the same workspace" | iPhone | Bug · tabs | — | OPEN | — | | | ✔ | Tab UI = view of the shared session model |
| TEST-023 | "continuous scroll toggle removes all text" | iPhone | Bug · reader | — | OPEN | — | | | ✔ | |
| TEST-024 | "line height setting isnt doing anything" | iPhone | Bug · reader | `src/hooks/useBibleLineHeight.ts` mounted by App.tsx and MobileApp.tsx | IN PROGRESS (fix landed; simulator check in Wave 3) | typecheck; simulator check pending | ✔ |  | ✔ | Root cause: the CSS variable was only set by desktop App.tsx |
| TEST-025 | "when i switch to a book that doesn't have the chapter, it should switch to the first chapter of that book instead of trying to find that chapter in the other book" | Shared | Bug · navigation | `chapterForBookSwitch` in `navigateToVerse` + iPhone ReaderPage guard (real chapter count) | COMPLETE | `textCoverage.test.ts` (Ruth 50 → 1, valid kept, loaded-count wins) | ✔ | ✔ | ✔ | Hermas excluded (own numbering) |
| TEST-026 | "remove the 'x' close buttons from the bottom sheets because they all can be dismissed from tapping the empty space" | iPhone | Change · sheets | — | OPEN | — | | | ✔ | X only at the verse low detent (TEST-040) |
| TEST-027 | "give the sheets a slightly taller drag region so its easier for the user to intentionally grab" | iPhone | Change · sheets | — | OPEN | — | | | ✔ | |
| TEST-028 | "search icon should most times be in the top bar so the user can get a floating search most of the top" | iPhone | Change · navigation | — | OPEN | — | | | ✔ | Superseded by the brief's three-control navigation (plus = search/creation) |
| TEST-029 | "when the user starts scrolling down, hide the top bar" | iPhone | Change · chrome | — | OPEN | — | | | ✔ | Hysteresis; reappears on scroll up |
| TEST-030 | "remove the entire current bottom bar (the tab part and the icons below)" | iPhone | Change · navigation | — | OPEN | — | | | ✔ | Functions keep a home (§ mapping in `mobile-navigation.md`) |
| TEST-031 | "instead of showing tabs at the bottom, show a little icon in the bottom right to open the preview cards of all the tabs like mobile Arc" | iPhone | Change · tab previews | — | OPEN | — | | | ✔ | Placement follows the brief + S3: tab cards bottom **left** (the note says right; the implementation brief and the Arc screenshot place it left, caret right) |
| TEST-032 | "in the middle there should be a plus icon like Arc that will open a floating search in a sheet thing that will show like the image below to open a new tab. there should also be separate buttons to just open a new scripture tab, notes tab, lexicon tab, youtube tab, more tab, settings, etc (iron this out more)" | iPhone | Change · new tab | — | OPEN | — | | | ✔ | S1 |
| TEST-033 | "to the right of that plus should be a caret that should some of the options that were in the "..." and in the "reading/Aa" menus (those two buttons would be eliminated) … the structure in the caret sheet needs to be a lot better" | iPhone | Change · commands | — | OPEN | — | | | ✔ | S2; contextual per tab type |
| TEST-034 | "translation picker should probably be quickly in that caret thing too" | iPhone | Change · commands | — | OPEN | — | | | ✔ | |
| TEST-035 | "allow the user to tap anywhere on a verse to select it instead of just the verse number" | iPhone | Change · reader | — | OPEN | — | | | ✔ | |
| TEST-036 | "the verse numbers should be a lot closer to the left and the scripture should cover like 90% of the horizontal space on the phone" | iPhone | Change · reader density | — | OPEN | — | | | ✔ | |
| TEST-037 | "allow to click on the far left or right to move back/forward between chapters" | iPhone | Change · reader | — | OPEN | — | | | ✔ | Coexists with the swipe pager |
| TEST-038 | "strongs numbers feel a little crowded or just not distinct enough" | iPhone | Change · Strong's | — | OPEN | — | | | ✔ | |
| TEST-039 | "long press on verse should allow me to select text of part of the verse instead of opening the sheet fully immediately; the sheet should show at the lowest position while i am adjusting my selection, but if i tap anywhere besides the selected text, it should deselect and make sure it doesnt now select the entire verse or a different verse yet. just a normal single tab should select a verse and then a sheet should appear at the lowest position (but it should cover the button buttons so its still visible)" | iPhone | Change · selection | — | OPEN | — | | | ✔ | Interpretation of the last clause: the low sheet sits **over** the bottom navigation controls so the sheet itself stays fully visible |
| TEST-040 | "based on this, there should be an additional position for probably most sheets that puts the sheet near the bottom but still open. when the sheet is at the bottom position, only then should there be an 'x' button at the right for quick closing. still swiping quickly down when the sheet is in a bigger state should close the sheet. the caret sheet doesnt get this lower position though, neither does the tab sheet. really, this other position for the sheet should only be for verse related things i think so far" | iPhone | Change · sheets | — | OPEN | — | | | ✔ | Configurable per sheet |
| TEST-041 | "clicking on the book/chapter at the top should feel like a floating search to go to any book and chapter and verse(s) i want to. it should filter from everything available that is scripture and show the full book names. this would edit the current tab" | iPhone | Change · navigation | — | OPEN | — | ✔ | | ✔ | |
| TEST-042 | "there should be a copy button for the lexicon sheet that pops up when clicking a strongs number" | iPhone | Change · Strong's | — | OPEN | — | | | ✔ | Desktop copy semantics |

## Ideas / Other

| ID | Original observation (verbatim) | Platform | Category | Implementation location | Status | Test coverage | S | D | P | Notes / deviations |
|---|---|---|---|---|---|---|---|---|---|---|
| TEST-043 | "On the phone, I would like a similar way to view the scripture and have the strongs numbers (if applicable) and cross refs like esword (cross refs may be pickable between the different versions)" | iPhone | Change · study presentation | — | OPEN | — | | | ✔ | S4 |
| TEST-044 | "Also use the compactness from the image" | iPhone | Change · reader density | — | OPEN | — | | | ✔ | S4 |
