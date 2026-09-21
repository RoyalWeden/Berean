# Berean Desktop — Feature Inventory (Lane B: Shell / Bible Reader / Search / Lexicon / Settings / Commands / Gestures / Theming)

Read-only audit of `/Users/roywe/Berean-ios` (branch `feature/ios-app`) for iOS/Capacitor planning.
Scope per assignment: shell & navigation, Bible reader, search, lexicon, settings, keyboard
shortcuts/commands, gestures, theming, plus one-line pointers into notes/audio/YouTube/AI/PDF
(owned in depth by the other audit lane) and clipboard/sharing. Every feature row cites its entry
file:line and the `window.*` bridge call it makes, or "store-only" when it never leaves the
renderer.

Foundational types referenced throughout (`src/types/index.ts`):
- `SpaceId = 'scripture' | 'notes' | 'lexicon' | 'youtube' | 'search'` (`src/types/index.ts:1`)
- `TabType = 'bible' | 'note' | 'lexicon' | 'youtube' | 'search' | 'pdf' | 'tags'` (`src/types/index.ts:22`)
- `ScriptureLayout` — 16 named layouts (`src/types/index.ts:3-19`, see §2.4)
- `YouTubeLayout` — 11 named layouts (`src/store/index.ts:169-180`)
- `Session` — `{ id, name, icon?, tabs, activeTabId, tabFilter? }` (`src/store/index.ts:166-173`)
- `ArchivedGroup` — `{ id, label, archivedAt, tabs[] }` (`src/store/index.ts:159-164`)
- `Tab` — `{ id, spaceId, type, title, state, isPinned?, originTabId?, originSpaceId? }` (`src/types/index.ts:251-263`). **`isPinned` is defined on the type and threaded through cross-window tab sync (`src/lib/crossWindowSync.ts:115,255`, `src/App.tsx:412`) but no UI component ever sets it** — no pin/unpin action exists in TabBar's context menu (`src/components/shell/TabBar.tsx:671-762`) or anywhere else searched. Dead/half-built field.

---

## 1. Shell & Navigation

### 1.1 Sidebar (`src/components/shell/Sidebar.tsx`, 1025 lines)

| Feature | Entry | window.* call |
|---|---|---|
| 5 Spaces (Scripture/Notes/Lexicon/YouTube) rail, click to switch | `Sidebar.tsx:20-24` (`SPACES` array; Search has no rail icon — reached via floating search) | store-only (`setActiveSpace`) |
| Sessions popover: switch / create / rename / delete / set emoji icon | `Sidebar.tsx:567-611, 955-982` | store-only (`switchSession`, `createSession`, `deleteSession`, `renameSession`, `setSessionIcon`) |
| Session context menu (right-click a session row) | `Sidebar.tsx:593-611` → mode switcher at `960-982`: Rename / Change icon / Manage sessions… / Delete session | store-only |
| Sidebar-wide right-click menu: new tab per space (4), Search in new tab, Toggle sidebar, Settings | `Sidebar.tsx:746-853` | store-only |
| Per-tab list (draggable, reorderable) w/ drag-to-reorder within/between spaces | `Sidebar.tsx:126-137` (`reorderTabs`, `reorderTabDisplay`) | store-only |
| Resizable sidebar width (drag handle) | `Sidebar.tsx:78-80` | store-only (`setSidebarWidth`) |
| Collapse/expand sidebar | `Sidebar.tsx:130` (`toggleSidebar`), shortcut `⌘⇧S` | store-only |
| Daily-note calendar row: open today, right-click → open in panel / new tab / floating tab / delete | `Sidebar.tsx:812-821, 995-1001` | `window.notes.searchNotes`, `window.notes.createNote`, `window.notes.deleteNote` (`263-340`) |
| "+" new-tab buttons per space | `Sidebar.tsx:693` | store-only (`createTab`) |
| Window-drag region (top strip) | `Sidebar.tsx:736-744` | `window.app.moveWindowBy` |

### 1.2 Tabs, Tab Bar, MRU switcher, Archived Groups

