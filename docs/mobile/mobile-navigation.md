# iPhone navigation (testing wave 2026-09-22, Wave 4)

The persistent bottom space bar, the tab pill and the per-page "…" / "Aa" / translation controls
are replaced by **three persistent controls**, visible on every tab type (Scripture, Compare, PDF,
Notes, tags graph, Lexicon, YouTube, Search) and on More / Settings:

| Position | Control | Opens |
|---|---|---|
| bottom LEFT | Tab cards (stack + count) | `TabCardsSheet` — every tab of the current workspace |
| bottom CENTER | Plus | `NewTabSheet` — open / search / create |
| bottom RIGHT | Upward caret | `CaretSheet` — the commands of what is on screen |

A horizontal swipe across the bar steps to the previous / next tab of the workspace. There is
**no fourth global control**: the earlier note "search icon should most times be in the top bar"
(TEST-028) is superseded — search lives in the plus surface, and the reader's title is its own
passage navigator. The bar hides while the keyboard is up; verse sheets at their low position
cover it (TEST-039).

Files: `src/mobile/navigation/BottomNav.tsx`, `src/mobile/navigation/NewTabSheet.tsx`,
`src/mobile/tabs/TabCardsSheet.tsx`, `src/mobile/commands/{caretRegistry.ts,CaretSheet.tsx,staticCommands.ts}`,
`src/mobile/navigation/shellNav.ts`, `src/mobile/MobileApp.tsx` (`Shell`, `useShellSheets`, `MorePage`).

## 1. Tab cards (bottom left)

A view of the shared tab / session model, not a data model of its own. It lists **every tab of the
current workspace, all types together** (Scripture, Compare, PDF, Note, Tags, Lexicon, YouTube,
Search) in space order then tab order — the old grid showed only the current space's tabs, which
read as a separate workspace per type (TEST-022). Tap → switch (any space); × → close; long-press →
tab actions; header: workspace switcher, Reorder (within each type — tab order is per type, as on
desktop), Archived tabs; a New tab card opens the plus surface.

## 2. Plus (bottom center)

A floating search sheet built for frequent Bible use (S1 screenshot). The query is classified
(`classifyNewTabQuery`): a reference ("John 3:16", "Genesis 1", "Romans 8:28", "Psalm 23") →
Open in a new Scripture tab (or the current one) via the shared `navigateToVerse`; a Strong's
number → Lexicon; anything else → Search. With an empty query: tiles for each top-level tab type
(Scripture, Note, Today's daily note, Lexicon, YouTube, Search), then navigation (More, History,
Workspaces, Settings), then recent history.

## 3. Caret (bottom right) — command registry

`caretRegistry` holds registrations from mounted pages; **the most recently mounted page wins**
(a pushed note editor takes over from the notes list and hands back on pop). A page registers with
`useCaretCommands(() => scope)`; the builder is read lazily when the caret opens, so values are
current. Pages without their own registration (the hosted Lexicon / YouTube / PDF / tags panels)
use `staticCaretScope(space, tab)` — one provider per tab type. No component branches on tab type.

A scope is `{ title, subtitle?, sections[] }`; a section is `tiles` (the few most frequent
actions, Arc-style — S2 screenshot) or a titled group of rows; a command is an action, toggle,
stepper or segmented control. Inline controls keep the caret open so several reading settings can
be changed at once; actions that open something close it. Existing action-sheet definitions are
reused through `fromSheetActions` (not re-implemented). The caret has **no low detent**.

| Context | Caret contents |
|---|---|
| Scripture | tiles: Translation (current), Go to, Strong's (toggle), Read aloud · Reading: KJV/LXX quick switch, All translations…, Text size, Line height, Continuous scroll, Verse numbers, Red letter text, Font/theme/more… · Navigate: previous / next chapter, Compare translations · Study: cross-reference source (TSKe/Classic), Tag this chapter, Study trail · Share: copy reference, share chapter |
| Compare | tiles: Go to, Add text · Compare: Strong's toggle, sync scroll on Mac, exit compare |
| Notes list | tiles: New note, Today · Notes: Import Markdown, Export idioms (when present), New folder, All views (desktop layout) |
| Note editor | tiles: Pin, Share, Copy, Print / PDF · Note: status, icon, folder, version history, insert video timestamp (when a video is open), export Markdown, move to trash |
| Search | Search in: Scripture / Notes / Lexicon · Scripture results: Filters…, Sort, Reset filters · Clear search, History |
| Lexicon | tiles: Open number, Copy entry (desktop copy semantics), In Scripture · Copy Strong's number, New lexicon tab |
| YouTube | YouTube settings, Transcript packs, New YouTube tab |
| PDF | PDF library, New Scripture tab |
| Tags graph | Back to notes, New note |
| More | Back to the current tab, Settings, History |

## 4. OLD LOCATION → NEW LOCATION (every action of the previous mobile UI)

| Old location | Action | New location |
|---|---|---|
| Bottom space bar | Scripture | Tab cards (any Scripture tab) · Plus → Scripture tile |
| Bottom space bar | Notes | Tab cards · Plus → Note tile / Today tile |
| Bottom space bar | Search | Plus → search field / Search tile |
| Bottom space bar | More | Plus → More (More page keeps every row: Lexicon, YouTube, Transcript packs, Verse tags, Study trail, Read Aloud queue, History, Workspaces, Archived tabs, PDF library, Settings, Diagnostics) · caret → More actions |
| Tab pill | current tab title / tab count | Tab cards control (count) + the page title |
| Tab pill | tap → tab grid | Tab cards control |
| Tab pill | horizontal swipe → adjacent tab | Horizontal swipe across the bottom bar |
| Tab pill | + new tab of the space's type | Plus → type tiles; Tab cards → New tab card |
| Tab grid | workspace switcher chip | Tab cards header chip (unchanged sheet) |
| Tab grid | reorder mode | Tab cards → Reorder |
| Tab grid | card tap / × / long-press actions (rename, duplicate, move up/down, move to workspace, archive, close others, close) | Tab cards — same actions |
| Workspaces sheet | switch / new / rename / icon / archive all / delete | unchanged, from Tab cards → workspace chip |
| Reader header | Translation (left icon) | Caret → Translation tile, KJV/LXX quick switch, All translations…; also shown on the title |
| Reader header | Aa Reading options (text size, line height, theme, verse numbers, font, continuous scroll) | Caret → Reading group (inline); font/theme via "Font, theme and more reading options…" (same sheet) |
| Reader header | … → Show/Hide Strong's | Caret → Strong's tile |
| Reader header | … → Reading options | Caret → Reading group |
| Reader header | … → Previous / Next chapter | Caret → Navigate; edge taps; swipe |
| Reader header | Title → Go to | Title (new passage navigator) · Caret → Go to |
| Notes list header | … (import, idioms, new folder, desktop layout) | Caret → Notes group |
| Notes list header | + New note, Today | unchanged (dedicated header controls) + caret tiles |
| Note editor header | … (pin, status, icon, folder, versions, timestamp, copy, print, share, export, trash) | Caret (tiles + Note group) |
| Note editor header | Edit / View | unchanged (dedicated) |
| Compare header | … (Strong's, sync scroll, exit) | Caret → Compare group |
| Compare header | ‹ › chapter, title → Go to, translation chips | unchanged (dedicated) |
| Search header | Filters | unchanged (dedicated) + caret |
| Verse long-press sheet | all verse actions | Verse sheet (tap a verse) — see post-migration-architecture.md §8 |

Nothing reachable before is unreachable now; `docs/mobile/testing-backlog-2026-09-22.md` records
the per-item verification.
