# Notes / Store / Media / Tests Audit — Lane C

Repo: `/Users/roywe/Berean-ios` (branch `feature/ios-app`). Read-only audit for the iOS/Capacitor
groundwork. See `docs/mobile/audit/data-and-platform.md` (IPC/DB layer) and
`docs/mobile/audit/feature-inventory.md` (UI feature inventory) for adjacent coverage — not
duplicated here.

## Lane 1 — Store data-model classification

Source: `src/types/index.ts` (549 lines), `src/store/index.ts` (3277 lines, `AppState` interface
at `src/store/index.ts:223-967`), `src/store/studyTrailSlice.ts`, `src/lib/crossWindowSync.ts`.

Classes used: **SYNC** (meaningful user data — should follow the user across devices via
iCloud), **LOCAL** (device/window-specific persistent state — geometry, scroll, per-window view),
**DERIVED** (recomputable from other synced data / DB — no need to sync itself), **EPHEMERAL**
(runtime-only, never persisted, resets every launch/tab-switch).

Setter/action functions (e.g. `setTheme`, `bumpNoteToken`) are omitted from the tables below —
each is a trivial one-line mutator for the state field immediately above it, with two exceptions
called out explicitly: tab/session CRUD actions (covered in 1c) and `applyExternalTabSync` /
`refreshVerseTags` (they do real merge/fetch work, not just `set()`).

### (a) Top-level `AppState` fields

**Navigation / panel chrome**

| Field | Type | Persisted? | Class | Rationale |
|---|---|---|---|---|
| `activeSpace` | `SpaceId` | No (explicitly excluded — per-window, see `perWindowViewState.ts`) | LOCAL | which Space this window is looking at |
| `tabs` | `Record<SpaceId, Tab[]>` | Yes | SYNC (mixed) | the actual open-tab content the user is studying; see Tab breakdown in (b) — some sub-fields inside are LOCAL |
| `activeTabId` | `Record<SpaceId, string\|null>` | No (per-window) | LOCAL | which tab in each space has focus in *this* window |
| `panelLayout` | `MosaicNode<MosaicKey>\|null` | No (per-window) | LOCAL | react-mosaic pane geometry — screen-size dependent, meaningless on a phone's single-column layout |
| `sidebarCollapsed` | `boolean` | Yes | LOCAL | chrome state tied to this device's screen width |
| `sidebarWidth` | `number` | Yes | LOCAL | px width, desktop-only concept (no sidebar on iPhone) |

**UI modals / cross-panel signaling (all runtime plumbing)**

| Field | Type | Persisted? | Class | Rationale |
|---|---|---|---|---|
| `searchOpen`, `searchMode`, `searchNewTabPosition`, `searchScope`, `settingsOpen` | various | No | EPHEMERAL | floating-search/settings modal open state |
| `pendingNoteId`, `pendingVerseFilter`, `noteChangeToken`, `presenterPushToken` | various | No | EPHEMERAL | one-shot cross-panel message + change-counter tokens |
| `pendingLexiconEntry`, `pendingLexiconSearch`, `pendingLexiconSearchTab`, `pendingNotesSearchTab`, `pendingYouTubeSearch` | `string\|null` | No | EPHEMERAL | one-shot "open X in the target panel" signals |
| `pendingRightPanelNoteId`, `pendingRightPanelVerseFilter`, `pendingRightPanelCrossRefVerse` | `string\|null` | No | EPHEMERAL | Bible right-panel triggers from VerseRow |
| `highlightChangeToken`, `verseTagChangeToken` | `number` | No | EPHEMERAL | change counters for reactive refetch |
| `pendingSearchQuery` | `string\|null` | No | EPHEMERAL | |
| `findBarOpen`, `findBarQuery`, `findBarAutoOpen`, `findBarWordMode` | various | No | EPHEMERAL | Cmd+F in-panel find |
| `activePanelId` | enum | No | EPHEMERAL | last panel that received a mousedown (routes Cmd+F) — desktop-mouse-specific concept |
| `windowWidth` | `number` | No | EPHEMERAL | live resize-listener value, device screen |
| `presenterRange`, `historyTriggerRect` | objects | No | EPHEMERAL | presenter-toolbar / History-modal anchor geometry |
| `pendingYouTubeVideo` | object\|null | No | EPHEMERAL | one-shot "jump to this timestamp" signal |
| `markdownReferenceOpen` | `boolean` | No | EPHEMERAL | modal open flag |
| `importModalOpen`, `importInitialTab` | various | No | EPHEMERAL | BibleGateway/e-Sword import modal |
| `bgImportPhase/Done/Total/Message/ReviewNotes` | various | No | EPHEMERAL | BibleGateway import progress (desktop-login-flow specific, see Lane 3 note) |
| `eSwordPhase/Done/Total/Message/ReviewNotes` | various | No | EPHEMERAL | e-Sword import progress |
| `youtubeNoteBack`, `lexiconNoteBack` | object\|null | No | EPHEMERAL | "return to this note" breadcrumb |
| `settingsInitialSection` | `string` | No | EPHEMERAL | one-shot deep-link override (distinct from `lastSettingsSection` below) |

**Verse tags cache**

| Field | Type | Persisted? | Class | Rationale |
|---|---|---|---|---|
| `verseTags` | `VerseTag[]` | No | DERIVED | in-memory cache of `window.verseTags.list()` — source of truth is the SQLite `verse_tags` table (itself SYNC-worthy but lives in the DB layer, not this store — see `data-and-platform.md`) |

**Experimental feature flags / preferences**

| Field | Type | Persisted? | Class | Rationale |
|---|---|---|---|---|
| `pdfFeatureEnabled` | `boolean` | Yes | SYNC | feature-gate preference |
| `chapterPullNavEnabled` | `boolean` | Yes | SYNC | reading-gesture preference (note: the underlying gesture is trackpad-momentum-specific — see Findings) |
| `dailyNoteLocation` | `{lat,lon}\|null` | Yes | LOCAL | device geolocation for sunrise-boundary calc — meaningless copied to another device/location |
| `autoPiP` | `boolean` | Yes | SYNC | preference (PiP itself is an Electron/macOS mechanism — see Lane 3) |
| `youtubeIsPlaying` | `boolean` | No | EPHEMERAL | live playback flag |

**AI Scripture Lookup panel**

| Field | Type | Persisted? | Class | Rationale |
|---|---|---|---|---|
| `aiLookupPanelOpen` | `boolean` | No | EPHEMERAL | panel open/closed |
| `aiLookupCommentaryOn`, `aiLookupAgenticOn`, `aiLookupUseTabContext` | `boolean` | Yes | SYNC | study preferences |
| `aiLookupPanelPos`, `aiLookupPanelSize` | objects\|null | Yes | LOCAL | floating-panel screen position/size |
| `aiLookupActiveChatId` | `string\|null` | No | EPHEMERAL (judgment call — see Findings) | which AI chat thread is open; chat content itself lives in `berean.db` via `window.aiLookup`, not persisted here |

**Note auto-formatting preferences**

| Field | Type | Persisted? | Class | Rationale |
|---|---|---|---|---|
| `noteVerseRefsEnabled`, `noteLexiconRefsEnabled`, `noteScriptureBlock`, `sidePanelScriptureBlock`, `noteScriptureBlockThreshold`, `autoEmDash`, `noteVerseBlockSuggest`, `noteStrongsBlockSuggest` | various | Yes | SYNC | editor-behavior preferences |
| `noteFocusModeTabId` | `string\|null` | No | EPHEMERAL | which tab currently has Focus/Zen mode on (scoped per-tab, not global) |

**Bottom-right layout-dodge signals (explicitly documented "NOT persisted")**

| Field | Type | Persisted? | Class | Rationale |
|---|---|---|---|---|
| `bibleRightPanelWidth`, `noteEditorOpenCount`, `bibleSearchTabActive`, `verseSelectionMenuOpen`, `verseSelectionBarOpen`, `chapterEchoStrongsNum` | various | No | EPHEMERAL | pure layout-collision-avoidance signals for the Study Trail toast |

**Word replacer**

| Field | Type | Persisted? | Class | Rationale |
|---|---|---|---|---|
| `wordReplacerEnabled` | `boolean` | Yes | SYNC | preference |
| `wordReplacerRules` | `WordReplacerRule[]` | Yes | SYNC | user-authored data — same tier as notes |

**Study Trail / Print & Export / Note editor prefs**

| Field | Type | Persisted? | Class | Rationale |
|---|---|---|---|---|
| `studyTrailAskChapterJumpReason` | `boolean` | Yes (own dedicated `localStorage` key `berean-ask-why-sync`, not the debounced blob — see 1d) | SYNC | preference |
| `printMarginPreset`, `printCustomMargins`, `printPaperSize`, `printFontSizePt`, `printFontFamily`, `printIncludeTitle`, `printColorMode`, `printTheme` | various | Yes | SYNC | print/export preferences |
| `printIncludeLinkedNotes` | `boolean` | **No — has a setter (`setPrintIncludeLinkedNotes`, line 2780) and a default (`false`, line 1815) but is missing from `partialize` (line ~3047-3116)** | SYNC (bug: currently resets to `false` every restart) | see Findings — same bug class as the display-toggle cluster below |
| `pdfDownloadLocation` | `string` | Yes | LOCAL | filesystem path — a macOS Downloads-folder path is meaningless on iOS |
| `defaultNoteEditorMode`, `confirmNoteDelete`, `noteSpellCheck`, `autoCopyOnHighlight`, `noteHeadingDivider`, `noteBulletStyle` | various | **No — all six have setters + defaults, none in `partialize`** | SYNC (bug — see Findings) | note-editor preferences the user toggles in Settings but that silently revert on every app restart today |
| `noteSidePanelPinned`, `noteTypingLook` | various | Yes | SYNC | preferences |

**Idioms / gestures**

| Field | Type | Persisted? | Class | Rationale |
|---|---|---|---|---|
| `idiomHighlightEnabled`, `idiomHoverPreviewEnabled` | `boolean` | Yes | SYNC | preferences |
| `swipePanelGestureEnabled` | `boolean` | Yes | SYNC (flag for iOS: the underlying gesture is "two-finger trackpad swipe" — see Findings, touch equivalent needs redesign, not just a toggle) |
| `idiomCache` | array | No | DERIVED | in-memory cache mirroring the `idioms`-tagged notes in the DB |

**Presenter/Viewer window**

| Field | Type | Persisted? | Class | Rationale |
|---|---|---|---|---|
| `viewerWindowOpen`, `viewerPaused`, `viewerBlank` | `boolean` | No | EPHEMERAL | live presenter-window runtime state (see `project_presenter_viewer` memory — separate BrowserWindow, Mac-only concept, likely N/A on iOS) |
| `viewerLaserEnabled`, `viewerSelectionMirror`, `viewerSidePanelEnabled`, `viewerTheme` | various | Yes | SYNC | preferences, though the feature itself is desktop-only |
| `viewerFontScale` | `number` | Yes (**also** its own dedicated non-debounced `localStorage` key, `VIEWER_FONT_SCALE_SYNC_KEY` — see 1d) | LOCAL | scale tuned to a specific presentation screen |

**Scripture display preferences — NOT persisted (bug cluster)**

| Field | Type | Persisted? | Class | Rationale |
|---|---|---|---|---|
| `showVerseNumbers`, `showRedLetters`, `continuousChapterScroll`, `continuousDailyScroll` | `boolean` | **No — each has a setter + default, none in `partialize`** | SYNC (bug — see Findings) | reading-display preferences that currently reset to default on every restart |

**Font / zoom / layout preferences**

| Field | Type | Persisted? | Class | Rationale |
|---|---|---|---|---|
| `bibleFontSize`, `appZoom`, `bibleLineHeight`, `defaultBibleTranslation`, `hermasTranslation` | various | Yes | SYNC | reading preferences |
| `updateStatus` | object | No | EPHEMERAL | live `window.app.onUpdateStatus` mirror (Electron auto-updater — N/A on iOS/App Store) |
| `updateLastCheckedAt` | `number\|null` | No (field exists, no setter/writer visible beyond initial value — largely vestigial) | EPHEMERAL | |
| `defaultScriptureLayout` | `ScriptureLayout` | Yes | LOCAL | one of 16 desktop multi-panel presets (§5 of CLAUDE.md) — needs a completely different mobile equivalent, not a value that ports |
| `noteTransformLayout` | `'right'\|'bottom'\|'left'` | Yes | LOCAL | same — panel-placement preset |
| `crossRefSource` | `'tske'\|'classic'\|'notes'` | Yes (setter exists; **not found in `partialize`** either — see Findings, a 3rd instance of the same bug) | SYNC | |
| `floatingSearchDensity` | enum | Yes | SYNC | |
| `defaultYoutubeLayout` | `YouTubeLayout` | Yes | LOCAL | one of 11 desktop split-panel presets — same as `defaultScriptureLayout` |
| `theme` | `'dark'\|'light'\|'system'` | Yes | SYNC | |
| `themePreset` | `string` | Yes | SYNC | |
| `backgroundAnimationEnabled`, `backgroundAnimationStyle`, `backgroundAnimationIntensity` | various | Yes | SYNC | |
| `glassAppearance` | string | Yes | SYNC | mirrors macOS transparency slider — needs an iOS equivalent concept |
| `systemAccentColor` | `string\|null` | No | EPHEMERAL | live macOS `systemPreferences.getAccentColor()` mirror — Mac-only, N/A on iOS |
| `resourceMode` | `'normal'\|'throttled'` | No | EPHEMERAL | live macOS power/thermal state mirror (`electron/powerAwareness.ts`) — Mac-only IPC, would need an iOS `ProcessInfo` equivalent |
| `scriptureFontFamily`, `notesFontFamily`, `uiFontFamily` | `string` | Yes | SYNC | though the actual *available* font list is a bundled-fonts/platform concern — see Findings |

