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
| T23-001 | "the top of the youtube tab is scrunched and there isnt enough room" | iPhone | | OPEN | | | | ✔ | |
| T23-002 | "the top of the lexicon tab is scrunched and there isnt enough room" | iPhone | | OPEN | | | | ✔ | |
| T23-003 | "enabling continuous scroll makes all the text in the scripture disappear" | iPhone (+ desktop latent) | | OPEN | | ✔ | | ✔ | |
| T23-004 | "which i switch text when the sheet is open, the text shows above the sheet for a moment" | iPhone | | OPEN | | | | ✔ | |
| T23-005 | "when i hold my finger on a tab, the other menu shows but it also selects text/background or whatever. that shouldn't be possible" | iPhone | | OPEN | | | | ✔ | |

## iPhone — Changes

| ID | Original observation (verbatim) | Platform | Implementation | Status | Verified | S | D | P | Notes |
|---|---|---|---|---|---|---|---|---|---|
| T23-006 | "when i click buttons at different places on a sheet, i dont like that a different panel pops up instead of just editing the current sheet" | iPhone | | OPEN | | | | ✔ | |
| T23-007 | Tabs: "the tabs should show lxx (or nothing)" | iPhone | | OPEN | | | | ✔ | |
| T23-008 | Tabs: "remove the 'reorder' button and instead allow reordering tabs from how they are" | iPhone | | OPEN | | | | ✔ | |
| T23-009 | Tabs: "when opening the new tab menu, all the options should open legit new tabs (i.e., a dedicated history tab, a dedicated settings tab, etc). not everything should have a tab" | iPhone (+ desktop fallback) | | OPEN | | ✔ | ✔ | ✔ | |
| T23-010 | Tabs: "from the new tab sheet, remove the 'search' button, and instead, if applicable, when typing show a button to open in a dedicated search tab" | iPhone | | OPEN | | | | ✔ | |
| T23-011 | Tabs: "in the tabs sheet, i am not getting the feeling that these are like Arc with the cards" | iPhone | | OPEN | | | | ✔ | |
| T23-012 | Tabs: "clicking the session shouldn't open a new sheet, instead it should change the look of the current sheet or show the option to go back to tabs (this back thing should happen whenever the sheet is changed)" | iPhone | | OPEN | | | | ✔ | |
| T23-013 | Advanced scripture search tab: "remove the filter button at the top right and all the relevant filter things should be in the caret menu, make sure there is clear structure" | iPhone | | OPEN | | | | ✔ | |
| T23-014 | Scripture tab: "when i open the caret menu, show the top bar" | iPhone | | OPEN | | | | ✔ | |
| T23-015 | Scripture caret: "remove the 'go to' button" | iPhone | | OPEN | | | | ✔ | |
| T23-016 | Scripture caret: "remove the button to the left of the 'go to' button that is translation" | iPhone | | OPEN | | | | ✔ | |
| T23-017 | Scripture caret: "remove the part that switches between kjv/lxx and instead have a single button next to the 'strongs' button that shows to switch to kjv or lxx, whichever is applicable and only show the button for applicable book (i.e., not new testament and not a lot of some of the other books)" | iPhone | | OPEN | | ✔ | | ✔ | |
| T23-018 | Scripture caret: "remove the previous chapter and next chapter buttons" | iPhone | | OPEN | | | | ✔ | |
| T23-019 | Scripture caret: "when clicking the "all translations" button, it should change the sheet instead of opening a new one" | iPhone | | OPEN | | | | ✔ | |
| T23-020 | Scripture caret: "on this button, show the current translation somehow to the right of the 'all translations' text" | iPhone | | OPEN | | | | ✔ | |
| T23-021 | Scripture caret: "remove the 'font, theme and more reading options...' and instead if some of those options arent in the current sheet, then add them" | iPhone | | OPEN | | | | ✔ | |
| T23-022 | Compare: "it should split vertically with one chapter on the left and another on the right" | iPhone | | OPEN | | | | ✔ | |
| T23-023 | Compare: "the user should only be able to compare lxx and kjva for now and only for chapters that actually allow that comparison" | iPhone | | OPEN | | ✔ | | ✔ | |
| T23-024 | Compare: "scroll sync in the sheet should read differently; it especially shouldn't say "on mac"" | iPhone | | OPEN | | | | ✔ | |
| T23-025 | Compare: "there shouldn't be a 'add text' button nor 'go to' button" | iPhone | | OPEN | | | | ✔ | |
| T23-026 | Compare: "the strongs should show strongs numbers for both sides" | iPhone | | OPEN | | | | ✔ | |
| T23-027 | "make the strongs numbers slightly bigger" | iPhone | | OPEN | | | | ✔ | |
| T23-028 | "when i have one verse selected and i click another verse it should add that verse to the selection. clicking a verse that is already selected should deselect it" | iPhone | | OPEN | | ✔ | | ✔ | |
| T23-029 | "in the sheet, remove the '(KJVA+)' text" | iPhone | | OPEN | | | | ✔ | |
| T23-030 | Notes tab: "holding on a note in the list should show a menu to either delete or move (only move the note if applicable because some notes shouldn't be able to be moved)" | iPhone (+ desktop check) | | OPEN | | ✔ | ✔ | ✔ | |
| T23-031 | More section: "remove the lexicon, youtube space buttons" | iPhone | | OPEN | | | | ✔ | |
| T23-032 | Settings: "'colour preset' should be spelled with 'color' instead of 'colour'" | iPhone (+ desktop strings) | | OPEN | | | ✔ | ✔ | |
| T23-033 | Settings: "in the color presets, show a preview for each" | iPhone | | OPEN | | | | ✔ | |
| T23-034 | Settings: "allow the user to specifically customize the text color and the background color" | iPhone + desktop | | OPEN | | ✔ | ✔ | ✔ | |

## Ideas / Other

| ID | Original observation (verbatim) | Platform | Implementation | Status | Verified | S | D | P | Notes |
|---|---|---|---|---|---|---|---|---|---|
| T23-035 | "i think there is some numbering that is off in the recognitions of clement in book 3 i think" | Shared (data) | | OPEN | | ✔ | ✔ | ✔ | |
