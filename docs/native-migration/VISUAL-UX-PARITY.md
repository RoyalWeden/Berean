# Visual & UX parity — existing Berean (Electron/React) vs native (SwiftUI)

Living tracker. Every visible native feature is compared against the existing desktop app before it is called
UI-complete (gate in `EXECUTION-PLAYBOOK.md` → "UI-complete gate").

**Comparison conditions (reproducible).** Both windows at 1300×800 pt, positioned at {100,60}, light appearance,
captured with `screencapture -x -R100,60,1300,800`.
- Existing app: `BEREAN_CDP_PORT=9222 npm run dev` in the worktree. It uses the Berean Dev profile, never
  production. The installed /Applications Berean must not be touched.
- Native app: `npm run native:build:mac`, then open `build/apple/DerivedData/Build/Products/Debug/BereanMac.app`
  (com.berean.native.mac.dev library).
- Screenshots are not committed: the Berean Dev profile contains personal note titles. Re-capture with the
  conditions above.

Status keys: ✅ parity (or better) · 🟡 partial · ❌ missing · ➕ native improvement.

| # | Area | Existing app (reference) | Native now | Status | Next |
|---|---|---|---|---|---|
| 1 | Main window | Sidebar + toolbar + reader; inspector on the right (`ShellHeader`, `PanelLayout`) | `NavigationSplitView` + `.inspector`; Liquid Glass toolbar | ✅ ➕ | Window restoration (multiple windows) |
| 2 | Sidebar organisation | Session switcher in the header, location field ("Scripture › Matthew 15"), "+ New Tab", one tab list, calendar, bottom tool rail (`Sidebar.tsx`, `TabBar.tsx`) | **2026-11-08:** session switcher, location field (opens ⌘K), New Tab, one tab list, Workspaces section, Archived section | 🟡 | Calendar (daily notes) and the tool rail (archive · presenter · voices · Study Trail · AI · settings) as features land |
| 3 | Spaces | Scripture/Notes/Lexicon/YouTube/Search are tab types; ⌘1–5 jump; the location field names the space | Same: ⌘1–5, location field, optional "Group Tabs by Space" (sidebar context menu) | ✅ ➕ | — |
| 4 | Vertical tabs | Flat list in the user's order; type-coloured icons; active pill; × on hover; drag reorder; ⌘/⇧-click multi-select | Flat list in `display_order` order, Pinned section, type colours, × on hover/active, drag reorder (persists), neighbour selected on close | 🟡 | Multi-select (⌘/⇧-click) with bulk archive/move/close; "Open in floating tab" (deferred: floating windows) |
| 5 | Tab creation / switching | ⌘T/⌘K floating search, "+ New Tab", ⌃Tab | Same entry points; ⌃Tab cycles within the space | 🟡 | ⌃Tab over the unified list order |
| 6 | Sessions | Header control: SESSIONS list, New Session ⌘⇧0, Manage Sessions…; right-click rename/icon/delete | Header control with the session name; menu lists sessions with tab counts and a checkmark, New Session ⌘⇧0, Rename, Close; Saved Workspaces in the same menu | 🟡 | Session icons (`SESSION_ICONS`); Manage Sessions view |
| 7a | iPhone tabs/sessions | TabCardsSheet list (session chip, search, Recent/Custom sort, select mode, archive, New Tab); WorkspacesPage (sessions + Saved snapshots) | Tab sheet (session row, search, ordered list, swipe/context actions, reorder, New Tab, Archived) + Sessions page with Saved Workspaces — real-tap verified | 🟡 | Recent sort (needs last-access tracking), select mode, card view |
| 7 | Workspaces | Settings → Layout list (save/load/delete) — hard to find | Sidebar **Workspaces** section (open, "Open" badge, rename/delete in the context menu, + to save), session menu, Settings section | ✅ ➕ | iPhone workspaces page |
| 8 | Scripture reading area | Sans/serif setting, verse numbers (click → verse popover), red letters, note dots, highlights, tag chips | Serif default, verse number → verse actions menu, red letters, note dots, highlights, tag chips + chapter tags | 🟡 | Partial-selection highlighting and multi-verse selection (TextKit, M5-01); tag chip hover preview |
| 9 | Study panels | Right panel: lexicon / cross refs / notes / tags | Inspector (Notes · Lexicon · Cross Refs) + 16 layout presets | 🟡 | Tags tab, verse-tag chips |
| 10 | Resizable layouts | react-mosaic presets, saved workspaces | 16 presets (Split views) | ✅ | Per-pane independent tabs |
| 11 | Search | Floating Search (groups: Go to · Verses · Lexicon · Notes · YouTube · Commands) + Search tab | Command palette + Search tab (verses) | 🟡 | Unified grouped results (`unifiedSearch.ts` port) |
| 12 | Notes | List with filters/folders, ProseMirror editor, history, import/export | List, filters, folders, Markdown edit/render, version history, export (native save panel), import | 🟡 | Rich editor (M7-02), tags, verse links in notes |
| 13 | Settings | Many sections (Display, Texts, Layout, Notes, YouTube, Shortcuts, About) | Reading, Appearance, Workspaces, Library | 🟡 | Texts, Shortcuts (read-only list), About |
| 14 | Toolbars & menus | History ← → · passage pill ‹ Matthew 15 ⌄ › · Strong's · tags · layout · info · more · right panel | **2026-11-08:** history ← →, passage pill ‹ Psalm 23 › with a book/chapter picker popover, text button ("KJVA"), Compare, Strong's, Study Panel, Layout; File ▸ Import/Export Markdown; ⌘L | 🟡 | Tags button, info, overflow menu |
| 15 | Context menus | Tab: floating · duplicate · move to session · archive · close ⌘W; verse menu | Tab: Duplicate · Pin · Move to Session · Archive · Close; verse menu (copy, highlight, note, lexicon) | 🟡 | Floating tab (deferred) |
| 16 | Window & panels | One window, floating Scripture windows, presenter window | One window | ❌ | Multiple windows / presenter (M9) |
| 17 | Theme & typography | Inter UI, custom glass, colour tokens (`docs/design-system.md`) | System font, native materials, accent colour; light/dark/system | ✅ ➕ | Dark-mode capture pass |

