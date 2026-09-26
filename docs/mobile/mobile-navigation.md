# iPhone navigation (testing wave 2026-09-22 Wave 4; refined 2026-09-23)

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
Search, History, Settings) in the workspace's **unified display order** — the same order the Mac
sidebar shows (`sessionDisplayOrders` / `reorderTabDisplay`).

Each tab is a **card previewing its last state** (`src/mobile/tabs/TabPreview.tsx`): Scripture shows
the passage text from where the tab was being read (its verse anchor), Compare both columns, a note
its title and text, Search its query and scope, Lexicon the entry, YouTube the video thumbnail,
History the latest entries, Settings the current look. Previews are lightweight (the tab's own data,
cached for the session) — no screenshots, and rendering a card never touches the tab's state. The
only translation named on a card is **LXX** (KJV is the default) — T23-007.

Gestures (the card layer owns them — T23-005):

| Gesture | Result |
|---|---|
| tap | open the tab |
| × | close the tab |
| press and hold (≈0.4 s) | the card lifts (haptic) |
| … then drag | reorder — the other cards make room; drop writes the display order |
| … release without dragging | the tab's actions, inside the same sheet (‹ Tabs) |
| finger moves before the lift | ordinary scroll |

While a card is pressed nothing underneath can be text-selected, highlighted or given a callout.
There is no Reorder button (T23-008). VoiceOver gets an "Actions for …" button per card, and the
actions include Move earlier / Move later. The workspace chip, a workspace's actions and icon,
Move to workspace and the **New tab** card all open **inside this sheet** with "‹ Tabs" at the top
(T23-012). Every genuine tab type can have several independent instances; each tab has its own
navigation stack and keeps its own state (Search query/scope/filters and History filter live in the
tab; a Notes tab reopens its note) — T23-009.

## 2. Plus (bottom center)

A floating search sheet built for frequent Bible use (S1 screenshot). The query is classified
(`classifyNewTabQuery`): a reference ("John 3:16", "Psalm 23:1-6") → Open in a new Scripture tab
(or the current one) via the shared `navigateToVerse`; a Strong's number → Lexicon. While typing,
**"Search … in a new Search tab"** opens a DEDICATED Search tab (never reuses the current one) —
T23-010. With an empty query: one tile per **genuine tab type**, each creating a real, independent
tab — Scripture, Note, Today's daily note, Lexicon, YouTube, History, Settings, and Compare when the
current passage has an LXX ↔ KJV counterpart (T23-009); then navigation that is not a tab (More,
Workspaces), then recent history. There is no Search tile — a Search tab starts from what you type.

## 3. Caret (bottom right) — command registry

