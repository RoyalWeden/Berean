# Native tab-to-page split audit

Checkpoint: 2026-11-19. Status: pure pane model implemented/tested; user-facing split UI not implemented.
User requirement: drag an existing sidebar tab onto a page, see a live split preview, then drop it into a real split. All tab types and combinations must work. This is a generic tab compositor, not another Scripture study-panel preset.

## What the current code actually does

- `apple/BereanMac/MacRootView.swift`: `detail` supplies ONE active tab ID to `MacTabContentHost.swift`. The extracted host switches on that explicit document. Scripture, Notes, Lexicon, Search, Calendar, History and Tags have different roots and toolbar ownership.
- `apple/BereanMac/ScriptureLayouts.swift`: HSplitView/VSplitView presets compose one Scripture tab with StudyPanel views derived from that SAME tab. They cannot host an unrelated Notes or Search tab. Preserve these layouts inside a Scripture leaf; do not overload them as the new generic split tree.
- `apple/BereanMac/Sidebar.swift`: row drag exports plain text tab ID through NSItemProvider. TabDropDelegate uses in-process dragging state to reorder/pin rows. There is no page drop target or pane preview. Filtering currently removes the drag modifier, so filtered tabs cannot yet start this workflow.
- `apple/Shared/AppModel.swift`: activeSpace + one activeTabId per space drive commands, Go/Back/Forward, save, selection and inspectors. These must be routed to the focused pane. Selecting another pane must not silently replace its sibling or rewrite the sidebar ordering.
- `Packages/BereanKit/Sources/BereanWorkspace/Tabs.swift`: persisted tabs have stable IDs and JSObject state preserving unknown tab fields. TabType includes bible, note, lexicon, youtube, search, pdf, tags, history, settings, calendar. Unknown raw types may also exist.
- `Packages/BereanKit/Sources/BereanWorkspace/WorkspaceSnapshot.swift`: parsed tabs preserve their raw objects, but the workspace serializer enumerates top-level fields. Do NOT assume a new top-level layout key survives an old-client parse/save. Prove preservation or keep the first layout persistence device-local.
- `AppModel.legacyDefaultPanelLayout`: native snapshots currently write the old fixed Bible/Notes mosaic default. Replacing this with arbitrary tab IDs without a compatibility contract would corrupt the meaning of an existing field.
- Legacy `src/components/shell/PanelLayout.tsx` is a comparison source, not authority to remove native tab state or production data.

## Interaction contract

1. A tab is a document identity. Dragging it into a split reuses that tab, without creating a tab or workspace. No duplication on drag enter or hover.
2. At a valid page edge, show a translucent preview of the destination rectangle and a restrained separator. Keep the existing page readable. An unsupported/invalid drop has no preview and no mutation.
3. Preview left/right/top/bottom relative to the target LEAF, not the whole window when a nested leaf is targeted. Neutral center cancels the split preview; center replacement/merge must be a separate explicit interaction.
4. Hysteresis around edge boundaries prevents a preview alternating while the pointer trembles. Pointer movement updates preview only; commit exactly once on accepted drop. Escape, drag exit, stale payload, window loss or workspace switch clears it.
5. Use a rich snapshot preview of the entire dragged document/pane with a lifted glass/shadow treatment. A source tab may remain listed; do not leave a duplicate live pane under the lifted pane preview. Drop target remains visible during animation.
6. Split proportions must respect each leaf's minimum size. If an edge cannot accommodate both leaves, show the proposed arrangement only if it can be committed without clipping controls; otherwise refuse that edge. Do not create inaccessible zero-width leaves.
7. Closing a pane removes that VIEW from the split; it does not close or trash its tab. Removing the last split branch collapses to a normal single leaf. Close Tab is a separate existing command, with a deterministic surviving pane if its tab is visible.
8. Dragging the same tab onto itself is a no-op. Initially prohibit duplicate live views of the same tab in one tree; this avoids two editors racing to save one note. A future explicit mirrored-view feature needs its own state/focus design.
9. Split resize, moving panes and removing a pane are reversible through layout undo; they must not alter document undo/history or pin/order/identity.
10. Compact iPhone widths need a deliberate stacked/focused presentation with accessible pane switching, not squeezed desktop columns. External keyboard/pointer and iPad widths need their own check. Never silently discard a split when rotating.

