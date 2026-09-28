# Berean iOS Audit — Data & Platform Layer

Scope: IPC surface, `berean.db` schema, bundled text/lexicon/cross-ref DBs, persistence
outside SQLite, main-process lifecycle, build/packaging/update, and native/Node-only
dependencies. Read-only audit against `/Users/roywe/Berean-ios` (worktree, branch
`feature/ios-app`). No source files were modified.

---

## 1. IPC Channel Catalog

**Total: 243 IPC registrations** (`ipcMain.handle`/`ipcMain.on` across `electron/main.ts` +
`electron/ipc/*.ts`, counted via `grep -rn "ipcMain\.\(handle\|on\)("` = 225, plus
`electron/ipc/youtube.ts`'s `registerYouTubeHandlers(ipc: typeof ipcMain)` which calls
`ipc.handle(...)` under an aliased parameter name = 18). `electron/ipc/archaicVocab*.ts`,
`numberWords.ts`, `semanticCandidates.ts` register no IPC of their own — they're pure
helper modules imported by `bible.ts`/`aiLookup.ts`.

Per-file counts (grep-verified):

| File | Channels |
|---|---|
| `electron/main.ts` | 51 |
| `electron/ipc/studyTrail.ts` | 43 |
| `electron/ipc/notes.ts` | 32 |
| `electron/ipc/verseTags.ts` | 13 |
| `electron/ipc/pdf.ts` | 11 |
| `electron/ipc/vault.ts` | 9 |
| `electron/ipc/aiLookup.ts` | 7 |
| `electron/ipc/ttsModel.ts` | 6 |
| `electron/ipc/crossrefs.ts` | 6 |
| `electron/ipc/workspaces.ts` | 5 |
| `electron/ipc/tagGraph.ts` | 5 |
| `electron/ipc/history.ts` | 5 |
| `electron/ipc/bible.ts` | 5 |
| `electron/ipc/bgImport.ts` | 5 |
| `electron/ipc/ttsAudioCache.ts` | 4 |
| `electron/ipc/playlists.ts` | 4 |
| `electron/ipc/lexicon.ts` | 4 |
| `electron/ipc/eSwordImport.ts` | 4 |
| `electron/ipc/settings.ts` | 3 |
| `electron/ipc/highlights.ts` | 3 |
| `electron/ipc/youtube.ts` | 18 |

Registration order (`app.whenReady()` in `main.ts:1341-1374`): `ttsModel`, `ttsAudioCache`,
`bible`, `notes`, `pdf`, `vault`, `settings`, `lexicon`, `highlights`, `verseTags`,
`tagGraph`, `youtube`, `crossrefs`, `aiLookup`, `bgImport`, `eSwordImport`, `history`,
`studyTrail`, `workspaces`, `playlists` — then ~51 `app:*`/`window:*`/`cross-window:*`/
`viewer:*`/`versePicker:*` channels are registered inline in `main.ts` itself (not via a
`register*Handlers` function).

### 1.1 CORE-SHARED (pure SQL / business logic — iOS needs this offline)

These touch only `better-sqlite3` (via `getBereanDb()` / `getTextDb()` / `getHebrewDb()` /
`getGreekDb()`) with no Electron-only API. They are the direct porting targets for an
async SQLite driver on iOS.

| File | Channels | preload namespace | DB(s) |
|---|---|---|---|
| `electron/ipc/bible.ts` (5, lines 185-255) | `bible:getBooks`, `bible:queryChapter`, `bible:queryVerse`, `bible:queryVerses`, `bible:searchText` | `window.bible.*` | `data/*.db` (per-text, via `getTextDb`) |
| `electron/ipc/lexicon.ts` (4, lines 380-405) | `lexicon:getEntry`, `lexicon:getOccurrences`, `lexicon:getRelated`, `lexicon:search` | `window.lexicon.*` | `strongs_hebrew.db`, `strongs_greek.db`, `data/*.db` |
| `electron/ipc/crossrefs.ts` (6, lines 331-478) | `crossrefs:status`, `crossrefs:getForChapter`, `crossrefs:getTSKeForChapter`, `crossrefs:getHermasTaylorChapter`, `crossrefs:getForVerse`, `crossrefs:getTSKeForVerse` | `window.crossrefs.*` | `data/cross_references.db`, `data/tske_refs.db` (own `new Database(...)`, path resolved via `app.isPackaged`/`existsSync`), `data/*.db` |
| `electron/ipc/highlights.ts` (3, lines 32-153) | `highlights:getChapter`, `highlights:toggle`, `highlights:remove` | `window.highlights.*` | `berean.db.highlights` |
| `electron/ipc/history.ts` (5, lines 32-89) | `history:add`, `history:getAll`, `history:getPage`, `history:delete`, `history:clear` | `window.appHistory.*` | `berean.db.history` |
| `electron/ipc/playlists.ts` (4, lines 37-77) | `playlists:list`, `playlists:save`, `playlists:rename`, `playlists:delete` | `window.playlists.*` | `berean.db.playlists`, `playlist_items` |
| `electron/ipc/settings.ts` (3, lines 5-19) | `settings:get`, `settings:set`, `settings:getAll` | `window.settings.*` | `berean.db.settings` |
| `electron/ipc/tagGraph.ts` (5, lines 43-112) | `tagGraph:getGraph`, `tagGraph:createEdge`, `tagGraph:updateEdge`, `tagGraph:deleteEdge`, `tagGraph:setTagPosition` | `window.tagGraph.*` | `berean.db.tag_edges`, `verse_tags` |
| `electron/ipc/verseTags.ts` (13, lines 106-246) | `verseTags:list/create/rename/setColor/setColorSlot/reorder/merge/delete/addMembers/removeMember/updateMemberRanges/getForChapter/getMembers` | `window.verseTags.*` | `berean.db.verse_tags`, `verse_tag_members`, `verse_tag_verse` |
| `electron/ipc/workspaces.ts` (5, lines 6-32) | `workspaces:list/save/load/delete/rename` | `window.workspaces.*` | `berean.db.workspaces` |
| `electron/ipc/aiLookup.ts` (4 of 7) | `ailookup:listChats`, `ailookup:getChat`, `ailookup:saveChat`, `ailookup:deleteChat` (lines 3603-3635) | `window.aiLookup.*` | `berean.db.ai_chats` |
| `electron/ipc/youtube.ts` (subset, ~8 of 18) | `youtube:loadAll`, `youtube:toggleStar`, `youtube:savePosition`, `youtube:getPosition`, `youtube:getWatchHistory`, `youtube:removeFromHistory`, `youtube:clearWatchHistory`, `youtube:getTranscript`, `youtube:searchTranscripts` (lines 1362-1408) | `window.youtube.*` | `berean.db.youtube_videos`, `youtube_watch_history`, `youtube_transcripts*` |
| `electron/ipc/notes.ts` (majority of 32) | see §1.2 — most are pure DB CRUD | `window.notes.*` | `berean.db.notes*`, `note_folders`, `note_versions`, `note_heading_collapse`, `note_thread_collapse` |
| `electron/ipc/studyTrail.ts` (majority of 43) | see §1.2 — most are pure DB CRUD | `window.studyTrail.*` | `berean.db.trail_*` (9 tables) |

### 1.2 CORE-SHARED-with-caveat: cross-window broadcast baked into the handler

`notes.ts` and `studyTrail.ts` are almost entirely CORE-SHARED DB logic, but **every
mutating handler also calls a `BrowserWindow.getAllWindows()` broadcast** as its last
step, which has no iOS equivalent (single-window app):

- `electron/ipc/notes.ts:2,16-17` — a local `broadcastNotesChanged(exclude)` helper sends
  `'notes:changed'` to every other open `BrowserWindow`. All 32 `notes:*`/`folders:*`
  channels (lines 174-771) route through this pattern for anything that mutates data.
  Preload: `window.notes.onChanged(cb)` (`preload.ts:69-72`).
- `electron/ipc/studyTrail.ts:2,23-24` — `broadcastDataChanged(trailSessionId?)` does the
  same; called from ~29 of the 43 `studyTrail:*` mutating handlers (full list at
  `studyTrail.ts:131,141,155,161,181,197,213,292,320,370,376,385,417,446,489,565,571,607,
  617,626,633,1023,1051,1061,1090,1099,1109,1121,1141,1168,1178`). Preload:
  `window.studyTrail.onDataChanged(cb)` (`preload.ts:521-525`).

Porting verdict: the SQL bodies are CORE-SHARED verbatim; the broadcast call is dead code
on iOS (0 or 1 windows) and should become a no-op in the shared layer, not deleted (it's
needed if a future iPad multi-scene / SharePlay-style feature appears).

Full `notes:*`/`folders:*` channel list (32, `electron/ipc/notes.ts:174-760`):
`notes:create`, `notes:update`, `notes:listIdioms`, `notes:delete`, `notes:restore`,
`notes:listTrash`, `notes:purgeTrashItem`, `notes:emptyTrash`, `folders:getAll`,
`folders:create`, `folders:rename`, `folders:delete`, `folders:deleteDeep`,
`folders:setParent`, `notes:setFolder`, `notes:setPinned`, `notes:deleteAll`,
`notes:getAll`, `notes:getByVerse`, `notes:getOne`, `notes:search`, `notes:deleteByTag`,
`notes:countTagRefs`, `notes:getByChapter`, `notes:getChapterCounts`,
`notes:createVersion`, `notes:getVersions`, `notes:restoreVersion`,
`notes:getCollapsedHeadings`, `notes:setHeadingCollapsed`, `notes:getCollapsedThreads`,
`notes:setThreadCollapsed`. `notes:delete`/`notes:restore`/trash handlers additionally
call into `vault.ts`'s `moveNoteToVaultTrash`/`restoreNoteFromVaultTrash`/
`purgeNoteFromVaultTrash` (fs-based) — see §1.4.

