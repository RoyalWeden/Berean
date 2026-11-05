# 06 - macOS native architecture (proposal)

> **Baseline note.** Investigated at `807c2d9`. The final baseline is `d97fb05`. The only code changes between them are PRs #9, #10 and #11, listed in `01-REPOSITORY-STABILIZATION.md`: fixes for sync defects D1-D4, note table-cell formatting, and audio cache keys. Anything below describing those defects as present is corrected where noted.

Audit of commit `807c2d974b795f95f4c05b8ae4b6796c273b572c` (package.json 0.8.1), `/Users/roywe/Berean-audit`, read-only, 2026-11-05. This document proposes how the macOS study workflow could be represented as a genuinely native AppKit/SwiftUI application. It **proposes**; nothing here authorises implementation. Companion documents: 02 (architecture), 03 (feature inventory), 07 (iOS), 08 (shared Swift architecture), 14 (dependency map).

Evidence labels: **VERIFIED** (read in code or in Apple documentation during this audit), **INFERRED** (follows from verified facts, not observed), **UNVERIFIED** (stated by a doc/comment or recalled, not confirmed), **BLOCKED** (cannot be established under the audit rules: no builds, no dev server, no database reads, no device).

Apple documentation was queried through Xcode's documentation index (`DocumentationSearch`, Xcode 27.2 on macOS 27.2). Symbols quoted below were returned by that index unless marked otherwise. Availability annotations (which OS version introduced an API) were **not** returned by the index; every "requires macOS N" statement is therefore UNVERIFIED and must be checked against the SDK before a minimum-OS decision (see 08 section 12).

Ground rule applied throughout: a `WKWebView` (or any web view) hosting React/ProseMirror/pdf.js is **not** native, however polished the chrome around it. Where a web island is unavoidable (YouTube), it is named as such in section 12.

---

## 1. Summary of conclusions