## Required architecture

- A typed, app-local drag payload containing a version, source window/workspace and stable tab ID. Validate against live tabs and permissions at DROP as well as preview. Plain reference text, verse selections, Compare-column payloads and files must never be interpreted as a tab drag.
- A pure pane-tree model with stable pane IDs: leaf(tabID), split(axis, fraction, first, second). Operations insert, move, remove, collapse and resize must reject cycles, duplicates, missing IDs and illegal sizes. Preserve node identity while dragging/resizing so native readers/editors do not remount every frame.
- A generic TabContentHost extracted from MacRootView.detail. It renders a supplied tab ID without reading global activeTab as the document source. Keep Scripture internal layout/Compare, Notes lists/editors, Lexicon search/detail, and every other type inside that leaf.
- Pane focus is explicit and observable. Window menu commands, toolbar, Cmd+L, Cmd+K, Find, copy, Back/Forward and inspectors operate on the focused leaf. Background pane scroll/selection updates cannot steal command focus.
- Native first-responder handoff must flush a note's pending edit before navigation or destruction. Two different Notes tabs for one note must share edit coordination or be refused as simultaneous editors. Read-only views of the same note need an explicit policy.
- Independent per-pane viewport, find, selection, popup and scroll-sync ownership. Reuse existing per-tab history/scroll records; use pane-local view state only when the same tab genuinely has multiple presentations. Never store another pane's viewport in activeTab merely because it scrolled last.
- A window-level preview coordinator that observes geometry and a pane-local drop target. It should not place a giant opaque hit area above the reader when no tab drag is active.
- Persistence decision gate: prove old/new app read-save-read behavior, workspace duplicate/remapping, archive/restore, missing-tab recovery and same-note editing before syncing any pane layout. Do not repurpose legacy mosaic identifiers.

## Full tab-pair coverage

Rows below are required leaf families. Every ordered pair of two families is in scope, including the same family. Testing only Scripture + Notes does not establish support.

| Leaf family | Specific states to include |
|---|---|
| Scripture | KJV, LXX titles/prologues, verse range, native text selection, Strong's, Compare, every internal study layout |
| Notes | Notes root, nested folder, Daily calendar folder, Verse Notes, editor, table, checklist, unsaved text, two tabs referencing one note |
| Lexicon | search empty/results/no results, Hebrew/Greek detail, occurrences filters and scrolled results |
| Scripture Search | empty, advanced filters, results/no results, active result and return scroll |
| Calendar | month navigation, selected day, existing/new daily note |
| History | filters, nonzero scroll, opening a historical destination |
| Tags | tag list/detail, filtering and tag mutations |
| PDF | existing placeholder/recovery; eventual actual page/selection/zoom when implemented |
| YouTube | existing placeholder/recovery; eventual web/player state when implemented |
| Settings/unknown | explicit unsupported-tab presentation retaining raw state; never omit or delete the leaf |

For each ordered pair: left/right and top/bottom; then nested split, swap/move, resize, close one pane, close one TAB, Back/Forward, Cmd+L changing type, Find/copy, hide/show sidebar, window resize, app background/foreground, restart/restore. Include pinned and filtered source tabs, same/different workspace, two windows, deleted/archived source during drag, canceled drag, invalid file/text payload, noncontiguous verse selection and active note IME composition.

## Verification gates and next implementation order

1. Pure pane-tree + payload tests: all pair identities survive insertion/removal/collapse; no cycles/duplicates; invalid/stale drop is a no-op; undo restores exact tree; old tab/state bytes remain intact.
2. Extract generic host with no visible behavior change. Build both apps. Prove each type still renders and its existing commands target the right tab.
3. Read-only preview coordinator first: drag enter/move/exit/Escape across edges; no tab/layout/store writes. Check keyboard/accessibility alternative to dragging.
4. Commit a two-leaf split with focus routing, first-responder handoff and deterministic collapse. Verify real UI for all families, not only a model test.
5. Nested trees, resize, pane movement, layout undo, restoration and compatibility gates.
6. Fluid whole-block lift/drop animation, Reduced Motion/Transparency, screen reader descriptions and compact-device behavior.