Full `studyTrail:*` channel list (43, `electron/ipc/studyTrail.ts:124-1178`):
`startSession`, `pauseSession`, `resumeSession`, `renameSession`, `endSession`,
`deleteSession`, `deleteSessions`, `listSessions`, `listAllSessions`,
`ensureLooseSession`, `getSession`, `addNode`, `reopenNode`, `promoteRevisit`,
`updateNodeSubnote`, `setNodeTopicBreak`, `deleteNode`, `moveNodes`, `addConnection`,
`deleteConnection`, `markGlance`, `updateConnectionReason`, `dismissPrompt`,
`clearConnectionNote`, `updateRecap`, `getBacklinks`, `search`, `listThreads`,
`listNotes`, `createNote`, `updateNote`, `deleteNote`, `listTags`, `createTag`,
`updateTag`, `deleteTag`, `setSessionTags`, `mergeSessions`, `splitSession`,
`reorderSessions`, `listSessionsPage`, `getCollapse`, `setCollapse` (all prefixed
`studyTrail:`).

### 1.3 DESKTOP-ONLY (windows, menus, importers, ollama, model downloads, viewer/presenter)

| Channel(s) | File:line | Node/Electron deps | Why desktop-only |
|---|---|---|---|
| `app:newWindow`, `app:newIndependentWindow`, `app:openFloatingTab`, `app:openViewerWindow`, `app:closeViewerWindow`, `app:isViewerWindowOpen`, `app:openStudyTrailWindow`, `app:closeStudyTrailWindow`, `app:isStudyTrailWindowOpen`, `app:getActiveScriptureRef`, `app:navigateMainToRef` | `main.ts:1397-1507` | `BrowserWindow` (multiple singleton secondary windows) | No multi-window model on iOS |
| `cross-window:broadcast`, `cross-window:sendTo`, `cross-window:list`, `cross-window:selfId`, `app:broadcastStudyTrailState`, `app:broadcastTabState`, `app:broadcastAudioState`, `app:returnFloatTab`, `app:moveWindowBy` | `main.ts:1405-1742` | `BrowserWindow.getAllWindows()` fan-out | Peer-window sync has no iOS analogue |
| `viewer:signalReady`, `app:pushViewerContent`, `app:pushViewerSettings`, `app:pushViewerOverlay`, `viewer:reportVisibleRegion`, `app:requestViewerVisibleRegion` | `main.ts:1510-1575` | Presenter/Viewer secondary `BrowserWindow` (see [[project_presenter_viewer]] memory) | Second-screen presenter window is desktop-specific |
| `versePicker:open`, `versePicker:ready`, `versePicker:selectionChanged` | `main.ts:1541-1555` | Auxiliary `BrowserWindow` | Desktop-only utility window |
| `window:minimize`, `window:maximize`, `window:close`, `window:isMaximized`, `window:setButtonsVisible` | `main.ts:1750-1775` | `BrowserWindow` frame controls | No window chrome on iOS |
| `app:checkForUpdates`, `app:downloadUpdate`, `app:installUpdate` | `main.ts:1791-1830` | `electron-updater` (`autoUpdater`) | iOS updates go through the App Store |
| `app:printNote`, `app:exportNotePDF`, `app:renderPreviewPDF` | `main.ts:1642-1704` | Offscreen `BrowserWindow` + `webContents.printToPDF`/`.print()` | Needs `NEEDS-PLATFORM-ADAPTER` (iOS has `UIPrintInteractionController` / PDFKit, but the whole offscreen-render-then-print mechanism is Electron-specific) |
| `bgImport:start`, `bgImport:importSelected`, `bgImport:cancel`, `bgImport:debugOpen`, `bgImport:clearSession` | `bgImport.ts:708-820` | `BrowserWindow` + `session` (scrapes a live BibleGateway login session via a real Chromium window) | Explicitly deferred per CLAUDE.md §20 ("BibleGateway notes sync — requires login session scraping, deferred") |
| `eSwordImport:detectFolder`, `eSwordImport:start`, `eSwordImport:importSelected`, `eSwordImport:cancel` | `eSwordImport.ts:434-543` | `BrowserWindow`, `os.homedir()`, opens the user's **local e-Sword desktop installation's own SQLite files** | e-Sword is a Windows/Mac-only app; meaningless on iOS |
| `youtube:buildSeed` | `youtube.ts:1520` | Dev/build-time tool (populates `youtube_seed.db` for shipping) | Not a runtime feature at all — build tooling |
| `ailookup:checkAvailable`, `ailookup:unloadModel`, `ailookup:query` | `aiLookup.ts:3591-3601` | `ollama.ts` → `net.fetch('http://localhost:11434/...')` — requires a **locally-installed, separately-running desktop Ollama app** | No iOS equivalent; see §7 and Findings |

### 1.4 NEEDS-PLATFORM-ADAPTER (native impl per platform)

| Channel(s) | File:line | Node/Electron deps | Adapter needed |
|---|---|---|---|
| `app:openFolderDialog` | `main.ts:1393-1396` | `dialog.showOpenDialog` | iOS `UIDocumentPickerViewController` |
| `app:openExternal` | `main.ts:1388` | `shell.openExternal` | `UIApplication.open` / `SFSafariViewController` |
| `app:youTubeSignOut` | `main.ts:1389-1392` | `session.fromPartition('persist:youtube').clearStorageData()` | `WKWebsiteDataStore` equivalent |
| `app:getAccentColor`, `app:getReduceTransparency`, `app:getIncreaseContrast` | `main.ts:1781-1787` | `systemPreferences`, `nativeTheme` (macOS/Windows-only APIs) | `UIAccessibility`/`UITraitCollection` |
| `app:getResourceMode` | `main.ts:1790` | `powerAwareness.ts` → `powerMonitor` (`on-battery`, `thermal-state-change`) | `ProcessInfo.thermalState`, `UIDevice.batteryState` |
| `pdf:import` | `pdf.ts:47` | `dialog.showOpenDialog` + `fs.copyFileSync` into `app.getPath('userData')` | iOS document picker + app container copy |
| `pdf:readBytes`, `pdf:get`, `pdf:list`, `pdf:rename`, `pdf:delete`, `pdf:setPageCount`, `pdf:highlights:*` (4) | `pdf.ts:75-152` | `fs.readFileSync`/`statSync`/`unlinkSync` against `app.getPath('userData')` | DB rows are CORE-SHARED; file storage path needs an iOS Documents-dir adapter |
| `ttsAudioCache:get/put/clear/stats` | `ttsAudioCache.ts:43-81` | `fs` cache dir under `app.getPath('userData')` | Portable logic (`audioCacheStore.ts` eviction planner is pure), storage layer needs iOS FileManager adapter |
| `ttsModel:getStatus/download/downloadRuntimeFile/cancelDownload/clearModelCache/getModelId` | `ttsModel.ts:195-217` | `fs`, `createWriteStream`, network download of ~125MB Kokoro weights + 21.6MB onnxruntime-web WASM runtime, served back via the custom `berean-model://` protocol (`ttsModelProtocol.ts`) | Kokoro/onnxruntime-web itself runs in a **renderer Web Worker** (portable WASM), but the download-to-disk-then-serve-via-custom-protocol mechanism is Electron-specific; iOS needs its own storage + `WKURLSchemeHandler` (or bundle a Capacitor local-file scheme) |
| `youtube:refresh`, `youtube:fullSync`, `youtube:fetchDescription`, `youtube:fetchTranscripts`, `youtube:clearTranscripts`, `youtube:getTranscriptStatus`, `youtube:searchVideos`, `youtube:clearAll` | `youtube.ts:1362-1408` | `electron.net.fetch` + `YOUTUBE_API_KEY` (gitignored secret file `electron/youtube-key.ts`, see [[project_youtube_transcript]]) | Trivially portable (swap `net.fetch` → standard `fetch`), but `fetchTranscripts`/`clearTranscripts` are intentionally `is.dev`-gated per [[feedback_transcript_dev_guard]] — must preserve that gate in any adapter |
| `vault:syncNote`, `vault:readNote`, `vault:watch`, `vault:unwatch`, `vault:reconcile`, `vault:exportAll`, `vault:importAll`, `vault:hasData`, `vault:setAutoExport` | `vault.ts:482-674` | `fs` (heavy — read/write/readdir/stat/copy/unlink), `chokidar` file watcher, `BrowserWindow` (sends `'vault:changed'` back to the window that owns the watched vault), `app.getPath` | Obsidian/Octarine sync targets a specific iCloud-synced macOS folder (see [[project_vault_export]]); on iOS this needs the Files/iCloud-Drive document-provider APIs or `NSFileCoordinator` — fundamentally different mechanism, likely a full rewrite not an adapter |

---

## 2. User-Data Schema (`berean.db`)

Source: `electron/db/berean.ts` (1145 lines), read in full. **42 migrations** (versions
1–42; version 18 was deliberately skipped — a comment at `berean.ts:527-530` explains a
same-numbered migration on another branch already consumed v18 against a shared dev
database, so this codebase's real v18 content is stamped v19 to avoid being silently
skipped by the `version > current` guard).

### 2.1 Tables