| Feature | Entry | window.* call |
|---|---|---|
| Horizontal tab strip per space, drag-reorder, drag between spaces | `src/components/shell/TabBar.tsx` (762 lines), rows ~600-665 | store-only |
| Tab context menu: Open in floating tab / Duplicate tab / Archive tab / Close tab (⌘W) / Move to session (submenu of other sessions) | `TabBar.tsx:671-762` | `window.app.openFloatingTab` (floating-tab item only) |
| Close tab button (×) on each tab row | `TabBar.tsx:645-656` | store-only |
| **Ctrl+Tab MRU tab switcher** — hold Ctrl, tap Tab to cycle, release Ctrl to commit; Shift+Tab reverses; Esc cancels. Shows mini live-content preview cards per tab type (Bible/Note/Lexicon/YouTube/Search) | `src/App.tsx:818-853` (key handling) + `src/components/shell/TabSwitcher.tsx` (319 lines, `BiblePreview`/`NotePreview`/etc. mini-renderers, `SPACE_CONFIG` color/abbrev per space) | store-only |
| `tabMRUList` — most-recently-used tab tracking across all spaces (feeds the switcher) | `src/store/index.ts:453`, `updateMRU()` at `store/index.ts:111-117` | store-only |
| Tab back/forward per-tab navigation history (`tabNavStacks`) with dropdown showing last 5 entries + "View all in History" | `src/store/index.ts:639` (state), `src/components/shell/ShellHeader.tsx:460-528` (dropdown UI) | store-only |
| "Home" item in back-dropdown for note/lexicon/youtube tabs (returns to that tab's browse view) | `ShellHeader.tsx:463-490` (`goToTabHome`) | store-only |
| Archived tab groups: archive a tab, later restore or permanently delete the whole group | `src/components/shell/Ribbon.tsx:200-226` (History popover UI), `src/store/index.ts` `archivedGroups`/`ArchivedGroup` type, `src/components/settings/sections/SessionsSection.tsx:139-140` (Restore/Delete permanently buttons) | store-only |
| Auto-close inactive tabs after N minutes (configurable) | `src/App.tsx:794-816` (5-min sweep interval), setting in `SettingsModal.tsx:825` "Auto-close inactive tabs" | store-only |
| Tab nav history size cap + "Clear all tab nav history" / app history log cap | `src/components/settings/sections/HistorySection.tsx` (64 lines) | store-only + `window.appHistory` (log itself) |

### 1.3 Sessions (Arc-style tab groups)

Each `Session` is a fully independent `{tabs, activeTabId}` per-space set. Managed from Sidebar's
session popover (§1.1) and from Settings → Data → **Sessions** section
(`src/components/settings/sections/SessionsSection.tsx`, 152 lines): list all sessions, rename,
delete, set per-session tab-type filter, plus the Archived Groups restore/delete list. New session:
`⌘⇧0`. Sessions are pure client-side state (`store-only`) — nothing round-trips through IPC except
via the shared `localStorage` blob (main window only writes it; see `IS_SECONDARY_WINDOW` guard,
`src/store/index.ts:26-49`).

### 1.4 Floating Search (`src/components/shell/FloatingSearch.tsx`, 1514 lines) — `⌘K`/`⌘T`

Result categories (`resultGroupLabel`, `FloatingSearch.tsx:22-33`), in ranked order:

| Category | Label | Source | window.* call |
|---|---|---|---|
| `ref` | "Go to" | Parsed Bible reference (`parseRef.ts`), Strong's number, multi-book query | store-only (navigates) |
| `verse` | "Verses" | Full-text verse search across up to 16 editions incl. word-replacer variants | `window.bible.searchText` (`FloatingSearch.tsx:510,568`) |
| `lexicon` | "Lexicon" | Strong's entry / lexicon keyword search | `window.lexicon.getEntry`, `window.lexicon.getOccurrences` (`470,487`) |
| `note` | "Notes" | Note title/content search | `window.notes.searchNotes` (`538`) |
| `youtube` | "YouTube" | Video title + transcript search | `window.youtube.searchVideos`, `window.youtube.searchTranscripts` (`579-584`) |
| `crossref` | "Cross References" | TSKe cross-reference matches | (via crossrefs data, not directly called in this file's excerpt) |
| `command` | "Commands" | `>` prefix invokes the command palette (`src/lib/commands.ts`) | store-only |
| `tag` | "Tags" | Verse-tag name fuzzy match (`rankVerseTags`) | store-only |

Also: recent-queries hint when the box is empty (`FloatingSearch.tsx:1434-1435`), translation-prefix
detection (`lxx:`, `enoch:`, `jubilees:`, `hermas:`, `barnabas:`, `t12p:`, etc. — 16 prefixes,
`TRANSLATION_PREFIXES`), density setting (compact/comfortable/spacious result-list height),
`searchScope: 'all' | 'verses'` (verses-only mode used by the Bible tab's "Search scripture"
button), and `searchNewTabPosition: 'top' | 'after-active' | 'end'` controlling where a result's new
tab is inserted.

### 1.5 History Modal (`src/components/shell/HistoryModal.tsx`, 792 lines) — `⌘H`

Full reading-history browser: type filter, sort order, date-range filter, per-entry "Remove this
visit", day-grouped list. Backed by `window.appHistory.getAll/getPage/delete/clear`
(`src/types/electron.d.ts:193-199`). Distinct from per-tab `tabNavStacks` (§1.2) and from Study
Trail (§8) — this is a flat chronological log of every navigation across the whole app.

### 1.6 Onboarding Wizard (`src/components/shell/Onboarding.tsx`, 1344 lines)

7 steps (`STEPS`, `Onboarding.tsx:11-18`): **Welcome → Texts (default translation) → Vault (folder
picker) → Import (BibleGateway/e-Sword) → Notes view (list vs. folder) → Shortcuts → Done**. On
completion it seeds a "Getting Started" note folder with 10 curated notes (Welcome, Bible Reader,
Notes & Editor, Strong's & Lexicon, Highlighting, Search, YouTube, Keyboard Shortcuts, Settings,
Vault Sync — `GETTING_STARTED_NOTES`, `Onboarding.tsx:32-869`) via `window.notes.createNote`.

### 1.7 Tasks Panel (`src/components/shell/TasksPanel.tsx`, 963 lines) — a "first-steps checklist"

Distinct from onboarding: a persistent, dismissible/minimizable checklist of guided tasks grouped
into categories — `first-steps`, `reading`, `study-tools`, `annotation` (seen so far; list
truncated in the grep). Each task has **auto-detected completion steps** (`detectableSteps`,
`isTaskDone`, `TasksPanel.tsx:679-689`) that watch live app state (e.g. `hasBibleTab`,
`hasStrongsEnabled`, `TasksPanel.tsx:44-47`) rather than requiring explicit "mark done" clicks.
Example tasks: "Read the Getting Started guide", "Open a Bible passage", "Switch to a different
translation", "Enable Strong's numbers", "Navigate with reading history", "Strong's hover", "Open a
full lexicon entry", "Compare a verse across translations", "Search across all texts", "Highlight
words or phrases", "Attach a note to a verse", "Create a freeform study note". Minimize / Dismiss
buttons (`TasksPanel.tsx:778-779`).

### 1.8 Floating chrome: Rail, Hover Panel, Shell (Pop Out Tab window)

| Component | Purpose | window.* |
|---|---|---|
| `FloatingRail.tsx` (187 lines) | Hover-expand vertical pill trigger housing `Ribbon` (search/history/find/zoom/study-trail/chat), appears when sidebar collapsed | — |
| `FloatingHoverPanel.tsx` (213 lines) | Generic hover-to-reveal floating card wrapper (used by note side-panel trigger, search "jump to book" rail, etc.) | — |
| `Ribbon.tsx` (349 lines) | The buttons inside the rail: Search/new tab, History (with Archived Groups restore/delete popover), Find in panel, Zoom menu, Study Trail, Berean Chat (AI Lookup) | `window.app.openStudyTrailWindow` (indirectly via store) |
| `FloatingShell.tsx` (215 lines) | Renders when a window is opened via "Pop Out Tab" (`?float=1`) — single panel, no title bar, custom drag overlay, traffic-lights inset. Reconstructs the popped-out tab's exact state from URL query params | `window.app.onTabStateUpdate`, `window.app.returnFloatTab` (put the tab back into the main window) |
| `PresenterControls.tsx` (188 lines) | Toolbar shown when the Viewer/Presenter window is open — pause/resume, laser toggle, selection-mirror toggle, blank screen | `window.app.openViewerWindow/closeViewerWindow`, `pushViewerOverlay` |
| `HeaderOverflowMenu.tsx` (151 lines) | "..." overflow menu in ShellHeader when the window is too narrow for every button | store-only |

### 1.9 Multi-window entry points (all via `window.app` / `window.crossWindow`)

| Window type | Trigger | window.* call |
|---|---|---|
| New synced window (shares tabs/sessions via cross-window sync) | `⌘N`, menu Window ▸ New Window | `window.crossWindow.newWindow()` (`App.tsx:948`) |
| New **independent** window (own blank workspace, settings-only inheritance, no sync) | `⌘⌥N`, menu Window ▸ New Independent Window | `window.crossWindow.newIndependentWindow()` (`App.tsx:942`); gated by `IS_INDEPENDENT_WINDOW` (`?independent=1`) in `src/store/index.ts:47-49` |
| Floating tab / "Pop Out Tab" (single-panel detached window) | Tab context menu "Open in floating tab" (TabBar, VerseRow indicator menu, VerseCopyMenu, StrongsContextMenu, idiom menu — 8+ call sites) | `window.app.openFloatingTab(type, state)` |
| Presenter/Viewer window (broadcast display, e.g. for teaching) | `⌘⇧B`, Ribbon button, command `open-presenter` | `window.app.openViewerWindow/closeViewerWindow/isViewerWindowOpen` |
| Study Trail window (own map/graph UI) | Settings → Study Trail "Open" button, sidebar/ribbon | `window.app.openStudyTrailWindow(trailSessionId?)` |
| Verse-tie picker window (small picker used by Study Trail to select a target verse) | Study Trail internals | `window.app.openVersePicker(payload)` |
| Cross-window sync transport | Any synced window | `window.crossWindow.broadcast/sendTo/list/onMessage/selfId` |

Cross-window tab-state sync mirrors `tabs`, theme, background-animation, and glass-appearance
fields (`applyExternalTabSync`, `src/store/index.ts:266-271`); `src/lib/crossWindowSync.ts` encodes
a per-tab digest (`id~title~isPinned`) to detect drift between windows.

### 1.10 Find Bar (`src/components/shell/FindBar.tsx`, 197 lines) — `⌘F`, or type-anywhere

Per-panel in-content search (Bible chapter, Notes, Lexicon). Routes to the last-focused panel
(`activePanelIdRef`, tracked via `ActivePanelContext.tsx`). Auto-open mode: typing any printable
character while a Bible/Notes/Lexicon panel is focused (and no input is focused) opens the bar
seeded with that character and auto-dismisses after 3.5s of inactivity (`App.tsx:1019-1077`).
Digit keys in the Bible panel instead accumulate into a go-to-verse jump
(`berean:verseDigit` event) rather than opening Find. Has its own phrase/all/any word-mode toggle
and "Advanced search" escape hatch to `ScriptureSearchView`.

---

## 2. Bible Reader

### 2.1 Reference bar, book/chapter picker, navigation

| Feature | Entry | window.* |
|---|---|---|
| Reference parsing (`Gen 1:1`, `Exodus 20`, ranges, Strong's numbers, multi-book editions) | `src/lib/parseRef.ts:623` `parseRef()`; RCL/Hermas traditional-numbering extension in `src/lib/multiBookSearch.ts` | — |
| Book/chapter picker popover — searchable list ("Search books… or type 'Genesis 3' and press Enter"), segmented by testament | `src/components/bible/BookChapterPicker.tsx` (54-arg component; `triggerLabel`, `editions`, `onSelectTranslation`, `onOpenPdfLibrary`) | — |
| Prev/next chapter arrows | `src/components/bible/BiblePanel.tsx:3122,3139` (`prevChapter`/`nextChapter`, also wired to `berean:prevChapter/nextChapter` events used by menu + command palette) | `window.bible.queryChapter` (via chapter load) |
| Continuous chapter scroll (infinite-scroll mode, alternative to one-chapter-at-a-time paging) | `src/components/bible/ContinuousChapterScroll.tsx`, toggle `continuousChapterScroll` in store | `window.bible.queryChapter` |
| Pull-past-chapter-end rubber-band navigation (paged mode only) | `src/components/bible/useChapterPullNav.ts` + `ChapterPullIndicator.tsx` — physics-based; explicitly NOT velocity- or timer-based (see file header) because Chromium gives no momentum-vs-real-input signal; commits only past a fractional over-pull threshold | store-only |
| Go-to-verse by typing digits while Bible panel focused | `App.tsx:1030-1031` → `berean:verseDigit` event, consumed in BiblePanel | store-only |

### 2.2 Scripture layouts (`ScriptureLayout`, 16 variants — `src/types/index.ts:3-19`)

`standard` (Scripture|Panel), `panel-bottom`, `notes-bottom`, `lexicon-crossref` (2×2 quad),
`reading` (full-width, no panel), `panel-left`, `notes-wide` (40/60), `scripture-wide` (65/35),
`compare-notes`, `study-grid`, `scripture-focus` (centered, no panel), `notes-right` (no tab strip),
`notes-top`, `triple-col` (Notes|Scripture|Lexicon), `commentary` (50/50, no tab strip),
`split-bottom` (Scripture top, Notes+Lexicon bottom row). Picker UI:
`src/components/bible/LayoutPicker.tsx` (thumbnail grid, "Quad Study" etc. labels), settable as a
default in Settings → Reading → "Default scripture layout"
(`SettingsModal.tsx:758,762-763`).

### 2.3 Right panel (`src/components/bible/BibleRightPanel.tsx`, 2152 lines)

Two independent slots (A and B — popped out via drag/right-click, each with its own tab set),
3 sub-tabs each: **Notes / Lexicon / Cross References**. Cross-ref sub-tab has 3 source modes
(`crossRefSource` setting): `classic` (curated static list), `tske` (Treasury of Scripture
Knowledge expanded — grouped headings, reciprocal-ref marking, per-chapter aggregate view via
`TSKeChapterView`, `BibleRightPanel.tsx:663-800`), `notes` ("My Notes" — cross-refs derived from
the user's own verse notes, `UserNotesChapterView`, `880-1063`). Notes sub-tab: embedded mini
note editor (open/create/switch notes without leaving the Bible panel), verse-filtered note list,
"expand all" toggle, its own scroll-position persistence per slot. Lexicon sub-tab: full
`EntryView`-equivalent embedded (`SidebarLexicon`, `114-250`). Every "open X" action also offers
Open in panel / Open in new tab / Open in floating tab (`window.app.openFloatingTab`).

### 2.4 Compare View (`src/components/bible/CompareView.tsx`, 802 lines)

2–4 columns (add/remove column, `addColumn`/`removeColumn`), each independently navigable OR
sync-scrolled (`syncScrollEnabled` prop, verse-anchored scroll sync — not raw pixel offset, so it
survives differing row heights across texts/zoom). Column state (`textId`, `bookId`, `chapter`,
`scrollPos: {verseNum, frac}`) persists per tab (`BibleTabState.compareColumns`,
`src/types/index.ts` — see §Store note). Feeds the Presenter window live
(`window.app.pushViewerContent`, `CompareView.tsx:507`).

### 2.5 Verse selection model

`selectedVersesByTab: Record<tabId, SelectedVerseRef[]>` (store) — clicking a verse number toggles
it into the tab's selection; Shift+↑/↓ extends via chapter-root keyboard handling. Selection is
per-tab, not global.

**`VerseSelectionBar.tsx`** (270 lines) — floating pill, bottom-center, appears whenever
`selectedVersesByTab[activeTab].length > 0`. Every action button (`VerseSelectionBar.tsx:198-215`):

| Icon | Label | Behavior | window.* |
|---|---|---|---|
| Copy | "Copy verse(s)" | Ref header + full text, word-replacer applied | `navigator.clipboard.writeText` |
| Hash | "Copy reference(s)" | Ref(s) only, compressed ranges ("Gen 1:3, 5-7") | `navigator.clipboard.writeText` |
| NotepadText | "Add note" | Creates a verse note anchored to first selected verse | `window.notes.createNote` |
| Files | "Show notes for this verse" (single-select only) | Opens right-panel notes filtered to verse | store-only |
| GitFork | "Show cross references" (single-select only) | Opens right-panel cross-refs | store-only |
| Volume2 | "Play audio from here" | Starts Read Aloud at that verse | store-only (`startPlaybackFrom`) |
| Tag | "Tag verses" | Opens `TagPickPopover` for the selection's verse ranges | `window.verseTags.*` |
| Palette | "Highlight" | Opens 15-color grid popover; also "Remove" | `window.highlights.toggle`/`remove` |
| X | "Clear selection" | — | store-only |

### 2.6 Verse-number popover (right-click or context-menu on a verse badge) — `VerseRow.tsx:1539-1567`

Copy verse · Copy reference · Add note · Show all notes · Show cross references · Play audio from
here · Tag verse… · inline highlight color swatch row (15 colors + "none").

### 2.7 Text-selection toolbar (select a run of words inside a verse) — `VerseRow.tsx:1838-1877`

Color swatch row (highlight the selection) · Copy verse · Copy reference · **Copy selection**
(exact selected substring, not the whole verse) · Add note to verse · **Open in new Advanced
Search tab** (seeds `ScriptureSearchView` with the selected text).

### 2.8 Note/cross-ref indicator right-click menu — `VerseRow.tsx:1882-2000`

For a note dot: Open in panel · Open in new tab · Open in floating tab. For a cross-ref indicator:
Open verse · Open in new tab (records Study Trail navigation) · Open in floating tab (ditto) ·
Copy verse · Copy reference.

### 2.9 Idiom word context menu — `VerseRow.tsx:2017-2052`

Hover tooltip (term + short meaning) → right-click: Open idiom note · Open in new tab · Open in
floating tab.

### 2.10 `VerseCopyMenu.tsx` (149 lines) — shared right-click menu used by search results, cross-ref lists, lexicon occurrences (any list of verse rows outside the main reader)

Open verse · Copy verse(s) · Copy reference · Open in new tab · Open in floating tab.

### 2.11 Highlighting

15 highlight colors (`HighlightColor` type, `src/types/electron.d.ts:70-72`): yellow, red, green,
blue, purple, orange, pink, teal, cyan, indigo, lime, amber, rose, violet, sky. Word/char-range
granularity (`startWord/endWord/startChar/endChar`, `window.highlights.toggle`). Applied from:
verse-number popover swatch row, text-selection toolbar swatch row, VerseSelectionBar's Palette
button (whole-verse only), and the ColorGridPopover in `VerseSelectionBar.tsx:238-268`. "Remove"
clears via `window.highlights.remove`.

### 2.12 Verse tags

`TagPickPopover.tsx` (165 lines) — attach one or more tags to a verse range or whole chapter
(`kind: 'verses' | 'chapter'`), create new tags inline. Tag color: per-tag or per-slot (15
preset color slots, `SlotSwatches`, `TagGraphSidePanel.tsx:128`). "Tag Manager" functionality
(rename, recolor, merge, delete, reorder) lives inside **`TagGraphSidePanel.tsx`** (300 lines,
`TagInspector`), embedded in the singleton **Tags graph tab** (`TagsGraphPanel.tsx`, 371 lines →
`TagGraphCanvas.tsx`, 387 lines, force-directed layout `tagForceLayout.ts` + edge
create/update/delete via `window.tagGraph.*`). `TagEdgeEditorPopover.tsx` (110 lines) edits an
edge's arrow direction/color/dashed/note. `TaggedVerseList.tsx` (102 lines) renders "every verse
tagged X" lists. Verse-badge tag pills render inline (`VerseTagBadges`, referenced in
`VerseRow.tsx:1537`).

### 2.13 Strong's numbers

- **Inline chip** (`StrongsInline.tsx`, 222 lines): per-word rendering with italic (translator-supplied),
  red-letter (words of Yeshua), and **parenthetical-particle** (grammatical markers with no
  English equivalent, e.g. Hebrew H853 את) styling; multi-word "phrase" grouping under one
  Strong's pill when a single tag spans several English words (`groupWords` prop).
- **Hover tooltip** (`StrongsTooltip.tsx`, 162 lines): word, transliteration, short gloss.
- **Click behavior**: opens the word in the right panel's Lexicon sub-tab (in-context); right-click
  opens `StrongsContextMenu.tsx` (128 lines): Open · Open in new tab · Open in floating tab ·
  Copy Strong's · Copy reference.
- **Toggle**: per-tab, not a global setting — toolbar button in BiblePanel + `⌘G` +
  command-palette "Toggle Strong's numbers" (`src/lib/commands.ts:26`). No Settings-page
  master switch exists (deviates from the desktop spec's "Settings → Display" location — see
  `docs/mobile/audit` findings).
- **Chapter-wide echo**: when the right panel has a lexicon entry open, every occurrence of that
  Strong's number in the visible chapter is highlighted (`chapterEchoStrongsNum`,
  `src/store/index.ts:465-469`).

### 2.14 Psalm superscriptions (`src/lib/psalmSuperscription.ts`, `psalmTitles.ts`)

Extracts KJV/KJVA/Brenton-LXX superscriptions ("To the chief Musician…") out of verse-1 body text
into a faint title line above the chapter, without renumbering verses — Brenton titles that occupy
whole leading verses fold into the title line while later verses keep their real DB numbers (e.g.
Ps 51 body starts at verse 3). Curated provenance data, not DB-editable.

### 2.15 Translator-supplied italics / LXX supply-brackets

KJV italic words: **not currently rendered** — per project memory, `kjva.db` lacks italic markup
pending a re-seed from OpenScriptures KJV XML. LXX supply brackets ARE implemented:
`supplyBracketIndices()` in `src/components/bible/VerseRow.tsx` detects `[bracketed]` spans in
Brenton LXX text and flags them for italic/translator-supplied styling.

### 2.16 Word replacer

Engine (`src/lib/wordReplacer.ts`) applies user-defined find→replace rules to displayed verse text
(e.g. built-in divine-name restoration rules — `H3068→Yehovah`, `christ→Messiah`, `jesus→Yeshua`,
plus 20 archaic-proper-noun rules — `DEFAULT_WORD_REPLACER_RULES`, `src/store/index.ts:79-109`).
Rules are either plain-text pattern matches or Strong's-number-scoped (KJVA tagged text only).
Settings UI: **Settings → Reading → Word replacer** section
(`src/components/settings/sections/WordReplacerSection.tsx`, 84 lines) — "Divine Name" quick
toggles + a general text-rules editor. Also expands search queries with replacement variants so a
search for "Yehovah" also matches underlying "LORD"/"GOD" (`getWordReplacerSearchVariants`).

### 2.17 Annotations / hidden annotations

Per-text bracket/parenthetical conventions can be toggled off per tab (`hiddenAnnotations: string[]`
on `BibleTabState`), via `src/lib/annotationFilters.ts`'s `stripAnnotations()`: `lxx_supply`
(Brenton `[...]`), `enoch_supply` `(...)` / `enoch_uncertain` `[...]` / `enoch_restored` `〈...〉`,
and 5 Jubilees variants (`jubilees_date`, `_bracket`, `_restored`, `_stanza`, `_supply`). UI toggle
row: `BiblePanel.tsx:3376-3388`.

### 2.18 Cross references

Two independent sources, both queryable per-verse or per-chapter: **native/classic**
(`window.crossrefs.getForVerse/getForChapter`) and **TSKe** (Treasury of Scripture Knowledge
expanded, `getTSKeForVerse/getTSKeForChapter` — heading-grouped, reciprocal-ref flagged). A third,
**"My Notes"**, derives cross-refs from the user's own verse-note content
(`UserNotesChapterView`, store-only, reads via `window.notes.getChapterNotes`). Selectable per-tab
default via `crossRefSource` setting (`classic | tske | notes`).

### 2.19 Hermas map (`src/lib/hermasMap.ts`)

Shepherd of Hermas is stored as 3 flat-numbered books (`HER_VIS` 25 ch., `HER_MAN` 24 ch.,
`HER_SIM` 65 ch.) but displayed/navigated using the traditional hierarchical scheme (5 Visions / 12
Mandates / 10 Similitudes with sub-chapters) — `HermasSection` maps DB chapter ↔ traditional
label. Two translations selectable (Roberts-Donaldson `hermas` vs. Charles Taylor 1903
`hermas_taylor`, Settings → Reading → "Shepherd of Hermas translation").

### 2.20 Zoom (`src/lib/zoom.ts`)

Single shared `appZoom` multiplier (0.5–3.0, step 0.1, `⌘+`/`⌘-`/`⌘0`), applied via font-size
scaling in reading panes and CSS `zoom` on chrome (side panel, top bar) — deliberately NOT applied
to sidebar/rail/panel-resize layout, which stay fixed size. Separate fixed `READING_REGION_ZOOM`
(1.1×, via CSS `transform: scale`, not `zoom`) permanently enlarges dense list regions (notes-home
list, lexicon entry body) relative to their default small type.

### 2.21 Display settings actually consumed by the reader

`bibleFontSize`, `bibleLineHeight` (`compact | comfortable | spacious`), `defaultBibleTranslation`,
`hermasTranslation`, `showVerseNumbers`, `showRedLetters`, `continuousChapterScroll`,
`defaultScriptureLayout`, `crossRefSource`, `chapterPullNavEnabled`, `swipePanelGestureEnabled`,
`theme`/`themePreset` (see §10). All read directly in `BiblePanel.tsx`/`ChapterView.tsx`/`VerseRow.tsx`.

---

## 3. Search

| System | Entry | Modes/filters | window.* |
|---|---|---|---|
| **Advanced Scripture Search** | `src/components/bible/ScriptureSearchView.tsx` (2055 lines) | Word mode `all/any/phrase`; testament filter; multi-select book filter with 10 canonical book-group presets (Torah, History, Wisdom, Major/Minor Prophets, Gospels, Acts, Pauline/General Epistles, Revelation — `src/lib/scriptureSearchFilters.ts`); verse-tag filter (AND/OR); sort `relevance` \| `bookOrder` (+ direction); text/edition selector across 16 texts; translation-prefix query shortcuts (`lxx:`, `enoch:`, `hermas:`, `recognitions:`, …); scroll-anchored virtualized results list persisted per tab | `window.bible.searchText`, `window.bible.queryChapter`, `window.bible.getBooks` |
| **Multi-book query parsing** | `src/lib/multiBookSearch.ts` | Traditional Recognitions-of-Clement (`Book.Chapter.Verse`) and Hermas (`Vision/Mandate/Similitude N[.sub]`) reference forms, floating-search-only (not wired into the shared `parseRef.ts` used by note auto-linking) | — |
| **Strong's number search** | `src/lib/strongsSearch.ts` | Single (`parseStrongsQuery`) and multi-Strong's-AND-plain-word queries (`parseMultiStrongsQuery`) | `window.lexicon.getOccurrences` |
| **Sidebar/space Search tab** | `src/components/search/SearchTab.tsx` | Simpler than the Advanced view; translation dropdown (16 editions incl. pseudepigrapha), translation-prefix auto-detect, word-count/number-word expansion (`numberTokenAlternates`) | store-only + `window.bible.*` |
| **Lexicon search** | `LexiconPanel.tsx`'s `SearchView` (`LexiconPanel.tsx:863`) | Language filter `H \| G \| all`, query text | `window.lexicon.search` |
| **Notes search** | Notes space's own search box (owned by the other audit lane) | modes `all/any/phrase` | `window.notes.searchNotes` |
| **YouTube search** | Floating search + YouTube tab's own search | video title search + full transcript search (returns per-video snippet + timestamp) | `window.youtube.searchVideos`, `window.youtube.searchTranscripts` |
| **Recent queries** | Floating search empty-state hint | shown when query box is empty and no tags selected (`FloatingSearch.tsx:1237,1434-1435`) | store-only |

---

## 4. Lexicon (`src/components/lexicon/LexiconPanel.tsx`, 1618 lines)

Views: **EntryView** (`327-863`) — full BDB/BDAG-style entry: lemma, transliteration, short gloss,
full definition, derivation, extended definition, occurrence count; abbreviation expansion for BDB
notation via `src/lib/bdbAbbreviations.ts`; occurrence list with matched-word highlighting
(`VerseWithMatchedWords`); related-words cross-navigation (Cmd/Ctrl-click); an info popover
explaining the entry layout (`LexiconInfoPopover`, `292-327`). **SearchView** (`863-1102`) — query +
language filter, results list. **lexHistory** — an in-tab back/forward stack of
`{kind:'entry', strongsNum} | {kind:'search', query, lang}` entries persisted per lexicon tab
(`LexiconTabState.lexHistory`), independent of the app-wide History modal and independent of
per-tab `tabNavStacks`. Occurrence navigation opens the verse in the active Scripture tab.
`window.lexicon.getEntry/getOccurrences/getRelated/search`.

---

## 5. Settings (`src/components/settings/SettingsModal.tsx`, 1761 lines + `sections/*.tsx`)

12 nav sections (`SettingsModal.tsx:441-453`):

| Section | Notable controls (label → behavior) |
|---|---|
| **Appearance** | Color mode (light/dark/system); Theme (37-theme browsable picker, see §10); Glass appearance (clear/regular/tinted); Ambient background animation (on/off + style + intensity); Section fonts (per-area typeface picker) |
| **Reading** | Default translation; Shepherd of Hermas translation; Default scripture layout; Open note alongside scripture; Line height; Floating search density; Bible text size; Auto-close inactive tabs; Show verse numbers; Red letter text; Continuous chapter scroll; Verse tags (show/hide); Auto-detect verse references; Auto-detect lexicon references; Word replacer (Divine Name + text rules, §2.16) |
| **Notes** | Auto em dash; Auto-format verse blocks; Default status for new notes; Strong's block suggestion; Verse block suggestion; "Advanced" disclosure → Suggest verse/Strong's blocks in side panel; Markdown reference (opens `MarkdownReferenceModal`); Bullet list style; Heading divider lines; Spell check; Copy verse on highlight; Default editor mode (edit/view); Confirm before deleting notes; Normalize note formatting; Continuous daily notes scroll; Daily notes; Print & export defaults (→ Print/Export section, §below); Idiom notes (highlight + hover preview toggles); Panel gestures (two-finger swipe to open/close side panel) |
| **Sync** (vault) | Markdown vault sync on/off; Vault folder picker; Export now (`window.vault.exportAll`); Import from vault (`window.vault.importAll`); "How vault sync works" explainer |
| **YouTube** | Default layout (11-option `OptionCard` grid via `YtLayoutSetting.tsx`); Auto Picture-in-Picture; Watch history list; YouTube account (sign out via `window.app.youTubeSignOut`) |
| **Audio** (Read Aloud) | Voice Pack (Kokoro model download progress/cancel); Voice picker; Speed slider; Autoplay when player opens; Highlight words while speaking; Auto-advance |
| **Shortcuts** | Read-only grouped keyboard-shortcut list (`ShortcutKeys.tsx`) |
| **Data** | Import (BibleGateway / e-Sword tabs, `ImportSection.tsx`); Navigation & app history (`HistorySection.tsx` — tab-nav max stack size, app-history max entries, clear buttons); Workspaces (list/rename/delete saved layouts, `WorkspacesSection.tsx`); Danger Zone (`DangerSection.tsx` — type-to-confirm destructive actions: Clear browsing history, Delete all BibleGateway notes, Delete all e-Sword notes, Delete all notes) |
| **About & Updates** | Version, MAS-build detection; Check/download/install update buttons (`window.app.checkForUpdates/downloadUpdate/installUpdate`); Beta-channel toggle; release-process dev notes (visible in dev builds) |
| **Viewer Window** | Font scale; Theme override |
| **Study Trail** | "Ask why you jumped chapters" toggle; Open Study Trail window button |
| **Experimental** | Pull to change chapter (chapterPullNav) toggle; PDF library & viewer feature flag |

Settings search box filters the nav list by label + keyword array (`NAV` items each carry a
`keywords[]` for fuzzy matching, e.g. Reading matches "strongs", "hermas", "red letter").
`window.settings.get/set/getAll` backs every persisted value that isn't already in the Zustand
`persist` blob (most settings ARE in the Zustand blob; `window.settings` is the lower-level KV store
some subsystems use directly — see the other lane's store-field audit for the split).

---

## 6. Keyboard Shortcuts & Commands

### 6.1 `src/lib/commands.ts` (command-palette entries, `>` prefix in Floating Search) — 27 commands

| id | label | shortcut | action |
|---|---|---|---|
| new-note | New general note | ⌘⇧N | `berean:newNote` event |
| new-verse-note | New verse note | ⌘⇧V | `berean:newVerseNote` event |
| new-scripture-tab | New Scripture tab | — | `ensureTab`+`createTab('bible')` |
| new-lexicon-tab | New Lexicon tab | — | `createTab('lexicon')` |
| new-youtube-tab | New YouTube tab | — | `createTab('youtube')` |
| todays-daily-note | Open today's daily note | ⌘⇧D | `berean:openDailyNote` event |
| toggle-strongs | Toggle Strong's numbers | ⌘G | `berean:toggleStrongs` event |
| compare-verse | Compare this verse | — | `berean:compareVerse` event |
| focus-ref-bar | Focus scripture reference bar | ⌘L | `berean:focusRefBar` event |
| prev-chapter / next-chapter | Previous/Next chapter | — | `berean:prevChapter`/`nextChapter` events |
| toggle-markdown | Toggle Edit/View mode | ⌘⇧M | `berean:toggleMarkdown` event |
| insert-timestamp | Insert YouTube timestamp into note | ⌘⇧L | `berean:insertTimestamp` event |
| toggle-pip | Toggle YouTube PiP | ⌘⇧P | `berean:togglePiP` event |
| toggle-sidebar | Toggle sidebar explorer | ⌘⇧S | `toggleSidebar()` |
| toggle-focus-mode | Toggle Focus mode | ⌘⇧U | `toggleNoteFocusMode(tabId)` |
| open-history | Open History | ⌘H | `openHistory()` |
| open-settings | Open Settings | ⌘, | `openSettings()` |
| open-markdown-reference | Markdown reference guide | — | `openMarkdownReference()` |
| full-text-search | Full-text search across all texts | ⌘⇧F | `openSearchTab('')` |
| open-presenter | Open Presenter view | ⌘⇧B | `window.app.openViewerWindow` |
| close-tab | Close tab | ⌘W | `closeActiveTab()` |
| nav-back / nav-forward | Back / Forward | ⌘[ / ⌘] | `navTabBack()`/`navTabForward()` |
| toggle-inspector | Toggle Inspector | — | `berean:toggleInspector` event (**dead — no listener wired**, per code comment) |
| zoom-in / zoom-out / zoom-reset | Zoom In/Out/Actual Size | ⌘= / ⌘- / ⌘0 | `adjustAppZoom`/`resetAppZoom` |
| find | Find | ⌘F | per-space find routing (mirrors Ribbon's `handleFind`) |

### 6.2 Additional shortcuts wired directly in `src/App.tsx` (NOT in commands.ts)

⌘F routes to notes/lexicon/bible find bar depending on focus (`App.tsx:872-899`) · ⌘K "search
current" · ⌘T "search new" · ⌘L opens floating search (always, even from Advanced Search tab) ·
⌘, settings · ⌘⇧S sidebar · ⌘⇧N new note · **⌘⌥N new independent window** · **⌘N new synced
window** · ⌘⇧F full-text search tab · ⌘/ search palette (same as ⌘K) · ⌘G toggle Strong's · ⌘H
history · **⌘P print/download preview** (Notes space only) · ⌘⇧U focus mode (works from any
context, unlike the toolbar button which is hidden in compact contexts) · ⌘⇧D daily note · **⌘⇧B
open Presenter window** · **⌘⇧R Read Aloud play/pause** · ⌘⇧P toggle PiP · ⌘⇧L insert timestamp ·
**⌘⇧0 new session** · **⌘1–⌘5 jump to space by number** · **Ctrl+Tab / Ctrl+Shift+Tab** MRU tab
switcher (§1.2) · type-anywhere auto-opens find bar (digit keys in Bible space accumulate a
go-to-verse jump instead) · **Escape** dismisses switcher/find bar/menus.

### 6.3 Native menu bridge

`window.app.onMenuAction` (`App.tsx:253-349`) dispatches native File/Edit/View/Go/Help menu clicks
into the same store calls / `berean:*` events as the shortcuts above — `openRef`, `searchTexts`,
`navBack/navForward`, `prevChapter/nextChapter`, `focusRefBar`, `toggleStrongs`, `compareVerse`,
`newNote`, `newVerseNote`, `openDailyNote`, `toggleMarkdown`, `insertTimestamp`,
`openImport(BibleGateway|ESword)`, `openHistory`, `toggleSidebar`, `openSearchInPanel`, `find`,
`switchSpace`, `addTab`, `popOutTab`. Separately, `window.app.onAppCommand` invokes any
`commands.ts` command by id directly.

---

## 7. Gestures & Input Already Present

| Hook | File | What it does / state mutated |
|---|---|---|
| `useSwipePanelGesture` | `src/hooks/useSwipePanelGesture.ts` | Two-finger trackpad swipe to open/close the Bible reader's right side panel. Live per-frame-eased drag (not tick-driven), decoupled from raw wheel-event timing to avoid visible stutter. Gated by `swipePanelGestureEnabled` setting. |
| `useSwipeDismissGesture` | `src/hooks/useSwipeDismissGesture.ts` | Two-finger swipe DOWN to dismiss a bottom-anchored toast (e.g. Study Trail arrival prompt); same physics engine as above; fast flick commits regardless of distance, slow drag decided by halfway point; rubber-band resistance on wrong-direction pull. |
| `chapterPullNav` (`useChapterPullNav`) | `src/components/bible/useChapterPullNav.ts` | Rubber-band pull-past-chapter-boundary to navigate prev/next chapter in paged (non-continuous-scroll) mode. No momentum/velocity signal is trusted (Chromium doesn't expose it); commits only on a proven-live, over-threshold pull. Mutates local drag state + calls `prevChapter()`/`nextChapter()`. |
| Trackpad swipe IPC | `window.app.onTrackpadSwipeBegin/onTrackpadSwipeEnd` (optional bridge, `src/types/electron.d.ts:337-338`) | Native-level swipe begin/end signal from the main process, consumed by BiblePanel; explicitly optional/tolerant of absence (preload changes need a full restart, not just HMR). |
| `useWindowDrag` | `src/lib/useWindowDrag.ts` | Manual JS-tracked (NOT native `-webkit-app-region: drag`) window-drag handler — sidesteps two known Electron bugs: portaled menus desyncing from the OS drag-region hit-test mask, and multi-monitor DPI drag failures. Used by ShellHeader, PanelHeader, Ribbon, Sidebar, TabBar. Calls `window.app.moveWindowBy(dx,dy)`. |
| `usePositionedMenu` | `src/lib/usePositionedMenu.ts` | Shared engine for every context/popup menu: viewport-clamped positioning, below-right default flipping to above/left on overflow, click-outside + Escape close, global `berean:closeMenus` event to close all menus at once, no-flicker (`useLayoutEffect` clamp before paint). |
| `useRovingNav` | `src/lib/useRovingNav.ts` | Roving-tabindex arrow-key navigation for non-native-menu lists/grids (Arrow keys + Home/End move focus; Enter/Space left to the focused control). Vertical/horizontal/both orientation, optional column count for grid wrap. |
| `useRovingGridNav` | `src/hooks/useRovingGridNav.ts` | Sibling roving-focus hook for fixed grids (chip rows, checkbox grids) — clamps at edges rather than wrapping. |
| `useScrollEdge` | `src/lib/useScrollEdge.ts` | Tells a toolbar/footer bar whether its adjacent content has scrolled, so it shows a hairline+shadow only then (resting bar reads seamless with content, macOS-style). |

---

## 8. Other Features (one line each — deep coverage owned by the other audit lane)

| Feature | Entry component |
|---|---|
| Notes editor (ProseMirror, markdown) | `src/components/notes/pm/NoteEditorPM.tsx` |
| Notes home (list/folder/board views) | `src/components/notes/NotesHomePanel.tsx`, `NotesFolderView.tsx`, `NotesBoardView.tsx` |
| Note statuses/pins/trash | `NotesPanel.tsx`, `window.notes.setNotePinned/restoreNote/listTrash/purgeTrashItem/emptyTrash` |
| Note version history | `src/components/notes/NoteVersionHistory.tsx` (diff + rendered-preview views) |
| Calendar / daily notes | `src/components/notes/CalendarWidget.tsx`, `src/lib/dailyNoteUtils.ts` |
| Idioms reference book | `window.notes.listIdioms`, `src/lib/idiomsExport.ts` |
| Print / PDF export of notes | `src/components/notes/PrintPreviewModal.tsx`, `window.app.printNote/exportNotePDF/renderPreviewPDF` |
| Markdown reference modal | `src/components/notes/MarkdownReferenceModal.tsx` |
| Tags graph (force-directed) | `src/components/tags/TagsGraphPanel.tsx` → `TagGraphCanvas.tsx` |
| Study Trail — sessions/map/threads/everything/connections/sticky notes | `src/components/studyTrail/StudyTrailApp.tsx`, `MapView.tsx`, `ThreadsView.tsx`, `EverythingView.tsx`, `TrailStickyNote.tsx` — own window, `window.studyTrail.*` (huge IPC surface, §StudyTrailAPI) |
| AI Lookup / Berean Chat (local Ollama) | `src/components/ailookup/AiLookupPanel.tsx`, `window.aiLookup.*` |
| PDF import/viewer | `src/components/pdf/PDFViewer.tsx`, `PdfPicker.tsx`, `window.pdf.*` |
| YouTube tab + secondary panels + playlists + watch history + transcripts | `src/components/youtube/YouTubeTab.tsx`, `YouTubeSecondaryPanel.tsx`, `window.youtube.*`, `window.playlists.*` |
| Read Aloud (Kokoro TTS) — audio player, queue, playlists | `src/components/audio/AudioPlayer.tsx`, `AudioQueuePopover.tsx`, `src/lib/tts/ttsEngine.ts`, `window.ttsModel.*`, `window.ttsAudioCache.*` |
| Presenter/Viewer window | `src/components/viewer/ViewerApp.tsx`, `ViewerBiblePage.tsx`, `ViewerCompare.tsx`, `ViewerCrossRefs.tsx` |
| Octarine vault sync/export/import | `window.vault.*` (`syncNote`, `watchVault`, `reconcile`, `exportAll`, `setAutoExport`, `importAll`) |
| BibleGateway import | `src/components/settings/BibleGatewayImporter.tsx`, `window.bgImport.*` |
| e-Sword import | `src/components/settings/ESwordImporter.tsx`, `window.eSwordImport.*` |
| App history log | `src/components/shell/HistoryModal.tsx`, `window.appHistory.*` |
| Tasks panel (first-steps checklist) | `src/components/shell/TasksPanel.tsx` (§1.7) |
| Word replacer | `src/lib/wordReplacer.ts` (§2.16) |
| Auto-update | `src/components/settings/sections/UpdatesSection.tsx`, `window.app.checkForUpdates/downloadUpdate/installUpdate/onUpdateStatus` |

---

## 9. Sharing & Clipboard

All clipboard writes go through `navigator.clipboard.writeText` (26 call sites found across
`src/components`/`src/lib`, excluding tests) or the shared helpers in `src/lib/verseClipboard.ts`:

| Format | Producer | Example output |
|---|---|---|
| "Reference text" (single verse) | `copyVerse()` (`verseClipboard.ts:41`) | `Genesis 1:1 In the beginning...` (Strong's tags stripped, whitespace collapsed) |
| "Reference" only | `copyVerseRef()` (`verseClipboard.ts:47`) | `Genesis 1:1` |
| Verse range | `copyVerse`/`copyVerseRef` with `endVerse` | `Genesis 1:1-3 ...` |
| LXX suffix | `lxx` param → `formatVerseRef` | `Genesis 1:1 LXX` |
| Multi-book edition labels | `bookRefLabel()` (`verseClipboard.ts:18-27`) | `Recognitions of Clement, Book 5, 3:5`; `Hermas, Similitudes, 35:1` |
| Multi-verse selection copy | `VerseSelectionBar.copyVerses()` | Header line + one line per verse (`"3 text..."`), word-replacer applied |
| Raw text selection | `VerseRow`'s "Copy selection" menu item | Exact `window.getSelection().toString()` |
| Strong's number | `StrongsContextMenu` "Copy Strong's" / "Copy reference" | `H7225` / `Strong's H7225` |
| YouTube timestamp link (into a note, not clipboard) | `berean:insertTimestamp` → note editor insert | `[Channel — Video Title — 12:34](https://youtu.be/ID?t=754)` |
| Note/PDF export | `window.app.exportNotePDF`, `window.app.printNote` | PDF file / native print dialog — not clipboard |
| "Open external" (URLs) | `window.app.openExternal(url)` | Opens in default browser — used by Updates section (App Store / site links) |

No native iOS share-sheet equivalent exists anywhere (Electron has no such API); every "share" in
this app today is clipboard-copy, file-export-to-disk, or open-in-default-browser.

---

## 10. Theming & Appearance

- **Application**: `src/lib/applyTheme.ts`'s `applyThemeToDocument()` — the SINGLE shared
  implementation used by the main window (`App.tsx`), floating "Pop Out Tab" window
  (`FloatingShell.tsx`), and the presenter/viewer window (`ViewerApp.tsx`); previously each had its
  own copy-pasted, drift-prone version. Sets `<html>` classList (`scheme-dark`/`scheme-light`,
  `color-scheme` CSS property for native form controls/scrollbars), `data-glass` attribute, and one
  of `ALL_PRESET_CLASSES`.
- **Theme base**: `theme: 'dark' | 'light' | 'system'`. **Preset overlay**: `themePreset` string —
  `''` (default), `'system-accent'` (follows live macOS accent color via
  `window.app.getAccentColor`/`onAccentColorChanged`), or one of **28 named presets**
  (`src/lib/themePresets.ts`) grouped into families: Classic (Default, Midnight, Obsidian, Slate),
  Vibrant (Neon, Terminal), Nature (Forest, Ocean, Arctic), Rich & Warm (Royal, Ember), Scripture &
  Parchment (Bible, Sand, Dawn), Soft Light (Rose, Ivory), and **Muted & Pastel** (16 presets: Sage,
  Lavender, Blush, Fog, Linen, Mist, Dune, Powder, Clay Dust, Willow, Periwinkle, Oat, Thistle,
  Seafoam, Chalk, Apricot, plus 5 dark variants — Wisteria, Slate Dust, Moth, Dusk Rose, Heather,
  Ash Sage). Several presets carry a signature ambient animation style (`shimmer`, `pulse`,
  `particles`, `flicker`, `drift`) independent of the separate on/off `backgroundAnimationEnabled`
  toggle. Browsable via `ThemePicker.tsx` (37 themes total per its own subtitle text, including
  non-family entries).
- **Reduce Transparency / Increase Contrast**: OS accessibility settings mirrored live via
  `window.app.getReduceTransparency/onReduceTransparency`,
  `getIncreaseContrast/onIncreaseContrast`.
- **Glass appearance**: `'clear' | 'regular' | 'tinted'` (`GLASS_ALPHA_MULT: {clear:0.8, regular:1,
  tinted:1.18}`) — scales every translucent material's alpha, mirroring macOS 27's system
  transparency slider.
- **CSS token files**: `src/styles/global.css` (2286 lines — the entire design-token system: color
  palette vars, derived semantic layer, material hierarchy M0–M4, radii, elevation, motion,
  typography, spacing) and `src/components/notes/pm/pmEditor.css` (1089 lines — note-editor-specific
  styling). `src/styles/highlightPalette.ts` (not CSS but the JS-side highlight-color token map).
- **`tailwind.config.js`** notable tokens: `fontFamily.sans` = native OS stack
  (`-apple-system, BlinkMacSystemFont, SF Pro Text, Helvetica Neue`) as the app default; `serif` =
  Georgia; `mono` = SF Mono/JetBrains Mono; custom `fontSize` scale keyed to CSS vars
  (`micro`→`title1`) — chrome typography only, Scripture/Notes reading bodies use the user's own
  font settings, not this scale.
- **`docs/design-system.md`** (skimmed) — the geometry contract most relevant to a mobile port:
  **all toolbars are a fixed 44px**; **every control inside a bar is a uniform 36px** (enforced by a
  `BarMetrics` React-context system consumed by `Button`/`IconButton`/`SegmentedControl`/
  `TextField`/`Select`, distinct from a 24px `CompactMetrics` used in popovers/inspectors); sidebar
  rows 28, list rows 36 (28 dense), menu rows 28, calendar cells 22; a segmented control's track is
  the 36px control, its segments inset to 32; radii follow a concentric rule (window 20 → corner
  surface 12 → menu 14 → row 8 → card 8 → chip 4); **"a lone bar item renders as a circle"**
  (Apple grouping-model convention — More/inspector/sidebar-toggle buttons). This entire system is
  macOS-window-chrome-native (traffic-light insets, hover states, native drag regions, a fixed
  44px toolbar height tuned to trackpad/mouse targets) and has no iOS equivalent — see §"No mobile
  equivalent" below.

---

## Features with no obvious mobile equivalent

- **Multi-window**: New synced window, new independent window, floating "Pop Out Tab" windows,
  Presenter/Viewer broadcast window, Study Trail's own window, verse-picker window, cross-window
  live sync (`window.crossWindow.*`). iOS/Capacitor has no multi-window desktop-style model (iPad
  multitasking is the closest analogue but nothing here targets it).
- **Hover-only affordances**: Strong's tooltip on hover, idiom-word hover tooltip, note-side-panel
  hover-to-reveal trigger, `FloatingHoverPanel`/`FloatingRail` hover-expand chrome, `Tooltip.tsx`
  generally. No touch equivalent to "hover" exists.
- **Keyboard-only**: the entire §6 shortcut surface (⌘-chord bindings), Ctrl+Tab MRU switcher,
  Shift+F10 "open context menu" convention, roving-tabindex Arrow-key navigation
  (`useRovingNav`/`useRovingGridNav`), type-anywhere auto-find. A touch UI needs equivalent
  affordances (swipe actions, long-press menus, visible buttons) for essentially everything in §6.
- **Right-click / context menus everywhere**: verse popover, text-selection toolbar, note/cross-ref
  indicator menu, idiom menu, Strong's context menu, tab-bar context menu, session context menu —
  all currently `onContextMenu` (right-click) triggered; would need long-press equivalents.
- **Drag-and-drop**: tab reordering/cross-space dragging (`TabBar.tsx`, `Sidebar.tsx`), right-panel
  slot A/B drag-to-pop-out, note-folder drag-and-drop, Study Trail node marquee-select/drag,
  column-resize handles throughout (`ResizeHandle.tsx`).
- **Trackpad-specific**: two-finger swipe gestures (`useSwipePanelGesture`,
  `useSwipeDismissGesture`), trackpad-specific pull-to-navigate physics tuned against Chromium's
  lack of a momentum-vs-real-input signal (`useChapterPullNav.ts`), native OS-level window-drag
  region conventions (`useWindowDrag.ts`'s entire rationale is Electron-desktop-specific bugs).
- **`react-mosaic` resizable panel layout** (16 `ScriptureLayout` variants, arbitrary panel
  resize/split): a touch UI would need to collapse this to a much smaller set of fixed
  navigation patterns (tabs, sheets, stacks) rather than freeform resizable panes.
- **Electron `<webview>` for YouTube** (full Chromium session, login, playlists) — iOS would need a
  native YouTube SDK/embed or `WKWebView`, with a different PiP model (`AVPictureInPictureController`
  vs. Electron's own).
- **File-system vault sync** (`window.vault.*`, direct `fs` access to an iCloud-Drive-symlinked
  Obsidian/Octarine vault folder) — iOS sandboxing has no direct equivalent; would need the Files
  app's document-provider APIs or an iCloud container, a materially different sync model.
- **Native menu bar** (`window.app.onMenuAction`/`onAppCommand`, File/Edit/View/Go/Help) — no
  equivalent surface on iOS.
- **Frameless custom window chrome** (`windowControls.*`, traffic-light insets, `pl-traffic-lights`
  classes throughout) — meaningless on iOS.
- **macOS System Settings mirroring**: live accent color, Reduce Transparency, Increase Contrast IPC
  bridges assume macOS `systemPreferences` APIs.

---

## Commands run

Read-only exploration only — `find`, `grep`/`rg`-style greps via Bash, and `Read` on specific line
ranges of: `src/App.tsx`, `src/lib/commands.ts`, `src/types/electron.d.ts` (full file, 866 lines),
`src/types/index.ts` (partial), `src/store/index.ts` (partial — types/state declarations only, per
instruction to skip the other lane's field-by-field store audit), and targeted sections of
~40 component/lib files under `src/components/{shell,bible,lexicon,tags,settings}` and `src/lib`,
`src/hooks`. No file was edited. No `npm install` or `npm run dev` was executed. No commands failed.
