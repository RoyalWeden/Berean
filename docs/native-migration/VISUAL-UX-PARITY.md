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
| 7 | Workspaces | Settings → Layout list (save/load/delete) — hard to find | Sidebar **Workspaces** section (open, "Open" badge, rename/delete in the context menu, + to save), session menu, Settings section | ✅ ➕ | iPhone workspaces page |
| 8 | Scripture reading area | Sans/serif setting, verse numbers, red letters, note dots, highlights | Serif default, verse numbers, red letters, note dots, highlights | 🟡 | Partial-selection highlighting (TextKit, M5-01); verse tags |
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