Gate1 now has a tested pure-model implementation in `Packages/BereanKit/Sources/BereanWorkspace/PaneLayout.swift`. Eight test cases include484 ordered family/edge combinations, nested movement/collapse, viewport minima, atomic failed edits/undo, stale/foreign/versioned payloads and depth/identity guards. This proves model operations only. Real drag content-type discrimination, current host permissions, same-note multi-editor prevention, live source deletion and old/new persistence compatibility have not passed. Gates2–6 remain unfinished; no visible split preview or split command has shipped.

## Implementation checkpoint — 2026-11-19

- `PaneLayout` owns only an optional value tree and focused leaf ID. Leaves reference existing tab IDs; neither tab data nor legacy workspace serializers are imported into layout operations.
- `applying` returns a validated candidate for insert/move/remove/resize/focus. Validate current live tab IDs, every identity/fraction and all leaf minimum sizes. Preview must be pure; revalidate CURRENT tabs/minima/viewport when accepting a real drop. Allocate candidate pane/split IDs once per drag transaction, not per pointer frame.
- `frames` uses top-left origins on both platforms and reserves divider width before applying the first child's fraction. Every displayed document must have explicit positive minimum dimensions keyed by TAB ID (superseding the first model draft's pane-ID keys); missing/illegal/insufficient sizes fail. Recompute from current tab types at preview and commit, including Cmd+L conversions. Do not squeeze a compact iPhone split through this geometry function; compact pane switching is still a required presentation decision.
- `reconciling` prunes views for closed/archived tabs without deleting documents, collapses empty branches and chooses a surviving focus. Run this when live tabs change before preview/drop/commands; ordinary edits intentionally reject an already-stale tree.
- `PaneLayoutHistory` provides layout-only undo/redo with current live-tab/geometry validation. Failed operations preserve both stacks; focus changes do not create undo entries or clear redo. This is not wired into any app UndoManager.
- `PaneTabDragPayload` encodes version/window/workspace/tab identities and rejects unknown versions, foreign windows/workspaces and stale tabs. It is NOT registered as a drag type or connected to Sidebar. JSON decoding alone is not permission to accept arbitrary text/files.
- No layout Codable/storage/sync changes. The first UI integration must stay process-local until the compatibility gate is proven. Same note via different tab IDs is NOT rejected by this ID-only model; the content host must coordinate/refuse duplicate editors before accepting a drop.

## Next executable extraction

The first extraction is implemented: MacRootView.detail now passes the active ID to MacTabContentHost, which resolves it with AppModel.findTab. The host retains per-type identity, toolbar and Scripture inspector ownership/dismissal guard, and handles a stale ID explicitly. Root still shows exactly one host. Mac build and ordinary live interactions for Scripture/Notes/Calendar/History/Tags/Lexicon/Search pass; unsupported PDF/YouTube/Settings/unknown branches are unchanged placeholders and not runtime-verified. Audit every hosted view for hidden global-active dependencies before allowing a background leaf: NoteDetailView, TagManagerView, LexiconTabHost and commands/navigation need focused-pane context. AppModel's activeTab/history/Go/Find currently route globally; do not enable two live editors or stack multiple toolbars as an apparent split solution. Prove ordinary single-tab interactions for every family after extraction, then add read-only previews and focus routing as separate gates.

## Host extraction verification — 2026-11-19

MacTabContentHost is now the single-tab root content adapter. Mac build PASS `/tmp/berean-tab-content-host-mac.log`; the248-test package/iOS model build baseline is unchanged because this extraction touches only the Mac app. Live Mac checks: Scripture→Notes toolbar/inspector switching; Calendar previous-month navigation; History Genesis filter; Tags list; Lexicon G26 search→entry→Back restoring query; Search no-results with visible input/options; Notes editor→list→original editor. Five temporary content tabs were opened explicitly through New Tab and closed individually; exact37original active tab IDs retained, original7note hashes/updated_at unchanged. Original note restored. No content edits or tag/history deletion performed.