(Commands of kind `view` open **inside the caret** — see §5.)

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
| Scripture | tiles: Strong's (toggle), **KJV ⇄ LXX switch** (only where the other text has this passage — `compareCounterpart`), **Compare** (only where `compareApplicable`), Read aloud · Reading: **All Translations  ‹current› ›** (in-caret list), Text size, Line height, Font › (in-caret), Appearance (Auto/Light/Dark), Color › (in-caret, previews), Continuous scroll, Verse numbers, Red letter text · Study: cross-reference source (TSKe/Classic), Tag this chapter › (in-caret), Study trail · Share: copy reference, share chapter. Opening the caret shows the top bar. No Go to / translation tile / KJV-LXX segmented / ‹ › chapter rows / "Font, theme and more…" — the title is the passage search, edge taps and swipes change chapter |
| Compare | tiles: Strong's (both columns), **Sync Scrolling** (default on) · Swap sides, Exit compare |
| Notes list | tiles: New note, Today · Notes: Import Markdown, Export idioms (when present), New folder, All views (desktop layout) |
| Note editor | tiles: Pin, Share, Copy, Print / PDF · Note: Status › / Icon › / Move to folder › (in-caret; Move only for movable notes), version history, insert video timestamp (when a video is open), export Markdown, move to trash |
| Search | Search in: Scripture / Notes / Lexicon · Match: All / Any / Phrase · Scripture filters: Text ›, Books ›, Verse tags › (in-caret), Reset · Sort: order + direction · Clear search, History. (No filter button in the header — T23-013) |
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
| Tab grid | reorder mode | Tab cards → press, hold and drag a card |
| Tab grid | card tap / × / long-press actions (rename, duplicate, move up/down, move to workspace, archive, close others, close) | Tab cards — same actions |
| Workspaces sheet | switch / new / rename / icon / archive all / delete | Tab cards → workspace chip (inside the tab-cards sheet, ‹ Tabs) |
| Reader header | Translation (left icon) | Caret → KJV ⇄ LXX switch tile (where applicable), All Translations (in-caret); LXX named on the title |
| Reader header | Aa Reading options (text size, line height, theme, verse numbers, font, continuous scroll) | Caret → Reading group (inline; Font and Color in-caret) |
| Reader header | … → Show/Hide Strong's | Caret → Strong's tile |
| Reader header | … → Reading options | Caret → Reading group |
| Reader header | … → Previous / Next chapter | Edge taps; swipe; title (passage search) |
| Reader header | Title → Go to | Title (passage navigator) |
| Notes list header | … (import, idioms, new folder, desktop layout) | Caret → Notes group |
| Notes list header | + New note, Today | unchanged (dedicated header controls) + caret tiles |
| Note editor header | … (pin, status, icon, folder, versions, timestamp, copy, print, share, export, trash) | Caret (tiles + Note group) |
| Note editor header | Edit / View | unchanged (dedicated) |
| Compare header | … (Strong's, sync scroll, exit) | Caret → Strong's, Sync Scrolling, Swap sides, Exit compare |
| Compare header | ‹ › chapter, title → Go to | unchanged (dedicated); translation chips removed (LXX ↔ KJV only) |
| Search header | Filters | Caret → Match / Scripture filters / Sort (T23-013) |
| Verse long-press sheet | all verse actions | Verse sheet (tap a verse) — see post-migration-architecture.md §8 |

Nothing reachable before is unreachable now; `docs/mobile/testing-backlog-2026-09-22.md` records
the per-item verification.

### 4b. Removed 2026-09-23 → new home (nothing became unreachable)

| Removed | What it did | New home |
|---|---|---|
| Caret: Go to tile | open the passage picker | the reader title (tap) — passage search |
| Caret: translation tile | pick a text | caret → All Translations (in-caret, current text at right) |
| Caret: KJV / LXX segmented | switch KJV ⇄ LXX | one switch tile beside Strong's, only where the other text has the passage |
| Caret: Previous / Next chapter rows | change chapter | edge taps, swipe, title |
| Caret: "Font, theme and more reading options…" | font, theme, size, line height… | caret Reading group inline; Font and Color in-caret |
| Tab cards: Reorder button | reorder tabs | press, hold and drag a card; Move earlier / later in a card's actions |
| New Tab: Search tile | open a Search tab | type, then "Search … in a new Search tab" |
| New Tab: History / Settings rows (pages) | open History / Settings | History / Settings tiles create real tabs; More still lists both |
| Search header: filter button | open the filter sheet | Search caret → Match / Scripture filters / Sort |
| Compare: Add text, Go to, "(KJVA+)" / column chips | pick more texts | Compare is LXX ↔ KJV only; title = passage picker |
| More: Lexicon / YouTube rows | open those spaces | plus sheet tiles; Strong's → Open in Lexicon; search results |

## 5. Sheets are navigable surfaces (2026-09-23)

Berean iPhone is one navigation system: **Tab cards → Tab → Caret → current Sheet → sub-view in the
same sheet → back**. When a control inside a sheet shows another view of the same context, the SAME
sheet replaces its content (slide forward) and shows a contextual back control at its top — "‹
Scripture", "‹ Tabs", "‹ Genesis 1:3" — that returns to the previous view (slide back), keeping the
parent's scroll position. No second sheet is stacked (T23-006/012/019).

API (`src/mobile/primitives/Sheet.tsx`): `api.push({ key, title, render, expand? })`, `api.pop()`,
`api.popToRoot()`, `api.depth`, `useSheetApi()`; sheet option `rootTitle` names the root view for the
back label. Reusable bodies: `ChoiceList` (single choice with a check) and `actionListView` (action
rows; a row with `view` goes one level deeper). Caret commands of kind `view` push a nested command
scope or a custom body.

Where it is used: caret → All Translations / Font / Color / Tag chapter; Search caret → Text /
Books / Verse tags; note caret → Status / Icon / Folder; verse sheet → Notes / Cross references /
Tag / Strong's entry, and the several-verse view (T23-028); tab cards → Workspaces → workspace
actions → Icon, tab actions → Move to workspace, New tab.

Still separate sheets (genuinely separate surfaces): the plus sheet from the bottom bar, the caret,
the tab cards, the verse sheet, a Strong's number tapped in the reader text itself, the audio
player, and single sheets opened from a page (selection bar, lexicon search results).

## 6. Verse selection and the verse sheet (2026-09-23)

Tap adds a verse to the selection, tap a selected verse removes it (`toggleVerseInSelection`,
contiguous or not; a selection in another text — the other Compare column — starts over). One verse
→ the verse sheet's study view; several → the same sheet, same height, shows the several-verse view
(combined "John 3:6-7, 18", highlight all, copy in the shared multi-verse format, tag, play, clear).
Drag-select from verse numbers is unchanged. The study view no longer prints "(KJVA+)"; Strong's
superscripts are 0.7em in the reader, the study view and Compare (T23-027/029).

## 7. Second 09-23 round (docs/mobile/testing-backlog-2026-09-23b.md)

- **Sheets keep their position**: a pushed view never changes the detent; content scrolls at every
  detent (the half-open Tabs sheet scrolls); a body drag moves the sheet only when the content can't
  scroll in that direction.
- **History and Settings are tabs** everywhere: any request for them opens or focuses the tab.
- **Plus / floating search**: one row of icon buttons (Scripture, Note, Today, Lexicon, YouTube,
  History, Settings, More); no Compare or Workspaces; recent list scrolls and dismisses the keyboard.
- **Passage picker** (title of the reader and Compare): Library → collection → book → chapter →
  optional verse in one sheet; search understands "LXX", book names and references.
- **Sessions** is the one name for live tab groups (the desktop's term); snapshots are **Saved
  sessions**. Tabs → session chip → Sessions view; Tabs → archive icon → Archived tabs view.
- **Search caret**: no Scope row; History opens in the caret; Books = individual books.
- **Reader chrome**: scrolling down collapses the header into a compact pill joined to the Dynamic
  Island / notch and slides the bottom controls away (same hysteresis); tap the pill for the picker.

## Caret header and tab history (2026-09-24)

Every caret opens with a location field (the current passage / note / query; tapping it opens
that tab's finder — the passage picker, note finder or search field — inside the same sheet) and
‹ › buttons that step through the **current tab's** history (the shared per-tab navigation
stacks the desktop uses). The reader caret's tiles are Find on Page · Strong's · KJV/LXX · Read
aloud; Compare and All Translations sit below; Display options are an inline disclosure. The
study-trail "Why did you go to…" prompt is not shown on iPhone. Destination map and gesture
ownership: [testing-backlog-2026-09-24.md](testing-backlog-2026-09-24.md).

## 8. Bible-first pass (2026-09-25)

Principles, the interaction-depth audit, the before/after map and the feature-placement matrix:
[../ux-principles.md](../ux-principles.md); ledger: [testing-backlog-2026-09-25.md](testing-backlog-2026-09-25.md).

- **⌘L vs ⌘T.** Every caret's field (`CaretGoTo`) navigates the CURRENT tab with the same
  destinations as the plus (⌘T, new tab). Actions inside a tab change that tab (Compare this
  verse / caret Compare, results, history rows); a new tab is always explicit (long-press → Open
  in New Tab).
- **Per-tab history.** `tabNavStacks` entries now carry `state` snapshots and `home` steps;
  `restoreTabNavEntry` (store) is the single restore path for back and forward. Notes: list /
  folder / filter and each note; Search: query / scope / filters (+ scroll); Settings: section;
  Scripture: text, passage, verse, scroll, Compare on/off.
- **Verse sheet.** Compact: reference · Notes · Strong's · Refs · Copy · colours. Strong's toggles
  the remembered Brief / Strong's mode; dragging up is Expanded. Notes are edited inside the sheet.
- **Picker.** A chapter tap moves Scripture immediately and shows that chapter's verses (sheet at
  medium); a verse or dismissing finishes.
- **Bottom controls** float over every tab; Scripture and Compare collapse them while reading.

## 9. Floating controls and tab types (2026-09-25 v2)

Ledger: [testing-backlog-2026-09-25b.md](testing-backlog-2026-09-25b.md).

- **Top-left switcher** changes what the CURRENT tab is (Scripture, Notes, Today, Lexicon,
  YouTube, Search, History, Settings — never the current type). `transformTab` keeps the tab's
  slot and carries its history; ‹ returns to the previous type and state. Typing an experience
  name ("notes", "history") in the caret does the same; in the plus it opens a new tab.
- **Top-right audio button** (while audio is active) opens the audio sheet; the floating
  play/pause sits above the bottom controls. Page headers keep clear of both through
  `html[data-floating-left|right]`.
- **Bottom controls** collapse on scroll on every tab (`pageCollapsed`), Scripture views drive it
  themselves.
- **Sheets:** a drag that moves the sheet owns the whole touch (direction reversals included);
  below the top detent an upward drag expands the sheet first.
- **Notes:** the phone editor has no permanent format bar — selection bubble, markdown, and a
  floating + for inserts; the editor is never fed its own saves (no lost keystrokes).