## Findings that drove the 2026-11-08 changes

1. **Sessions were hidden.** A small menu with no indication of how many sessions or tabs existed. Now the session
   is a labelled control at the top of the sidebar, as in the existing app. Its menu shows each session's tab
   count and the saved workspaces.
2. **Workspaces were hard to find.** In the existing app they live only in Settings. Now they have their own sidebar
   section and an "Open" badge when the workspace's session is running. A short explanation appears when saving.
3. **Grouping tabs by Space broke the user's order.** The existing sidebar is one list in the user's order (synced
   `display_order_key`). The native app grouped tabs by Space, which hid that order. The native app now uses the
   same single list. Grouping is kept as an option.
4. **The ‹ › buttons were ambiguous.** In the native toolbar they meant previous/next chapter but looked like history
   arrows, and there was no book/chapter picker. The native toolbar now matches the existing app: history arrows
   plus the passage pill with a picker.
5. **Duplicate controls.** A "Go to reference" text field duplicated the location field and ⌘K. It was removed;
   ⌘L opens the location search.
6. **Export did nothing** (Michael's manual test). Fixed with native panels. See CHANGELOG 2026-11-08 07:30.
7. **Tab archive was missing.** It is in the existing context menu and bottom rail. The native app now has Archive Tab,
   an Archived section, Restore, and Archive All Tabs (sidebar context menu), all in the shared `archived_groups`
   format.

## Verification log
- 2026-11-08 (Mac, running app, synthetic dev library), verified by driving the UI:
  - session menu switch (Ten Words Test → Study);
  - archive Psalm 23 → Archived row (`archived_groups` row written, tabs_json in the JS tab shape) → restore
    (row soft-deleted);
  - drag Psalm 23 from last to second → order kept after quit/relaunch;
  - passage pill → picker → chapter 24 → Back returns to Psalm 23;
  - workspaces section opens the saved workspace;
  - export/import as in CHANGELOG.
- Not yet verified: VoiceOver pass over the new sidebar; narrow-window behaviour (sidebar collapse); dark mode.

## Mac control styling audit

| Surface | Source finding | Follow-up |
|---|---|---|
| Scripture selection | Highlight, Export, and More used menu button chrome inside the same glass capsule as plain actions. The rectangular hover fill repeated that shape. | Use plain menu triggers with the shared capsule hover treatment. Check idle, hover, pressed, and open menu states in light and dark appearances. |
| Scripture window toolbar | Passage navigation uses the native navigation control group. Edition, display, and study actions are independent native toolbar items. | Keep the picker in this toolbar. Check order and overflow in a narrow window, and inspect LXX flip and flip-back frame by frame. |
| Lexicon and Compare | Full Lexicon navigation floats over its entry, Compare uses a window toolbar on Mac, and inspector entry actions are inline. | Check enabled and disabled neighbors, long labels, and pointer feedback. Reserve floating glass for controls that sit above scrolling content. |
| Sidebar and Search | Sidebar row selection, close affordances, workspace switching, and Search result overflow use several SwiftUI styles. | Compare hover, keyboard focus, disabled actions, and selected states across sidebar rows and Search results. Check the filter popover at minimum window size. |
| Notes editor | Format and Share are native window-toolbar menus. Note rows have separate inline and context actions. | Check consistent menu icons and contrast in a narrow window, then verify rich editing commands alongside keyboard shortcuts. |


## 2026-11-19 — Psalm opening and numbering metadata

One verse1 marker now begins the muted italic title/body group in both native readers. Multiple title rows stay together, body alignment no longer depends on leading title tabs, and title/body use a single verse paragraph. Selection outlines include both. Short secondary summaries replace long LXX notices; native popovers reveal detail without adding toolbar buttons or persistent banners. Mac and iPhoneSimulator standard layouts and title/group selection checked; iPhone word handles retained. Do not claim the full font/Dynamic Type/VoiceOver or physical cursor/scroll matrix. The Mac sidepanel also exposed repeatedVerse1 cross-reference groups; source identity correction is next, not solved by the visual change.


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

Reading-first annotation pass: quiet neutral margin dots for personal notes/tags, neutral chapter-tag summary, grouped contextual tag/note details, no per-verse Compare tag rows. Mac screenshot/AX and iPhone real touch verified; copy and range selection retained. Still audit marker hit areas/accessibility, hidden numbers, large type, long labels, dark/contrast and personal note citations. See READER-ANNOTATION-DESIGN.md.