Next: define a pane environment/command target and inventory global-active calls before a background host is allowed. The new host alone does not resolve `AppModel.activeTab`, back/forward, Go/Find, note list active-tab guards, TagManager search navigation, inspector/title/toolbar focus ownership, or same-note editing through distinct tabs. Separate focused toolbar/inspector presentation from background leaf content. Keep keyboard and native first-responder/save handoff correct. PDF/YouTube/Settings/unknown placeholder coverage and iPhone content-host extraction remain open. Only after these gates add typed Sidebar payload registration, read-only edge previews and a two-leaf commit. No split UI is enabled by this refactor.

## Selection, command scope and compact model — 2026-11-19

The pure model now supports `.replace(paneID:tabID:)`, `selecting` and `PaneLayoutHistory.select`. Selecting a tab already in the tree focuses that leaf; selecting a different existing tab replaces only the focused leaf while preserving its pane ID and every sibling. Empty layouts take a supplied new pane ID. No tab is created, cloned or deleted. History records document replacement, while focus-only changes preserve undo/redo stacks. The new document's minimum is looked up by TAB ID; a larger replacement cannot inherit the old leaf's smaller size requirement.

`commandTarget(windowID:workspaceID:liveTabIDs:)` captures window/live-workspace/pane/tab identities. `accepts` rejects foreign scope, removed/replaced/closed tabs and changed command focus; `requiringFocus:false` is specifically for a still-visible pane's OWN viewport updates. This token is a document/focus scope, not an intent revision, permission grant or a guarantee against close/reopen with reused IDs. Use unique pane IDs for each lifetime and retain operation-specific request/cancellation revisions. The workspace ID is the live workspace/session identity, not the separate saved-snapshot identity. These helpers are NOT wired into AppModel commands yet.

`Presentation.focused` projects only the focused leaf to the viewport without rewriting/collapsing the tree. Selection and layout undo can validate in that presentation on compact widths; returning to tiled presentation restores the original tree and fractions. The focused document still needs a valid minimum. Default `.tiled` remains unchanged. The app must explicitly choose/implement compact pane switching; this is not a rendered iPhone split UI. Original full split geometry remains available while focused presentation is active.

Focused tests cover replacement, visible-tab reuse, empty layout, document-specific minima, scope/staleness rejection, replacement undo and a390-point compact→wide projection. Initial test compile required `try` inside SwiftTesting's `#require` for a throwing capture call. Existing484family/edge model cases still run. Full/build results and current logs are in HANDOFF.

Next integration: a per-window/workspace coordinator owns history and supplies these targets to a pane environment/FocusedSceneValue. Resolve the focused target before keyboard/menu/Go/Find/Back/Forward actions; do not let a background viewport save change focus. Use the same source context for links, note save/first-responder handoff, inspectors and toolbars. Background title/toolbar declarations must not override the focused document. MacTabContentHost still renders only the current active tab; generic live splits remain disabled.

## Window inspector ownership checkpoint — 2026-11-19

Single-active-host MacRootView now owns the native inspector, outside per-tab IDs; MacTabContentHost supplies document content/toolbars. This avoids per-reader inspector destruction and retains settled native width. It is not the future multi-pane focus/command ownership bridge: root still targets the single active tab. New live pane hosts must explicitly route focus/window/inspector ownership and duplicate-note editors before being mounted in parallel. See HANDOFF for exact return checks and unresolved constrained-Compare reflow.

## Nov23 host inventory correction
Read-only current source audit: MacTabContentHost and IOSRootView now host actual PdfTabView and YouTubeTabView (withOSavailabilityfallback). Older Nov19 PDF/YouTubeplaceholder wording above is dated and superseded for those branches. Settings remains under the defaultunsupported-tab branch on both hosts, while native settings already exists separately as Macwindow/iPhonesheet. Before supporting importedSettings tabs, design embeddedSettings sizing/navigation and test existing nativewindow/sheet unaffected. No multi-pane toolbar/focus/editor coordination proof is established by these newer leaf views. Nextsplitgate still explicitpane environment/routing, not merely stacking currentglobal-active hosts.