1. **Do not choose "SwiftUI everywhere" or "AppKit everywhere".** The study workflow splits cleanly: SwiftUI is the better tool for the sidebar, lists, forms, settings, sheets, the search palette, inspectors and the tag/calendar surfaces; AppKit materially wins for the Scripture text surface (TextKit 2 in `NSTextView`), the user-configurable resizable pane tree (`NSSplitViewController`), context menus built from a hit-tested text position, window-level behaviour (restoration, full screen, panels) and the responder chain. VERIFIED that the AppKit APIs exist; the SwiftUI-side limits are INFERRED (see 3.3).
2. **Scripture is the hard 20 percent.** Highlights are stored as character offsets into the *plain* `verse.text` of a specific `text_id` (03 H02, VERIFIED), while the screen shows word-replaced, bracket-filtered, optionally Strong's-annotated text. A native reader needs an explicit, tested **display-to-plain offset map** per verse. This is the single most important design object in this document (section 9).
3. **Vertical tabs, Sessions, Spaces and saved workspaces should stay a custom, Berean-distinctive model** rendered natively (a sidebar `List` plus a custom pane tree). Native `NSWindow` tabbing is horizontal, one window per tab, and cannot express Spaces/Sessions/Archived groups (INFERRED from AppKit's tab model; not re-fetched). Sessions already exist as SQLite rows (`sessions`, `tabs`, `archived_groups`), so this is a rendering port, not a model redesign.
4. **The cross-window relay disappears.** Every Electron window is its own renderer with its own Zustand store, glued together by `src/lib/crossWindowSync.ts` over `cross-window:*` IPC (02 section 7, VERIFIED). A native process has one address space: windows share an `@MainActor` model and differ only in per-window view state. This removes an entire class of defects (pending-save flush on pop-out return, stale peers) but changes what "synced window" means.
5. **Adopt Mac conventions in chrome and menus; keep Berean's distinctiveness in model and content.** Concrete shortcut conflicts with macOS conventions are listed in section 8 (notably Cmd+H remapped to History, Cmd+G vs Find Next, Cmd+Shift+S vs Save As, Ctrl+Tab MRU vs next-tab).
6. **Liquid Glass: use it where the system already does, do not paint it onto Scripture.** Building with the current SDK gives system toolbars, sidebars and sheets glass automatically (INFERRED); custom glass is limited to the few floating controls that exist today (rail handle, presenter pill, floating search). `NSGlassEffectView` and `NSGlassEffectContainerView` exist (VERIFIED, documentation returned) and replace the hand-written `native/mac-liquid-glass/berean_glass.m` Node-API addon.
7. **Biggest macOS-specific risks:** (a) TextKit 2 behaviour and performance on Psalm 119 / Isaiah-length chapters inside a continuous multi-chapter scroll (UNVERIFIED, needs a spike); (b) a native notes editor with the private markdown dialect (callouts, columns, threads, NBSP indent, coloured highlights) (UNVERIFIED, highest product risk after Ask Berean, per 03 N02); (c) accessibility of a single large text view (needs explicit per-verse accessibility children); (d) the YouTube surface, which cannot be native.

---

## 2. Current macOS behaviour that a native version must account for

All VERIFIED unless marked.

| Area | Current implementation | Anchor |
|---|---|---|
| Shell | One `index.html`; `src/main.tsx` picks root by query string: main `App`, `FloatingShell` (`float=1`), `ViewerApp` (`viewer=1`), `StudyTrailApp`, `VersePickerApp`, `ChatWindowApp` | `src/main.tsx`, 02 section 2.3 |
| Window kinds | Main (peer, mirrored, or independent), floating pop-out tab, presenter/viewer, Study Trail, Berean Chat, verse picker, hidden render windows, BibleGateway import, transcript workers | 02 section 4 (9 kinds), `electron/main.ts` |
| Window chrome | `titleBarStyle: 'hiddenInset'`, `trafficLightPosition {x:20,y:20}` on main; secondary windows opaque; main window transparent + vibrancy + native glass pane behind the web view | `electron/main.ts:797,1151-1168` |
| Spaces | `SpaceId = scripture | notes | lexicon | youtube | search`; `tabs: Record<SpaceId, Tab[]>`; Cmd+1..5 jumps | `src/types/index.ts`, `src/App.tsx` keydown |
| Tab types | `bible, note, lexicon, youtube, search, pdf, tags, history, settings, calendar` | `TabType` |
| Sessions | Named live tab groups; snapshots are "Saved sessions" (workspaces); archived groups; MRU; auto-close after N minutes (5-minute sweep) | `sessionsService.ts`, `App.tsx` auto-close effect |
| Layouts | 16 Scripture layouts (`LayoutPicker.tsx`: standard, reading, scripture-focus, notes-right, notes-bottom, notes-top, commentary, panel-bottom, panel-left, notes-wide, scripture-wide, study-grid, lexicon-crossref (2x2), split-bottom, triple-col, compare-notes); CLAUDE.md says 6 | `src/components/bible/LayoutPicker.tsx` |
| Panel engine | `react-mosaic-component` (`Mosaic`/`MosaicWindow`), tree persisted as JSON in `workspaces.layout_json`; `onChange -> updatePanelLayout` | `src/components/shell/PanelLayout.tsx:74-85` |
| Inspector | Attached side panel with magnetic widths (Compact 260 / Standard 300 / Expanded 420, max 520), pane-relative reading margins, topmost verse stays put on resize | `docs/design-system.md` "Reading column" |
| Presenter | Separate renderer; `ViewerPayload` union (`bible | note | lexicon | compare | idle`) with `scrollPercent` fractions; opaque window; owned by the window that opened it | `src/types/viewer.ts`, `useViewerSync.ts`, `main.ts:778` |
| Menu | `buildAppMenu()` (File/Edit/View/Go/Window/Help); most accelerators are `registerAccelerator:false` because the renderer keydown layer owns them; menu clicks become `berean:*` DOM events | `electron/main.ts:376-640` |
| Window restoration | Per-window-kind bounds saved to the SQLite `settings` table, debounced 300 ms, with `boundsFitAnyDisplay` for disconnected monitors | `electron/main.ts:653-710` |
| Appearance | 38 theme presets, custom themes, accent from system, reduce-transparency/increase-contrast pushes (`app:reduceTransparency`, `app:increaseContrast`, `app:accentColorChanged`), Liquid Glass via native addon | `src/lib/themePresets.ts`, `berean_glass.m` (345 lines) |
| YouTube | Electron `<webview partition="persist:youtube">`, auto-PiP via injected `video.requestPictureInPicture()`, timestamp insert | `YouTubeTab.tsx` |
| PDF | pdf.js in renderer; highlights stored as `rects_json` normalised to page; bookmarks; hash-matched metadata sync, bytes never sync | `PDFViewer.tsx:37`, `bereanMigrations.ts:290,1183` |

---

## 3. Framework decision: SwiftUI vs AppKit, surface by surface

### 3.1 Method

For each surface the table states what the current app does, what each framework offers (VERIFIED where an API name is cited from the documentation index), and a recommendation. "AppKit wins" is claimed only where there is a concrete capability gap.

### 3.2 Decision table

| Surface | SwiftUI | AppKit | Recommendation |
|---|---|---|---|
| App lifecycle, scenes, settings window, menu commands | `App`, `WindowGroup`, `Window`, `Settings`, `.commands`, `focusedSceneValue` (INFERRED names; standard) | `NSApplicationDelegate`, main menu, responder chain | **SwiftUI** for scene declaration and commands; drop to `NSApplicationDelegateAdaptor` for open-URL, termination (export on quit) and Dock behaviour |
| Sidebar (Spaces, Sessions, Tabs) | `List`/`OutlineGroup`/`DisclosureGroup`, `draggable`/`dropDestination`, selection, `NavigationSplitView` | `NSOutlineView` + `NSSplitViewItem(sidebarWithViewController:)` | **SwiftUI** list in a system sidebar item. `NSSplitViewItem` sidebar behaviour (translucent material, collapse, overlay in full screen, standard 0.15 preferred fraction) is VERIFIED from the doc text and is what `NavigationSplitView` is expected to give (INFERRED) |
| Window root: sidebar + content + inspector | `NavigationSplitView`, `.inspector` (INFERRED) | `NSSplitViewController` with `sidebar`, `contentList`, `inspector` item behaviours, `toggleSidebar(_:)`, `toggleInspector(_:)` (VERIFIED) | Either works. **Preferred: SwiftUI outer shell**, because Cmd-Opt-S style actions and toolbars integrate with scene commands; keep AppKit in reserve if the spike shows toolbar/inspector behaviour gaps |
| User-resizable pane tree with 16 presets and saved layouts | `HSplitView`/`VSplitView` (macOS-only, INFERRED: no documented API for programmatic divider positions, min/max per pane, collapse animation or autosave per node; **not verified**) | `NSSplitView`/`NSSplitViewController`: `holdingPriority`, `minimumThickness`, `canCollapse`, `autosaveName`, programmatic `setPosition(_:ofDividerAt:)`, `insertSplitViewItem(_:at:)` / `removeSplitViewItem(_:)` (VERIFIED from index) | **AppKit wins.** A recursive `PaneTree` (value type) rendered by nested `NSSplitView`s, hosted in SwiftUI through `NSViewControllerRepresentable` |
| Scripture text | `Text(AttributedString)` per verse in `LazyVStack`; `TextEditor(text:selection:)` with `AttributedTextSelection` exists (VERIFIED) but it is an editor, not a hit-testable reader | `NSTextView` on TextKit 2: `NSTextLayoutManager`, `textLayoutFragment(for: CGPoint)`, `enumerateTextSegments(in:type:options:using:)`, `NSTextViewportLayoutController` (all VERIFIED) | **AppKit wins** (section 9) |
| Notes editor | `TextEditor(text: AttributedString, selection:)` (VERIFIED API; macOS availability UNVERIFIED) | `NSTextView` TextKit 2 | Decision deferred to a spike; see 07 section 9 for the shared analysis |
| Lexicon, Settings, Tag manager, Calendar, History, Study Trail lists, Chat list | Forms, lists, `Canvas`, sheets | n/a | **SwiftUI** |
| Study Trail map and Tag graph | `Canvas` + gestures + custom force layout (port `tagForceLayout.ts`, `trailGraph.ts`) | n/a | **SwiftUI Canvas**; accessibility and keyboard model (arrows pan, +/-/0 zoom, Tab cycles nodes per design-system.md) must be re-implemented |
| Floating search / command palette | SwiftUI overlay or `.popover`/sheet | `NSPanel` | **SwiftUI** content in an `NSPanel` (non-activating, centred) if window-level behaviour needs it |
| Context menus on Scripture text | `.contextMenu` is item-based | `NSTextView.menu(for:)` / `NSMenuItem.view` (the latter is how swatch rows are normally built; INFERRED) | **AppKit** for text surfaces; SwiftUI `.contextMenu` elsewhere |
| Toolbars | `.toolbar`, `ToolbarItemGroup`, `.searchable` | `NSToolbar` | **SwiftUI**; AppKit only if per-panel customisable toolbars are wanted (not a current feature) |
| PDF | `PDFView` wrapped | `PDFKit.PDFView` | **AppKit/PDFKit** via representable (section 13) |
| YouTube | `WKWebView` wrapper | `WKWebView` | Web island (section 12) |

### 3.3 Where the SwiftUI limits are asserted, not verified

The index returned no documentation on `HSplitView`/`VSplitView` limits, so "no programmatic divider control" is **INFERRED from the API surface I recall**, not confirmed. The pane-tree recommendation therefore rests on the VERIFIED presence of the richer `NSSplitView`/`NSSplitViewController` API plus the INFERRED absence in SwiftUI. A one-day spike (build the 16 presets, persist and restore divider fractions, collapse a pane with animation) would settle it and is the cheapest way to reduce risk.

---

## 4. Window and scene architecture

### 4.1 Proposed scene set

| Scene | Native construct | Replaces | Notes |
|---|---|---|---|
| Main window (workspace) | `WindowGroup` (value-based, id = `WindowSession`) | `createWindow()` peer + independent windows | Multiple windows allowed |
| Presenter | `Window("Presenter", id: "presenter")` single-instance scene | `createViewerWindow()` | Section 6 |
| Pop-out tab / floating panel | `WindowGroup(for: TabID.self)` or `NSPanel` | `createFloatingWindow()`, `FloatingShell`, `FloatingHoverPanel` | Section 7 |
| Study Trail window | `Window(id: "trail")` | `createStudyTrailWindow()` | single instance today |
| Berean Chat window | `Window(id: "chat")` | `createChatWindow()` | `Cmd+N` in chat means "new conversation" today (`main.ts` Window menu) |
| Verse picker | sheet/popover from the originating window | `createVersePickerWindow()` (child window) | no separate window needed |
| Settings | `Settings { }` scene | `SettingsModal` (1,836 lines) | Cmd+, is automatic |
| Hidden PDF/print render windows | `NSPrintOperation`, `PDFDocument` generation, `ImageRenderer` | `app:printNote`, `app:exportNotePDF` hidden windows | removes `sandbox:false` hidden `BrowserWindow`s |
| BibleGateway import | `ASWebAuthenticationSession`-style or `WKWebView` inside a sheet | `bgImport.ts` | web island, optional feature (03 N14 says Mac-only importer) |
| Transcript workers | **not shipped**; dev tool target | `youtube.ts` transcript windows | must stay dev-only (project rule) |

### 4.2 Shared model, per-window state

Current: "synced peer windows share tabs, sessions, settings; each keeps its own active tab, space, layout and scroll" (`main.ts` Window menu comment; `crossWindowSync.ts` `SHARED_PREFERENCE_KEYS`; per-window slice listed in 02 section 7).

Proposed native split:

- `WorkspaceModel` (`@MainActor`, `@Observable`): sessions, tabs (with fractional order keys), archived groups, workspaces; backed by the SQLite tables through the `SessionsService`; **one instance per process**.
- `WindowState` (one per window, persisted through `@SceneStorage` for restoration and the device-local `session_local_state` table where that already exists): active space, active tab id per space, `PaneTree`, scroll anchors, inspector width, find-bar state, selected verses.
- "Standalone window" (`Cmd+Opt+N`, own tabs/sessions, not synced) maps to a `WindowSession` that points at a *different* session set. VERIFIED that it exists today; whether users depend on it is UNVERIFIED. It is cheap to keep because the model is session-keyed.
- Database-to-UI invalidation: `src/lib/syncInvalidation.ts` (`INVALIDATES` map from sync entity to a store token) becomes an `AsyncStream<ChangeEvent>` from the database layer (see 08 section 6), observed per view model.

### 4.3 What disappears

`window.crossWindow`, `cross-window:broadcast|sendTo|list|selfId`, `installCrossWindowChangeBroadcast` with `withSender` (AsyncLocalStorage), `flushPendingSaves` on pop-out return, `perWindowViewState.ts` as a storage hack, and 295 IPC `handle` channels (02 section 5). VERIFIED that these exist; INFERRED that none has a native counterpart.

---

## 5. Sidebar, Spaces, vertical tabs, sessions, custom tab groups

### 5.1 Behaviour to preserve (03 U01-U04, VERIFIED)

Five Spaces each with a tab list; Arc-style vertical lists; sessions as named groups; archived groups; MRU; move/duplicate/rename/close others; drag reorder (Mac); right-click menus; `Tab.isPinned` is persisted and synced but **no code sets it** (03 U03), so it is not a feature to port, only a column to preserve.

### 5.2 Proposed structure

```
NavigationSplitView (or NSSplitViewController sidebar item)
  Sidebar: List(selection: $selectedTabID)
    Section "Scripture"   -> sessions as DisclosureGroup -> tab rows
    Section "Notes" ...
    (Lexicon / YouTube / Search spaces)
    Footer: Archived groups, History, Settings entry
  Detail: PaneHost(tree: windowState.paneTree)
```

- Do **not** use `NSWindow` native tabs. They are horizontal, one window per tab, and do not model Spaces or sessions (INFERRED). A user-visible Window > Merge All Windows behaviour would also conflict with peer-window semantics.
- Row model: `TabRow(id, type, title, icon, isPlaying, hasUnsavedState)`; context menu: Close, Duplicate (the single `duplicateTab` action with history deep copy, 03/navigation docs), Move to Session, Move to Panel, Open in New Window, Pop Out.
- Drag and drop: `Transferable` payload `TabDragItem { tabID, sourceSessionID }`; drop computes a new fractional order key with the existing algorithm (`src/platform/sync/fractional.ts`, 160 lines; port as `FractionalIndex` with the same test vectors).
- Keyboard: roving selection with Up/Down/Home/End, Shift+F10 / the Menu key for the context menu (design-system.md "Keyboard model"). SwiftUI `List` provides arrow-key selection and `.contextMenu`; Home/End and typeahead need verification (UNVERIFIED).
- Scale: a user may hold hundreds of tabs (the author's DB shows 3,375 notes, not tabs; tab counts are UNVERIFIED). `List` is lazy; no performance claim is made without a measurement.
- **Keep distinctive:** Sessions as live named groups, Archived groups, auto-close-after-N-minutes, the per-tab history stacks and `originTabId` return behaviour (`navigateToVerse` single entry point, `docs/navigation-contract.md`). **Adopt Mac conventions:** sidebar material and collapse behaviour, selection highlight, disclosure triangles, standard drag feedback, standard rename-in-place.

### 5.3 Ctrl+Tab MRU switcher

`App.tsx` implements a Ctrl+Tab overlay that commits on Ctrl release (`onKeyUp` for `Control`). This is distinctive (Arc/Chrome-like). Natively it needs an `NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .flagsChanged])` because SwiftUI has no key-up/modifier-release hook (INFERRED). Keep it, but also provide sequential next/previous tab commands (Cmd+Shift+] and Cmd+Shift+[, Safari/Terminal convention) so a standard path exists (section 8).

---

## 6. Presenter / viewer window

Current (VERIFIED): `createViewerWindow()` (`main.ts:778`), opaque, separate renderer with its own Zustand store; the main window pushes `ViewerPayload` (kind `bible` carries `bookId, chapter, verse?, textId, hiddenAnnotations?, sidePanel?, scrollPercent?, sidePanelScrollPercent?`; `compare` carries per-column `scrollPercents`); `useViewerSync.ts` is the bridge; `window.__bereanPresenterDebug` exists; the presenter is tied to the window that opened it (`viewerOwnerId`); the main Scripture pane draws a dashed "outline band" showing what the presenter shows (`presenterBand.ts`, `PresenterOutline.tsx`); viewer-local zoom with Cmd +/-/0 (`ViewerApp.tsx:278-282`).

Native proposal:

- `Window("Presenter", id: "presenter")` scene; content = a read-only `ScriptureView` bound to a `PresenterModel` (`@MainActor @Observable`) that the owning window writes to. Same process, so no payload serialisation, no `useViewerSync`.
- **Do not synchronise by pixel or percent.** `scrollPercent` is a proportional hack across differently sized windows. Synchronise by *anchor*: `(verse, fractionWithinVerse)` plus the column width class. The "verse-fraction geometry" pipeline that `presenterBand` already uses (design-system.md "Presenter state") is the right abstraction; `NSTextLayoutFragment` frames per verse paragraph give exact verse geometry in TextKit 2 (VERIFIED API: `textLayoutFragment(for:)`, `enumerateTextLayoutFragments`).
- Outline band in the main window: an overlay view positioned from the presenter's visible verse range mapped through the main text view's fragment frames.
- Multi-display: `NSScreen.screens`, `NSWindow.collectionBehavior` for full-screen on a secondary display; remember last screen by `NSScreen.localizedName`/frame (INFERRED; current code uses bounds + `boundsFitAnyDisplay`).
- Non-fullscreenable windows: the View menu "Enter Full Screen" is disabled per-window today (`main.ts` `toggle-fullscreen` id and `browser-window-focus` handler). Natively, `NSWindow.collectionBehavior = [.fullScreenNone]` makes the system disable it automatically. This is a place where AppKit removes custom code.
- Tests to port: `presenterBand.test.ts`, `presenterCenteredBand.test.ts`, `presenterPercentForScrollTop.test.ts` (existing test names, 03 U07) become pure-function tests over the geometry module.

Risk: the presenter is a Mac-only capability (iPhone has no equivalent, `UIApplicationSupportsMultipleScenes = false`, 03 U07). It must live in the macOS-only layer (08 section 4).

---

## 7. Floating panels, pop-out windows, hover panel and rail

Current (VERIFIED): floating pop-out tab windows (`?float=1&type=...`), a "floating hover panel/rail" (`FloatingRail`, `FloatingHoverPanel`) for a collapsed sidebar, `app:returnFloatTab`.

Proposal:

- Pop-out tab = `WindowGroup(for: TabID.self)` rendering the same `TabContentView` as the main pane; "Return to main window" = close + reinsert (same model, so no save flush).
- Hover rail / collapsed sidebar: with a real `NSSplitViewItem` sidebar, the system provides collapse and overlay-in-full-screen (VERIFIED from the doc text: "ability to overlay at small split view sizes in full-screen mode"). The custom rail may be reducible to the system behaviour; whether Berean's rail UX is worth keeping is a design decision, not a technical one. **Mac convention wins here unless the rail is considered core identity.**
- Quick lexicon/Strong's peek: `NSPopover` (transient) anchored to the hit-tested segment rect (section 9.6), not a floating window.
- If a true always-on-top reference window is wanted (e.g. lexicon beside a video), use an `NSPanel` with `.floating` level and `.nonactivatingPanel`. Only add if the current pop-out is used that way (UNVERIFIED).

---

## 8. Toolbars, menu bar and every shortcut in the current app

### 8.1 Toolbar

Design system target: window toolbar 44 pt, bar controls 36 pt, grouped controls in capsule `ControlGroup`s, a lone icon in a bar is a circle (design-system.md "Layers"). Those rules describe what the system toolbar already does in current SDKs (INFERRED); a native toolbar should be built with `.toolbar { ToolbarItem... }` and let the system own metrics. Panel-specific controls today are portalled into `ShellHeader` through `TabHeaderPortal`; the native equivalent is a per-active-tab `.toolbar` plus `navigationTitle`/`navigationSubtitle`, with the reference field as the principal item. Keep: reference bar, translation menu, Strong's toggle, layout picker, compare toggle, inspector toggle, read-aloud, presenter toggle.

### 8.2 Menu bar

Native: SwiftUI `.commands { CommandMenu / CommandGroup(replacing:) }` with `@FocusedValue`/`focusedSceneValue` so a menu item acts on the **key window's** model. This replaces `menuSend()` plus the string-named `berean:*` DOM events (03 U09 notes "event names are an undocumented contract among components"). Standard roles (Undo/Redo/Cut/Copy/Paste/Select All, Services, Hide, Quit, Minimize, Zoom, Bring All to Front, Help search) come from the responder chain for free. The existing Berean menu structure is retained: File (New Note, New Verse Note, New Scripture/Lexicon/YouTube Tab, Today's Daily Note, Close Tab), Edit, View (Toggle Sidebar, Toggle Inspector, Strong's Numbers, Focus Mode, Zoom, Find, Full Screen), Go (Back, Forward, Previous/Next Chapter, Go to Reference, History, Search Everything), Window (New Window, New Standalone Window), Help (Berean Help, Keyboard Shortcuts, Markdown Reference).

Gaps in today's menu that a native app would also expose (VERIFIED absent from `buildAppMenu`): Open Presenter (only Cmd+Shift+B and command palette), Read Aloud play/pause (Cmd+Shift+R), Insert Timestamp, Print (Cmd+P is handled only by `App.tsx`), New Session, Settings is in the app menu only.

### 8.3 Shortcut inventory (VERIFIED from `electron/main.ts`, `src/App.tsx`, `src/lib/commands.ts`, `src/components/notes/pm/keymap.ts`, `ChapterView.tsx`, `ViewerApp.tsx`)

Notation: C = Command, S = Shift, O = Option, Ctl = Control.

| Shortcut | Current action | Source | Native handling | Mac-convention note / recommendation |
|---|---|---|---|---|
| C+, | Settings | menu + `App.tsx` | `Settings` scene (automatic) | keep |
| C+Q, C+Opt+H (hideOthers), role `services`, `about` | system roles | menu | automatic | keep |
| **C+S+H** | Hide app (remapped) | `main.ts` custom hide | restore **C+H = Hide** | **change**: C+H is the universal Hide; move History to **C+Y** (Safari/Finder convention for History) |
| C+H | Open History | `App.tsx` | becomes C+Y | change |
| C+W | Close tab (not window) | `before-input-event` + menu | `CommandGroup(replacing: .saveItem)` Close Tab; C+S+W could close window | keep: matches Safari/Terminal tab semantics |
| C+N | New synced window | menu + `App.tsx` | `WindowGroup` new window | keep |
| C+Opt+N | New standalone window | menu + `App.tsx` | custom command | keep (UNVERIFIED usage) |
| C+T | New tab (opens floating search, new-tab intent) | `App.tsx` | command | keep |
| C+K | Floating search, current-tab intent | `App.tsx` | command | keep |
| C+L | Menu says "Go to Reference" (`focus-ref-bar`); renderer opens floating search in **current-tab** mode | `main.ts` vs `App.tsx:842-846` | one behaviour must be chosen | **inconsistency in current app** (menu label vs renderer behaviour; `docs/ux-principles.md` §2 documents the renderer behaviour). Mac convention: C+L focuses the address/location field; keep the *renderer* behaviour and fix the menu label |
| C+/ | Floating search (current tab) | `App.tsx` | command | redundant with C+K/C+L; consider dropping |
| C+F | Find, routed to last-focused panel (Bible find bar, Notes FindBar, Lexicon FindBar); type-anywhere auto-opens find | `App.tsx` | responder-chain `performFindPanelAction`/`NSTextFinder` for text views, custom for Scripture (see 9.7) | keep; type-to-find is distinctive |
| **C+G** | Toggle Strong's numbers | `App.tsx`, menu | conflicts with system **Find Next** (C+G) and C+S+G Find Previous | **open decision**: if the system find bar is used, C+G must mean Find Next while it is active; move Strong's to another binding (candidates: Ctl+C+S, C+Opt+S; not chosen here) |
| C+S+F | Search Everything (Search tab) | `App.tsx` | command | keep |
| C+S+N | New note | menu + `App.tsx` | command | keep (not a system convention conflict in a non-Finder app) |
| C+S+V | New verse note | menu | command | note: C+S+V is "Paste and Match Style" in many apps; risk of conflict inside text views. **Review** |
| C+S+D | Today's daily note | menu + `App.tsx` | command | keep |
| C+S+S | Toggle sidebar | menu + `App.tsx` | `toggleSidebar(_:)` (VERIFIED) / `SidebarCommands` | **change to system**: Show/Hide Sidebar is Ctl+C+S in Finder/Mail; C+S+S is Save As-style elsewhere |
| (none) | Toggle inspector | menu has no accelerator | `toggleInspector(_:)` (VERIFIED) | assign system-style (Opt+C+I is Inspector in many apps; UNVERIFIED) |
| C+S+U | Toggle Focus mode (notes) | `App.tsx` | command | keep; Escape exits |
| C+S+B | Open Presenter | `App.tsx`, commands | command | keep; add menu item |
| C+S+R | Read Aloud play/pause | `App.tsx` | command | keep; add menu item |
| C+S+P | YouTube PiP toggle | `App.tsx` | command | note: C+S+P is Page Setup in many apps; keep (no print setup) |
| C+S+L | Insert YouTube timestamp | `App.tsx`, commands | command | keep |
| C+S+0 | New session | `App.tsx` | command | keep |
| C+1..C+5 | Jump to Space | `App.tsx` | commands | keep |
| C+[ / C+] | Back / Forward in tab history | menu | commands | keep (Safari convention) |
| C+= / C+- / C+0 | App zoom in/out/reset | menu + `App.tsx` | commands scaling Scripture font; system "Zoom" in Window menu is a different thing | keep, but name "Make Text Bigger/Smaller" if it scales text only |
| C+P | Print preview for the active note (Notes space only) | `App.tsx:900-910` | `NSPrintOperation` with validation (enabled only when printable content exists) | keep; add to File menu |
| C+C / C+S+C (verse selection) | Copy verse / copy with reference | `ChapterView.tsx:936-952` | override `copy(_:)` in the text view subclass | keep |
| C+Z, C+S+Z / C+Y (editor) | Undo / redo | `keymap.ts` | automatic in text views | keep; note C+Y in the editor is **redo** in ProseMirror today, which collides with the proposed C+Y History. Editor focus wins; menu item is validated |
| C+B / C+I / C+U / C+` / C+S+H (highlight) | Bold / italic / underline / code / highlight in editor | `keymap.ts` | editor-local commands | **conflict**: editor C+S+H is highlight, app C+S+H is Hide (today); resolved by restoring C+H = Hide |
| Tab / S+Tab | Indent / outdent (blockquote nesting, list lift) | `keymap.ts`, `indent.ts` | editor | keep |
| S+Enter | Hard break | `keymap.ts` | editor | keep |
| C+S+ArrowUp / ArrowDown | Move top-level block | `keymap.ts` | editor | keep |
| C+S+M | Toggle markdown (edit/view) | `commands.ts`, CLAUDE.md | command | the handler location was not found in `App.tsx`; UNVERIFIED |
| Ctl+Tab / Ctl+S+Tab | MRU tab switcher, commit on Ctrl release | `App.tsx:745-770` | local event monitor | keep (distinctive); add C+S+] / C+S+[ sequential |
| Escape | Close floating search, popovers, exit Focus mode, clear verse selection | multiple | responder chain `cancelOperation` | keep |
| Verse badges: Up/Down, S+Up/Down, Enter, Escape, S+F10 | Move/extend/toggle verse selection, open verse menu | `ChapterView.tsx:976-986`, design-system.md | custom key handling in the text view | keep; must be re-implemented |
| Space, Page Up/Down, Home, End | native scroll keys | design-system.md; `BiblePanel.tsx:1119-1121` has custom handling for presenter scroll | `NSScrollView` handles | keep native |
| Arrow keys, +/-/0 in graphs | pan/zoom graph | design-system.md | Canvas key handlers | keep |
| C+click on Strong's | Open in new tab | `LexiconPanel.tsx:230`, `BibleRightPanel.tsx:423` | modifier-aware click | keep |
| Viewer C+= / C+- / C+0 | presenter-local zoom | `ViewerApp.tsx:278` | scene-local commands | keep |

Items present in CLAUDE.md but not found in code: `Cmd+Shift+M` handler location, `Cmd+Shift+L` is present, `Cmd+Shift+F` is present, shortcut editing is "deferred". Shortcut parity with CLAUDE.md is "partly verified" in 03 U10; the table above is the code-derived list and supersedes CLAUDE.md. A trackpad two-finger swipe opens/closes the side panel (`useSwipePanelGesture`, `main.ts` swipe begin/end forwarding, 03/`useSwipePanelGesture.ts`): native equivalent is `NSEvent` scroll phases or `NSPanGestureRecognizer`; keep as a Berean-distinctive trackpad gesture with a setting (`swipePanelGestureEnabled` exists).

### 8.4 Keyboard navigation and Full Keyboard Access

The documented keyboard model (design-system.md "Keyboard model") is thorough: verse badges focusable, roving lists, menu typeahead, rail focus, graph navigation. Natively most of it comes from standard controls; the Scripture text view, verse selection, graph canvases and the presenter controls need explicit work. Testing against **System Settings > Keyboard > Keyboard navigation / Full Keyboard Access** is required (BLOCKED here; cannot run).

---

## 9. Scripture rendering, selection, hit testing, highlights and Strong's chips

This is the most consequential macOS design decision. VERIFIED facts from the current app:

- Verse text is in SQLite `verses(id, book_id, chapter, verse_num, text, text_tagged?, title?)` (03 X5).
- `text_tagged` grammar: `word{H7225}`, `word{}`, `*word{}` italic, `!word{G1063}` red letter, `~{H853}` particle, `word{H914|H996}` multi, with malformed `sup>`/`blu>` fragments tolerated (`src/lib/taggedTokens.ts`, 90 lines; 03 S01).
- Highlights: `highlights(id, text_id, book_id, chapter, verse_num, start_word, end_word, start_char, end_char, color, label, created_at)`; three coordinate systems coexist: verse-level, **word index into tagged tokens** (legacy), and **char offsets into plain `verse.text`**; deterministic ids `hl-<textId>-<bookId>-<chapter>-<verse>-<v|wS-E|cS-E>` are a sync contract (03 H01/H02).
- Display transforms applied before render: word replacer rules (divine names), per-text annotation hiding (`ANNOTATION_KEYS`: italics, supply brackets), Psalm superscriptions, section titles, red letter (03 S04, S16).
- No re-anchoring exists if text DB corrections shift characters (03 H02 limits).
- The reader is not virtualised: `ContinuousChapterScroll` windows chapters (`LOAD_AHEAD = 1`, `WINDOW_CHAPTERS = 2`), each chapter renders all verses; the app's own perf doc reports Mac scroll with 0 frames over 25 ms (UNVERIFIED by this audit) (03 S14).

### 9.1 Recommended architecture

```
VerseTextModel (pure Swift, BereanText module, unit-testable without UI)
  plain: String                    // verse.text, source of truth for stored offsets
  tokens: [TaggedToken]            // parsed text_tagged
  display: AttributedString        // after replacer/annotation filters/inline Strong's
  map: DisplayMap                  // displayIndex <-> plainIndex, monotonic, with insert gaps
ChapterTextStorage
  one NSTextContentStorage per chapter window; each verse = one paragraph
  custom attributes: .bereanVerse(Ref), .bereanStrongs([id]), .bereanVerseNumber
ScriptureTextView : NSTextView (TextKit 2)
  NSTextLayoutManager + NSTextViewportLayoutController for lazy layout
  highlights, search hits, audio word-follow = rendering attributes (do not touch storage)
```

Why a single `NSTextView` per chapter window rather than a view per verse (VERIFIED APIs: `NSTextLayoutManager`, `NSTextViewportLayoutController`, `textLayoutFragment(for:)`, `enumerateTextSegments`):

- Native cross-verse range selection, native Copy, Services, Look Up, Writing Tools-neutral reading, dictation-free (read only), system text-finder hooks, selection geometry for toolbars.
- Viewport-based layout is designed for long documents (INFERRED; **not measured**; Psalm 119 + Isaiah 40-66 continuous scroll is the test).
- Per-verse SwiftUI `Text` would give per-verse accessibility and simple tap handling but **no cross-verse selection** (03 S14 risk 10 says exactly this) and `textSelection` is per-`Text` (INFERRED).

AppKit wins here because: custom hit testing, selection geometry, rendering-attribute overlays, accessibility children, menu construction from a text position, and `NSTextFinder`/`NSTextFinderClient` customisation are all text-system APIs.

### 9.2 The offset map (design object, not an implementation detail)

Stored highlights index `verse.text` (plain). The screen string differs when: (1) the word replacer substitutes names; (2) annotation filters remove or keep `[ ]` supply brackets; (3) inline Strong's mode inserts `H7225`-style text after words; (4) red-letter and italics change only attributes (no offset change); (5) tagged markup is stripped from `text_tagged` to produce displayed text (the existing `taggedTokenCharPos.test.ts` "pins how tagged tokens map to those positions", 03 S04).

Requirements for `DisplayMap`:

- Bijective on retained characters, with explicit "gaps" for inserted display text (Strong's chips, replacement text) that map to the owning plain index.
- Selection -> plain range: displayed `NSRange` in, `(startChar, endChar)` out, clamped to word boundaries only where the existing code does so (read `scriptureHighlight.ts`, `verseUtils.ts` first; not audited in detail here).
- Highlight -> display ranges: plain range in, one or more displayed ranges out (a replaced word is highlighted as a unit).
- Legacy word-index highlights resolve through the token list.
- **Conformance corpus:** every `(text_id, verse)` row with highlights in the author's database, rendered through both engines. BLOCKED here (databases were not opened). Without it the claim "offsets are preserved" is UNVERIFIED. Treat this as a gate before any native release that writes highlights.

### 9.3 Strong's chips

Two modes exist: superscript numbers inline (toggle per tab, `showStrongs`), and hover/click behaviours (tooltip, open lexicon tab, context menu: open, new tab, float, copy; 03 S05).

Options:

| Option | Pros | Cons |
|---|---|---|
| A. Chips as attributed runs (superscript, smaller font, muted colour, custom attribute `.bereanStrongs`) | Plain text flow, selection and copy stay predictable; offsets managed by `DisplayMap` | Not a "pill" visual; hover target is text-sized |
| B. Chips as `NSTextAttachment` with `NSTextAttachmentViewProvider` | Real pill UI, real views | Each attachment is one U+FFFC character that corrupts offsets/copy unless mapped; accessibility per chip; layout cost across thousands of chips |
| C. Superscript attributed run for display + overlay pill drawn on hover only | Best of both for common case | Hover overlay needs segment rect math |

**Recommendation: A for resting state plus C for hover/focus**, matching the current "chips styled subtly, not distracting" rule (CLAUDE.md section 6, design-system "Strong's chips") and Mac convention (inline annotations, not widgets). B is rejected because of the offset and copy semantics. VERIFIED that the iPhone already uses superscripts at 0.7 em inline (`docs/mobile/mobile-navigation.md` §6 "Strong's superscripts are 0.7em in the reader").

### 9.4 Verse-level hit testing

`NSTextLayoutManager.textLayoutFragment(for: CGPoint)` returns the fragment under a point (VERIFIED); with one paragraph per verse, the fragment maps to the verse. The verse number "badge" is a separate attribute run at paragraph start (clickable, focusable). Word-level hit testing (Strong's, replaced names) uses `characterIndex` plus attribute lookup. Drag-select along verse numbers (`verseDragSelect.ts`) is a custom `mouseDragged` mode that starts when the mouse-down lands on a badge run.

### 9.5 Highlights and overlays

Highlights, find hits, audio word-follow (`followState`, `timestampAlignment.ts`) and verse-selection tint should be drawn as **rendering attributes** on the layout manager (`setRenderingAttributes` is the intended API for non-storage decoration; **INFERRED, not returned by the index**; verify before committing). Benefits: no storage mutation (offsets stay stable), cheap invalidation per range, and the theme can recolour without re-layout. The 15 highlight colours (`HighlightColor`, 03 H03) become named tokens.

### 9.6 Selection UX and the highlight toolbar

Current: verse-number click selection (single/range/multiple), text-range selection that raises a highlight toolbar, selection bar. Native: observe `NSTextView` selection changes; compute `enumerateTextSegments(in:type:.selection...)` (VERIFIED) for the anchor rect; show an `NSPopover` (or a glass floating bar) there. Right-click: `menu(for:)` builds the verse menu from the hit-tested ref. Text selection hit-testing differs from DOM (03 S07 risk); selection -> offsets must be re-proven through 9.2.

### 9.7 Find

`NSTextFinder` gives the standard find bar for `NSTextView`, but Berean's find semantics are custom (`buildHighlightPattern`: phrase/all/any, matches the raw OR word-replaced text, number-word alternates; `src/lib/scriptureFind.ts`, `scriptureHighlight.ts`). Implement `NSTextFinderClient` over the display string with the shared matcher from the BereanText module, or keep a custom find bar. The iOS equivalent (`UITextSearching`, `UIFindInteraction`) is VERIFIED to support custom searchable objects (07 section 12).

### 9.8 Reading column, reading anchor, scrolling feel

- Left-anchored column with `--reading-max-ch` (86) measure and pane-relative margins -> `NSTextContainer.size`/`lineFragmentPadding` and `textContainerInset` computed from the pane width; side-panel "never makes the text jump" rules map to a fixed leading inset plus an inspector reserve value (design-system.md "Reading column"). VERIFIED rules; implementation INFERRED.
- `useReadingAnchor` (topmost visible verse stays put on width change) -> record the first fragment in `viewportBounds` before layout and restore after (`NSTextViewportLayoutController`, VERIFIED API).
- Native scrolling: `NSScrollView` elastic and momentum behaviour replaces `scrollbar auto-hide`, `Chromium sibling-selector restyle` workarounds and the ScrollWheel handling in `useChapterPullNav`. The pull-past-end chapter navigation (`ChapterPullIndicator`, `useChapterPullNav`) is Berean-distinctive; implementing it over elastic `NSScrollView` overscroll is feasible but **UNVERIFIED** (needs a spike; risk of fighting the rubber band).
- Dynamic type: macOS has no Dynamic Type; Berean's own size setting and `Cmd +/-` remain the control. The app should still honour the system "Increase contrast" and "Reduce motion" flags (section 11).

### 9.9 Performance expectations

None measured by this audit (BLOCKED: no running). Criteria to set before building: first chapter paint, Psalm 119 scroll p95 frame time, memory for 2-chapter window plus highlights, `ensureLayout(for:)` cost on a jump to verse 176. The existing perf doc and scripts (`scripts/perf/*`) define the baseline to beat.

---

## 10. Context menus, accessibility, appearance

### 10.1 Context menus

Current menus (03 S08): add verse note, show notes, cross refs, compare, tag, highlight swatches, copy, play from here, open in new tab/floating, idiom menu, note indicator menus; native `Menu` for note images (`app:noteImageMenu`); tab context menus. Native: `NSMenu` built from the hit-tested verse for text surfaces (colour swatches as a custom `NSMenuItem.view` or a submenu with swatch images; INFERRED approach), SwiftUI `.contextMenu` for sidebar/list rows. Convention to adopt: Shift+F10 / Control-click equivalence is automatic; menu rows 28 pt etc. become system metrics (drop the design-system.md menu-row spec).

### 10.2 Accessibility

State today (VERIFIED): `aria-label` usage, `role="switch"` presenter controls, keyboard model documented; **no VoiceOver audit performed** (`A14`, SPEC says so; BLOCKED to test). Native gives accessible standard controls for free; custom surfaces do not:

- Scripture text view: expose each verse as an accessibility element (`accessibilityChildren` / `NSAccessibilityElement` per paragraph frame) with label "verse 5", value text, actions (select, add note, highlight). Without this VoiceOver reads one giant text block (INFERRED standard behaviour).
- Verse selection announcements, highlight colour names (not just colour), note/tag indicators as accessibility custom content.
- Graph canvases: a parallel accessibility tree (nodes as elements).
- Read-aloud interplay: VoiceOver and Berean's own TTS must not both speak; provide a setting or detect `NSWorkspace.shared.isVoiceOverEnabled` (INFERRED API name).
- Respect `accessibilityDisplayShouldReduceMotion`, `...IncreaseContrast`, `...ReduceTransparency` through `NSWorkspace` and SwiftUI environment values (INFERRED names). Today these are pushed from main (`app:reduceTransparency`, `app:increaseContrast`) so the behaviour exists and must be preserved.
- Contrast helpers (`contrast.ts`) and the theme validator become a unit-tested pure module.

### 10.3 Appearance

- Light/dark/system: `NSApp.appearance` / SwiftUI `preferredColorScheme` (today `nativeTheme` source push).
- Accent: system accent via `.tint`; today `app:accentColorChanged`.
- **38 theme presets + custom themes** (`themePresets.ts`, `customTheme.ts`): the design system states a theme defines only palette variables and everything else is derived with `color-mix`. Native: a `Theme` struct of palette tokens, derived semantic colours computed once, delivered through `Environment`, with `NSColor(name:dynamicProvider:)` for light/dark. **Recommendation: themes colour the content layer (Scripture, Notes, Lexicon surfaces, highlights, accent); chrome (sidebar, toolbar, sheets, menus) stays on system materials.** This follows the design system's own layering rule ("chrome is glass, content is clean") and avoids fighting the OS appearance. Whether users expect the chrome to be tinted by themes is UNVERIFIED.
- Ambient theme animations (some presets have optional ambient animation, 03 U11) are optional; implement last, behind Reduce Motion.

---

## 11. Visual effects and Liquid Glass

VERIFIED from documentation: `NSGlassEffectView` ("embeds its content view in a dynamic glass effect"; `contentView`, `cornerRadius`, `style` with `.regular`/`.clear`, `tintColor`, `effectIsInteractive`), `NSGlassEffectContainerView` ("efficiently merges descendant glass effect views... can improve performance by reducing the number of passes"), `NSButton.BezelStyle.glass`, `NSVisualEffectView` with `blendingMode` `.behindWindow`/`.withinWindow` and materials such as `.sidebar`, `.underWindowBackground`.

Current: `berean_glass.m` looks the classes up by name with `NSClassFromString` and parks `NSGlassEffectView`/`NSVisualEffectView` behind the Chromium view; the renderer then draws "sidebar glass pane" cut-outs (`SidebarGlassPane`) and CSS `material-*` classes emulate materials (`design-system.md`).

Native proposal:

1. Build with the current SDK so toolbars, sidebars, sheets and system controls adopt glass automatically (INFERRED; Apple's "Adopting Liquid Glass" overview is referenced from the AppKit essentials page in the index but its content was not fetched).
2. Custom glass only for: floating rail handle (if kept), presenter-controls pill, floating search panel, the audio player capsule, selection/highlight bar. Group neighbours in `NSGlassEffectContainerView` (SwiftUI equivalent: `GlassEffectContainer`, INFERRED name).
3. Scripture, Notes and Lexicon bodies stay flat on `.material-content` equivalents (design-system.md rule "Content never glass"); this also matches the iPhone ux-principles §1.7 ("Scripture text is never translucent").
4. Fallbacks: if the minimum OS predates glass, `NSVisualEffectView` materials (VERIFIED API). A minimum-OS decision is needed before this is finalised (08 section 12).
5. Opaque secondary windows (presenter, trail, chat today) remain opaque by design.
6. Reduce Transparency must flatten every custom glass view (today pushed from main).

---

## 12. YouTube surface and Picture-in-Picture (web island, stated plainly)

YouTube offers no native playback API for arbitrary videos; any macOS app that plays them embeds web content. **This surface cannot be native.** What can be native is everything around it.

| Concern | Today | Native proposal | Label |
|---|---|---|---|
| Player | Electron `<webview partition="persist:youtube">` with login, browse, watch | `WKWebView` with a persistent `WKWebsiteDataStore` identified by a stable UUID (the analogue of the `persist:youtube` partition) | INFERRED API |
| Chrome (toolbar, layouts, secondary panels, transcript viewer, watch history, playlists, stars) | React in main renderer; 11 layouts (`youtubeLayouts.ts`) | Native; layouts reuse the pane tree (section 3) | VERIFIED today, INFERRED port |
| Channel feed | **Scraping** channel pages with `executeJavaScript(EXTRACT_JS)` in hidden windows; hard-coded `CHANNELS` array (not a user allowlist, contradicting CLAUDE.md) (03 M01) | Port as `URLSession` + parser, or move to the YouTube Data API; scraping fragility and ToS exposure carry over unchanged | VERIFIED today |
| Transcripts | **Dev-only** fetch (`youtube:fetchTranscripts`/`clearTranscripts` return `unavailable in production` unless `devToolsEnabled`); baked into `youtube_seed.db` (187 MB), shipped read-only (03 M04) | Keep the model: fetch tooling lives in a **separate non-shipping target** (`BereanDevTools`), compiled out of release, with no code path in the shipping binaries. The project rule that production must not trigger fetches must survive the port | VERIFIED rule |
| Timestamp insert (C+S+L) | `video.currentTime` read from the page | `WKScriptMessageHandler` messages from a small injected script reading the IFrame API / `<video>` | INFERRED |
| PiP | Auto-PiP when leaving the YouTube space: `video.requestPictureInPicture()` in the page; Cmd+Shift+P toggle; `PiPController.tsx` is a dead stub (03 M02) | Same mechanism through `evaluateJavaScript`; `AVPictureInPictureController` is not available because there is no stream URL (03 M02 states this). **Whether WebKit permits programmatic PiP without a user gesture on macOS is UNVERIFIED** (03 notes WebKit blocks it on iPhone) | UNVERIFIED |
| Sign-in | Chromium session | WebKit session in the persistent store; Google sign-in inside `WKWebView` can be rejected by Google policy for embedded user agents (UNVERIFIED, test early) | UNVERIFIED |
| Sandbox | n/a | `com.apple.security.network.client` for the MAS build | INFERRED |

Deliverable-level statement: the YouTube tab remains a hosted web view with native chrome; it must be reported to stakeholders as such, not as native playback.

---

## 13. PDF surface (PDFKit) and document handling

### 13.1 PDFKit

PDFKit is a strong native fit (03 U17 "SW-UI with PDFKit"). Mapping:

| Today (pdf.js, `PDFViewer.tsx`, `PdfPage.tsx`) | PDFKit |
|---|---|
| Continuous page scroll, zoom incl. trackpad pinch (`ctrlKey` wheel) | `PDFView` `displayMode = .singlePageContinuous`, `autoScales`, pinch built in |
| Text selection, find bar with per-page rects (`rectsForOccurrence`) | `PDFSelection`, `PDFDocument.findString`, `PDFView.highlightedSelections`; system find bar via `isFindInteractionEnabled` on iOS, `NSTextFinder`-style on macOS (UIFindInteraction doc states `PDFView` supports built-in find, VERIFIED) |
| Highlights: `pdf_highlights(page, rects_json, color, text, note)`, `rects` normalised to the page (`PDFViewer.tsx:37`) | `PDFAnnotation` of subtype highlight per rect, **not** written into the PDF file (Berean stores highlights in the DB and never mutates the PDF, bytes are never synced, 03 U17). Render with annotations added at load time or with `PDFPageOverlayViewProvider` |
| Outline, bookmarks (`pdf_bookmarks`, page + label) | `PDFOutline`, DB bookmarks |
| Copy link `berean://pdf/<id>/<page>` and legacy `berean-pdf://` | `PDFView.go(to:)` from the deep-link router (unchanged grammar) |

Coordinate conversion is the one real risk: `rects_json` is "normalised to page" from pdf.js's top-left-origin text layer, while `PDFPage` bounds use a bottom-left origin in points. The normalisation base (page width/height vs viewport) and y-axis direction were **not verified** (see `PDFViewer.tsx` around the `clientRects` normalisation, lines ~340-352). Needs a golden test: render the same highlight with both engines on three sample PDFs (BLOCKED here: no PDFs/DB). Metadata sync is hash-matched (`pdfs.file_hash`), unchanged.

### 13.2 Document handling

- Berean is **not a document-based app**: notes, highlights and sessions are database rows. `DocumentGroup`/`NSDocument` should not be adopted (INFERRED; no user-visible "document" concept).
- File-system touchpoints that do need native handling: PDF import (`NSOpenPanel`/`.fileImporter`, drag onto Dock/window, "Open With" via `CFBundleDocumentTypes` for `com.adobe.pdf` and markdown), vault folder (default Octarine iCloud path; MAS security-scoped bookmarks today, `electron/mac/folderAccess.ts`, `sandbox-bookmarks.json`, max 32), iCloud container, print/export to PDF.
- Vault watcher: `chokidar` (undeclared dependency, polling 1.5 s, depth 10, 02 section 12) -> FSEvents (`FSEventStream`/`DispatchSource.makeFileSystemObjectSource`) or `NSFilePresenter`; iCloud-evicted (dataless) files must be handled without blocking the main thread (the 2026-09-22 freeze documented in project memory: `readFileSync` on dataless vault files inside `vault:reconcile`). Native reads must go through `NSFileCoordinator` off the main actor and check `URLResourceKey.ubiquitousItemDownloadingStatusKey` (INFERRED API). VERIFIED that the problem occurred; the fix design is INFERRED.
- URL schemes: `berean://` and `berean-pdf://` must keep resolving forever, because links are written into users' notes (03 A06). `onOpenURL` and the `NSAppleEventManager` `kInternetEventClass` path; `berean-dev://` for the Dev identity.

---

## 14. Window restoration, full screen, process-level behaviour

- **Restoration:** today bounds only (`electron/main.ts:653-710`), plus DB-restored tabs/sessions. Native: `NSWindow.setFrameAutosaveName` (display-topology aware) or SwiftUI scene restoration + `@SceneStorage` for per-window state (active tab, inspector width, pane tree). The current `boundsFitAnyDisplay` check becomes unnecessary (INFERRED). Whether the app reopens all previous windows at launch is UNVERIFIED (not read).
- **Pane-tree persistence:** `workspaces.layout_json` holds a react-mosaic tree; the native `PaneTree` must read and write the **same JSON** (`{direction, first, second, splitPercentage}` per react-mosaic's documented shape, INFERRED; confirm against a real row, BLOCKED) so that the old and new apps can coexist on one `berean.db` (03 U05 C-DATA).
- **Full screen:** system behaviour; sidebar overlays automatically for `NSSplitViewItem` sidebars (VERIFIED doc text). Presenter full screen on secondary display (section 6). Disable for auxiliary windows via `collectionBehavior`.
- **Quit/export:** `will-quit` runs `runExportAll()` (vault export) then closes DBs (02 section 2.1). Native: `applicationShouldTerminate` returning `.terminateLater` while the export finishes, with a progress sheet if it is slow.
- **Updates:** `electron-updater` (GitHub Releases, beta channel) has no native equivalent in the SDK; DMG distribution needs Sparkle or similar (third-party; not evaluated here) while the MAS build uses the Store. Outside scope of this document, flagged in 08 section 10.

---

## 15. What to keep distinctive vs adopt Mac conventions

| Keep distinctive (product identity, 03/ux-principles) | Adopt Mac convention |
|---|---|
| Spaces + Sessions + Archived groups; per-tab history stacks and origin-tab return; the current-tab vs new-tab contract (`openDestination`, `NavIntent`) | Sidebar material, collapse, overlay, selection and disclosure behaviour |
| Floating Search ("Search Berean") with source prefixes and grouped Go to / Verses / Lexicon / Notes / YouTube / Commands | Menu bar structure, standard menu roles, Services, Help search, Settings scene |
| Verse-number badges as the selection model; multi-verse selection; verse notes/tags indicators | Native text selection handles, Look Up, Copy, Share, Spell/Services in notes |
| Strong's inline superscripts, hover peek, Lexicon tab | Context menus built with `NSMenu`; standard popovers |
| Ctrl+Tab MRU overlay; type-anywhere find | Cmd+H = Hide; Find Next/Previous on Cmd+G / Cmd+Shift+G; sidebar toggle shortcut; sequential tab shortcuts |
| Presenter window with outline band | Full screen, window restoration, tabbing off, Window menu list |
| 16 layouts and saved workspaces | Divider dragging, double-click to reset, collapse animations (system) |
| Themes for content surfaces; reading column rules | Toolbar/sidebar/sheet materials and metrics (stop emulating them) |
| Study Trail, Tag graph, Berean Chat | Print, share sheet, PDF export through system dialogs |

---

## 16. Risks, open questions, and proposed spikes (not authorisations)

| # | Question | Why it matters | Proposed spike (time-boxed) | Status |
|---|---|---|---|---|
| M1 | Does one TextKit 2 `NSTextView` per chapter window hold 60 fps on Psalm 119 and a 2-chapter continuous scroll with 500 highlights? | Core reader | Load real chapters, synthetic highlights, measure with Instruments | UNVERIFIED |
| M2 | Can `DisplayMap` reproduce every stored highlight's position exactly? | Data integrity | Export all highlight rows, render, compare to the web renderer's DOM offsets | BLOCKED (no DB) |
| M3 | `HSplitView` vs nested `NSSplitView` for 16 presets and persisted fractions | Section 3.3 | Build presets; persist/restore; collapse | UNVERIFIED |
| M4 | `setRenderingAttributes` availability and behaviour for overlays | Section 9.5 | API check in the SDK | UNVERIFIED |
| M5 | Pull-past-end chapter navigation over elastic scrolling | Distinctive gesture | Prototype | UNVERIFIED |
| M6 | Programmatic PiP and Google sign-in inside `WKWebView` on macOS | YouTube parity | Prototype with a test account | UNVERIFIED |
| M7 | Shortcut conflict decisions (C+H, C+G, C+S+S, C+Y) | Muscle memory for the existing user | Michael decides; list in section 8.3 | open decision |
| M8 | Does the native notes editor reach round-trip fidelity for the private markdown dialect? | Highest product risk | See 07 section 9 / 08 section 9 | UNVERIFIED |
| M9 | Minimum macOS version | Determines glass, rich-text APIs, fallback cost | Install-base data is not available to this audit | BLOCKED |
| M10 | Is the standalone (non-synced) window, and the floating rail, used? | Scope | Ask the user; telemetry does not exist | UNVERIFIED |

---

## 17. References

Apple documentation (queried through Xcode's index on 2026-11-05; paths are the index URIs under `https://developer.apple.com`):

- `/documentation/AppKit/NSSplitViewController`, `/documentation/AppKit/NSSplitViewItem` (behaviours `sidebar`, `contentList`, `inspector`; `holdingPriority`; `toggleSidebar(_:)`; `toggleInspector(_:)`), `/documentation/AppKit/NSSplitView`
- `/documentation/AppKit/NSTextLayoutManager` (`textLayoutFragment(for:)`, `enumerateTextSegments`, `textViewportLayoutController`, `ensureLayout(for:)`), `/documentation/AppKit/NSTextViewportLayoutController`
- `/documentation/AppKit/NSGlassEffectView`, `/documentation/AppKit/NSGlassEffectContainerView`, `/documentation/AppKit/NSVisualEffectView`, `NSButton.BezelStyle.glass`
- `/documentation/SwiftUI/TextEditor`, `/documentation/SwiftUI/AttributedTextSelection`, `/documentation/SwiftUI/Building-rich-swiftui-text-experiences`
- `/documentation/UIKit/UIFindInteraction` (states `PDFView` and `WKWebView` support built-in find interactions)

Repository: `electron/main.ts`, `src/App.tsx`, `src/lib/commands.ts`, `src/components/notes/pm/keymap.ts`, `src/components/bible/{ChapterView,LayoutPicker}.tsx`, `src/components/shell/PanelLayout.tsx`, `src/types/viewer.ts`, `docs/design-system.md`, `docs/ux-principles.md`, `docs/navigation-contract.md`, `docs/native-migration-audit/{02,03,14}-*.md`.