| Table | Created (v) | Columns (name: type) | Indexes | Read/write IPC |
|---|---|---|---|---|
| `notes` | v1 (+ v2,6,7,8,10,12,14-17,19,20,22,23,25 alterations) | `id` TEXT PK, `type` TEXT DEFAULT 'general', `title` TEXT, `content` TEXT DEFAULT '', `verse_ref` TEXT, `color` TEXT DEFAULT 'blue', `created_at` INTEGER, `updated_at` INTEGER, `tags` TEXT DEFAULT '[]', `imported_at` INTEGER (v8), `folder_id` TEXT (v10), `text_id` TEXT DEFAULT 'kjva' (v12), `idiom_term`/`idiom_meaning`/`idiom_aliases`/`idiom_auto_variants`/`idiom_data` (v14-17), `status` TEXT (v20), `deleted_at` INTEGER (v22, soft-delete), `icon` TEXT (v23), `pinned` INTEGER DEFAULT 0 (v25) | `idx_notes_verse(verse_ref)`, `idx_notes_updated(updated_at DESC)`, `idx_notes_deleted_at(deleted_at)` | `notes.ts` (all `notes:*`) |
| `notes_fts` | v19 | FTS5 external-content over `notes(title, content)`, `content='notes'`, `content_rowid='rowid'`, `tokenize='unicode61'` + triggers `notes_ai`/`notes_ad`/`notes_au` | — | `notes:search` |
| `highlights` | v1 (+v2) | `id` TEXT PK, `text_id`, `book_id`, `chapter` INTEGER, `verse_num` INTEGER, `start_word`/`end_word` INTEGER, `color` TEXT, `label` TEXT, `created_at` INTEGER, `start_char`/`end_char` INTEGER (v2) | `idx_highlights_verse(text_id, book_id, chapter, verse_num)` | `highlights.ts` |
| `settings` | v1 | `key` TEXT PK, `value` TEXT (JSON-encoded) | — | `settings.ts`, and ad hoc `db.prepare("SELECT value FROM settings WHERE key=...")` calls sprinkled through `main.ts` (window bounds, update prefs, vault sync flag, seed version) |
| `workspaces` | v1 (+v9) | `id` TEXT PK, `name` TEXT, `layout_json` TEXT, `created_at` INTEGER, `state_json` TEXT (v9) | — | `workspaces.ts` |
| `youtube_videos` | v3 (+v4,5) | `video_id` TEXT PK, `title`, `published`, `channel_name`, `channel_handle`, `thumbnail_url`, `type`, `is_live_now` INTEGER DEFAULT 0, `fetched_at`, `duration_seconds` INTEGER DEFAULT 0 (v4), `is_starred` INTEGER DEFAULT 0 (v5), `description` TEXT DEFAULT '' (v5) | `idx_yt_handle`, `idx_yt_published DESC` | `youtube.ts` |
| `youtube_sync` | v3 | `channel_handle` TEXT PK, `last_full_sync`, `last_refresh` | — | `youtube.ts` |
| `youtube_watch_history` | v5 | `video_id` TEXT PK, `position_seconds` REAL DEFAULT 0, `last_watched`, `title` DEFAULT '', `channel_name` DEFAULT '', `thumbnail_url` DEFAULT '' | — | `youtube.ts` |
| `history` | v9 | `id` TEXT PK, `type`, `title`, `timestamp` INTEGER, `session_id`, `session_name`, `book_id`, `chapter`, `verse`, `note_id`, `strongs_num`, `video_id`, `query`, `parent_id`, `import_source`, `import_count` | `idx_history_ts(timestamp DESC)` | `history.ts` |
| `note_folders` | v10 | `id` TEXT PK, `name`, `parent_id`, `created_at` INTEGER | `idx_note_folders_parent` | `notes.ts` (`folders:*`) |
| `pdfs` | v11 | `id` TEXT PK, `title`, `filename`, `page_count` INTEGER DEFAULT 0, `file_size` INTEGER DEFAULT 0, `imported_at` INTEGER | — | `pdf.ts` |
| `pdf_highlights` | v11 | `id` TEXT PK, `pdf_id`, `page` INTEGER, `rects_json` TEXT, `color`, `text` DEFAULT '', `note`, `created_at` INTEGER | `idx_pdf_hl_pdf(pdf_id)` | `pdf.ts` |
| `note_versions` | v12 | `id` TEXT PK, `note_id`, `title`, `content` DEFAULT '', `kind` DEFAULT 'auto', `created_at` INTEGER | `idx_note_versions_note(note_id, created_at DESC)` | `notes.ts` (`notes:createVersion/getVersions/restoreVersion`) |
| `youtube_transcripts` | v13 | `video_id` TEXT PK, `lang` DEFAULT 'en', `source` DEFAULT 'timedtext', `fetched_at` INTEGER, `segment_count` INTEGER DEFAULT 0, `duration_ms` INTEGER DEFAULT 0, `error` TEXT | `idx_yt_transcripts_fetched(fetched_at DESC)` | `youtube.ts` |
| `youtube_transcript_segments` | v13 | `id` INTEGER PK, `video_id` FK→`youtube_transcripts(video_id) ON DELETE CASCADE`, `start_ms` INTEGER, `dur_ms` INTEGER DEFAULT 0, `text` TEXT | `idx_yt_seg_video(video_id, start_ms)` | `youtube.ts` |
| `youtube_transcripts_fts` | v13 | FTS5 external-content, `content='youtube_transcript_segments'`, `content_rowid='id'`, `tokenize='unicode61'` + triggers `yt_seg_ai/ad/au` | — | `youtube:searchTranscripts` |
| `ai_chats` | v21 | `id` TEXT PK, `title`, `messages` TEXT (JSON array), `created_at`/`updated_at` TEXT | `idx_ai_chats_updated(updated_at DESC)` | `aiLookup.ts` |
| `note_heading_collapse` | v24 | `note_id` TEXT, `heading_key` TEXT, `collapsed` INTEGER DEFAULT 1 — composite PK `(note_id, heading_key)`, no FK (degrades silently) | — | `notes.ts` |
| `note_thread_collapse` | v27 | `note_id`, `thread_key`, `collapsed` DEFAULT 1 — composite PK, no FK | — | `notes.ts` |
| `playlists` | v26 | `id` TEXT PK, `name`, `created_at`/`updated_at` INTEGER | — | `playlists.ts` |
| `playlist_items` | v26 | `id` TEXT PK, `playlist_id` FK→`playlists(id) ON DELETE CASCADE`, `position` INTEGER, `book_id`, `chapter` INTEGER, `start_verse` DEFAULT 1, `end_verse` (nullable = whole chapter), `text_id` | `idx_playlist_items_playlist(playlist_id, position)` | `playlists.ts` |
| `trail_sessions` | v28 (+v40) | `id` TEXT PK, `name`, `status` ('live'/'paused'/'ended'), `possibly_accidental` DEFAULT 0, `recap_text`, `recap_user_edited` DEFAULT 0, `created_at`/`updated_at` INTEGER, `sort_order` INTEGER (v40) | — | `studyTrail.ts` |
| `trail_paused_intervals` | v28 | `id` TEXT PK, `trail_session_id`, `paused_at` INTEGER, `resumed_at` INTEGER (NULL = still paused) | `idx_trail_paused_session` | `studyTrail.ts` |
| `trail_nodes` | v28 (+v29,32,33,36) | `id` TEXT PK, `trail_session_id`, `book_id`, `chapter` INTEGER, `order_index` INTEGER, `anchor_started_at`/`anchor_ended_at` INTEGER, `cached_subnote`, `origin_label`, `revisit_of_node_id` (v29), `translation` TEXT (v32), `cluster_id` TEXT (v33), `is_topic_break` INTEGER DEFAULT 0 (v36), `promoted_from_connection_id` (v31) | `idx_trail_nodes_session(trail_session_id, order_index)` | `studyTrail.ts` |
| `trail_connections` | v28 (+v30,31,34,35,36) | `id` TEXT PK, `trail_session_id`, `from_node_id`, `to_kind`, `to_book_id`, `to_chapter`, `to_verse`, `to_strongs_num`, `to_note_id`, `to_video_id`, `clarity_tier` INTEGER, `reason_text`, `reason_tags` (JSON), `verse_pin_from`/`to` INTEGER, `weight` DEFAULT 'full', `strongs_depth`, `cluster_id`, `dismissed_prompt_at`, `created_at`, `origin_verse_pin_from`/`to` (v30), `from_connection_id`/`chain_depth` DEFAULT 0/`to_verse_end` (v31), `ties` TEXT (v34, superseded), `user_note`/`ties_from`/`ties_to` (v35), `is_branch`/`is_branch_return` DEFAULT 0 (v36) | `idx_trail_conn_session`, `idx_trail_conn_dest`, `idx_trail_conn_parent` | `studyTrail.ts` |
| `trail_embeddings` | v28 | `id` TEXT PK, `ref_type`, `ref_id`, `source_text`, `vector` BLOB (Float32Array serialized), `updated_at` INTEGER | `idx_trail_embeddings_ref` | (no direct IPC found registered against this table in the files read — likely internal to `studyTrail.ts`'s search ranking) |
| `verse_tags` | v37 (+v42) | `id` TEXT PK, `name`, `color`, `sort_order` INTEGER, `created_at` INTEGER, `color_slot` INTEGER (v42), `graph_x`/`graph_y` REAL (v42), `graph_pinned` INTEGER DEFAULT 0 (v42) | unique `idx_verse_tags_name(name COLLATE NOCASE)` | `verseTags.ts`, `tagGraph.ts` |
| `verse_tag_members` | v37 | `id` TEXT PK, `tag_id` FK→`verse_tags(id) ON DELETE CASCADE`, `kind` DEFAULT 'verses', `ranges` TEXT (JSON), `label`, `created_at` | `idx_vtm_tag` | `verseTags.ts` |
| `verse_tag_verse` | v37 | `tag_id`, `member_id`, `book_id`, `chapter` INTEGER, `verse` INTEGER (0 = whole chapter) — composite PK `(tag_id, book_id, chapter, verse, member_id)` | `idx_vtv_loc`, `idx_vtv_tag` | `verseTags.ts` |
| `trail_collapse` | v38 | `scope`, `key`, `collapsed` DEFAULT 1, `updated_at` — composite PK `(scope, key)` | — | `studyTrail.ts` |
| `trail_notes` | v39 (+v41) | `id` TEXT PK, `trail_session_id`, `kind` DEFAULT 'annotation', `anchor_node_id`, `order_index` DEFAULT 0, `title`, `body` DEFAULT '', `width`/`height` INTEGER, `note_id` (nullable — set = body owned by `notes` table), `color`, `created_at`/`updated_at`, `offset_x`/`offset_y` INTEGER (v41) | `idx_trail_notes_session`, `idx_trail_notes_anchor` | `studyTrail.ts` |
| `trail_tags` | v40 | `id` TEXT PK, `name`, `color`, `sort_order`, `created_at` | unique `idx_trail_tags_name(name COLLATE NOCASE)` | `studyTrail.ts` |
| `trail_tag_members` | v40 | `tag_id` FK→`trail_tags(id) ON DELETE CASCADE`, `trail_session_id`, `created_at` — composite PK | `idx_ttm_session` | `studyTrail.ts` |
| `tag_edges` | v42 | `id` TEXT PK, `source_tag_id`/`target_tag_id` FK→`verse_tags(id) ON DELETE CASCADE`, `arrows` DEFAULT 'none', `color`, `dashed` DEFAULT 0, `note` DEFAULT '', `created_at`/`updated_at` | unique `idx_tag_edges_pair(source,target)`, `idx_tag_edges_src`, `idx_tag_edges_tgt` | `tagGraph.ts` |
| `schema_version` | (migration runner) | `version` INTEGER | — | `runMigrations()` only |

### 2.2 FTS5 tables & triggers
Two external-content FTS5 indexes, both hand-rolled (not `sqlite-utils`): `notes_fts`
(v19) and `youtube_transcripts_fts` (v13), each with `AFTER INSERT/DELETE/UPDATE`
triggers that keep the index in sync with the content table. `notes_fts` was backfilled
with `INSERT INTO notes_fts(notes_fts) VALUES('rebuild')` at creation time.

### 2.3 better-sqlite3-specific usage
- `db.transaction(() => {...})()` — used by `runMigrations` (each migration wrapped
  individually) and `mergeYouTubeSeed` (`berean.ts:28-78`). This is better-sqlite3's
  **synchronous** transaction wrapper — an async SQLite driver (e.g.
  `@capacitor-community/sqlite`, `op-sqlite`) needs an explicit `BEGIN`/`COMMIT` or its
  own promise-based transaction API; none of this code can port as-is.
- `db.pragma('journal_mode = WAL')`, `db.pragma('foreign_keys = ON')` (`berean.ts:100-101`)
  — WAL mode requires `-wal`/`-shm` sidecar files in the same directory; the packaged-app
  `afterPack.js` hook (see §6) explicitly converts the **bundled read-only text DBs** to
  `DELETE` journal mode for exactly this reason (MAS/Windows read-only Resources dir can't
  write `-shm`). `berean.db` itself (the writable user DB) stays WAL. An iOS document
  container is writable, so WAL *can* work there, but confirm the chosen driver supports it.
- No `.pluck()`, `.raw()`, or `db.function()` (user-defined SQL functions) found anywhere
  in `electron/db/*.ts` or `electron/ipc/*.ts` — good news for porting; nothing relies on
  those better-sqlite3-only escape hatches.
- `ATTACH`/`DETACH` — `mergeYouTubeSeed` (`berean.ts:26,80`) attaches the bundled
  `youtube_seed.db` as `seed` and bulk-inserts via `INSERT OR IGNORE ... SELECT FROM
  seed.*`. This one-time seed-merge pattern needs an explicit re-implementation on
  whatever iOS driver is chosen (most don't support `ATTACH` the same way, or need each
  DB opened separately with manual row copying).
- `randomUUID` (Node's `crypto.randomUUID`) is used for all primary keys across
  `notes.ts`, `highlights.ts`, `pdf.ts`, `playlists.ts`, `studyTrail.ts`, `tagGraph.ts`,
  `verseTags.ts`, `workspaces.ts`, `bgImport.ts`, `eSwordImport.ts` — trivially portable
  (any `uuid` package or `crypto.randomUUID()` in a JS/WebKit runtime).
- `Date.now()` (ms epoch integers) is the timestamp convention throughout — no ISO
  strings except `ai_chats.created_at/updated_at` (TEXT) and `youtube_videos.published`
  (TEXT, likely ISO from the YouTube API).
- Soft-delete: only `notes.deleted_at` (v22) uses the pattern; nothing else in the schema
  soft-deletes.
- Version tables: `note_versions` (v12, full snapshot history) is the only such table.

---

## 3. Bundled Text DBs (`data/*.db`)

`data/` in the worktree is 26 **symlinks** into `/Users/roywe/Berean/data/` (the main
working tree) plus one `.gitkeep` and one stray backup file
(`kjva.db.bak-2esdras7-restore-20260805-083737`, 19MB, not referenced by code). Symlinks
resolved and sizes measured directly against the main tree:

| File | Size | Registered as (id: label) in `bibleTexts.ts` |
|---|---|---|
| `kjva.db` | 20MB | `kjva`: "KJVA" |
| `kjv.db` | 8.4MB | *(not in `TRANSLATIONS`/`EDITIONS` — only referenced in `bible.ts`'s `TEXT_FILES` map; appears to be a plain-KJV-without-Apocrypha variant not surfaced in the UI picker)* |
| `lxx_brenton.db` | 17MB | `lxx`: "LXX" (Brenton Septuagint) — note the **file** is `lxx_brenton.db` but the **id** is `lxx` |
| `lxx.db` | 24MB | *(not in `TRANSLATIONS`; not in `bible.ts`'s `TEXT_FILES` map either — appears to be an orphaned/legacy file not wired to any text id)* |
| `enoch.db` | 480KB | `enoch`: "1 Enoch" |
| `jubilees.db` | 588KB | `jubilees`: "Jubilees" |
| `apoc_elijah.db` | 100KB | `apoc_elijah`: "Apoc. Elijah" |
| `recog_clement.db` | 2.3MB | `recog_clement`: "Recog. Clement" |
| `hermas.db` | 444KB | `hermas`: "Hermas" (Roberts-Donaldson) |
| `hermas_taylor.db` | 492KB | `hermas_taylor`: "Hermas (Taylor)" |
| `asc_isaiah.db` | 152KB | `asc_isaiah`: "Asc. Isaiah" |
| `ep_barnabas.db` | 232KB | `ep_barnabas`: "Ep. Barnabas" |
| `t12p.db` | 392KB | `t12p`: "T12 Patriarchs" |
| `gad.db` | 132KB | `gad`: "Gad the Seer" |
| `t_job.db` | 188KB | `t_job`: "T. Job" |
| `1clement.db` | 176KB | `1clement`: "1 Clement" |
| `apoc_abraham.db` | 128KB | `apoc_abraham`: "Apoc. Abraham" |
| `didache_hoole.db` | 92KB | `didache_hoole`: "Didache" |
| `t_jacob.db` | 96KB | `t_jacob`: "T. Jacob" |
| `2baruch.db` | 280KB | `2baruch`: "2 Baruch" |
| `strongs_hebrew.db` | 8.2MB | lexicon, not a text — opened via `db/lexicon.ts` |
| `strongs_greek.db` | 29MB | lexicon, not a text — opened via `db/lexicon.ts` |
| `cross_references.db` | 21MB | opened directly in `crossrefs.ts` (own `Database`) |
| `tske_refs.db` | 45MB | opened directly in `crossrefs.ts` (own `Database`) |
| `youtube_seed.db` | 192MB | merged into `berean.db` once via `mergeYouTubeSeed` (§2.3), never opened directly by IPC |
| `berean.db` | 0 bytes | empty placeholder in `data/` — the REAL `berean.db` lives in `app.getPath('userData')`, not `data/`; this is presumably a build/packaging artifact slot |

**19 registered translations** in `bibleTexts.ts`'s `TRANSLATIONS`/`EDITIONS` arrays
(`src/lib/bibleTexts.ts:121-168`), each with an `ANNOTATION_KEYS` entry describing its
translator-supplied-word markup convention (italics/brackets/parens/etc. — used to render
`text_tagged` markup, not just cosmetic). `bible.ts`'s `TEXT_FILES` map
(`electron/db/bible.ts:10-30`) has **21 entries** — 19 matching the UI list plus bare
`kjv` and a duplicate-looking `lxx` (which actually maps to a *different* file, `lxx.db`,
than the UI's `lxx` id which is `lxx_brenton.db` — see caveat below).

### 3.1 Naming caveat — flag for the lead
`src/lib/bibleTexts.ts` registers UI id `'lxx'` → label "LXX" / "Brenton Septuagint", but
`electron/db/bible.ts`'s `TEXT_FILES['lxx']` maps to **`lxx_brenton.db`**, not `lxx.db`.
The standalone `lxx.db` file (24MB, its own distinct schema variant with a `sort_order`
column on `books`) exists in `data/` but has **no `TEXT_FILES` key pointing to it** and
does not appear in `TRANSLATIONS`. It is either dead/orphaned data or an
in-progress swap that hasn't been wired up — worth confirming with Michael before an iOS
data-bundle decision, since bundling both would roughly double the LXX footprint for no
reason if `lxx.db` really is unused.

### 3.2 Common schema (canonical, `kjva.db`)
```sql
CREATE TABLE books (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, short_name TEXT NOT NULL,
  testament TEXT NOT NULL, chapters_count INTEGER NOT NULL
);
CREATE TABLE verses (
  id INTEGER PRIMARY KEY AUTOINCREMENT, book_id TEXT NOT NULL REFERENCES books(id),
  chapter INTEGER NOT NULL, verse_num INTEGER NOT NULL,
  text TEXT NOT NULL, text_tagged TEXT,
  UNIQUE(book_id, chapter, verse_num)
);
CREATE INDEX idx_verses_ref ON verses(book_id, chapter);
CREATE VIRTUAL TABLE verses_fts USING fts5(
  text, book_id UNINDEXED, chapter UNINDEXED, verse_num UNINDEXED,
  content=verses, content_rowid=id
);
CREATE TRIGGER verses_ai AFTER INSERT ON verses BEGIN ... END; -- INSERT-only trigger (read-only bundled DB, never updated/deleted at runtime)
```
Strong's tags embed as `word{H7225}`/`word{G3056}` inside `text_tagged` (per CLAUDE.md §7),
parsed client-side at render time.

### 3.3 Deviations from the common schema
- **No `text_tagged` column** (no Strong's tagging) in: `t12p.db`, `hermas_taylor.db`,
  `hermas.db`, `t_job.db`, `1clement.db`. `verses` also lacks the `UNIQUE` constraint in
  `t_job.db`/`1clement.db`.
- **`recog_clement.db`** adds a `title TEXT` column on `verses` (chapter/section titles).
- **`lxx.db`** (the orphaned file, §3.1) adds `sort_order INTEGER NOT NULL DEFAULT 0` on
  `books`; its `verses_fts` uses `content='verses'`/`content_rowid='id'` with slightly
  different quoting than the canonical form but is functionally equivalent.
- **`lxx_brenton.db`** (the actually-used LXX file) matches the canonical schema exactly
  plus a bare `sort_order INTEGER` (no default) added via `ALTER TABLE` on `books`.
- **`gad.db`** is structurally simplest: no `text_tagged`, no `FOREIGN KEY` on `book_id`,
  no `idx_verses_ref` index, and its `verses_fts` indexes only `text` (no `book_id`/
  `chapter`/`verse_num` UNINDEXED columns).
- **`strongs_hebrew.db` / `strongs_greek.db`** (lexicon, not text) share an `entries`
  table (`strongs_id` PK, `word`, `transliteration`, `pronunciation`, `short_def`,
  `full_def`, `derivation`, `bdb_def`, `occurrence_count`) and an `occurrences` table
  (`strongs_id`, `book_num`, `chapter`, `verse`) — but **`strongs_greek.db`'s
  `occurrences` has an extra `text_id TEXT NOT NULL DEFAULT 'kjva'` column and a
  compound index `idx_occ_strong_text(strongs_id, text_id)`** that `strongs_hebrew.db`
  does not have (Hebrew occurrences aren't tracked per-translation; Greek ones are,
  probably because Greek NT Strong's numbers also occur in the LXX text).
- **`cross_references.db`**: `refs(from_book, from_ch, from_vs, to_book, to_ch, to_vs,
  to_vs_end, votes)` + `meta(key, value)` — a community-cross-reference-style schema with
  vote counts, indexed both directions (`idx_from`, `idx_to`).
- **`tske_refs.db`**: `tske_refs(id, from_book, from_ch, from_vs, heading,
  is_reciprocal, to_book, to_ch, to_vs, to_vs_end, sort_order, context)` — Treasury of
  Scripture Knowledge-enhanced refs, a different shape from `cross_references.db`
  entirely (has headings/context/reciprocal flag, no vote count).
- **`youtube_seed.db`**: matches `berean.db`'s `youtube_videos`/`youtube_sync`/
  `youtube_transcripts`/`youtube_transcript_segments` columns closely (it's the seed
  source merged INTO those tables) but has **no FTS5 table and no FK** on
  `youtube_transcript_segments.video_id` (unlike the live `berean.db` version) and its
  `youtube_transcripts.source` default is `'tactiq'` vs. the live schema's `'timedtext'`.

### 3.4 DB open/attach strategy (`electron/db/bible.ts`, read in full — 60 lines)
- Single in-memory `Map<string, Database>` cache (`dbCache`), lazily opened per `textId`
  on first `getTextDb(textId)` call, closed all-at-once via `closeAllTextDbs()` (called
  from `main.ts`'s `will-quit` handler).
- Every text DB opened `{ readonly: true }` — never written to at runtime.
- Path resolution (`dataPath`, lines 32-38): `app.isPackaged ? join(process.resourcesPath,
  'data', filename) : join(__dirname, '../../data', filename)`. `__dirname` at dev-time is
  `out/main/` (electron-vite's build output dir), so `../../data` lands at the project
  root's `data/`. **This exact resolution logic needs a full rewrite for iOS** — there is
  no `process.resourcesPath`/`app.isPackaged`; a Capacitor/native iOS build would bundle
  the `.db` files into the app's main bundle (`Bundle.main.path(forResource:...)`) or the
  Documents directory, and the shared-layer code should accept an injected base path
  instead of branching on Electron globals.
- `electron/db/lexicon.ts` (34 lines) uses the SAME pattern but branches on `is.dev`
  (from `@electron-toolkit/utils`) instead of `app.isPackaged`, and resolves dev paths via
  `process.cwd()` instead of `__dirname` — a second, slightly different path-resolution
  strategy for what is conceptually the same problem. Worth unifying before porting.
- `electron/db/embeddingsDb.ts` (55 lines): a **third** variant — the semantic-embedding
  index (`verse_embeddings.db`) is explicitly a local dev build artifact, NOT shipped in
  `extraResources` (comment at lines 8-21 confirms: "Not wired into electron-builder's
  packaged Resources/ in this pass"). `getEmbeddingsDb()` returns `null` gracefully in any
  packaged build today — semantic search is an additive AI Lookup signal, never a hard
  dependency (consumed by `electron/ipc/semanticCandidates.ts`). Irrelevant to iOS v1
  unless/until that feature ships.

### 3.5 Data pipeline scripts
- `scripts/publish-data.js` (92 lines, read in full): uploads all non-empty `data/*.db`
  files to a **draft** GitHub Release tagged `data-v1` (deliberately draft-only — a
  published release would be mistaken for an app release by `electron-updater`'s scan, see
  the file's own comment). Run manually (`npm run data:publish`) whenever the DBs change;
  not part of CI.
- `scripts/convert-dbs.js` (96 lines, not fully read but referenced by both
  `publish-data.js` and `release.yml`): converts every DB to `DELETE` journal mode before
  upload/packaging (removes `-wal`/`-shm` sidecars) — same reasoning as `afterPack.js`'s
  DB conversion step (§6), done twice (once at publish time, once at packaging time as a
  belt-and-suspenders).
- CI (`.github/workflows/release.yml`) downloads the `data-v1` draft release's `*.db`
  assets into `data/` before every build — **the actual DBs are never committed to git**
  (`data/` is gitignored except `.gitkeep`); this is why a fresh worktree has empty
  symlink targets until `setup-worktree.sh` runs (§6).
- `electron/__tests__/packagedAssets.test.ts` (read in full, 43 lines): a narrow guard
  that `package.json`'s `build.files` excludes `out/renderer/assets/ort-wasm-*.wasm` (the
  21.6MB onnxruntime-web binary Vite's bundler would otherwise statically pull in) — see
  §7 for why that file is dead weight in the packaged app.

---

## 4. Persistence Outside SQLite

### 4.1 `localStorage` keys (grep across all of `src/`; `sessionStorage` is **never used**
anywhere in `src/` or `electron/`)

| Key | File | Purpose | Persisted across restart? |
|---|---|---|---|
| `berean-app-state` | `src/store/index.ts` (zustand `persist`, see §4.2) | The entire app-state blob — tabs, sessions, settings, layout | Yes (debounced write via `debouncedLocalStorage`, see below) |
| `berean:folderViewExpanded2` (`EXPAND_KEY`) | `src/components/notes/NotesFolderView.tsx:112,115,168,362` | Which note-folder tree nodes are expanded | Yes |
| `berean:skipFolderDeleteConfirm` (`SKIP_CONFIRM_KEY`) | `src/components/notes/NotesFolderView.tsx:269,1204,1238` | "Don't ask again" for folder-delete confirmation | Yes |
| `berean:hint:clickNoteToOpen` (`OPEN_NOTE_HINT_KEY`) | `src/components/notes/NotesPanel.tsx:524,526,530` | One-time onboarding hint dismissal | Yes |
| `` `berean:pdfBookmarks:${pdfId}` `` (`bookmarkKey`) | `src/components/pdf/PDFViewer.tsx:93,96,105,111` | Per-PDF bookmark list | Yes |
| `berean-crash` | `src/components/shell/ErrorBoundary.tsx:9`, `src/components/shell/CrashReport.tsx:18,25`, `src/main.tsx:119` | Last renderer-crash payload, shown to the user on next launch then cleared | Yes (until read once) |
| `berean_search_diag` | `src/components/shell/FloatingSearch.tsx:184` | Manual opt-in diagnostic flag (`localStorage.berean_search_diag = '1'` typed in DevTools console) | Yes |
| `berean-study-trail-window` (`STORAGE_KEY`) | `src/components/studyTrail/trailWindowPrefs.ts:10,100,145` | Study Trail secondary-window UI prefs (per-window, not multi-window synced) | Yes |
| `berean-verse-picker-font-scale` (`FONT_SCALE_KEY`) | `src/components/studyTrail/VersePickerApp.tsx:12,15,310` | Verse-picker auxiliary window font size | Yes |
| `berean-viewer-font-scale` | `src/components/viewer/ViewerApp.tsx:166`; same key as `VIEWER_FONT_SCALE_SYNC_KEY` in `src/store/index.ts:24,2890,2984` | Presenter/viewer window font scale — written non-debounced so it beats the main blob's debounce loss on fast window close (see store comment at `index.ts:2978-2981`) | Yes |
| `berean:embedBlocked` | `src/components/youtube/YouTubeTab.tsx:407,415,418` | List of video ids whose embed failed and fell back | Yes |
| `berean:notesCache:v1` (`STORAGE_KEY`) | `src/lib/notesCache.ts:16,29,39,49` | Cached notes list for fast paint before the DB round-trip resolves | Yes |
| `` `berean-window-view-${...}` `` (per-window key, exact template not captured — see `src/lib/perWindowViewState.ts:55,93`) | `src/lib/perWindowViewState.ts` | Per-window `activeSpace`/`activeTabId`/`panelLayout`/`currentSessionId` — deliberately kept OUT of the shared `berean-app-state` blob so synced peer windows don't clobber each other's view (see `store/index.ts:3047-3054` comment) | Yes |
| `berean-ask-why-sync` (`ASK_WHY_SYNC_KEY`) | `src/store/index.ts:2909,3197` | Cross-window live-sync channel for the Study Trail "Ask why?" toggle (piggybacks on the native `storage` event, see `index.ts:3169-3183` comment) | Yes |
| `` `berean:debug:${prop}` `` (dynamic, per debug flag) | `src/main.tsx:29,33,34` | Persisted debug flags set via `window.__berean_debug.<flag> = true` in DevTools | Yes |

`src/lib/debouncedStorage.ts` (referenced by several of the above) wraps `localStorage`
with a debounced flush (batches `JSON.stringify` + `setItem` rather than doing it
synchronously on every `set()`) — this is the zustand `storage` adapter used by
`useAppStore`'s `persist` middleware (not `createJSONStorage`, deliberately, per the
comment at `store/index.ts:2945-2948`).

### 4.2 zustand `persist` config (`src/store/index.ts:1092` wraps the whole store; config
block at lines 2930-3166, read in full)

```ts
{
  name: 'berean-app-state',
  version: 8,
  migrate: (persistedState) => persistedState as Partial<AppState>,  // intentional no-op —
    // prevents zustand's default "wipe on version mismatch" behavior; see the long comment
    // at index.ts:2933-2943 explaining this was likely the cause of settings silently
    // resetting after past app updates
  storage: (IS_SECONDARY_WINDOW || IS_INDEPENDENT_WINDOW) ? readThroughLocalStorage : debouncedLocalStorage,
  onRehydrateStorage: () => (state) => { ... },  // see below
  partialize: (state) => ({ ...~70 explicitly-listed top-level keys... }),
}
```

**`partialize` allowlist** (persisted keys — everything else in `AppState` is
deliberately excluded, e.g. `activeSpace`/`activeTabId`/`panelLayout`/`currentSessionId`
are per-window and live in `perWindowViewState.ts` instead, §4.1): `tabs`,
`sidebarCollapsed`, `lastSettingsSection`, `settingsSectionScrollTop`, `sidebarWidth`,
`theme`, `bibleFontSize`, `appZoom`, `bibleLineHeight`, `defaultBibleTranslation`,
`hermasTranslation`, `autoPiP`, `aiLookupCommentaryOn`, `aiLookupAgenticOn`,
`aiLookupUseTabContext`, `aiLookupPanelPos`, `aiLookupPanelSize`, `pdfFeatureEnabled`,
`chapterPullNavEnabled`, `dailyNoteLocation`, `wordReplacerEnabled`, `wordReplacerRules`,
`studyTrailAskChapterJumpReason`, `noteVerseRefsEnabled`, `noteLexiconRefsEnabled`,
`noteScriptureBlock`, `sidePanelScriptureBlock`, `noteScriptureBlockThreshold`,
`noteVerseBlockSuggest`, `noteStrongsBlockSuggest`, `autoEmDash`, `themePreset`,
`backgroundAnimationEnabled`, `backgroundAnimationStyle`, `backgroundAnimationIntensity`,
`glassAppearance`, `scriptureFontFamily`, `notesFontFamily`, `noteTypingLook`,
`noteSidePanelPinned`, `uiFontFamily`, `autoCloseTabsAfter`, `defaultScriptureLayout`,
`noteTransformLayout`, `floatingSearchDensity`, `defaultYoutubeLayout`, `tabMRUList`,
`archivedGroups`, `sessions` (tabs re-snapshotted into the current session), `tasksVisible`,
`tasksMinimized`, `completedTaskIds`, `completedStepIds`, `historyExpandedDays`,
`historyExpandedSessions`, `historyAutoExpandedKey`, `printMarginPreset`,
`printCustomMargins`, `printPaperSize`, `printFontSizePt`, `printFontFamily`,
`printIncludeTitle`, `printColorMode`, `printTheme`, `pdfDownloadLocation`,
`idiomHighlightEnabled`, `idiomHoverPreviewEnabled`, `swipePanelGestureEnabled`,
`viewerFontScale`, `viewerTheme`, `viewerLaserEnabled`, `viewerSelectionMirror`,
`viewerSidePanelEnabled`, `tabNavStacks`, `tabNavMaxStack`, `historyMaxEntries`,
`recentSearchQueries`, `ttsVoiceURI`, `ttsRate`, `ttsHighlightWordsEnabled`,
`ttsAutoAdvanceEnabled`, `ttsAutoAdvancePauseSec`, `ttsAutoplayOnOpen`,
`queuePopoverOpen`, `queuePopoverPos`, `reasonPromptPopoverPos`. (History itself is
explicitly NOT here — persisted to SQLite's `history` table instead, loaded via
`window.appHistory.getAll()` on mount.)

`onRehydrateStorage` (lines 2950-3046) does non-trivial post-load work: kicks off Kokoro
TTS backend activation as a side effect (can't happen in pure state rehydration), reads
the dedicated `VIEWER_FONT_SCALE_SYNC_KEY` to override a possibly-stale value in the main
blob, wipes tab/session/view fields back to defaults for an independent window
(`IS_INDEPENDENT_WINDOW`), merges in any new default word-replacer rules by id, and
validates/rebuilds the tab MRU list against currently-open tabs.

### 4.3 `settings` table keys (SQLite, via `window.settings.get/set`)
Grep for literal string-key calls (`settings.get('...')`/`settings.set('...')`) found 11
distinct keys directly: `autoDownloadUpdate`, `autoUpdate`, `bgPassword`, `bgUsername`,
`defaultNoteStatus`, `defaultTranslation`, `fontSize`, `notesFolderView`, `updateChannel`,
`vaultPath`, `vaultSync` — this undercounts keys referenced via a variable/constant rather
than a literal string. The v1 migration (`berean.ts:161-177`) seeds these defaults
directly into the table (bypassing the IPC layer): `defaultText: 'kjva'`, `showStrongs:
false`, `showStrongsTooltips: true`, `strongsClickOpensTab: true`, `fontSize: 16`,
`lineHeight: 'comfortable'`, `vaultPath: ''`, `vaultSync: false`, `noteOpenBehavior:
'right-panel'`, `verseIndicatorPos: 'right'`, `crossTextHighlights: false`. Later
migrations add more seeded defaults directly: `onboardingCompleted` (v9),
`transcriptAutoFetch`/`transcriptStorageLimitMb` (v13). `main.ts` itself reads/writes
several more settings keys ad hoc (not through the IPC layer, since it already holds the
DB handle): `youtubeSeedVersion`, window-bounds keys (`mainWindowBounds`,
`viewerWindowBounds`, `trailWindowBounds`, `versePickerBounds`, `` `floatBounds:${type}` ``
— all desktop-window-specific and N/A on iOS).

---

## 5. Main-Process Lifecycle & Platform Services

(`electron/main.ts`, 2000 lines, read in full.)

**Startup order** (`app.whenReady().then(...)`, lines 1225-1982):
1. Log GPU info + active command-line switches (diagnostics).
2. Set dock icon (dev only, macOS).
3. `app.setAboutPanelOptions` (macOS-native About panel).
4. `Menu.setApplicationMenu(buildAppMenu())` — full native menu (File/Edit/View/Go/Window/
   Help), built by `buildAppMenu()` (lines 339-604), heavily annotated with which items the
   renderer's own keydown layer already intercepts (`registerAccelerator: false`) vs. which
   Electron fires natively.
5. `getBereanDb()` — opens `berean.db` and runs all pending migrations synchronously.
   `mergeYouTubeSeed` is deliberately **deferred** until after first paint (see #10) since
   it can attach a 196MB DB and bulk-insert.
6. `session.fromPartition('persist:youtube')` — persistent cookie/storage partition for the
   YouTube `<webview>`.
7. `session.defaultSession.setPermissionRequestHandler` — allowlists only `geolocation`
   (daily-note sunrise calc, `src/lib/dailyNoteUtils.ts`) and clipboard read/write
   (`clipboard-sanitized-write`, `clipboard-read`) for the **default session only** (not
   the YouTube partition).
8. CSP header handler via `session.defaultSession.webRequest.onHeadersReceived`, built by
   the shared `buildCSP(is.dev)` (`electron/csp.ts`, read in full — §7 has the policy
   itself). Note: this handler **never fires for a packaged `file://` build** — the real
   production CSP enforcement is `src/index.html`'s injected `<meta>` tag (via
   `electron.vite.config.ts`'s `inject-csp-meta` plugin, same `buildCSP()` call), which
   `csp.ts`'s own header comment says used to drift out of sync with this handler before
   the shared function existed.
9. `registerTTSModelProtocolHandler()` + all 20 `register*Handlers(ipcMain)` calls (§1),
   then ~51 inline `app:*`/`window:*`/etc. handlers.
10. `createWindow()` — first `BrowserWindow`. `mergeYouTubeSeed` runs on that window's
    `did-finish-load` (once), then auto-updater wiring, then periodic update-check
    interval (5 min) if enabled.
11. `nativeTheme.on('updated')`, `systemPreferences.on('accent-color-changed')`,
    `setupPowerAwareness()`, `screen.on('display-removed'|'display-metrics-changed')`,
    `app.on('browser-window-focus')` — various live OS-signal relays to all windows.
12. `app.on('activate')` — macOS dock-click re-create-window behavior.

**Custom protocol**: `berean-model://` (`ttsModelProtocol.ts`, read in full) — registered
as privileged (`standard: true, secure: true, supportFetchAPI: true, corsEnabled: true,
stream: true`) at **module load time** (before `app.whenReady()`, a hard Electron
requirement), with the actual `protocol.handle()` request handler wired up inside
`whenReady()`. Serves files out of `{userData}/tts-models/` for the Kokoro TTS Web Worker
to `fetch()` (Chromium blocks `fetch()` on `file://` from a worker context — this is the
documented Electron workaround). Path-traversal-guarded (`normalize(join(root,
relPath))` must stay under `root`).

**CSP** (`csp.ts`, read in full): `default-src 'self'`; `script-src` allows
`'wasm-unsafe-eval'` (narrow — NOT `'unsafe-eval'`) always, plus `'unsafe-inline'
unsafe-eval'` in dev only (Vite HMR); `connect-src` allows `berean-model:` (the custom
scheme, for the TTS worker) and `ws: http: https:` in dev only; `frame-src` allows
`https://www.youtube.com`; `worker-src 'self' blob:'`.

**Power awareness** (`powerAwareness.ts`, read in full): `ResourceMode = 'normal' |
'throttled'`, computed from `powerMonitor.isOnBatteryPower()` +
`thermal-state-change`→`getCurrentThermalState() === 'critical'|'serious'` (macOS-only
event). No screen-share detection exists (not observable from Electron); this is an
explicit proxy. Broadcasts `app:resourceModeChanged` to all windows; consumed by YouTube
tab polling intervals and the vault file-watcher's cadence.

**Session/webview config**: `webviewTag: true` on the main window (YouTube embeds), a
dedicated `persist:youtube` partition for cookie/session isolation from the app's own
default session, and `app.commandLine.appendSwitch('autoplay-policy',
'no-user-gesture-required')` (Kokoro Read Aloud plays sentence-chunk `<audio>` elements
well outside any click handler's call stack, so Chromium's default gesture-gating would
block it).

**MAS-specific workarounds** (lines 114-137): when `process.mas === true`, disables the
Network Service sandbox (`disable-features=NetworkServiceSandbox` — MAS sandbox blocks
Mach bootstrap IPC the Network Service utility process needs) and disables hardware
acceleration/GPU compositing entirely, running GPU in-process instead.

**`will-quit`** (lines 1994-2000): `runExportAll()` (best-effort final vault export,
never blocks shutdown), `closeBereanDb()`, `closeAllTextDbs()`, `closeLexiconDbs()`.

**Windows**: five distinct `BrowserWindow` roles — main (`appWindows: Set<BrowserWindow>`,
supports N synced peers + independent standalone windows), viewer/presenter (singleton,
always-on-top, owned by exactly one main window via `viewerOwnerId`), Study Trail
(singleton, always-on-top), verse-tie picker (singleton, always-on-top), and arbitrary
floating pop-out tabs (`createFloatingWindow`, one per popped-out tab type, `'screen-saver'`
always-on-top level — the highest level below system overlays). All of this — the entire
multi-window model — has no iOS equivalent and is the single largest desktop-only surface
in the codebase.

---

## 6. Build/Packaging/Update

- **`package.json` `build` block** (read in full, §6 reproduces the relevant parts above
  under item-by-item headers): `appId: com.berean.app`, `afterPack: build/afterPack.js`,
  `afterSign: build/notarize.js`, `files: ["out/**/*", "!out/renderer/assets/ort-wasm-*.wasm"]`,
  `asarUnpack: ["**/*.node"]` (native `.node` addons — i.e. `better-sqlite3` — must live
  outside the asar archive since Node can't `dlopen` from inside one), `extraResources`
  copies `data/*.db` and `assets/*.icns|*.ico|*.png` into `Contents/Resources/`.
  `mac.target`: `dmg` + `zip`, arm64 only, hardened runtime, `notarize: false` at the
  electron-builder level (notarization is instead driven manually via the `afterSign`
  hook so CI can control credentials/retries itself). Separate `mas` target block (arm64,
  `hardenedRuntime: false`, its own entitlements + provisioning profile) for a Mac App
  Store build. `win.target`: nsis, x64. `publish.releaseType: draft` (GitHub).
- **`build/afterPack.js`** (read in full): sets `LSMinimumSystemVersion` to 12.0 and
  `ITSAppUsesNonExemptEncryption` to `false` via `PlistBuddy`, then converts every bundled
  `data/*.db` to `DELETE` journal mode in the packaged `Resources/data/` dir (WAL mode
  needs a writable `-shm` sidecar, which a read-only MAS/Windows Resources dir can't
  provide).
- **`build/notarize.js`** (read in full): wraps `@electron/notarize`'s `notarize()`,
  skipped silently if `APPLE_ID` env var is unset (local/unsigned builds).
- **`.github/workflows/release.yml`** (read in full, 228 lines): triggered on `v*` tag
  push. Two parallel jobs (`build-mac` on `macos-latest`, `build-win` on
  `windows-latest`), each: `npm ci` → download `data-v1` release DBs → `convert-dbs.js` →
  `npm run rebuild` (rebuilds `better-sqlite3` against the Electron ABI, not the system
  Node ABI) → write `electron/youtube-key.ts` from a GitHub secret → `npm run build` →
  package. Mac job builds its own throwaway signing keychain explicitly (rather than
  trusting electron-builder's built-in temp-keychain flow, which broke on a runner-image
  update per the inline comment) and retries the sign+notarize step up to 3x for
  notarization flakiness. Two follow-up jobs (`mark-prerelease`, `publish-stable`) flip
  the draft GitHub release to prerelease or fully-published based on whether the tag name
  contains `-beta`/`-alpha`/`-rc`.
- **`scripts/tag-release.js`** (190 lines, not fully read — invoked as `npm run
  tag:stable`/`tag:beta`) drives the `v*` tag creation that triggers the workflow above.
- **`electron.vite.config.ts`** (read in full): three build targets (main/preload/
  renderer) via `electron-vite`'s `defineConfig`. Renderer gets its own `cacheDir`
  (`.vite`, NOT the default `node_modules/.vite`) specifically because `node_modules` is a
  cross-worktree symlink (§ setup-worktree below) and a shared Vite dep-cache caused
  worktrees to stomp on each other's dev-server chunk hashes. Injects the CSP `<meta>` tag
  at build time via the shared `buildCSP()`.
- **`vitest.config.ts`** (read in full): `jsdom` environment, `css: true` (needed for
  `?raw` CSS imports used by print/PDF export), its own `.vite-test` cache dir (same
  cross-worktree reasoning), excludes `**/.claude/**` (nested agent-scratch worktrees).
- **`tsconfig.json`** (renderer): ES2022/ESNext/bundler resolution, `strict: true`,
  `lib: ["ES2022","DOM","DOM.Iterable"]`, path alias `@/* → ./src/*`.
  **`tsconfig.node.json`** (main/electron): ES2022/CommonJS/node resolution, `strict:
  true`, `lib: ["ES2022"]` (no DOM — matches `electron/db/lexicon.ts`'s comment about
  needing to reach `localStorage` through `globalThis` in `preload.ts` since the DOM lib
  isn't available there), same path alias.
- **`scripts/setup-worktree.sh`** (67 lines, read in full): symlinks `node_modules`,
  `electron/youtube-key.ts`, and every `data/*.db` individually (explicitly NOT `ln -s
  .../data data`, which would nest into `data/data` since the dir already exists — see
  [[feedback_worktree_data_symlinks]]) from the **first** entry in `git worktree list`
  (the main tree) into the current worktree. Refuses to run inside the main tree itself.

### `npm run typecheck` — **PASS**
```
> tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json
EXIT:0
```
No errors, either project.

### `npx vitest run` — **PASS**
```
Test Files  141 passed (141)
     Tests  3894 passed (3894)
  Duration  14.47s (transform 3.04s, collect 20.39s, tests 14.15s, environment 75.22s)
```
All green. (Console noise: repeated `"The current testing environment is not configured
to support act(...)"` React warnings — pre-existing test-environment noise, not failures.)

---

## 7. Native Modules & Node-Only Deps

Classified from `package.json`'s `dependencies`/`devDependencies` (read in full, §6).

**Native (Node addon / requires a platform-specific build)**
- `better-sqlite3` (`^12.10.0`) — synchronous N-API SQLite addon, main-process only.
  `asarUnpack: ["**/*.node"]` in `package.json` and `npm run rebuild` (`electron-rebuild -f
  -w better-sqlite3`) exist specifically for this module. **The single largest porting
  item** — no iOS equivalent; needs a full swap to an async iOS-compatible SQLite driver
  (Capacitor SQLite plugin, op-sqlite, or similar), which cascades into every CORE-SHARED
  IPC handler in §1 since they're all written against better-sqlite3's synchronous
  `.prepare().get()/.all()/.run()` API and `db.transaction()`.

**Main-process-only (Node/Electron APIs, no native compile step but inherently
Electron-specific)**
- `electron` (`^32.3.3`) — the runtime itself.
- `electron-log` (`^5.1.2`) — file-based logging via Node `fs`; used pervasively in
  `main.ts` (`log.info`/`log.error`/`log.warn`) plus the pre-ready `earlyLog()` synchronous
  breadcrumb writer to a hardcoded `~/Library/Containers/com.berean.app/Data/` path.
- `electron-updater` (`^6.2.1`) — GitHub-Releases-based auto-update; entirely N/A on iOS
  (App Store owns updates there, same as the existing MAS-build code path already
  disables this).
- `@electron-toolkit/preload`, `@electron-toolkit/utils` (dev deps, but used at runtime —
  `is.dev` is imported throughout `main.ts` and the `ipc/*.ts` files) — preload/`is.dev`
  helpers, Electron-specific.
- `@electron/notarize`, `@electron/rebuild`, `electron-builder`, `electron-vite` — build
  tooling only, not shipped in the app bundle.

**Renderer-safe (pure JS/WASM, runs fine in a WebKit/browser context — WKWebView included)**
- `@lezer/highlight`, `diff`, `markdown-it`, `marked`, `suncalc`, `zustand` — pure JS, no
  Node/Electron API surface.
- `@radix-ui/react-popover`, `@radix-ui/react-dialog`, `@radix-ui/react-tooltip`,
  `@tanstack/react-virtual`, `framer-motion`, `lucide-react`, `react`, `react-dom`,
  `react-mosaic-component` — standard React UI libraries.
- `prosemirror-*` (10 packages: commands, dropcursor, gapcursor, history, inputrules,
  keymap, markdown, model, schema-list, state, tables, view) — the notes editor, pure
  DOM/JS.
- `pdfjs-dist` (`^4.10.38`) — runs its parser in a Web Worker; should be portable to
  WKWebView as-is (already worker-based in this codebase, per `src/lib/pdfjs.ts`
  referenced from `notePreviewRender.ts`/`PrintPreviewModal`).
- `kokoro-js` (`^1.2.1`) — runs ONNX inference via `onnxruntime-web` (WASM/WebGPU) **inside
  a renderer Web Worker** (`src/lib/tts/kokoro/kokoro.worker.ts`, confirmed by reading its
  header comments), NOT in the main process. The inference code itself is portable WASM;
  the blocker is how model files reach the worker — see below.

**The `berean-model://` / ORT WASM loading chain** (traced through
`src/lib/tts/kokoro/kokoro.worker.ts`, `ttsModelManifest.ts`, `ttsModelProtocol.ts`,
`electron/ipc/ttsModel.ts`):
1. `ttsModel.ts`'s IPC handlers download ~125MB of Kokoro ONNX weights + tokenizer +
   per-voice `.bin` files (from a stable HuggingFace `resolve/main` URL) **in the main
   process** (Node `fetch`/`createWriteStream`) into `{userData}/tts-models/`, plus a
   pinned 21.6MB `onnxruntime-web` WASM runtime file
   (`onnxruntime-web@1.22.0-dev.20250409-89f8206ba4/dist/ort-wasm-simd-threaded.jsep.wasm`,
   version-pinned to exactly match the copy `kokoro-js` bundles internally — a mismatch
   fails at the WASM ABI boundary) from jsDelivr's npm mirror.
2. The renderer/worker can't `fetch()` a `file://` path (Chromium security restriction),
   so `ttsModelProtocol.ts` registers a **custom privileged `berean-model://` scheme**
   (must be registered before `app.whenReady()`) whose handler streams bytes straight off
   disk from `{userData}/tts-models/`.
3. `kokoro.worker.ts` sets `env.backends.onnx.wasm.wasmPaths` / primes
   `wasmBinary` so `onnxruntime-web`'s `initializeWebAssembly` short-circuits straight to
   the already-fetched bytes instead of falling through to its own bundled-WASM
   `import.meta.url` resolution — which is exactly what Vite's bundler would otherwise
   statically pull the 21.6MB binary into `out/renderer/assets/` for (guarded against
   shipping by `packagedAssets.test.ts`, §3.5).
4. **iOS implication**: the ONNX WASM inference itself should run fine inside a WKWebView
   Web Worker (subject to verifying WKWebView's WASM/SharedArrayBuffer/threading support
   for the SIMD-threaded runtime variant specifically — untested in this audit). The
   download-to-userData-then-serve-via-custom-scheme mechanism needs a full iOS-side
   rewrite: either a `WKURLSchemeHandler` reimplementing `berean-model://`, or routing
   through Capacitor's own local-file serving convention if the iOS shell is
   Capacitor-based.

**Hard non-portable runtime dependency**: `electron/ollama.ts` (read in full) is a thin
`net.fetch` bridge to `http://localhost:11434` — a **separately-installed, separately-running
desktop Ollama application** (`ollama.com`). AI Lookup's `ailookup:query` handler
(`aiLookup.ts`) has no fallback path when Ollama isn't running beyond surfacing
`available: false` to the UI. This is not a Node-only API problem (`net.fetch` itself is
portable) — it's a product dependency on desktop-only third-party software with no iOS
counterpart. Flagged in Findings below as a decision the lead needs to make explicitly
(cloud API fallback? feature-gate AI Lookup off on iOS entirely for v1?).

---

## Findings the lead must decide

1. **AI Lookup (`ailookup:query`/`checkAvailable`/`unloadModel`) hard-depends on a
   locally-running desktop Ollama app at `localhost:11434`.** This is the single biggest
   feature gap for iOS — there is no drop-in mobile equivalent. Needs an explicit decision:
   feature-gate AI Lookup off on iOS v1, or build a cloud-API-backed variant (with its own
   cost/privacy tradeoffs the desktop app currently avoids entirely by being local-only).

2. **`lxx.db` (24MB) appears orphaned.** `bibleTexts.ts`'s UI-facing `'lxx'` id maps to
   `lxx_brenton.db` via `electron/db/bible.ts`'s `TEXT_FILES` table; the standalone
   `lxx.db` file has no `TEXT_FILES` entry and isn't referenced in `TRANSLATIONS`/
   `EDITIONS`. Confirm before deciding whether to bundle it for iOS — it may be dead data
   inflating the download size for nothing, or a half-finished swap-in.

3. **The plain `kjv.db` (8.4MB, KJV without Apocrypha) is in `TEXT_FILES` but not
   surfaced anywhere in the UI's `TRANSLATIONS`/`EDITIONS` list.** Same question as #2 —
   bundle it or drop it for iOS.

4. **`better-sqlite3`'s synchronous API is load-bearing everywhere** — every CORE-SHARED
   handler in §1.1 (roughly 150 of the 243 channels) is written as synchronous
   `.prepare().get()/.all()/.run()` calls, several wrapped in `db.transaction(() =>
   {...})()`. Porting to any async iOS SQLite driver isn't a drop-in swap; it changes the
   call signature of essentially the entire data-access layer, which argues for
   introducing a thin repository/adapter interface in the shared layer now rather than
   inlining `better-sqlite3` calls directly into whatever new shared module gets
   extracted.

5. **The Obsidian/Octarine vault-sync subsystem (`vault.ts`, 9 channels, `chokidar` +
   heavy `fs`) targets a specific macOS iCloud-synced folder path** (per CLAUDE.md §18,
   also Michael's own global vault path in his CLAUDE.md). This is architecturally the
   hardest DESKTOP-ONLY subsystem to adapt — iOS has no arbitrary-folder `fs.watch`
   equivalent; it would need `NSFileCoordinator`/`NSMetadataQuery` against an iCloud
   container. Recommend treating vault sync as explicitly out-of-scope for iOS v1 rather
   than a "needs adapter" item, unless the lead wants to scope that rewrite separately.

6. **`notes:*` and `studyTrail:*` mutating handlers bake a `BrowserWindow.getAllWindows()`
   broadcast into the same function as the DB write** (not a separate cross-window-sync
   layer) — see §1.2. Extracting the shared SQL logic cleanly means either stubbing that
   broadcast call to a no-op in the shared layer, or refactoring it out into a caller-side
   hook before extraction, so it doesn't need to be reimplemented as dead code per platform.

7. **Two/three different dev-vs-packaged path-resolution strategies for bundled DBs**
   (`bible.ts` branches on `app.isPackaged` + `__dirname`; `lexicon.ts` branches on
   `is.dev` + `process.cwd()`; `embeddingsDb.ts` is a third variant that's simply never
   shipped) — worth unifying behind one path-injection strategy before/while extracting a
   shared data layer, rather than porting three slightly-different Electron-specific
   branches to iOS separately.

8. **Kokoro TTS's WASM inference plausibly runs in a WKWebView Web Worker as-is** (it's
   pure onnxruntime-web WASM, already worker-isolated in this codebase) — this audit did
   not verify WKWebView's support for the specific SIMD-threaded WASM variant Berean uses
   (`ort-wasm-simd-threaded.jsep.wasm`), which needs `SharedArrayBuffer` /
   cross-origin-isolation headers that are easy to get wrong in a WKWebView context. Worth
   a small spike before committing to "Read Aloud works on iOS with just a protocol-handler
   swap."

9. **YouTube integration is mostly portable** (`net.fetch` → standard `fetch`, DB-backed) — but
   two of its handlers (`fetchTranscripts`/`clearTranscripts`) are intentionally
   `is.dev`-gated per existing project memory ([[feedback_transcript_dev_guard]]:
   "production users read-only, Michael populates the DB in dev"). Any iOS adapter must
   preserve that gate, not accidentally expose bulk transcript-fetching to production
   users on a new platform.

---

## Commands run

```bash
cd /Users/roywe/Berean-ios && grep -rn "ipcMain\.\(handle\|on\)(" electron/ | wc -l
# → 225

cd /Users/roywe/Berean-ios && grep -c "ipc\.handle(" electron/ipc/youtube.ts
# → 18   (total IPC channels = 225 + 18 = 243)

cd /Users/roywe/Berean-ios && grep -rn "ipcMain\.\(handle\|on\)(" electron/ | sed -E 's/:[0-9]+:.*//' | sort | uniq -c | sort -rn
# per-file breakdown, reproduced in §1

cd /Users/roywe/Berean-ios && npm run typecheck 2>&1 | tail -30
# tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json
# EXIT:0  (clean, both projects)

cd /Users/roywe/Berean-ios && npx vitest run 2>&1 | tail -15
# Test Files  141 passed (141)
#      Tests  3894 passed (3894)
#   Duration  14.47s
# (run with a 600000ms timeout; completed well under it)

cd /Users/roywe/Berean/data && sqlite3 <file>.db .schema
# run against kjva.db, lxx.db, lxx_brenton.db, strongs_hebrew.db, strongs_greek.db,
# cross_references.db, tske_refs.db, youtube_seed.db, gad.db, berean.db, and all 15
# remaining pseudepigrapha/ANF text DBs (t12p, hermas_taylor, hermas, enoch, jubilees,
# apoc_elijah, recog_clement, asc_isaiah, ep_barnabas, t_job, 1clement, apoc_abraham,
# didache_hoole, t_jacob, 2baruch) — full schema dump for each, deviations noted in §3.3.
# Note: data/*.db in the WORKTREE are symlinks to /Users/roywe/Berean/data/ (the main
# tree) — `du`/`ls -la` run directly against the worktree symlinks initially showed 0B
# (du following a relative symlink target oddity); re-ran directly against
# /Users/roywe/Berean/data/ for accurate sizes, reproduced in §3.

cd /Users/roywe/Berean-ios && ls -la data/ ; ls build/ .github/workflows/
# confirmed 26 symlinks + .gitkeep + 1 stray .bak file in data/; build/ has afterPack.js,
# notarize.js, 3 entitlements plists; .github/workflows/ has only release.yml
```

Files read in full during this audit (not excerpted): `electron/main.ts` (2000 lines),
`electron/preload.ts` (610 lines), `electron/db/berean.ts` (1145 lines),
`electron/db/bible.ts`, `electron/db/lexicon.ts`, `electron/db/embeddingsDb.ts`,
`electron/csp.ts`, `electron/ollama.ts`, `electron/powerAwareness.ts`,
`electron/ttsModelProtocol.ts`, `electron/ttsModelManifest.ts`,
`src/lib/bibleTexts.ts`, `electron/__tests__/packagedAssets.test.ts`,
`scripts/publish-data.js`, `scripts/setup-worktree.sh`, `build/afterPack.js`,
`build/notarize.js`, `.github/workflows/release.yml`, `electron.vite.config.ts`,
`vitest.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `package.json`. Import headers
(not full bodies) were read for every file under `electron/ipc/*.ts` to establish
per-file DB/dependency profiles; handler bodies were sampled via grep line context rather
than read end-to-end for the largest files (`aiLookup.ts` 3638 lines, `studyTrail.ts`
1273 lines, `youtube.ts` 1588 lines, `vault.ts` 1204 lines, `notes.ts` 771 lines) given
the scope of this audit — flagging for the lead in case a deeper pass on any one of those
five is wanted before the iOS extraction work begins.