**Tab bookkeeping**

| Field | Type | Persisted? | Class | Rationale |
|---|---|---|---|---|
| `tabLastAccessed` | `Record<string, number>` | No (not in `partialize` — inconsistent with the closely-related `tabMRUList` below, which *is* persisted) | LOCAL | per-tab last-focus timestamp |
| `tabMRUList` | `Array<{spaceId,tabId}>` | Yes | LOCAL (judgment call) | most-recently-used order drives Ctrl+Tab switching — arguably per-device usage pattern rather than data worth merging across devices; syncing it naively would thrash on two devices used concurrently |
| `archivedGroups` | `ArchivedGroup[]` | Yes | SYNC | user-recoverable closed-tab history — see (b) |
| `sessions` | `Session[]` | Yes | SYNC (mixed) | see 1(b)/1(c) — the session LIST/name/icon is SYNC; each session's live `tabs`/`activeTabId` snapshot embedded here is mixed, same as top-level `tabs` |
| `currentSessionId` | `string` | No (explicitly excluded — per-window) | LOCAL | which session *this window* has open |
| `sessionDisplayOrders` | `Record<string,string[]>` | Yes | SYNC | custom cross-space tab ordering, keyed by session id |

**Getting-started tasks / history**

| Field | Type | Persisted? | Class | Rationale |
|---|---|---|---|---|
| `tasksVisible`, `tasksMinimized`, `completedTaskIds`, `completedStepIds` | various | Yes | SYNC (mixed) | onboarding-checklist progress — `completedTaskIds`/`completedStepIds` are meaningful SYNC data (don't want to redo onboarding on a new device); `tasksVisible`/`tasksMinimized` are more LOCAL UI-chrome (judgment call) |
| `verseNoteToken`, `strongsHoverToken`, `versePopoverToken`, `noteEditToken`, `tableInsertToken`, `settingsNavToken`, `floatingTabToken`, `youtubePipToken`, `vaultSyncToken` | `number` | No | EPHEMERAL | one-shot hint/analytics-style bump counters (drive the onboarding hint system, §16) |
| `selectedVersesByTab` | `Record<string, SelectedVerseRef[]>` | No | EPHEMERAL | in-progress verse-click multi-select, keyed per scripture tab |
| `savedWorkspaces` | `SavedWorkspace[]` | No | DERIVED | loaded on demand from the SQLite `workspaces` table via `window.workspaces.list()` — see 1(b) note on Session vs. workspaces |
| `lastSettingsSection` | `string` | Yes | LOCAL (judgment call) | last Settings section visited — cheap enough to be SYNC too, but low-value |
| `settingsSectionScrollTop` | `Record<string, number>` | Yes | LOCAL | per-section scroll offsets |

**Per-tab / global navigation stacks**

| Field | Type | Persisted? | Class | Rationale |
|---|---|---|---|---|
| `tabNavStacks` | `Record<string, {stack: TabNavEntry[], idx: number}>` | Yes | LOCAL | back/forward history keyed by tab **id** — tab ids are per-window-generated (see 1c), so this doesn't reliably carry meaning to another device's tab set |
| `isNavJumping` | `boolean` | No | EPHEMERAL | re-entrancy guard while a back/forward jump is in flight |
| `notesHomeToken`, `lexiconHomeToken`, `youtubeHomeToken` | `number` | No | EPHEMERAL | "go to list/home view" bump signals |
| `tabNavMaxStack`, `historyMaxEntries` | `number` | Yes | SYNC | preferences (max stack depth) |
| `recentSearchQueries` | `string[]` (max 10) | Yes | SYNC | small, meaningful |
| `history` | `HistoryEntry[]` | No (comment: "persisted to SQLite `history` table, not localStorage"; loaded via `window.history.getAll()` in `App.tsx`) | DERIVED | mirror of the DB table — see `data-and-platform.md` for the table itself, which **is** the real SYNC-worthy artifact |
| `historyOpen`, `historySeenLength`, `historyLoaded`, `historyHasMore`, `historyLoadingMore` | various | No | EPHEMERAL | modal/pagination runtime state |
| `historyExpandedDays`, `historyExpandedSessions`, `historyAutoExpandedKey` | various | Yes | LOCAL | UI collapse-state memory |

**Read Aloud (TTS) — see Lane 3 for the engine itself**

| Field | Type | Persisted? | Class | Rationale |
|---|---|---|---|---|
| `audioPlayback` | `AudioPlaybackState\|null` | No (explicit — "no playback-position persistence across restarts, per plan") | EPHEMERAL | |
| `audioPlaybackRequestToken` | `number` | No | EPHEMERAL | signal token |
| `skipVerseToken`/`Direction`, `seekToken`, `seekTargetVerseNum` | various | No | EPHEMERAL | one-shot playback-control signals |
| `playbackQueue`, `playbackQueueIndex`, `playbackQueueSourcePlaylistId`, `playbackQueueSourcePlaylistName` | various | No (explicit — ephemeral; durable form is `window.playlists`) | EPHEMERAL/DERIVED | the *saved* playlist (via `window.playlists`) is the SYNC-worthy artifact, not this live queue |
| `queuePopoverOpen`, `queuePopoverPos` | various | Yes | LOCAL | popover screen position |
| `reasonPromptPopoverPos` | object\|null | Yes | LOCAL | Study Trail reason-popover drag position |
| `ttsVoiceURI`, `ttsRate`, `ttsHighlightWordsEnabled`, `ttsAutoAdvanceEnabled`, `ttsAutoAdvancePauseSec`, `ttsAutoplayOnOpen` | various | Yes | SYNC (mostly) / LOCAL for `ttsVoiceURI` specifically (judgment call — a Kokoro voice id is tied to which voice packs are installed on *this* device; see Lane 3) |
| `kokoroModelReady` | `boolean` | No (explicit — re-checked via IPC every launch since model files can be deleted externally) | EPHEMERAL | |

### (b) Tab-state sub-interfaces (field-by-field)

**`Tab` (wrapper, `types/index.ts:251-263`)**

| Field | Class | Rationale |
|---|---|---|
| `id` | SYNC | needed to address the tab; generated as `` `${type}-${Date.now()}-${Math.random()...}` `` (`createTab`, `store/index.ts:1982`) — no device namespace, see Findings |
| `spaceId`, `type` | SYNC | |
| `title` | SYNC | denormalized display string, cheap to carry |
| `state` | SYNC (mixed) | see per-type tables below |
| `isPinned` | SYNC (**but see Findings — no UI currently sets this to `true` anywhere in `src/`; only read in `crossWindowSync.ts`/`App.tsx` signature strings**) | |
| `originTabId`, `originSpaceId` | LOCAL/EPHEMERAL | one-off "opened as a detour" breadcrumb for the back button; the origin tab id is meaningless if that tab only exists on the other device |

**`BibleTabState` (`types/index.ts:23-112`)**

| Field | Class | Rationale |
|---|---|---|
| `bookId`, `chapter`, `endChapter`, `verse`, `endVerse`, `translation` | SYNC | what/where the user is reading |
| `targetVerse`, `targetVerseQuery`, `targetVerseWordMode`, `targetVerseStrongsWords`, `targetVerseStrongsExtraWords` | EPHEMERAL | one-shot highlight-on-arrival payload, cleared by `ChapterView` once consumed |
| `showStrongs` | SYNC | per-tab study display toggle |
| `scrollPosition` | LOCAL | raw scroll offset, device/screen dependent |
| `compareMode`, `compareSyncScroll` | SYNC | |
| `compareColumns` | SYNC (mixed) | `textId/bookId/chapter` SYNC; nested `scrollPos` LOCAL |
| `hiddenAnnotations` | SYNC | |
| `rightPanelOpen`, `rightPanelWidth`, `bottomPanelHeight` | LOCAL | desktop multi-panel geometry — no direct iPhone single-column equivalent |
| `rightPanelTab`, `rightPanelNoteId`, `rightPanelLexiconEntry`, `rightPanelVerseFilter` | LOCAL (judgment call) | "which sub-view is open in the side panel" — arguably worth syncing as study intent, but tightly coupled to `rightPanelOpen` which is LOCAL |
| `rightPanelNoteCursor`, `rightPanelNoteFocused`, `rightPanelExpandAll(B)`, `rightPanelScrollTop(B)` | LOCAL/EPHEMERAL | |
| `rightPanelSlotBTabs`, `rightPanelSlotB`, `rightPanelNoteIdB`, `rightPanelNoteCursorB`, `rightPanelNoteFocusedB`, `rightPanelLexiconEntryB`, `rightPanelVerseFilterB` | LOCAL | "slot B" (popped-out second side panel) is an explicitly desktop-wide-screen feature — flag as likely N/A on iOS |
| `noteBack`, `scriptureBack`, `searchBack` | LOCAL/EPHEMERAL | in-tab "return to" breadcrumbs |
| `searchMode`, `scriptureSearchQuery` | LOCAL | |
| `scriptureLayout` | LOCAL | one of 16 desktop panel presets (§5) — needs a mobile-specific replacement, not a synced value |
| `searchTextId`, `searchWordMode`, `searchTestamentFilter`, `searchBookFilter`, `searchSortMode`, `searchScrollTop`, `searchScrollAnchor` | LOCAL | in-tab Advanced Search view state |
| `searchTagFilter`, `searchTagFilterAll` | SYNC (judgment call) | reflects a deliberate tag-based filter choice, cheap to carry |

**`NoteTabState` (`types/index.ts:114-138`)**

| Field | Class | Rationale |
|---|---|---|
| `noteId`, `isNew` | SYNC / EPHEMERAL | `noteId` worth syncing (resume the same note elsewhere); `isNew` is a transient creation flag |
| `verseRef` | SYNC | |
| `scrollTop`, `cursorPos`, `listScrollTop` | LOCAL | |
| `continuousDailyDate` | SYNC (judgment call) | which day is in view in daily-note continuous-scroll mode |
| `homeView.{noteSearch,noteSearchWordMode,noteFilter,statusFilter,noteSort,viewMode,expandAll}` | LOCAL | per-tab snapshot of browse/filter UI |
| `homeView.{previewNoteId,previewFolderId}` | LOCAL/EPHEMERAL | transient list-preview selection |

**`LexiconTabState` (`types/index.ts:140-152`)**

| Field | Class | Rationale |
|---|---|---|
| `strongsNum` | SYNC | entry being studied |
| `scrollTop`, `searchScrollTop` | LOCAL | |
| `searchQuery`, `searchLang` | LOCAL | live search-box state |
| `lexHistory` | SYNC (judgment call) | small in-tab browse trail, cheap and meaningful like Study Trail |

**`YouTubeTabState` (`types/index.ts:191-200`)**

| Field | Class | Rationale |
|---|---|---|
| `videoId`, `playlistId`, `url` | SYNC | |
| `youtubeLayout` | LOCAL | one of 11 desktop split-panel presets (§12) |
| `panelA`, `panelB` | LOCAL | secondary study panels beside the video — `panelB` in particular is a wide-screen-only concept |
| `scrollTop` | LOCAL | |

**`SearchTabState` (`types/index.ts:202-206`)**

| Field | Class | Rationale |
|---|---|---|
| `query` | SYNC | |
| `results` | DERIVED | recomputable by re-running the query; not worth transmitting/storing |
| `scrollTop` | LOCAL | |

**`PdfTabState` (`types/index.ts:208-213`)**

| Field | Class | Rationale |
|---|---|---|
| `pdfId`, `title` | SYNC | (the underlying PDF *file* itself is a separate, bigger sync question — see `project_pdf_feature` memory / `data-and-platform.md`) |
| `page` | SYNC | reading position — meaningful to resume elsewhere |
| `scrollTop` | LOCAL | |

**`TagsTabState` (`types/index.ts:217-219`)**

| Field | Class | Rationale |
|---|---|---|
| `selectedTagId` | LOCAL/EPHEMERAL | transient graph-node selection; pan/zoom for this singleton tab lives separately in the `settings` KV table under key `tagsGraph.view`, not here |

**`ArchivedGroup` (`store/index.ts:1041-1046`)**

| Field | Class | Rationale |
|---|---|---|
| `id`, `label`, `archivedAt` | SYNC | |
| `tabs` | SYNC (mixed) | flat `Tab[]` — same per-field breakdown as `Tab` above applies to each entry |

**`Session` (`store/index.ts:1048-1054`)**

| Field | Class | Rationale |
|---|---|---|
| `id`, `name`, `icon` | SYNC | |
| `tabs` | SYNC (mixed) | as above |
| `activeTabId` | LOCAL (but see Findings) | conceptually per-window "what's focused," yet `partialize` snapshots the *current* window's `activeTabId` into whichever `Session` is currently active before persisting (`store/index.ts:3103-3106`) — so one window's focus silently becomes the persisted value for that session. Not exercised as a bug today only because there's one window per session in the common case; worth resolving explicitly for multi-device sync. |
| `tabFilter` | LOCAL | per-window tab-type filter; not part of `crossWindowSync.ts`'s `tabs`/`sessions` messages, so today it doesn't even sync between two *windows*, let alone devices |

### (c) Tab id/order/lifecycle mechanics

- **ID generation** — `createTab` (`store/index.ts:1982`): `` `${type}-${Date.now()}-${Math.random().toString(36).slice(2,7)}` ``. No device/session namespace prefix. Collision risk across devices is negligible in practice but the ID carries no provenance — worth a namespaced scheme (e.g. device-id prefix) if tabs/sessions are to merge from two devices rather than one being authoritative.
- **Per-space order** — `tabs[spaceId]` is a plain array per `SpaceId`; array order is a tab's position *within its own space*.
- **Cross-space unified order** — `sessionDisplayOrders[sessionId]: string[]` is a flat list of tab ids spanning *all* spaces for that session, built/maintained by `computeInsertOrder()` (`store/index.ts:196-217`). New tabs insert `'after-active'` (default — Cmd+T, "+", "open in new tab"), `'top'`, or `'end'` (double-click empty tab-bar space) per call site.
- **Reorder** — `reorderTabs(spaceId, fromIndex, toIndex)` (`store/index.ts:2106`) splices the per-space array (drag within one space's list); `reorderTabDisplay(sessionId, fromId, toId, before)` (`store/index.ts:1920`) reorders the cross-space `sessionDisplayOrders` array instead (drag in the unified sidebar view).
- **Move between spaces** — no direct "move tab to another space" action was found; a tab's `spaceId` is fixed at creation (derived from `TYPE_TO_SPACE`, `store/index.ts:1032-1040`) and doesn't change.
- **Move between sessions** — `moveTabToSession(spaceId, tabId, targetSessionId)` (`store/index.ts:1949`): removes the tab from the live `tabs[spaceId]` (current session) and appends it into the target `Session.tabs[spaceId]` array directly (the target session doesn't have to be the active one).
- **Pin** — `Tab.isPinned` exists on the type and is round-tripped by `crossWindowSync.ts:115` and included in the dirty-check signature strings in both `crossWindowSync.ts:99` and `App.tsx:412`, but **no action or UI call site sets it to `true`** anywhere under `src/` — likely a vestige of a removed/never-shipped pin-tab feature. Flagged in Findings.
- **Close** — `closeTab(spaceId, tabId)` (`store/index.ts:2145`), `closeActiveTab()` (`store/index.ts:2201`).
- **Archive** — `archiveTab(spaceId, tabId)` (`store/index.ts:2801`) and `archiveAllTabs(label?)` (`store/index.ts:2816`) move closed tabs into `archivedGroups` instead of discarding; `restoreArchivedGroup(groupId)` (`store/index.ts:2842`), `dismissArchivedGroup(groupId)` (`store/index.ts:2863`), `clearAllArchivedGroups()` (`store/index.ts:2865`).
- **Active tab per space** — `activeTabId: Record<SpaceId, string|null>`, set via `setActiveTab`/`activateTab`/`ensureTab`; NOT persisted at top level (per-window), but see the `Session.activeTabId` wrinkle noted in (b).
- **Sessions vs. `workspaces` DB table** — two distinct, easily-conflated concepts:
  - **Sessions** (`sessions`, `currentSessionId`, `switchSession`, `renameSession`, `createSession`, `deleteSession`, `DEFAULT_SESSION` at `store/index.ts:1022-1027`) are Arc-style **tab-group contexts** — each `Session` owns its *own* full `tabs`/`activeTabId` tree, and switching sessions (`switchSession`, `store/index.ts:1881`) swaps the entire live workspace out from under the window. They are live, always-on, part of the persisted blob, and (via `crossWindowSync.ts`) kept convergent across open windows. There is always at least one (`deleteSession` refuses to drop the last one).
  - **Workspaces** (`savedWorkspaces`, `window.workspaces.*`, `WorkspacesSection.tsx`) are one-shot **named snapshots** of `panelLayout` + `{tabs, activeTabId}` at save time, stored in the SQLite `workspaces` table (`electron/ipc/workspaces.ts`) — `layout_json`/`state_json` columns. Loading one (`loadWorkspace`, `WorkspacesSection.tsx:35`) only restores `panelLayout` today (`updatePanelLayout(layout)`) — the saved `state_json` tab/activeTabId snapshot is written on save but **not read back** on load, i.e. "Load Workspace" currently only restores the panel geometry, not which tabs were open. Worth flagging to the lead as either a bug or an intentional (but confusing) partial-restore.
- **`applyExternalTabSync`** (`store/index.ts:2509`, invoked from `App.tsx:388`) and **`broadcastTabState`** (`electron.d.ts:357`, called `App.tsx:425`) are an **older, narrower** cross-window mechanism — IPC-relayed (`window.app.*`, main-process mediated) and limited to `{tabs, theme, themePreset, backgroundAnimation*, glassAppearance}`, guarded by a monotonic `updatedAt` timestamp (`lastAppliedTabSyncAt`, `store/index.ts:1037`) so a stale broadcast can't clobber a newer local change. This coexists with the **newer, broader** `src/lib/crossWindowSync.ts` mechanism (below) which covers sessions, `sessionDisplayOrders`, and a much larger preference set, over a different transport (`window.crossWindow`, a "dumb relay" per its own header comment). Two independent, overlapping cross-window sync systems live in the codebase simultaneously — see Findings.
- **`crossWindowSync.ts`** — `SHARED_PREFERENCE_KEYS` (`crossWindowSync.ts:33-54`), the authoritative "which preference fields follow the user between windows" list:
  ```
  'theme', 'themePreset', 'appZoom', 'bibleFontSize', 'bibleLineHeight',
  'defaultBibleTranslation', 'hermasTranslation', 'defaultScriptureLayout',
  'scriptureFontFamily', 'notesFontFamily', 'uiFontFamily',
  'noteTypingLook', 'noteTransformLayout', 'noteSidePanelPinned',
  'noteVerseRefsEnabled', 'noteLexiconRefsEnabled', 'autoEmDash',
  'autoPiP', 'defaultYoutubeLayout', 'floatingSearchDensity',
  'autoCloseTabsAfter', 'crossRefSource',
  'wordReplacerEnabled', 'wordReplacerRules',
  'idiomHighlightEnabled', 'idiomHoverPreviewEnabled',
  'backgroundAnimationEnabled', 'backgroundAnimationStyle', 'backgroundAnimationIntensity',
  'swipePanelGestureEnabled',
  'aiLookupCommentaryOn', 'aiLookupAgenticOn', 'aiLookupUseTabContext',
  'pdfFeatureEnabled', 'pdfDownloadLocation', 'dailyNoteLocation',
  'printMarginPreset', 'printCustomMargins', 'printPaperSize', 'printFontSizePt',
  'printFontFamily', 'printIncludeTitle', 'printColorMode', 'printTheme',
  'ttsVoiceURI', 'ttsRate', 'ttsHighlightWordsEnabled', 'ttsAutoAdvanceEnabled',
  'ttsAutoAdvancePauseSec', 'ttsAutoplayOnOpen',
  'studyTrailAskChapterJumpReason',
  'viewerTheme', 'viewerLaserEnabled', 'viewerSelectionMirror', 'viewerSidePanelEnabled',
  'historyMaxEntries', 'tabNavMaxStack',
  ```
  This list is a strong, already-hand-curated starting point for the iCloud-sync "preferences" bucket — it's effectively the subset of `partialize` the team has already decided is safe/desirable to converge live between two open surfaces, which is exactly the SYNC/LOCAL question this lane is answering, just for windows instead of devices. Notably it deliberately **excludes** `dailyNoteLocation`'s device-specific nature is NOT excluded (it IS in the list) even though this lane classifies it LOCAL above — worth the lead's attention as a real disagreement between "safe to mirror between two Mac windows on the same machine" (trivially true, same filesystem/location) and "safe to sync to an iPhone" (false — see Findings). Sessions/`tabs`/`sessionDisplayOrders` are handled by separate, structural merge logic (`applyMessage`, `crossWindowSync.ts:118-176`), not this flat key list — see `mergeTabSets` (`crossWindowSync.ts:103-121`): membership/order/title/pin come from the sender, but a tab's own `.state` (scroll, cursor, nav) is kept from the *local* copy when the tab already exists locally, only adopting the sender's state for genuinely new tabs. That "structure syncs, per-window view state doesn't" merge policy is a good model for device sync too.

### (d) Persist config

- `name: 'berean-app-state'` (localStorage key), `version: 8` (`store/index.ts:2932`).
- `migrate: (persistedState) => persistedState as Partial<AppState>` — a no-op passthrough. The surrounding comment (`store/index.ts:2933-2943`) explains this is deliberate: without *some* `migrate` function, zustand's persist middleware discards **all** persisted state on any version bump with no transform defined, which the comment says "is almost certainly why some settings have appeared to 'not save' across an app update." No real migration logic exists for any of the 8 version bumps to date — purely additive-field changes so far.
- `storage`: `(IS_SECONDARY_WINDOW || IS_INDEPENDENT_WINDOW) ? readThroughLocalStorage : debouncedLocalStorage` — only the main window is a writer; secondary/independent windows read the shared blob but never flush their own state back over it (this is what makes the newer `crossWindowSync.ts` safe from the clobber race described in its own comments, `store/index.ts:3145-3157`).
- `onRehydrateStorage` (`store/index.ts:2950-3045`) does, in order:
  1. If `IS_INDEPENDENT_WINDOW`: wipes `tabs`/`activeTabId`/`activeSpace`/`currentSessionId`/`sessions`/`sessionDisplayOrders`/`tabMRUList`/`tabLastAccessed`/`panelLayout` back to blank defaults — an independent window (`?independent=1`) shares the settings blob but always starts with one empty session, never the user's real tabs.
  2. Kicks off `window.ttsModel?.getStatus()` to populate `kokoroModelReady` (a real side effect, not just state — constructs backend readiness outside the synchronous rehydration).
  3. Prefers a dedicated non-debounced `VIEWER_FONT_SCALE_SYNC_KEY` localStorage value over whatever the (possibly stale/debounce-lost) main blob says for `viewerFontScale`.
  4. Bails out entirely if `!state?.tabs` (fresh install / corrupted state).
  5. Merges in any new `DEFAULT_WORD_REPLACER_RULES` entries missing from the persisted `wordReplacerRules` (by id) — an additive-migration pattern done ad hoc outside `migrate()`.
  6. Filters each space's `tabs[spaceId]` array to drop `null`/non-object garbage entries.
  7. Validates/rebuilds `tabMRUList` against the actual persisted tab set, dropping stale entries for closed tabs and appending any open tabs missing from the MRU (active tabs first, per space).

### Findings from Lane 1 (a consolidated cross-lane "Findings" section is at the very end of this report)

- **Three separate "setting silently doesn't persist" bug clusters**, all the same shape (setter + default exist, field absent from `partialize`): (1) `printIncludeLinkedNotes`; (2) `defaultNoteEditorMode`, `confirmNoteDelete`, `noteSpellCheck`, `autoCopyOnHighlight`, `noteHeadingDivider`, `noteBulletStyle`; (3) `showVerseNumbers`, `showRedLetters`, `continuousChapterScroll`, `continuousDailyScroll`; also `crossRefSource`. That's 11 user-facing Settings toggles that reset to their hardcoded default every app restart today, independent of any mobile work — worth a quick standalone fix regardless of the iOS effort, and something to *not* carry forward as "working as intended" into whatever sync-classification table drives the iCloud implementation.
- **Two independent, overlapping cross-window sync mechanisms** coexist: the older `window.app.broadcastTabState`/`applyExternalTabSync` (IPC-relayed, `{tabs, theme, themePreset, background*, glassAppearance}` only) and the newer `src/lib/crossWindowSync.ts` (`window.crossWindow`, much broader `SHARED_PREFERENCE_KEYS` + structural session/tab merge). Both are live and both fire on tab changes. The lead should decide whether the mobile/iCloud sync design builds on `crossWindowSync.ts`'s already-more-thorough merge semantics (recommended — it already solves "which parts of a tab are shared vs. per-surface" correctly) and whether the older mechanism should be retired rather than porting both.
- **`dailyNoteLocation` is LOCAL for device sync but IS in `crossWindowSync.ts`'s cross-*window* shared list.** Correct for two Mac windows on the same machine (same real location); wrong for Mac ↔ iPhone (different physical locations, and the iPhone should presumably use its own on-device location, not inherit the Mac's). This is exactly the kind of field the "same key list, different transport" temptation would get wrong if the team's first instinct is to reuse `SHARED_PREFERENCE_KEYS` verbatim for iCloud sync.
- **Tab ids have no device namespace** (`${type}-${Date.now()}-${random5}`). Fine for a single-writer-at-a-time model (today); if two devices can create tabs while briefly offline from each other, worth a namespace prefix to keep merges collision-free and attributable.
- **`Tab.isPinned` appears to be dead code** — typed, synced, included in change-detection signatures, but no UI sets it. Confirm with the team before porting a "pin" concept to mobile; may be leftover from an unshipped feature rather than something to preserve.
- **"Load Workspace" only restores `panelLayout`**, not the saved tab/activeTabId snapshot (`WorkspacesSection.tsx:35-42` reads `ws.layout_json` only, never `ws.state_json`) — likely worth fixing before workspaces become a model for anything mobile-facing, since right now it's a half-working feature.
- **Desktop-only layout presets don't have a mobile equivalent**: `ScriptureLayout` (16 variants), `YouTubeLayout` (11 variants), `defaultScriptureLayout`, `noteTransformLayout`, `defaultYoutubeLayout`, every `rightPanel*`/`bottomPanel*`/`slotB*` field, `panelLayout` (react-mosaic) itself. On a single-column iPhone screen essentially the entire panel-layout subsystem needs a different (probably much simpler, e.g. tab-based navigation instead of panes) mobile UI — none of these fields "port," they just don't apply.
- **`ttsVoiceURI` classified LOCAL** (voice availability is tied to which Kokoro voice packs are downloaded on a given device — see Lane 3) — if the lead wants "my last-used voice" to follow across devices, that requires checking voice-pack presence on the receiving device first, not blindly applying the synced id.
- **Session vs. `activeTabId` persistence wrinkle** (`store/index.ts:3103-3106`): the currently-focused window's `activeTabId` gets baked into the persisted `Session` for whichever session that window is on, even though `activeTabId` is conceptually per-window. Not a visible bug with one window per session today; will need an explicit decision once "session" becomes a syncable, potentially concurrently-edited object across devices.

### Commands run for Lane 1

```
grep -n "interface AppState" src/store/index.ts
sed -n '1,223p' / '223,967p' src/store/index.ts   (AppState interface + surrounding context)
grep -n "partialize|persist(|name: 'berean-app-state'|storage:|version:|migrate:|onRehydrateStorage" src/store/index.ts
sed -n '2920,3277p' src/store/index.ts            (persist config, partialize, cross-window listeners)
cat -n src/lib/crossWindowSync.ts
grep -rn "broadcastTabState|applyExternalTabSync" src --include="*.ts" --include="*.tsx"
sed -n '2495,2530p' src/store/index.ts / sed -n '370,430p' src/App.tsx
grep -n "createTab:|addTab:|ensureTab:|closeTab:|...|reorderTabDisplay:" src/store/index.ts  (tab/session action line numbers)
sed -n '1980,2145p' / '1853,1980p' src/store/index.ts
sed -n '1,60p' src/components/settings/sections/WorkspacesSection.tsx
grep -n "SavedWorkspace" src/types/electron.d.ts ; grep -rn "workspaces" electron/ipc/*.ts
grep -n "printIncludeLinkedNotes" src/store/index.ts
for f in <~25 field names>; do grep -q "state\.$f\b" src/store/index.ts; done   (partialize membership spot-checks)
awk '/partialize: \(state\) => \(\{/,...' src/store/index.ts   (confirm tabLastAccessed / crossRefSource absence)
grep -n "onboardingCompleted|completeOnboarding:" src/store/index.ts ; grep -rln "...|onboardingCompleted" electron/ipc src/lib
grep -rn "defaultNoteEditorMode|...|noteBulletStyle" src/App.tsx src/components/settings/
grep -rln "isPinned" src ; grep -n "isPinned" src/App.tsx ; grep -rn "\.isPinned\s*=|togglePin|pinTab" src
grep -rln "AppSettings" src --include="*.ts" --include="*.tsx"
```

## Lane 2 — Notes & ProseMirror editor

Source: `src/components/notes/**` (18 top-level components + `pm/` subdir: 32 editor files, ~9,200
lines total in `pm/`), plus `src/lib/noteRefs.ts`, `src/lib/parseRef.ts` (904 lines), `src/lib/tagRefScan.ts`,
`src/lib/noteTextBlocks.ts` (512 lines), `src/lib/notePreviewRender.ts` (887 lines), `src/lib/dailyNoteUtils.ts`.

### Schema (`pm/schema.ts`, 407 lines)

**Nodes**: `doc`, `paragraph` (has an `indent` attr, 0-8, rendered as `margin-left`, round-tripped
as a leading run of NBSP characters — real spaces/tabs would parse back as an indented code
block), `blockquote`, `callout` (GFM `> [!NOTE]` etc. — real markdown-backed node, `calloutType` ∈
NOTE/TIP/WARNING/IMPORTANT/CAUTION), `column_list`/`column` (2-column layout, `column` deliberately
excluded from the `block` group so it can only be a direct child of `column_list`; markdown
round-trip is HTML-comment-delimited, `<!-- berean:columns -->`/`<!-- berean:col -->`, NOT a GFM
table, because table cells in this schema are inline-only), `thread`/`thread_entry` (collapsible
timestamped log container, modeled directly on `column_list`/`column`; `threadId`/`entryId` are
`crypto.randomUUID()`-generated; markdown round-trip reuses the same HTML-comment placeholder-swap
algorithm as columns — `<!-- berean:thread id="…" title="…" -->`), `horizontal_rule`,
`study_trail_embed` (leaf node embedding a live Study Trail session by `trailSessionId`; count
attrs are a cached display snapshot, not live truth), `heading` (levels 1-6), `code_block` (no
marks allowed inside), `text`, `image` (inline, `width` attr nullable — resize handle only sets
width, height auto-follows for aspect ratio; stored as base64 data URL, see Images below),
`hard_break`, `bullet_list`/`ordered_list`/`list_item` (list_item doubles as a task item via a
nullable `checked` attr — no separate task-item node type; `bullet_list` tracks `tight` and the
literal `marker` character typed, both round-tripped exactly), plus `tableNodes()` from
prosemirror-tables (`cellContent: 'inline*'`, matching the old CM6 editor's plain-text-only cells —
no lists/images/headings inside a table cell).

**Marks**: `em`, `strong`, `code` (excludes `_` — i.e. code can't nest inside another code-styled
run), `strike`, `underline`, `highlight` (`color: null` → generic `==text==`; `color: 'amber'|…'`→
`<mark class="hl-{color}">`), `link`, `wikilink` (`[[Title]]`, parsed via a custom markdown-it
inline rule, rendered as a pill — unlike the old CM6 editor's "hide the brackets with a decoration"
trick, a PM mark never shows delimiter syntax in the editable view at all).

Verse/lexicon blocks are **deliberately not schema nodes** — they're plain paragraph text that
`blockDecorations.ts` recognizes and boxes once an async DB lookup confirms a real verse/Strong's
number, kept out of the schema specifically so the markdown source stays "zero markers" (plain
text) and parsing never needs to be async.

### Plugins (`pm/*.ts`, one-line purpose each)

| File | Purpose |
|---|---|
| `autocomplete.ts` | Trigger detection (`/` slash-command, `#tag`, `[[wikilink`, `H1234`/`G567` Strong's, verse-ref) via a report-via-callback plugin; no popup UI itself |
| `AutocompletePopups.tsx` | React popups for the triggers above |
| `blockDecorations.ts` | Async verse/lexicon **block** detection (multi-line boxed quote) over plain paragraph runs |
| `blockHandles.ts` | Block drag handles + hover insert button — **native HTML5 drag-and-drop** (`draggable=true`, `dragstart`); see Mobile concerns |
| `BlockMenu.tsx` | The "⋮" per-block menu (type-conversion, delete, duplicate, etc.) |
| `codeBlockHighlight.ts` | Lightweight code-block syntax highlighting |
| `columnControls.ts` | Add/remove-column buttons rendered beside a `column_list` |
| `editorCommands.ts` | Shared command factories (toggle blockquote, indent/outdent, toggle code block, wrap in thread, etc.) used by both toolbars and slash commands |
| `findHighlight.ts` | Highlights Cmd+F find-bar matches inside the document |
| `headingCollapse.ts` | Collapsible headings; identity computed from `level + trimmed text + ordinal` (headings have no id attr slot) and persisted per-note via IPC |
| `imageInsert.ts` | Shared "File → base64 image node" insertion path, used by paste/drop/toolbar-picker |
| `indent.ts` | Paragraph left-indent command (`changeIndent`) backing Tab/Shift-Tab |
| `inputRules.ts` | Live markdown-shortcut → node/mark conversion while typing (see below) |
| `keymap.ts` | Core keymap + a separate per-instance block-movement keymap (see below) |
| `markdownIt.ts` | Configured `markdown-it` instance + custom inline/core rules (wikilink, highlight, underline, task list) |
| `nodeViews.ts` | Custom NodeViews: `code_block` (syntax highlight), resizable `image`, clickable task checkbox, colored-bullet list marker |
| `parser.ts` (668 lines) | `MarkdownParser` config + hand-written pre-processing passes for HTML-comment-delimited columns/threads and `[!TYPE]` callout detection |
| `pastePlugin.ts` | Clipboard image → node, bare URL → link mark, re-closes a copied blockquote/callout/list so formatting survives paste; also handles Finder file **drop** |
| `placeholderPlugin.ts` | Empty-first-paragraph placeholder text (CSS `::before`, standard PM idiom) |
| `refDecorations.ts` (491 lines) | Inline decorations for verse/LXX/Strong's/tag/wikilink refs + hover-preview and click/right-click dispatch (see below) |
| `SelectionToolbar.tsx` / `selectionToolbarPlugin.ts` | Floating format toolbar positioned from the live PM selection (state-driven, not mouse-event-driven) |
| `serializer.ts` | `MarkdownSerializer` config — list-item/task-checkbox serialization, tight-list handling, marker-character round-trip |
| `slashCommands.ts` (269 lines) | The `/` command palette definition + each command's doc-transform (see below) |
| `staticRender.ts` (372 lines) | Read-only HTML rendering of a doc for version history / print / daily continuous-scroll / Presenter — no live EditorView |
| `suppressRanges.ts` | Cmd+Shift+R "suppress auto-detected refs in this range" — port of the old CM6 suppress system |
| `tablePlugins.ts` | prosemirror-tables' own cell-selection/merge/resize plugin |
| `tableStatusPlugin.ts` | Reports "cursor is inside a table" so the toolbar can show/hide table controls |
| `threadCollapse.ts` | Collapsible threads, sibling to `headingCollapse.ts`, keyed directly by the thread's own `threadId` attr (no ordinal-identity workaround needed) |
| `threadNodeView.ts` | NodeView for `thread`/`thread_entry` — editable title, "+ Add entry" control, timestamp badges |
| `threadSelectionPlugin.ts` | Converts a drag-selection spanning exactly one whole thread into a NodeSelection over it |
| `Toolbar.tsx` (561 lines) | The fixed top editor toolbar (see button roster below) |
| `WordCountFooter.tsx` | Debounced (500ms) word-count/reading-time footer |

**32 plugin/component files total** in `pm/` (not counting `schema.ts`/`markdownIt.ts`/`parser.ts`/
`serializer.ts` which are config/transform modules rather than PM `Plugin` instances, though several
of the above register more than one `Plugin`).

### Input rules (`pm/inputRules.ts`)

Live (while-typing) conversions, registered in this order: `emDashRule` (2nd of two `-` → `—`, gated
by the `autoEmDash` setting), `headingRule` (`#{1,6} ` → heading), `codeFenceRule` (` ``` ` → code
block), `blockquoteRule` (`> ` → blockquote), `bulletListRule` (`-`/`+`/`*` + space, marker
preserved), `orderedListRule` (`N. `), `taskCheckboxRule` (a **second-stage** rule — `bulletListRule`
already consumes `"- "` before `"[ ] "` finishes being typed, so this only fires on `[ ]`/`[x]` when
already inside a fresh list item), `horizontalRuleRule` (`---`/`***`/`___`/`—-`, the last variant
because `emDashRule` fires on the first two dashes of a fast `"---"` before the third arrives),
`boldRule`/`boldUnderscoreRule`/`italicRule`/`italicUnderscoreRule`/`strikeRule`/`codeRule`/
`highlightRule` (mark-toggling rules using a zero-width lookbehind `(?<=^|\s)` so the leading space
before a delimiter is never consumed/deleted), `wikilinkRule` (`[[Title]]` → live `wikilink` mark,
independent of the autocomplete-popup insertion path).

### Keymap (`pm/keymap.ts`)

Base: `baseKeymap` (prosemirror-commands) + `Mod-b`/`Mod-i`/`` Mod-` ``/`Mod-u`/`Mod-Shift-h` (toggle
strong/em/code/underline/highlight), `Mod-z`/`Mod-y`/`Mod-Shift-z` (undo/redo), `Tab` (chain:
sink-list-item → paragraph indent → literal tab in a code block / swallow), `Shift-Tab` (chain:
lift-list-item → paragraph outdent → no-op), `Enter` (chain: split-list-item → default), `Shift-Enter`
(hard break). `Mod-/`, `Mod-[`, `Mod-]` are explicitly **not** bound — reserved by the app shell.

A **second, per-instance** keymap (`createBlockMovementKeymap`, factory because it closes over that
editor's own popup-open state): `Mod-Shift-ArrowUp`/`Mod-Shift-ArrowDown` (move the enclosing
top-level block up/down among its siblings — same delete-then-reinsert transaction shape as
`blockHandles.ts`'s drag-drop, so it's a genuine **keyboard-only alternative to block drag-and-drop**),
`Escape` (select the enclosing top-level block as a NodeSelection, same visual state a drag grip's
mousedown produces — a no-op if a popup is open or the selection is already a NodeSelection).

### Slash commands (`pm/slashCommands.ts`, `SLASH_COMMANDS` array)

Two groups. **Basic blocks**: Text, Scripture verse (turns on `noteScriptureBlock` if off, drops a
"Book chapter:verse" placeholder for the existing verse-suggest autocomplete to take over — doesn't
insert a verse itself), Heading 1-6, Bulleted list, Numbered list, Task list, Quote, Code block,
Table (empty 2×2), Image (opens the same file-picker path as toolbar/paste), Columns (2-col layout),
Thread, Study Trail (embeds the currently-live Study Trail session, or inserts an explanatory line if
none is live — deliberate-insertion only, never auto-suggested), Divider. **Callouts**: Note, Tip,
Warning, Important, Caution. Triggered by `/` at start-of-line or after any whitespace (not inside
code blocks); `insertBlockNode`/`replaceRangeWithBlock` in `slashCommands.ts`/`autocomplete.ts`
widen the replace range to the whole enclosing paragraph when the trigger spans it exactly, to avoid
a stray leading blank paragraph.

### Markdown parsing/serialization (`markdownIt.ts`, `parser.ts`, `serializer.ts`)

`markdown-it('default', { html: false, breaks: true })` — the `'default'` preset (not
`'commonmark'`) is required for GFM pipe tables; `breaks: true` is load-bearing (a bare `\n` becomes
a hard line break, matching the old CM6 flat-text editor's and Obsidian's convention — without it,
migrating existing notes silently joined every soft-wrapped line into a run-on paragraph, the
dominant cause of round-trip mismatches found in the original CM6→PM migration testing). Indented
(4-space/tab) code blocks are disabled (`md.disable('code')`) so RTF-imported e-Sword content with a
leading `\t` doesn't misparse as a code block; fenced ` ``` ` blocks stay on and are the only form
the serializer ever writes. Custom inline/core rules registered: `wikilink` (before `link`),
`task_list` (core, GFM `- [ ]` → attrs), `highlight_color`/`highlight_plain`/`underline` (before
`emphasis`). Column/thread round-trip is **not** a markdown-it rule at all — `parser.ts` hand-scans
for `<!-- berean:columns -->`/`<!-- berean:col -->` and `<!-- berean:thread id="…" -->`/
`<!-- berean:thread-entry … -->` HTML-comment markers *before* tokenization, swaps each region for a
unique placeholder line, lets markdown-it/prosemirror-markdown parse everything else normally (marks,
lists, tables, nested fences, even nested `column_list`s), then splices the real node back in —
explicitly chosen over a markdown-it block rule to get all of markdown-it's normal parsing for free
inside each column/entry. Callouts (`[!NOTE]` etc., `CALLOUT_RE`) are detected post-parse by
inspecting a blockquote's first text child. `serializer.ts` customizes list-item serialization to
round-trip task checkboxes and the exact tight/marker-character list attrs.

### Scripture reference handling

- **Detection**: `src/lib/parseRef.ts` (904 lines) is the canonical "does this text resolve to a
  real book/chapter/verse" parser (book aliases, subdivision editions like Recognitions of Clement's
  Book.Chapter.Verse addressing, comma-separated verse lists → `verseGroups`, cross-chapter ranges,
  a trailing `" LXX"` translation-override marker). `src/lib/noteTextBlocks.ts` layers
  `findVerseRefMatches` on top (a fuller regex than the old single-book-word CM6 regex — multi-word
  book names, "Book N" subdivisions) for both inline ref-linking (`refDecorations.ts`) and
  verse-*block* detection; also exports `stripLxxMarker`/`normalizeRefWhitespace` (NBSP→space,
  length-preserving). `src/lib/tagRefScan.ts` is a separate greedy longest-known-tag matcher for
  `#tag` refs — given the live set of known verse-tag names, it prefers the *longest* known
  multi-word tag match starting after `#` (fixing an old single-token regex that stopped at the
  first space), falling back to a single-token rule for unknown/freshly-typed tags.
- **Rendering**: `refDecorations.ts` walks the doc on every state update, applying inline
  `Decoration`s (`.pm-verse-ref` / `.pm-lxx-ref` / `.pm-lexicon-ref` / `.pm-tag-ref` / wikilink pill)
  with `data-ref`/`data-strongs-id`/`data-tag` attrs carrying the raw match text — no schema marks
  involved, decorations only, recomputed live.
- **Click**: `handleDOMEvents.click`, dispatched by `closest()` DOM-class lookup (deliberately not
  PM's `handleClick` prop, which pre-resolves a doc position via `posAtCoords` and skips the handler
  entirely on failure — this dispatch needs none of that, it identifies purely by CSS class) →
  navigates the active scripture tab / opens the lexicon tab / follows the wikilink, per ref type.
- **Hover**: `mouseover`/`mouseout` with a 350ms delay timer → `RefHoverPreview` popup fetches and
  shows the verse text / lexicon gloss / tag preview via `window.bible.query*`/`window.lexicon.getEntry`.
  **Mouse-only** — no touch equivalent (see Mobile concerns).
- **Context menu**: native `contextmenu` event (right-click only) → `VerseCopyMenu`
  (`src/components/bible/VerseCopyMenu.tsx`): **Open verse, Copy verse(s), Copy reference, Open in
  new tab, Open in floating tab**; and `StrongsContextMenu` (`src/components/lexicon/StrongsContextMenu.tsx`)
  for `H`/`G` refs. **Right-click only, no long-press/kebab-button fallback** anywhere in this path —
  see Mobile concerns.

### Images

Paste (clipboard `image/*` item) and Finder drag-drop both funnel through `imageInsert.ts`'s
`insertImageFile` — a `FileReader.readAsDataURL`, stored as a **base64 data URL directly in the
document** (no separate file storage at insert time). The explicit "Insert image" affordance (slash
command / toolbar) uses a plain hidden `<input type="file" accept="image/*">` rather than Electron's
native `dialog.showOpenDialog` — deliberately, so it reuses the same `File`-object path as
paste/drop with no IPC round-trip; this also means it should work unchanged in an iOS WKWebView
(file inputs open the native photo picker there). Resizing is drag-handle-only (`nodeViews.ts`,
width-only, height auto-follows via CSS to preserve aspect ratio) — mouse-drag based, no pinch/touch
resize handle. Base64-in-document is rewritten to a real file under `{vault}/attachments/` only at
vault-export time (`electron/ipc/vault.ts`, main-process `fs`) — see `data-and-platform.md` and the
`project_pdf_feature`-adjacent `project_vault_export` memory; the editor itself has no vault
awareness.

### Wikilinks, tables, heading/thread collapse

- **Wikilinks**: `[[Title]]` — schema mark (not a decoration, unlike verse/Strong's refs), created
  either by the `[[` autocomplete popup (`replaceRangeWithWikilink`, inserts a genuinely marked text
  node so the link is clickable immediately) or by hand-typing `[[Title]]` (`wikilinkRule` in
  `inputRules.ts`, live-converts as you finish typing the closing `]]`) or by markdown parse at load
  time. Click → `onWikilinkClick`; hover (350ms) → preview popup.
- **Tables**: prosemirror-tables (`tablePlugins.ts` for cell-selection/merge/column-resize,
  `tableStatusPlugin.ts` for toolbar awareness, `columnControls.ts`-style row/column add/delete menu
  items in `Toolbar.tsx`). Cells are `inline*`-only (matches the old CM6 plain-text-cell behavior) —
  no lists/headings/images nested inside a cell. Column-resize is a **mouse-drag** interaction
  (prosemirror-tables' built-in `columnResizing`); no touch-drag alternative evaluated here.
- **Heading collapse** (`headingCollapse.ts`): identity is `level + trimmed text + an ordinal`
  (headings carry no id attr, unlike threads), persisted per-note via `window.notes.getCollapsedHeadings`/
  `setHeadingCollapsed` (IPC → SQLite), not the zustand store.
- **Thread collapse** (`threadCollapse.ts`): sibling mechanism, keyed by the thread's own stable
  `threadId` attr — no ordinal-identity fallback needed. Same IPC-backed persistence shape
  (`getCollapsedThreads`/`setThreadCollapsed`).

### Note types, statuses, folders, pins, trash, version history (`Note` interface + `window.notes` IPC)

One `Note` row (`types/index.ts:289-315`) covers every kind: **verse note** (`verseRef` set),
**general note** (`verseRef` null), **daily note** (title convention `"Daily — YYYY-MM-DD"` from
`dailyNoteUtils.ts`'s `dailyNoteTitle`; `ContinuousDailyScroll.tsx`/`CalendarWidget.tsx` are the
daily-specific UI, `DailyNoteEditsSection.tsx` shows same-day edits made to *other* notes), **idiom
note** (`type: 'idiom'`, structured `idiomData: {examples, explanation, compare, verses}` +
`idiomTerm`/`idiomMeaning`/`idiomAliases`/`idiomAutoVariants` fields, convertible from a plain note
via `NoteContextMenu`'s "Convert to idiom note"), and an imported-video note (`type: 'youtube'`,
badge "Video"). `textId` marks which translation a verse note is attached to. Source badges: "BG"
(BibleGateway import), "eSw" (e-Sword import).

- **Status** (`NoteStatus`: started/in-progress/complete/make-video/archive) — independent of
  `color` (decorative only) and `type`/`folderId` (organizational). Set via `NoteStatusDropdown.tsx`
  (in the editor header) or `NoteContextMenu`'s "Set status" submenu (list/folder view, no need to
  open the note first).
- **Folders** (`NoteFolder`: `id`/`name`/`parentId` — hierarchical): `NotesFolderView.tsx` (1,355
  lines) is the folder-tree browsing UI; full CRUD via `window.notes.{getFolders,createFolder,
  renameFolder,deleteFolder,deleteFolderDeep,setFolderParent}`.
- **Pins**: `Note.pinned` (boolean), sorts to top of `NotesList.tsx`; `window.notes.setNotePinned`.
  (Distinct from the still-unused `Tab.isPinned` covered in Lane 1.)
- **Trash**: soft-delete via `Note.deletedAt` (unix ms); `window.notes.{deleteNote,restoreNote,
  listTrash,purgeTrashItem,emptyTrash}`.
- **Version history**: `NoteVersionHistory.tsx` (Sheet UI, diff via the `diff` package's
  `diffWords`, preview rendered through the same `renderPreviewContent`/`staticRender.ts` path used
  elsewhere) backed by `window.notes.{createNoteVersion,getNoteVersions,restoreNoteVersion}`.
  Versions are consolidated automatically on a **2-minute idle timer** (`SNAPSHOT_IDLE_MS =
  2*60*1000`, `NotesPanel.tsx:229`) — not on every keystroke — plus explicitly on note switch/unmount,
  each tagged `kind: 'auto'|'manual'|'pre-restore'`.
- **Note actions menu** (`NoteContextMenu.tsx`): Open in new tab / floating tab / current tab, Export
  to PDF/Print, Rename, Move to folder (submenu), Set status (submenu), Open in session (submenu —
  cross-references Lane 1's Session concept), Convert to idiom note, Delete. **Triggered exclusively
  via `onContextMenu` (right-click) in `NotesList.tsx`/`NotesFolderView.tsx` — no visible "⋮" button
  fallback for a touch device with no right-click**, same gap as the ref context menus above.

### Focus mode

`toggleNoteFocusMode(tabId)` (store, scoped per-tab, not global) — `Toolbar.tsx` additionally calls
`window.windowControls?.setButtonsVisible?.(!focusMode)` to hide the native macOS traffic-light
window buttons while focused, restoring them on cleanup, and renders its **own** custom
close/minimize/maximize buttons in the toolbar. This is a pure Electron/macOS-window-chrome
mechanism with no iOS equivalent (no traffic lights to hide) — the surrounding "center + hide
sidebar/rail/top-bar chrome" part of Focus mode is the portable part; the window-controls toggle
itself is not.

### Toolbar (`pm/Toolbar.tsx`, 561 lines)

Fixed top toolbar, `onMouseDown` handlers throughout (deliberate — avoids stealing focus from the
contenteditable before the command runs against the still-live selection). Buttons: Bold, Italic,
Underline, Strikethrough, Highlight (color picker), Link, Inline code, "Suppress auto-detected refs"
(⌘⇧R), Blockquote, Outdent/Indent, Focus-mode toggle, Insert menu (Bullet/Dash/Numbered/Task list,
Table row/column add-delete + delete-table, Thread, Table, Code block, Divider, Verse…, Image…), plus
(when `focusMode` is on) the app's own window-control buttons described above. An `OverflowGroup`
wrapper collapses lower-priority groups when the toolbar is too narrow for the panel width — the one
piece of this file already built with a narrow-viewport case in mind.

### Save path & cross-window refresh

`NotesPanel.tsx`'s `handleContentChange`/`handleTitleChange` debounce **500ms**, then call
`window.notes.updateNote(id, {content|title})`; on resolution, `setLastAutosaveAt(Date.now())` drives
the quiet "Saved" indicator (`Toolbar.tsx`), `maybeSyncNote(id)` triggers vault export if
`vaultSync` is on (`window.vault.syncNote`), and `bumpNoteToken()` (store) increments
`noteChangeToken` — every window's `NotesPanel` instance re-fetches on that token bump, and
`window.notes.onChanged` (main-process broadcast on any note mutation) is what makes a note edited
in one window/floating-tab refresh another window's Bible-panel notes side panel (wired in
`App.tsx`, see Lane 1). Version snapshots run on their own separate 2-minute idle timer (above),
decoupled from the 500ms save debounce.

### Mobile-relevant concerns (summary — see also inline notes above)

- **Block drag-and-drop reorder (`blockHandles.ts`) is built entirely on native HTML5 drag events**
  (`draggable=true` grip, `dragstart`/`drop`) — this API has poor-to-no touch support in iOS
  Safari/WKWebView (no synthetic `dragstart` from a touch gesture by default). The keyboard
  alternative (`Mod-Shift-ArrowUp/Down` in `keymap.ts`) already exists and is the natural fallback to
  lean on, but there is currently no *touch-drag* equivalent — would need a pointer-events-based
  reimplementation for a first-class iOS reorder gesture.
- **Hover-based ref/wikilink preview popups** (`refDecorations.ts`'s `mouseover`/`mouseout` with a
  350ms delay) have no touch equivalent — a tap on an iPhone won't show the preview at all under the
  current event wiring (tap instead goes straight to the `click` handler, i.e. navigates).
- **Right-click-only context menus**, with no "⋮"/long-press fallback, appear in at least two places:
  the ref system (`VerseCopyMenu`/`StrongsContextMenu` via `refDecorations.ts`'s `contextmenu`
  handler) and the notes list/folder view (`NoteContextMenu` via `onContextMenu` in
  `NotesList.tsx`/`NotesFolderView.tsx`). Both need a touch-triggerable path (long-press, or an
  always-visible "⋮" affordance) before they work on iOS.
- **Table column resize** (prosemirror-tables' built-in `columnResizing`) is mouse-drag-only.
- **No virtual-keyboard handling anywhere in `src/components/notes` or `App.tsx`** — no
  `visualViewport` listener, no keyboard-avoidance/scroll-into-view-above-keyboard logic. Unsurprising
  for a desktop Electron app; will need to be added for iOS (the editor toolbar, `SelectionToolbar`,
  and every autocomplete popup all position by raw viewport/`coordsAtPos` coordinates that a
  soft-keyboard resize would invalidate).
- **`contenteditable` quirks**: nothing iOS-specific was found guarded against (no Safari-specific
  contenteditable workarounds, no `-webkit-user-select` touch-callout suppression beyond the two
  plain `user-select: none` rules in `pmEditor.css` for the block-handle grip and one other UI
  element). ProseMirror's own contenteditable abstraction generally handles iOS Safari reasonably
  well out of the box, but this hasn't been exercised/tuned here yet.
- **`SelectionToolbar`/`selectionToolbarPlugin.ts`** is state-driven (PM selection, not mouse events)
  so it should in principle track touch-based text selection too, but a custom floating toolbar
  competing with iOS's own native text-selection handles/callout menu is a common source of friction
  worth explicit QA once running in a WKWebView.
- **`Toolbar.tsx`'s `onMouseDown` handlers** should still fire from a tap (browsers synthesize
  mouse events from touch by default), but weren't written with touch in mind and haven't been
  verified against iOS Safari's ~300ms/touch-action quirks.

## Lane 3 — Audio/TTS and YouTube

### Read Aloud (TTS) engine

**Stack**: `kokoro-js` (wraps `@huggingface/transformers`, i.e. transformers.js) running ONNX
inference via **onnxruntime-web**, entirely inside a dedicated **Web Worker**
(`src/lib/tts/kokoro/kokoro.worker.ts`) — never the main thread, specifically because WASM
inference is "synchronous-feeling enough to visibly stall the UI" and the app already suffered
one renderer-freeze bug it doesn't want to repeat. `ttsEngine.ts` is a stable-identity facade
(`TTSBackend` interface, `ttsBackend.ts`) that the rest of the app imports — there used to be a
second, Web Speech (`speechSynthesis`) backend, **removed outright** at Michael's request in favor
of Kokoro-only (better voices, one highlight path instead of two, no more Web-Speech-only
workarounds). Until the one-time voice pack download completes, `ttsEngine` delegates to an inert
no-op backend (every method a silent no-op, not a throw) so playback controls reachable from
several surfaces never crash on a missing model.

**Backend selection**: `pickDevice()` in `kokoro.worker.ts` prefers **WebGPU** when
`navigator.gpu.requestAdapter()` actually succeeds, falling back to **WASM** on any failure
(missing API, disabled flag, unsupported GPU under Electron's sandboxed GPU process).

**Dtype/model size**: `TTS_MODEL_DTYPE = 'fp32'` (`modelProtocolConstants.ts`) — deliberately NOT
a quantized variant; `q8` (`model_quantized.onnx`, ~92MB) was tried first and produced garbled,
mumbling speech (a known failure mode of that particular export, not ordinary quantization
softness), and `fp16`/`q4f16` would only fix quality on the WebGPU path, leaving WASM-fallback
users with the same mumbling — fp32 behaves identically on both paths. Core weights are
~326MB (`MODEL_FILE_ESTIMATED_BYTES`, `ttsModelManifest.ts`), plus one `voices/<id>.bin` file per
catalog voice, plus a standalone onnxruntime-web WASM runtime binary (~21.6MB,
`RUNTIME_FILE_ESTIMATED_BYTES`) fetched once from jsDelivr's npm CDN mirror (pinned exact
`onnxruntime-web` build, `ORT_RUNTIME_VERSION`, asserted against `package.json` in a test so an
`npm update` can't silently desync the two) — **the only network fetch in the whole pipeline**;
core model files come from a stable HuggingFace-style URL (see `ttsModel.ts`). Total pack is
therefore comfortably >350MB depending on voice-catalog size.

**Download flow**: `electron/ipc/ttsModel.ts` (218 lines) does the actual fs/network work;
`electron/ttsModelManifest.ts` is the pure "what files does a complete pack need / is what's on
disk complete" logic (independently unit-testable, no fs mocking). Files land under
`{userData}/tts-models/<model_id>/`, tracked by a manifest so a pack that predates the ORT runtime
file being added to the manifest can be topped up with just that one file instead of re-prompting
the whole ~350MB download.

**`berean-model://` protocol** (`electron/ttsModelProtocol.ts`): exists because Chromium's
renderer/worker `fetch()` refuses `file://` URLs outright, and transformers.js always loads model
files via `fetch()`. A custom privileged scheme (`protocol.registerSchemesAsPrivileged` at module
load time, `protocol.handle()` once `app` is ready — both **main-process-only Electron APIs**)
streams the exact bytes off disk (`createReadStream`) in response to
`fetch('berean-model://local/...')` from the worker. `main.ts`'s CSP `connect-src` allowlists
exactly this scheme and nothing broader (deliberately not achieved by weakening `webSecurity`).
`env.allowRemoteModels = false` in the worker ensures kokoro-js/transformers.js can **never** phone
home for model files at inference time — every synthesis-time byte comes from this local protocol.
**This entire mechanism (custom `protocol.handle` scheme + Node `fs` + `userData` path) is
Electron-main-process-specific and has no direct Capacitor/iOS equivalent** — porting it means
either a `WKURLSchemeHandler` (native Swift/Obj-C, not a drop-in), routing model bytes through
`blob:`/`data:` URLs instead, or a different on-device inference path entirely (e.g. Apple's native
`AVSpeechSynthesizer`, trading away the neural-voice quality this whole subsystem exists for).

**Playback**: NOT `speechSynthesis`/Web Audio scheduling — real synthesized PCM per sentence chunk
(`kokoroChunking.ts`'s `buildLatencyChunks`) is wrapped in a minimal hand-rolled WAV container
(`pcmToWavBlob`) and played through a plain **`HTMLAudioElement`** per chunk (`kokoroBackend.ts`).
Playback **rate is never re-synthesized** — always synthesize at 1x, then drive speed purely via
`HTMLAudioElement.playbackRate` + `preservesPitch = true` (the same "2x, no chipmunk" mechanism
YouTube's own player uses), so `setRate()` never restarts playback and the disk cache doesn't need
rate as part of its key. Chromium's autoplay policy is disabled app-wide via the
`autoplay-policy=no-user-gesture-required` Electron switch (`main.ts`) since each chunk's
`<audio>.play()` happens many `await`s away from the original button click.

**Word/verse-boundary highlight sync**: Kokoro's public API has no forced-alignment timestamps;
`timestampAlignment.ts`'s `estimateWordTimings` distributes each chunk's **real, measured** audio
duration proportionally across the chunk's characters (an honest approximation, explicitly
documented as such — better than Web Speech's `onboundary` guess since it's anchored to true audio
duration, but still not per-word ground truth). A poll loop (`POLL_INTERVAL_MS = 50`) compares
`<audio>.currentTime` against each event's `atSec` to fire word/verse boundary callbacks consumed
by `VerseRow.tsx`.

**Queue/playlist model**: two layers, per Lane 1 — a live, ephemeral `playbackQueue`
(store, freeform reorderable "chapters to play back to back," replacing the old "always advance
to next chapter of the same book" as the *only* option) that can optionally be linked to/saved as a
**durable named playlist** via `window.playlists` (SQLite-backed, survives restart;
`AudioQueuePopover.tsx`/`useQueueAutosave.ts`). `src/lib/audioQueueRef.ts`'s
`parseQueueRefInput` turns a free-typed reference ("Luke 13-15", "Luke 15:10-16:3") into one or
more queue items, splitting chapter/verse ranges correctly across chapter boundaries.
`useTTSPlayback.ts` (mounted **once at `App.tsx`'s shell root**, deliberately outside any
`BiblePanel` instance) is what makes playback survive tab/panel navigation — it's never torn down
by `ActivePanel` remounting the Bible panel — and drives chapter-end auto-advance (respecting
`ttsAutoAdvanceEnabled`/`ttsAutoAdvancePauseSec`) into either the next queue item or the next
chapter of the same book.

**Controls** (`AudioPlayer.tsx`, `ChapterProgressBar.tsx`): retarget-to-current-chapter, previous
verse / next verse (`skipVerse`), play/pause, stop, playlist-queue popover, and a drag-to-seek
chapter progress slider (`Slider` UI primitive — mouse-drag oriented, not explicitly touch-tuned).

**Cross-window**: **no** cross-window audio broadcast exists — `audioPlayback` is absent from both
`crossWindowSync.ts`'s `SHARED_PREFERENCE_KEYS` and the older `applyExternalTabSync` payload (Lane
1). Each open window runs its **own independent** `KokoroBackend`/Worker instance; playback in one
window has no effect on another. Only the small `ttsVoiceURI`/`ttsRate`/toggle *preferences* sync
across windows (they're in `SHARED_PREFERENCE_KEYS`), not live playback state.

**Caching**: two independent disk caches, both Node-`fs`/`userData`-backed (Electron
main-process-only, same porting concern as the model protocol above):
- **Model files** — `{userData}/tts-models/` (above).
- **Synthesized audio** — `electron/ipc/ttsAudioCache.ts` + `src/lib/tts/kokoro/audioCacheStore.ts`:
  `{userData}/tts-audio-cache/<key>.pcm`, a tiny custom 4-byte-sample-rate-header + raw float32 PCM
  container (not WAV — nothing outside Berean ever reads these files, so a real RIFF header would
  be pure overhead), keyed by `backendId + textId + bookId + chapter + voiceURI + contentHash`
  (a cheap djb2 hash of the actual spoken text, so changing a word-replacer rule like "LORD" →
  "Yehovah" naturally busts stale cached narration). Deliberately **no rate dimension** in the key,
  for the same reason rate never re-synthesizes above. LRU, size-capped eviction
  (`planEviction`/`DEFAULT_AUDIO_CACHE_CAP_BYTES`), pure/testable apart from the actual disk I/O.

### YouTube

**Embedding**: an Electron **`<webview>`** tag (`src/components/youtube/YouTubeTab.tsx`, 2,692
lines — one large stateful component, no separate "player" child component), `partition=
"persist:youtube"` (persistent Chromium session → YouTube login survives app restarts, no OAuth/API
keys needed for login itself — the user just signs into YouTube inside the embedded page; **no
app-level "sign out" IPC/handler was found** — signing out is presumably done from inside YouTube's
own UI in the webview). No `preload` attribute is set on the `<webview>` — the app doesn't use a
webview-specific preload script at all; every interaction with the embedded page instead goes
through **`executeJavaScript()`** calls injected from the host (dozens of call sites: play-state
polling, CSS injection to hide/restyle parts of YouTube's own UI, blocking YouTube's internal SPA
`pushState` navigation to other videos via a `will-navigate` listener + injected interception,
reading `window.__yt` state, PiP start/stop, seek/currentTime reads for position-save). Event
listeners bound directly to the `<webview>` DOM element: `dom-ready` (fires setup of a play
monitor, CSS injection, and a polling loop, all together, immediately on ready — not waiting for
the first interval tick), `will-navigate`.

**YouTube Data API key**: `electron/youtube-key.ts` (gitignored; `electron/youtube-key.example.ts`
is the checked-in template — this is the file `npm run setup:worktree` symlinks back into a fresh
worktree, per CLAUDE.md §2/§22, without which `npm run dev` fails to resolve the import). Used
**only** for `playlistItems`/`videos` Data API v3 lookups (richer per-video metadata, uploads-
playlist enumeration) — all from the **main process** (`electron/ipc/youtube.ts`, plain `fetch`
calls, not renderer-side). Basic channel-feed sync uses the **public, keyless**
`https://www.youtube.com/feeds/videos.xml?channel_id=…` RSS feed instead where that's sufficient.

**Channel allowlist**: videos/channels are stored in a `youtube_videos` SQLite table keyed by
`channel_handle`; every read path in `electron/ipc/youtube.ts` (full-text search, transcript
matching, etc.) is explicitly documented as operating over "the already-synced, allowlisted-channel-
only library" — the allowlist itself lives as the set of channel handles that have ever been synced
into that table (per CLAUDE.md §12's soft-guard description — adding an unlisted channel prompts to
add it first).

**Feed sync/refresh**: `youtube_sync` table tracks `last_full_sync`/`last_refresh` per
`channel_handle`; a full sync walks a channel's uploads via the Data-API-keyed `playlistItems`
endpoint, a lighter refresh presumably uses the RSS feed (both write into the same `youtube_videos`
table via an upsert that preserves `is_starred` and only fills in `duration`/`description` if
missing — never clobbers user state).

**Starred**: `youtube_videos.is_starred` (SQLite boolean column), toggled via a simple read-then-
flip-then-write IPC handler; explicitly documented as "never overwritten" by a routine sync upsert.

**Watch history & resume position**: `window.youtube.savePosition(videoId, pos, {...})` IPC call,
invoked from several points in `YouTubeTab.tsx` (periodic position poll while playing/backgrounded,
and on pause/seek). A `historyMap` (videoId → last-known startTime, both a React ref and state)
also drives "resume where you left off" when reopening a video, seeded either from that saved
position or from an explicit `startTime` passed in (e.g. a note's timestamp link). Seeking on
resume branches on player type: a direct `<video>` element gets `v.currentTime = …`; an `<iframe>`-
embedded player (see Secondary considerations below) gets a `postMessage` YouTube IFrame API
`seekTo` command instead — i.e. **two different control paths already coexist** in this codebase
depending on how the video is hosted.

**Playlists**: handled distinctly from Read Aloud's `window.playlists` (that's TTS-only) — YouTube
playlist support is `playlistId`-based (`YouTubeTabState.playlistId`, `types/index.ts:193`) via the
Data API's `playlistItems` endpoint noted above; no separate dedicated playlist-management UI file
was found beyond what's inline in `YouTubeTab.tsx`.

**Transcripts**: `fetchTranscripts`/`clearTranscripts` (`electron/ipc/youtube.ts:1392-1398`) are
gated by `if (!is.dev) return { error: 'unavailable in production' }` — the dev-fetch model per the
`project_youtube_transcript`/`feedback_transcript_dev_guard` memories: Michael populates the
`youtube_transcripts`/`youtube_transcript_segments` tables during development, and those tables
ship pre-populated inside `data/youtube_seed.db` (built by a separate dev-only "package updated
data for the next release" IPC handler, `electron/ipc/youtube.ts:~1518-1521`, also `is.dev`-gated)
so production users get a working, searchable transcript library with **zero runtime scraping**.
Search is **real SQLite FTS5** (`youtube_transcripts_fts`) over transcript segment text, joined back
through the allowlisted `youtube_videos` table — this is what backs "find a video whose *spoken
content* covers X," distinct from the separate plain title/channel-name full-text search.
`TranscriptViewer.tsx` renders segments with timestamp labels and click-to-seek.

**Picture-in-Picture**: `PiPController.tsx` is a **dead stub** ("Phase 4 stub", 4 lines, returns
`null`) — despite CLAUDE.md §12 describing "native macOS PiP via Electron's `webContents`," the
*actual* implementation lives inline in `YouTubeTab.tsx` and uses the **standard W3C Web
Picture-in-Picture API** (`video.requestPictureInPicture()` / `document.exitPictureInPicture()` /
`document.pictureInPictureElement`), executed **inside the webview's guest page** via
`executeJavaScript` (not any Electron-native `webContents` PiP call). Auto-PiP triggers on leaving
the YouTube space while a video is playing (`autoPiP` setting, `userGesture: true` required — the
PiP API rejects without a recent user-activation context, satisfied here since it fires off the
same click that navigated away); a poll loop separately detects the user clicking the native OS PiP
window's "Return to tab" control (`document.pictureInPictureElement` going false) to resync
`isPiPActive`. `Cmd+Shift+P` toggles manually. **Because this is the standard web PiP API rather
than an Electron-only mechanism, it is the one YouTube feature in this lane most likely to port
with only moderate change** — the real open question is whether the video is reachable as a real
`<video>` element at all once hosted differently on iOS (see below), not the PiP call itself.

**Timestamp insertion into notes**: `insertTimestamp(mode: 'timestamp' | 'link')`
(`YouTubeTab.tsx:1435`) reads the current playback position and dispatches a plain DOM
`CustomEvent('berean:insertTimestamp', { detail: { text } })`; the active note editor listens for
this event and inserts the text at the cursor — loosely coupled via a window-level event rather
than a direct prop/store call, so it works regardless of which panel currently owns focus.

**Secondary panels** (`YouTubeSecondaryPanel.tsx`, 302 lines): up to two panels (`panelA`/`panelB`,
Lane 1) can sit beside the video showing Notes (`NoteEditorPM` reused directly), Scripture
(`ChapterView` reused directly), or Lexicon content — each self-contained with its own search/empty
state and a back button. `youtubeLayouts.ts` (170 lines, 11 `YouTubeLayout` presets, each with an
inline-SVG-style preview) governs how video vs. panelA vs. panelB divide the available space —
same "desktop multi-pane preset doesn't map to a single iPhone column" concern raised for
`ScriptureLayout` in Lane 1.

### What depends on Electron `<webview>`/`session` vs. what could run in a WKWebView/iframe

- **Hard Electron-only**: the `<webview>` tag itself (Chromium-specific, no WKWebView equivalent —
  iOS would need either a plain `<iframe src="https://www.youtube.com/embed/...">` inside the app's
  own WKWebView, or the native `youtube-ios-player-helper`/`WKWebView`-hosted IFrame Player API),
  `partition="persist:youtube"` (Electron session partitioning — iOS session/cookie persistence for
  an embedded YouTube iframe works differently and needs its own design), every `executeJavaScript`
  call targeting the webview's **guest** page context (an `<iframe>` is cross-origin from the host
  page, so direct `executeJavaScript`-style DOM poking into it is not possible at all from
  JavaScript — the YouTube **IFrame Player API**'s `postMessage` protocol, which this codebase
  *already partially uses* for the iframe-embedded seekTo path noted above under "Watch history,"
  is the correct/only cross-origin control surface and would have to become the *primary* one, not
  a secondary fallback, on iOS).
- **Electron main-process-only**: the YouTube Data API key fetch path (plain Node `fetch` in
  `electron/ipc/youtube.ts` — trivially portable to any native HTTP call, just not through this
  exact IPC channel), all SQLite (`youtube_videos`/`youtube_sync`/`youtube_transcripts*`) access.
- **Likely portable largely as-is**: the standard Web PiP API usage (once the video element is
  reachable at all); the transcript FTS5 search and pre-seeded read-only transcript data (SQLite
  ships the same way on iOS via whatever DB layer the mobile port settles on); `youtubeLayouts.ts`/
  `youtubeTitle.ts`/`youtubeSearch.ts` (pure logic, no `window.*`/DOM dependency — see Lane 4);
  timestamp insertion's `CustomEvent`-based decoupling (works identically as long as the host page
  itself, as opposed to the video iframe, is the one WKWebView content).
- **Needs a real redesign, not a port**: the entire play-state/CSS-injection/navigation-blocking
  cluster of `executeJavaScript` calls, since none of it can reach across an `<iframe>`'s origin
  boundary — this is the single biggest YouTube-lane rewrite implied by moving off `<webview>`.

## Lane 4 — Tests & tooling inventory

### Config (`vitest.config.ts`)

`environment: 'jsdom'`, `globals: true`, `css: true` (needed because a plain `false` — the
default — stubs out `.css` imports with empty exports, which silently breaks `?raw` CSS imports
too, e.g. the note editor's `pmEditor.css?raw` used to inline the live editor's stylesheet into
print/PDF export — would resolve to an empty string in tests only, never in the real Vite build).
Own `cacheDir: .vite-test` (separate from the dev-server's Vite cache) — deliberate, because
`node_modules` is symlinked across git worktrees (CLAUDE.md's worktree workflow), so anything
cached under it would otherwise be shared/clobbered between a test run here and a dev server
running in another worktree or in `main`. `exclude` adds `**/.claude/**` so agent scratch
worktrees under `.claude/` don't contribute spurious duplicate/stale test failures to a full
`vitest run`. Alias `@` → `src`.

A second, separate Vitest config exists for evals: `scripts/eval/vitest.eval.config.ts` (see
below) — a distinct suite, not part of the default `vitest run`.

### Test file inventory

**134 test files** total under `__tests__` directories, plus 6 more under a top-level `tests/`
directory (7 files: `tests/unit/*.test.ts` × 6, `tests/integration/vault-sync.test.ts` × 1) — 140
test files overall. Breakdown by area (`__tests__` parent directory):

| Area | Test files |
|---|---|
| `src/lib/__tests__` | 41 |
| `src/components/notes/pm/__tests__` | 35 |
| `src/components/notes/__tests__` | 13 |
| `electron/ipc/__tests__` | 13 |
| `src/store/__tests__` | 9 |
| `electron/__tests__` | 6 |
| `src/lib/tts/kokoro/__tests__` | 5 |
| `src/components/bible/__tests__` | 4 |
| `src/lib/tts/__tests__` | 3 |
| `src/components/lexicon/__tests__` | 2 |
| `src/components/tags/__tests__`, `src/components/shell/__tests__`, `src/components/ailookup/__tests__` | 1 each |
| `tests/unit/` (top-level, not `__tests__`) | 6 (`trailGraph`, `parseRef`, `dailyNoteUtils`, `vault-note-icon`, `vault-note-status`, `psalmSuperscription`) |
| `tests/integration/` | 1 (`vault-sync.test.ts`) |

`src/store/__tests__` covers tab lifecycle specifically: `archivedGroups`, `closeTabPrune`,
`freshBibleTabNav`, `goToTabHome`, `originTabReturn`, `scrollByTabNavReset`, `tabMRU`,
`tabPlacement`, plus `studyTrailSlice.test.ts` — i.e. most of Lane 1(c)'s tab mechanics already
have direct unit coverage to build a device-sync test suite on top of. `electron/ipc/__tests__`
skews heavily toward AI Lookup (`aiLookup.*` × 6) plus `crossrefs`, `lexicon.occurrences`,
`numberWords`, `semanticCandidates`, `ttsModel`, `vault.extractInlineImages`,
`vault.inlineVaultImages`. `electron/__tests__` (top-level, distinct from `electron/ipc/`) covers
`csp`, `embeddingQuantize`, `packagedAssets`, `rrf`, `tokenBudget`, `ttsModelManifest` — mostly
pure-function/config tests, no Electron app instance spun up.

### How tests stub `window.*` bridges

Strikingly **few** tests touch `window.*` at all: only **8 of 140** test files reference `window.`
in any form, and of those, only **1** (`crossWindowSync.test.ts`, for `window.location`) plus the
one `vi.stubGlobal('fetch', ...)` in `ttsModel.test.ts` use a real Vitest/browser stubbing
mechanism. The dominant pattern is a plain **partial object-literal assignment** onto the global
`window`, done ad hoc per test file with no shared helper:
```ts
// @ts-expect-error partial window.notes mock, sufficient for this test
global.window = { ...global.window, notes: { getNotes, updateNote, createNoteVersion } }
```
(`src/lib/__tests__/noteMigration.test.ts:22-23`), and similarly `window.app = { ...window.app,
openFloatingTab }` in `src/components/shell/__tests__/TabBarContextMenu.test.tsx`. **No shared
mock-bridge test utility exists** (no `test/mockWindow.ts` or equivalent) — each of the 8 files
builds its own minimal inline stub of just the one or two bridge methods it needs. This is a real
gap worth flagging for the mobile port: whichever shared/abstracted platform-bridge layer gets
introduced for iOS should probably come with one shared test double, both to DRY these 8 files up
and so future shared-layer tests have a ready-made fake to import.

The overwhelming majority of the other 132 test files need **no** `window.*` stub at all, because
they test pure functions/reducers/plugins directly against their exported API (schema transforms,
`parseRef`, PM plugin doc-transform functions, store actions called via `useAppStore.getState()`
with no bridge call in the code path under test, etc.) — a strong signal that most of this logic
is already bridge-independent and could move into a shared cross-platform layer with its tests
following unchanged (see the `src/lib/*.ts` classification below).

**Integration test**: `tests/integration/vault-sync.test.ts` — the one test exercising the
Obsidian/Octarine vault-sync round trip (§18 of CLAUDE.md) against a real temp-directory vault,
rather than mocking the filesystem.

### CI / tooling

- **`.github/workflows/release.yml`** — the only workflow file. Tag-triggered (`v*`) macOS release
  build: checkout → Node 22 (`actions/setup-node`, npm cache) → `npm ci` → download Bible/lexicon
  `.db` files from a separate `data-v1` GitHub Release via `gh release download` → convert DBs to
  `DELETE` journal mode (`scripts/convert-dbs.js`) → `npm run rebuild` (native module rebuild for
  Electron) → write the YouTube API key file from a secret → (presumably) build + publish the
  `.dmg`. **No CI job runs `npm test` or `npm run lint`** on every push/PR — this workflow only
  fires on a release tag and only builds; there is no continuous test/lint gate in this repo today.
- **ESLint**: `package.json`'s `lint` script is `eslint . --ext .ts,.tsx` and `eslint": "^9.1.1"`
  is a devDependency, but **no ESLint config file exists anywhere in the repo root**
  (`eslint.config.js`/`.mjs`/`.cjs`, or a legacy `.eslintrc*`) — confirmed by direct directory
  listing, not just a missed glob. ESLint 9 requires flat config by default and no longer reads
  `--ext` from the CLI the same way its own `--ext` flag implies (that flag is a legacy-config-era
  option); as configured today, `npm run lint` most likely does not run successfully. Since there's
  also no CI lint gate, this may simply not have been noticed. Worth flagging to the lead as
  pre-existing repo hygiene independent of the mobile effort, since a mobile port is exactly the
  kind of large refactor where having a working lint pass would help.
- **`scripts/eval/`** — a separate offline evaluation harness for AI Lookup's retrieval, not part
  of the normal test suite: `runRetrievalEval.ts` (entry point), `semanticEval.ts`,
  `retrievalFixtures.ts` (fixture queries/expected results), `betterSqlite3NodeShim.ts` (lets the
  eval script run outside Electron by shimming the native module), `vitest.eval.config.ts` (its own
  Vitest config, separate from the root one), `ZERO_RESULT_INVESTIGATION.md` (a findings doc, not
  code). Unrelated to the mobile audit's scope beyond noting it exists and isn't part of `npm test`.

### `src/hooks/*` (9 files)

| Hook | Purpose |
|---|---|
| `useChapterProgress.ts` | Shared "how far through the chapter is Read Aloud" (verse list + current-verse fraction 0-1), used by both the always-visible circular progress ring and the full player's progress bar |
| `useKokoroModelDownload.ts` | Drives the Kokoro voice-pack download UI; wraps a pure reducer (`modelDownloadState.ts`) around the `window.ttsModel` IPC bridge, mirrors the final ready state into the store |
| `useProximityReveal.ts` | Reveals UI while the **cursor** is within N px of a target element — mouse-proximity based, used for Focus mode; no direct touch equivalent (see Findings) |
| `useQueueAutosave.ts` | Autosaves the Read Aloud playback queue back to its source playlist on change; mounted once at `App.tsx` root alongside `useTTSPlayback` |
| `useRovingGridNav.ts` | Roving-tabindex arrow-key navigation for a button/chip/checkbox group (keyboard-only; Enter/Space left to native activation) |
| `useSwipeDismissGesture.ts` | **Two-finger trackpad** swipe-down to dismiss a bottom toast |
| `useSwipePanelGesture.ts` | **Two-finger trackpad** swipe to open/close the Bible reader's right side panel (backs the `swipePanelGestureEnabled` setting from Lane 1) |
| `useTTSPlayback.ts` | Read Aloud orchestration — see Lane 3 |
| `useViewerSync.ts` | Presenter/Viewer window content + scroll-position sync (see `project_presenter_viewer` memory) |

Both trackpad-swipe hooks are macOS-trackpad-gesture-specific by name and design — natural
candidates for a touch-swipe reimplementation on iOS rather than a straight port.

### `src/lib/*.ts` (69 files), grouped

Classified by grepping each file for `window.<bridgeNamespace>` calls (bridge-dependent) vs. other
browser globals (`window.`/`document.`/`localStorage`/`sessionStorage`/`navigator.`/
`addEventListener`/`requestAnimationFrame`/`getComputedStyle`, DOM-dependent) vs. neither (pure).

**Bridge-dependent (calls a `window.<namespace>` IPC method) — 11 files**: `chapterCache.ts`
(`window.bible`), `commands.ts` (`window.app`), `crossRefIndex.ts` (`window.notes`),
`crossWindowSync.ts` (`window.crossWindow` — see Lane 1), `noteCache.ts` (`window.notes`),
`noteMigration.ts` (`window.notes`), `notesCache.ts` (`window.notes`), `panelDataCache.ts`
(`window.lexicon`, `window.notes`), `useWindowDrag.ts` (`window.app` — frameless-window drag
region, Electron/macOS-window-specific), `wordReplacer.ts` (`window.bible`), `youtubeTitle.ts`
(`window.youtube`). These are exactly the files a shared cross-platform layer would need a real
platform-bridge implementation for (vs. a fake) on iOS.

**DOM/browser-dependent (no bridge call, but uses `window`/`document`/storage/etc.) — 10 files**:
`applyTheme.ts`, `debouncedStorage.ts` (wraps `localStorage` — the zustand persist adapter, Lane
1d), `perWindowViewState.ts` (also `localStorage`-based — per-window view state restore, Lane 1),
`presenterOverlay.ts`, `scrollbarAutoHide.ts`, `tagPalette.ts`, `usePositionedMenu.ts` (heaviest
DOM user of this group — floating-menu positioning math), `useRovingNav.ts`, `useScrollEdge.ts`,
`verseClipboard.ts` (`navigator.clipboard`). Also **`pdfjs.ts`** (not caught by the grep pattern
above, but browser-dependent via a Web Worker: `new Worker` from a Vite `?url` import for pdf.js's
own worker) belongs in this bucket too.

**Pure / shared-safe (no `window.*`, no DOM) — remaining 47 files**, the large majority:
`annotationFilters.ts`, `audioQueueRef.ts`, `bdbAbbreviations.ts`, `bibleNav.ts`, `bibleTexts.ts`,
`blockTypeIcons.ts`, `caretScroll.ts`, `dailyNoteUtils.ts`, `emojiList.ts`, `hermasMap.ts`,
`idiomsExport.ts`, `lexiconTitle.ts`, `motion.ts`, `multiBookSearch.ts`, `notePreviewRender.ts`,
`notePreviewText.ts`, `noteRefs.ts`, `noteStatus.ts`, `noteTextBlocks.ts`, `noteUtils.ts`,
`numberWords.ts`, `parseRef.ts`, `presenterBand.ts`, `progressBar.ts`, `prologueBooks.ts`,
`psalmSuperscription.ts`, `psalmTitles.ts`, `scriptureHighlight.ts`, `scriptureSearchFilters.ts`,
`scrollToVerse.ts`, `strongsSearch.ts`, `taggedTokens.ts`, `tagRefScan.ts`, `themePresets.ts`,
`translationChapterMap.ts`, `verseNavigation.ts`, `verseRangeFormat.ts`, `verseScrollSync.ts`,
`verseTagRanges.ts`, `verseTagSearch.ts`, `verseUtils.ts`, `windowChrome.ts` (just two layout
constants — despite the name, no actual `window` access), `wordCount.ts`, `youtubeLayouts.ts`,
`youtubeSearch.ts`, `zoom.ts`. **One exception worth flagging individually**: `knownTagsBridge.ts`
has zero `window.*`/DOM calls (it isn't in either grep bucket) but is **not** side-effect-free —
it's a module that, on import, subscribes to the Zustand store and pushes updates into
`refDecorations.ts`'s module-level cache; it's "pure" only in the DOM sense, not in the
"safe to import without side effects" sense, so a shared layer would need to special-case it (or
just always carry the store dependency along, which is a smaller ask than the platform bridge).

This ~47-of-69 pure majority (68%) is a strong starting point for "what can move into a shared
cross-platform lib layer unchanged": book/chapter navigation, reference parsing, note
text/markdown/preview rendering, tagging, word-count/verse-range formatting, theme presets, and
more all have zero platform coupling today.

## Findings the lead must decide

- **Block drag-and-drop (`blockHandles.ts`) has no touch-equivalent today** — native HTML5 DnD
  doesn't fire from a touch gesture in iOS Safari/WKWebView by default. The keyboard move command
  (`Mod-Shift-ArrowUp/Down`) is a ready-made fallback, but a first-class touch-drag reorder gesture
  would need to be built, not ported.
- **Every scripture/Strong's/tag/wikilink hover-preview and every right-click context menu in the
  notes editor (and the notes list/folder view) has no touch trigger.** This is the single biggest
  cross-cutting UX gap for iOS: hover previews (350ms `mouseover`) simply won't fire on tap, and
  `contextmenu`-only menus (`VerseCopyMenu`, `StrongsContextMenu`, `NoteContextMenu`) have no
  long-press or "⋮" fallback anywhere in the codebase today.
- **Two trackpad-specific gestures** (`useSwipePanelGesture.ts`, `useSwipeDismissGesture.ts`) are
  explicitly two-finger-trackpad based and won't translate to a touch swipe without a rewrite.
- **`useProximityReveal.ts`'s cursor-distance-based reveal** (used by Focus mode) has no touch
  concept of "distance from a mouse cursor" — needs a different trigger on iOS (e.g. an explicit
  tap-to-reveal affordance).
- **Read Aloud's entire model-serving path is Electron-main-process-specific**: the custom
  `berean-model://` `protocol.handle` scheme (Node `fs` streaming from `userData`) has no direct
  Capacitor/iOS equivalent — this is probably the single largest "needs real native work, not a
  port" item in the whole audit, not just this lane. The lead needs to decide between a
  `WKURLSchemeHandler`-based reimplementation, routing bytes through blob/data URLs instead, or
  swapping to a native iOS TTS engine (`AVSpeechSynthesizer`) and accepting the voice-quality
  tradeoff that removing Kokoro implies.
- **YouTube's entire `executeJavaScript`-into-the-guest-page control surface can't survive moving
  off `<webview>`.** An `<iframe>` (the natural iOS replacement) is cross-origin, so none of the
  current play-state polling / CSS injection / SPA-navigation-blocking code can reach into it —
  only the YouTube IFrame Player API's `postMessage` protocol can, and the codebase already has
  exactly one code path built that way (the iframe-branch of the resume-seek logic in
  `YouTubeTab.tsx`) that would need to become the primary mechanism rather than a secondary one.
- **No CI test/lint gate exists** (`release.yml` only builds on a release tag) and **the `lint`
  script currently has no ESLint config to run against** — independent, pre-existing repo-hygiene
  gaps the lead may want fixed before or alongside a large mobile refactor, since a broad shared/
  platform-layer extraction is exactly the kind of change a real lint+test CI gate would catch
  regressions in.
- **No shared `window.*` bridge test-mock helper exists** — each of the 8 tests that stub `window`
  do it inline and ad hoc. Introducing a shared platform-bridge abstraction for iOS is a natural
  point to also introduce one shared fake for it.

## Commands run

```
cat vitest.config.ts
find src electron -type d -name "__tests__" | wc -l ; find . -maxdepth 1 -type d -name tests
find src electron -type f -path "*__tests__*" | wc -l ; find tests -type f
find src electron -type f -path "*__tests__*" | sed -E 's#/__tests__/.*##' | sort | uniq -c | sort -rn
grep -rln "window\.notes\s*=|window\.bible\s*=|vi\.stubGlobal|Object\.defineProperty(window" src electron tests
grep -rl "window\." src/**/__tests__/*.ts* electron/**/__tests__/*.ts tests/**/*.ts | wc -l
grep -rln "vi.stubGlobal" src electron tests
find . -maxdepth 2 -iname "*setup*test*"
find src -iname "*mock*" -o -iname "*testUtils*" -o -iname "*test-helpers*"
grep -n "window\." src/lib/__tests__/crossWindowSync.test.ts ; grep -n "window\.|global\." src/lib/__tests__/noteMigration.test.ts
ls .github/workflows ; cat .github/workflows/release.yml | head -40
grep -n "\"lint\"|eslint" package.json ; find . -maxdepth 1 -iname "*.eslintrc*" -o -maxdepth 1 -iname "eslint.config*" ; ls -la
find scripts/eval -type f
ls src/hooks/ ; head -8/-15/-20 on each hooks file for purpose comments
find src/lib -maxdepth 1 -type f -name "*.ts" | sort | wc -l
for f in src/lib/*.ts; do grep -oE "window\.(notes|bible|settings|lexicon|youtube|vault|app|history|workspaces|verseTags|tagGraph|studyTrail|aiLookup|playlists|pdf|ttsModel|crossWindow|windowControls|idioms|import)\b" "$f" | sort -u; grep -cE "\b(window\.|document\.|localStorage|sessionStorage|navigator\.|addEventListener|requestAnimationFrame|getComputedStyle)\b" "$f"; done
head -15 src/lib/pdfjs.ts ; head -15 src/lib/windowChrome.ts ; cat src/lib/knownTagsBridge.ts
find electron -maxdepth 2 -type d -name "__tests__" ; find electron -path "*/electron/__tests__/*"
find electron/ipc/__tests__ -type f ; find src/store/__tests__ -type f
```
