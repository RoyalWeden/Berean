# Berean iPhone — Implementation Progress

Living status document. Updated at every phase gate and whenever a decision, blocker or known
issue appears. Requirement statuses live in `requirements.md`; this file is the narrative.

Branch: `feature/ios-app` · Worktree: `/Users/roywe/Berean-ios` · Base: `main` @ `7aa70d4` (0.6.19)

---

## Testing wave 2026-09-22 (post-migration backlog)

Source: the developer's 2026-09-22 device/desktop testing notes → `testing-backlog-2026-09-22.md`
(TEST-001–TEST-044, every note line tracked). Architecture added by this wave:
`post-migration-architecture.md`. Waves: 1 shared logic · 2 macOS · 3 iPhone reader/selection ·
4 iPhone navigation · 5 compact reader · 6 remaining iPhone · 7 regression + audit.

| Wave | Scope | Status |
|---|---|---|
| 1 | Shared: drag range selection, history model, scroll-state audit (Ctrl+Tab, side panel), LXX→KJV and chapter fallbacks, line-height hook | **CHECKPOINT** 2026-09-22 — typecheck clean; vitest 184 files / 4,201 tests (was 180 / 4,146); `npm run build` OK; `ios:build` (simulator) OK; Ctrl+Tab and side-panel scroll reproduced + verified in the running desktop app over CDP |
| 2 | macOS: presenter/outline follow jumps (+ cached-chapter landing fix), notes sort menu alignment, layout-picker layering, taller title bar, calendar month/year/12-year picker, session + … menus highlight selection, floating-search context menu (+ floating windows opened at Genesis 1 — fixed), selection-menu material + 2-row swatches, Select verses, notes filter follows selection, search scope radius | **CHECKPOINT** 2026-09-22 — typecheck clean; vitest 187 files / 4,213 tests; `npm run build` OK; `ios:build` OK; every item checked in the running desktop app over CDP (screenshots + DOM probes) |
| 3 | iPhone reader + selection: tap/long-press verse model, verse sheet with low detent + study view, sheet detent model (no ✕ except low), compact layout + inline Strong's, edge taps, auto-hiding top bar, passage navigator, continuous scroll + line height fixed, Strong's Copy, scroll memory | **CHECKPOINT** 2026-09-23 — typecheck clean; vitest 188 files / 4,222 tests; `npm run build` OK; `ios:build` OK; verified on the simulator with the probe build (tap, text selection, highlight, study view, continuous, line heights, edge taps, navigator, top bar) |
| 4 | iPhone navigation: bottom tab cards · plus · caret; per-page caret command registry; tab cards show the whole workspace; plus search/create surface; old bar/pill/grid and reader header controls removed with every action re-homed (mobile-navigation.md) | **CHECKPOINT** 2026-09-23 — typecheck clean; vitest 188 files / 4,225 tests; `npm run build` OK; `ios:build` OK; simulator: nav buttons, reader/notes/lexicon carets, tab cards (8 types), plus → new tab, More routes + Done |
| 5 | Compact study presentation: study pane (verse + Strong's + dense cross refs) browsable verse by verse with the verse kept above the pane, duplicate verse text removed, Dynamic Type for the reading column | **CHECKPOINT** 2026-09-23 — typecheck clean; vitest 189 files / 4,229 tests; `npm run build` OK; `ios:build` (normal build — no probe code in the bundle) OK; simulator checks |
| 6 | Remaining iPhone refinements: onboarding copy for the new navigation, stale references to the removed bar/pill cleaned, Compare verified on the shared verse model, caret verified in every context (reader, compare, notes list, note editor, search, lexicon, More), reduced motion confirmed | **CHECKPOINT** 2026-09-23 — typecheck clean; mobile tests green; simulator checks |

## Status summary (2026-09-21, end of the autonomous run)

- **Ledger (`requirements.md`, 115 rows):** 22 DONE · 31 IMPLEMENTED · 32 TESTING (works on the
  simulator; device confirmation pending) · 26 IMPLEMENTING (partial, remainder named in the row)
  · 2 COMPLETE · 1 DEFERRED by decision (R046 AI Lookup, D-009) · 1 NOT STARTED on device (R065
  two-device iCloud matrix — needs the developer's iPhone).
- **Phases:** 0–20 done or implemented on the simulator; 21 prepared (runbook `ios-build.md` §4b)
  and 22 done on the repository side. Nothing was pushed, uploaded, or signed with personal
  credentials (R139); every checkpoint is a local commit on `feature/ios-app`.
- **What only the developer can do next:** create `ios/App/Signing.xcconfig` (team id, bundle id,
  iCloud container, App Group) and the App ID capabilities; run the device pass (§4b) and the
  two-device iCloud matrix; run the 24-step desktop regression on the Mac (`testing.md` §2b);
  decide on universal links (D-008) and the AI Lookup port (D-009); publish transcript packs
  (`scripts/data/publish-transcripts.sh`); archive + TestFlight from Xcode (§5).
- **Known limitations on the phone** are listed under "Known limitations (iPhone)" below and in
  `feature-matrix.md` §10; each names the desktop behaviour, the restriction and the reason.
- **Build/test state at the last checkpoint:** typecheck clean; vitest 180 files / 4,146 tests;
  `npm run build` OK; `npm run ios:build` OK (app + Share Extension).

## Phase plan (adjusted after the audit)

The brief's 22 phases are kept, with two adjustments the audit forced:

- **Phase 1 and Phase 3 are merged in practice** — the service extraction (Phase 1) *is* the
  database abstraction (Phase 3); there is no useful intermediate state. They are tracked as one
  gate ("Phase 1/3").
- **Phase 5 (shared data model) precedes Phase 2 (Capacitor foundation) work on tabs**, because
  tabs/sessions must leave localStorage before anything mobile touches them. Capacitor project
  scaffolding (Phase 2) itself is independent and is done right after Phase 1/3.

| Phase | Name | Gate | Status |
|---|---|---|---|
| 0 | Repository audit & migration specification | audit reports + all docs in this folder + ledger | **COMPLETE** (2026-09-20) |
| 1/3 | Platform architecture, shared services, `DatabaseAdapter`, migrations moved | typecheck + all existing tests green + contract tests + desktop build | **GATE MET** 2026-09-21 (16 services, 14 contract-test files; one cleanup item open: aiLookup async conversion to drop the `@deprecated` sync helpers) |
| 2 | iOS/Capacitor foundation (project, plugins skeleton, build scripts, signing docs) | simulator build succeeds; app boots to renderer | **GATE MET** 2026-09-21 (BUILD SUCCEEDED; boots to the self-test screen) |
| 4 | Bundled DB installation + offline operation on iOS | in-app parity self-test passes on simulator + device | TESTING — simulator 12/12 ✔; physical iPhone pending (needs Signing.xcconfig + a paired device) |
| 5 | Shared data model: sessions/tabs/archived groups to SQLite; legacy import; partialize fixes; workspace restore | store tests green; import test; desktop behaviour unchanged | **GATE MET** 2026-09-21 (mirror + legacy import + hydration, 12 settings persisted, workspace load restores tabs/order/state/layout with v0/v1/v2 compatibility; 165 files / 4071 tests) |
| 6 | iCloud persistence & sync architecture (HLC, journal, merge, engine, stores) | unit + two-device integration tests | **GATE MET (engine)** 2026-09-21 — transport-abstracted engine + entity adapters + in-memory transport; cases A–O green; real transports (fs / BereanCloud) are Phase 7 |
| 7 | iCloud sync: notes / highlights / verse tags (+ folders, versions, edges) — real transports + hosts + settings UI | scenario tests S1–S6 + first device run | **GATE MET (code + simulator)** 2026-09-21 — desktop `FsSyncStore` + sync host + Settings → iCloud; iOS `BereanCloud` plugin + `CloudSyncStore` + in-WebView host + `window.sync`; iCloud entitlement/container wiring; two-device tests over both transports green; simulator self-test 13/13. First real Mac↔iPhone run is Phase 21 (needs signing + iCloud account) |
| 8 | iCloud sync: tabs | S7–S9 | **GATE MET** 2026-09-21 — `tab` entity (sync fields only, `local_state_json` excluded, tombstones), K/L union + order tests, fs/cloud transport tests, `applyExternalSessions` on remote apply |
| 9 | iCloud sync: sessions & workspaces (+ playlists, trail, chats, pdf metadata, youtube_user) | S10–S15 | **GATE MET (engine)** 2026-09-21 — sessions/archived groups/workspaces/playlists (Phase 6) + `ai_chat`, `pdf`/`pdf_highlight`/`pdf_bookmark` (v46), `youtube_user` (v45), `trail_session` aggregate + `trail_node`/`trail_connection`/`trail_note`/`trail_tag`; dependents + vanished-record capture; event-time causal capture; cases P–U green. compaction snapshots/prune/bootstrap (cases V–X) done |
| 10 | Mobile navigation shell (primitives, stack, sheets, space bar, tab pill) | primitive tests; boots on device | **GATE MET (simulator)** 2026-09-21 — `src/mobile/*`: SheetHost/Sheet (detents, drag, close control), ActionList, Page/Row/ListSection, NavigationStack (push/pop, edge-swipe back), SpaceBar, TabPill (tap/swipe/+), TabGrid, SessionSwitcher, ReaderPage (chapter pager, pinch font size, Go-to sheet, translation sheet, Strong's sheet), SettingsPage (appearance/reading/iCloud/about), More page (Lexicon, YouTube, tags, history, PDFs, diagnostics); desktop panels hosted for Notes/Search/Lexicon/YouTube/PDF/tags until their phone pages land; 8 primitive tests; physical device: Phase 21 |
| 11 | Mobile Bible reading (pager, pinch, reference picker, reader options) | device perf baseline recorded | **IMPLEMENTED (simulator)** 2026-09-21 — pager, pinch, Go-to, translation sheet, reader options sheet (size/line height/theme/verse numbers/font/continuous scroll), prev/next actions; device perf baseline: Phase 21 |
| 12 | Scripture interactions: long-press menu, selection, highlights, tags, Strong's sheet, cross refs, notes-for-verse | device manual acceptance | **IMPLEMENTED (simulator)** 2026-09-21 — `VerseInteractionContext` (touch mode inside VerseRow), long-press → `VerseActionSheet` (context-adaptive: selection vs verse), `SelectionBar`, `VerseNotesSheet`, `CrossRefsSheet` (TSKe/classic), `TagPickerSheet`, Strong's sheet; verified by synthesized long-press/taps on the simulator |
| 13 | Mobile ProseMirror notes (editor, home, folders, versions, refs, daily) | PM touch tests + device | **IMPLEMENTED (simulator)** 2026-09-21 — native `NotesHomePage` (search, filters, folders, pinned, daily, trash), `NoteEditorPage` (shared PM editor, autosave/snapshots, title, edit/view, actions: pin, status, folder, versions+restore, copy, share, trash), `TrashPage`; wikilinks/verse refs/Strong's refs wired; verified on the simulator (create, type, title, daily note). Remaining: icons/colours/tags, folder CRUD, board/calendar pages (hosted meanwhile), image insert from Photos, keyboard toolbar on device |
| 14 | Search (page, filters, parity) | parity tests + perf | **IMPLEMENTED (simulator)** 2026-09-21 — `src/lib/scriptureSearch.ts` (the desktop algorithm as a shared function, 5 tests) + `SearchPage` (scripture/notes/lexicon scopes, filter sheet, grouped results with highlighted snippets, recent queries, reference jump, Strong's queries, `pendingSearchQuery`); verified on the simulator ("remember the sabbath" → 10 verses in 7 books across texts → tap lands on Exo 20:8). Pending: tag filter, virtualised long lists, perf baseline on device |
| 15 | Tabs & workspace UX (grid, switcher, archive, workspaces page) | tests + device | **IMPLEMENTED (simulator)** 2026-09-21 — tab actions: rename, duplicate, move up/down (`reorderTabs`), move to workspace (`moveTabToSession`), archive, close others, close; session actions: rename, icon (`SESSION_ICONS`), archive all, delete; `WorkspacesPage` (save current as v2 snapshot, open as session, rename, delete); `ArchivePage` (restore/discard); chrome made non-selectable so long-presses never raise text handles. Pending: drag-to-reorder in the grid, session reorder, tab filter |
| 16 | Audio (Read Aloud spike → implementation, audio session, lock-screen) | device | **IMPLEMENTED (simulator; device pending)** 2026-09-21 — finding: desktop has no Web Speech path any more (Kokoro-only, inert before the pack downloads), so the phone gets `NativeSpeechBackend` (`AVSpeechSynthesizer`) behind the shared `TTSBackend` seam; `BereanAudio` plugin (session, Now Playing, remote commands); `AudioBar` + player sheet; `useTTSPlayback` mounted in the shell. Simulator: Exodus 20 read aloud with verse + word highlight. Pending on device: background continuation, lock-screen card/commands, queue + playlists pages |
| 17 | YouTube / PiP (`BereanWebView`) | device; restrictions documented | **IMPLEMENTED (simulator; device pending)** 2026-09-21 — `BereanWebViewPlugin` native player (embed accepted via https base URL; error 153 from capacitor:// origin was the blocker, and Capacitor iOS cannot serve https), `TouchYouTubePlayer` in `YouTubeTab` (positions saved + synced), `youtubeFetchService` (shared port of channel fetching, 4 tests, CapacitorHttp), `BereanDownloadsPlugin` + transcript packs page (download → verify → merge, verified end-to-end on the simulator). Pending: device verification of background audio/PiP, timestamp-insert into the phone note editor, YouTube settings page |
| 18 | Native integrations (Share Sheet in/out, deep links, Share Extension, Spotlight, App Intents, haptics, print) | device | **IMPLEMENTED (simulator; device pending)** 2026-09-21 — Share Extension target (text / URL / PDF → App Group inbox → `berean://share` → router; Safari share verified on the simulator), verse + note Share, print / PDF export plugin, Spotlight (notes), App Intents (5, iOS 17-compatible), extended deep-link router (`daily`, `workspace`, `share`, `play`), YouTube space parked while a video plays (timestamp insert into the phone editor; the missing desktop `berean:insertTimestamp` listener fixed), YouTube settings page. Pending on device: Spotlight/Siri UI; universal links documented only (D-008) |
| 19 | Performance & accessibility | targets met; VoiceOver pass | **IMPLEMENTED (simulator)** 2026-09-21 — `BereanA11yPlugin` (Dynamic Type scale → every phone font size, VoiceOver / Bold Text / Increase Contrast attributes), labels audit, reduced motion; `perf.ts` boot marks + search timing, simulator baseline table in `testing.md` §6; device numbers + VoiceOver run-through: Phase 21 |
| 20 | Desktop regression audit | full desktop checklist | **IMPLEMENTED (automated)** 2026-09-21 — typecheck / 180 files / 4,146 tests / `npm run build`; shared FTS pass consolidated; import-boundary guard; 24-step manual checklist with per-area change notes in `testing.md` §2b for the developer's Mac pass |
| 21 | Physical-device testing incl. iCloud matrix | `testing.md` §5 filled | **PREPARED** — runbook `ios-build.md` §4b (11 checks incl. the two-device iCloud matrix, background audio, Share/Spotlight/Siri, VoiceOver, Kokoro spike); needs the developer's iPhone + `Signing.xcconfig` + iCloud account — cannot be run by the assistant |
| 22 | TestFlight / App Store preparation | checklist in `ios-build.md` §7 | **IMPLEMENTED (repo side)** 2026-09-21 — PrivacyInfo.xcprivacy, permission strings, export-compliance flag, full-bleed icon + launch screen, version/build from package.json, archive script; remaining rows are the developer's ASC actions (App ID capabilities, record, nutrition labels, upload) — never done by the assistant (R139) |

## Phase 0 — Repository audit & migration specification — COMPLETE

**Done**
- Worktree `Berean-ios` on `feature/ios-app`, `npm run setup:worktree` run (DB symlinks, node_modules, youtube-key).
- Three audit reports: `audit/data-and-platform.md` (243 IPC channels catalogued and classified; 30 user-data tables; 26 bundled DB schemas; every localStorage key; persist config; build/packaging), `audit/feature-inventory.md` (complete UI feature trace), `audit/notes-store-media-tests.md` (store field-by-field classification, ProseMirror, audio, YouTube, tests).
- Desktop baseline recorded: typecheck clean; vitest 141 files / 3894 tests passing.
- Environment verified: Xcode 26.6, iOS SDK 26.5, Swift 6.3, Node 24; no simulator runtime installed; no paired iPhone yet; Apple Distribution + Developer ID identities present, no Apple Development identity yet.
- Documents written: README, requirements (ledger R001–R143), architecture, feature-matrix, icloud, database, decisions (D-001–D-006), testing, ios-build, this file.
- Verified by hand (not just reported): FTS5 in Apple's SQLite (`pragma compile_options` → `ENABLE_FTS5`); `lxx.db` has no runtime reference; `kjv.db` is reachable via textId `kjv`; bookmarks do not exist as a scripture feature; tabs/sessions live in localStorage not SQLite; `window.*` is the only platform boundary in the renderer.

**Gate check:** audit complete ✔ · docs ✔ · ledger ✔ · decisions logged ✔ · desktop untouched ✔ (no source change in Phase 0).

## Phase 1/3 — Shared services & DatabaseAdapter — IMPLEMENTING

**Done (2026-09-21)**
- `src/platform/db/DatabaseAdapter.ts` (interface), `electron/db/adapters/syncSqliteAdapter.ts` (better-sqlite3 in Electron / `node:sqlite` in vitest — the repo's better-sqlite3 binary is Electron-ABI and cannot load under plain Node), `electron/db/adapters/nodeSqliteAdapter.ts` (test driver).
- `src/platform/db/bereanMigrations.ts`: all 42 migrations moved verbatim, async runner; `electron/db/berean.ts` now `initBereanDb()` (awaited in `main.ts`) → identical schema to the developer's real 496 MB dev database verified object-by-object (80 objects, identical SQL). Snapshot: `docs/mobile/audit/schema-v42.sql` (`scripts/dump-user-schema.ts`).
- Services extracted (SQL verbatim) with thin IPC delegates: bible, lexicon, crossrefs, highlights, settings, history, workspaces, playlists, verseTags, tagGraph, notes (vault trash mirror stays in `electron/ipc/notes.ts`), studyTrail, pdf (rows; file IO stays in Electron). `electron/services.ts` (registry, no electron import so IPC modules stay testable) + `electron/servicesHost.ts` (desktop context, cross-window `data:changed` → `notes:changed`/`studyTrail:dataChanged` broadcast with `AsyncLocalStorage` sender tracking).
- Sync helpers used by desktop-only `aiLookup.ts` are kept in the electron files as `@deprecated` (bible: `queryVerse`/`searchVerses`; lexicon: 4; crossrefs: 5; youtube: 2) until the aiLookup async conversion lane.
- Tests: adapter (6), migrations (7), bible/highlights/settings/history contract tests; `electron/__tests__/ipcParity.test.ts` (every preload channel has a main handler). Full suite green at each step (last: 144 files / 3916 tests; desktop `npm run build` OK).

- youtube DB subset (`youtubeService`, `is.dev` guards preserved in `electron/ipc/youtube.ts`) and `aiChatsService` landed; contract tests for every service (14 files). Totals: **161 test files / 4058 tests**, typecheck clean, `npm run build` OK.

**Open**: aiLookup async conversion so the `@deprecated` sync helpers in bible/lexicon/crossrefs/youtube can be deleted (desktop-only cleanup; no behaviour impact).

**Gate check:** implementation ✔ · tests ✔ · desktop valid ✔ · docs ✔ · ledger ✔.

## Phase 6 — Sync engine — GATE MET (2026-09-21)

**Done**
- `src/platform/sync/types.ts` (`SyncOp`, `DeviceManifest`, `SyncStore` transport interface), `journal.ts` (JSONL encode/decode tolerant of truncation/garbage, file naming, size-based rotation), `entities.ts` (schema-discovered table adapters + special adapters: tombstone tables, `tabs.local_state_json` excluded, verse-tag unique-name resolution, member → `verse_tag_verse` rebuild, playlists as aggregates), `engine.ts` (capture with HLC + `base` + field hash, coalescing outbox, push/pull, LWW + tombstones + note conflict copies, per-device seq contiguity with gap stop, `sync_failed` bounded retries, schema-newer guard, adoption of pre-sync data, status snapshot), `stores/memorySyncStore.ts` (offline queueing, eviction, corruption, write faults).
- Migration v44 (bookkeeping tables only; no synced table changed).
- Tests: `engine.integration.test.ts` — two real devices (real services, real schema): A/B propagation + idempotence, C/D offline both ways, E concurrent note edits → deterministic winner + identical conflict copy on both, F concurrent tag creation (unique-name rule), G/H purge/trash vs later edit, J evicted file gap, K/L tab reorder + session rename/close union, M restart mid-push, N truncated journal, O corrupt line + spoofed device, adoption, newer-schema guard + transport unavailable queueing; `journal.test.ts`; earlier `hlc`/`fractional`/`tabFields`.
- Docs: `icloud.md` §4 rewritten to the implemented rules; `database.md` v44 corrected.

**Gate check:** implementation ✔ · tests ✔ (167 files / 4086) · desktop typecheck + build ✔ · docs ✔.
**Not yet:** iCloud Drive transports and the host wiring (Electron main process, iOS), sync settings UI, compaction — Phase 7.

## Phase 7 — Transports, hosts, settings UI — GATE MET (2026-09-21)

**Done (desktop)**
- `electron/sync/fsSyncStore.ts` — `SyncStore` over a plain folder (the iCloud Drive container's `Documents/sync/v1` by default, or any folder the user picks). Atomic `tmp + rename` writes, `.icloud` placeholders reported as "not yet downloaded" (returns `null`, kicks `brctl download`), recursive `fs.watch` → `onChange`, `ubiquityContainerPath(containerId)` resolves `~/Library/Mobile Documents/<id with . → ~>`.
- `electron/sync/host.ts` — `initSyncHost()`: reads `icloudSyncEnabled` / `icloudSyncFolder` / `icloudContainerId` from settings, stable per-install `deviceId` (random 16 hex, stored in `sync_state`), opens the engine, syncs on start / on folder change (debounced) / every 60 s / on `sync:syncNow`, broadcasts `sync:status` and `sync:applied` to all windows, stops cleanly on quit. IPC: `sync:getStatus`, `getConfig`, `syncNow`, `enable`, `disable`, `chooseFolder`, `useDefaultFolder`.
- Preload `window.sync` (optional in `electron.d.ts` so the renderer works on builds without it) and `src/App.tsx` refresh hook: remote applies bump the highlight token, refresh verse tags, re-hydrate sessions/tabs (`applyExternalSessions`) and reload saved workspaces.
- `src/components/settings/sections/ICloudSection.tsx` — enable/disable, folder (default container or custom), device list with last-seen, pending outbox / last error, "Sync now". Vault section relabelled "Vault" to avoid two "Sync" entries.
- `electron/servicesHost.ts` — `data:changed` events with `remote: true` are broadcast to every window (previously only to the origin window's siblings).
- Tests: `electron/sync/__tests__/fsSyncStore.test.ts` (4) and `fsSync.integration.test.ts` (two engines over one real folder: notes / tags / tabs propagate, `local_state_json` never crosses, concurrent note edits → identical winner + conflict copy on both, manifests list both devices).

**Done (iOS)**
- `ios/App/BereanNative/Sources/BereanNative/BereanCloudPlugin.swift` — `status` (signed-in + container availability + device name), `mkdir`/`list`/`read`/`write`/`remove` (all `NSFileCoordinator`-coordinated, atomic replace, placeholder → `downloading: true` + `startDownloadingUbiquitousItem`, throttled), `startWatching`/`stopWatching` (`NSMetadataQuery` → `change` events with relative paths). Registered in `BereanBridgeViewController`.
- `src/platform/ios/cloudSyncStore.ts` (`SyncStore` over the plugin; own-folder filter + 1.5 s debounce on watch), `src/platform/ios/syncHost.ts` (engine lifecycle, `visibilitychange` foreground sync / background push, `window.sync`), wired in `src/platform/ios/main.tsx`; self-test check 13 "BereanCloud plugin answers".
- `ios/App/App/App.entitlements` (iCloud Documents, container from `BEREAN_ICLOUD_CONTAINER`), `Berean.xcconfig` (`BEREAN_ICLOUD_CONTAINER`, `CODE_SIGN_ENTITLEMENTS`), Info.plist `BereanICloudContainer` + `NSUbiquitousContainers` (public document scope so the folder is visible in iCloud Drive on the Mac), `scripts/ios/finalize-info-plist.sh` + patch-xcodeproj step 6 (build settings do not expand inside plist keys; verified in the built Info.plist), `vite.ios.config.ts` exposes `VITE_APP_VERSION`.
- Tests: `src/platform/ios/__tests__/cloudSyncStore.test.ts` (fake native container: unavailable status, not-yet-downloaded → null then content, watch filters own files, engine two-device sync waits out downloads in 3 passes without error).
- Simulator: BUILD SUCCEEDED, plugins `BereanSQLite=ok BereanCloud=ok`, self-test 13/13 (cloud reports "unavailable: not signed in" on the simulator, as expected).

**Gate check:** implementation ✔ · tests ✔ · desktop typecheck + build ✔ · simulator ✔ · docs ✔ (`icloud.md` §2, `ios-build.md` §2/§7).
**Deferred to Phase 21 (needs the developer's signing + iCloud account):** the first real Mac ↔ iPhone pass, container visibility on the Mac (`NSUbiquitousContainerIsDocumentScopePublic`), `testing.md` §5 matrix.
**Not yet:** journal compaction (§8).

## Phase 8–9 — Tabs, sessions, workspaces and the remaining entities — GATE MET (engine) (2026-09-21)

**Done**
- Migrations v45 (`youtube_user`, backfilled) and v46 (`pdf_bookmarks`, `pdfs.file_hash`); `BEREAN_SCHEMA_VERSION = 46`; migration tests extended.
- Entities: `ai_chat`, `pdf` (metadata; dependents highlights/bookmarks), `pdf_highlight`, `pdf_bookmark`, `youtube_user` (`video_id` key; mirrored into `youtube_videos.is_starred` + `youtube_watch_history` on apply), `trail_session` (aggregate: row + paused intervals + tag ids, deferred memberships), `trail_node` (dependent connections), `trail_connection`, `trail_note`, `trail_tag` (dependent sessions). `verse_tag` now declares its member/edge dependents and clears the derived `verse_tag_verse` on a remote delete; `note` → versions, `note_folder` → folders + notes.
- Engine: `dependents` + generalised `captureVanished` (replaces the notes-only purge scan); event-time HLC + snapshot capture (causal ops within a device); direct events move an unpushed op's HLC forward; bulk/dependent re-captures use the triggering event's HLC.
- Services: `youtubeService` writes `youtube_user` alongside the UI tables (`toggleStar`, `savePosition`, `removeFromHistory`, `clearWatchHistory`; `clearAll` keeps stars), `mirrorYoutubeUserRow`; desktop `upsertVideos` + `mergeYouTubeSeed` re-apply synced stars. `pdfService`: `findByHash`, `attachFile`, bookmarks CRUD + one-time localStorage import; desktop `pdf:import` hashes the file and attaches to synced metadata instead of duplicating; `pdf:list/get` add `fileMissing`; picker + viewer show it. `studyTrailService.resumeSession` made portable (no `UPDATE … LIMIT`).
- Tests: engine.integration P (YouTube stars/positions incl. unfetched video + clear history), Q (PDF metadata/highlights/bookmarks, hash attach, cascade delete), R (trail session with pause/resume, nodes, connection, tag, note; tag delete and session delete cascades), S (AI chats; verse-tag delete cascades members + derived index; folder delete moves notes to root); 170 files / 4100 tests.

**Gate check:** implementation ✔ · tests ✔ · desktop typecheck + build ✔ · docs ✔ (`icloud.md` §4/§5, `database.md` §3).
**Compaction (§8) — done 2026-09-21:** `engine.compact()` (thresholds 5 MB / 5,000 live ops, forced variant for tests), `pruneCompacted()` (waits for every known device's `applied[me] ≥ snapshot.seq` or 90-day silence), `applySnapshot()` bootstrap on pull; manifest `snapshot` field, `JournalFileInfo.bytes`, status `journal` + `lastSeenAt`; iCloud settings show journal size / compaction point / last seen; memory store registers a device when it comes online (as the real transports do). Cases V, W, X.
**Not yet:** "refresh on remote apply" for open YouTube / PDF / AI-chat panels (they re-read on open; notes, trail, highlights, tags, sessions and workspaces refresh live).

## Phase 5 — Shared data model — GATE MET (2026-09-21)

**Done**
- `src/store/tabPersistence.ts` (pure: `buildSnapshot`, `hydrateFromRows`, `assignOrderKeys` — reuses fractional keys so only moved rows change) and `src/store/tabPersistenceRuntime.ts` (`installTabPersistence`: legacy import from the localStorage-restored store when the tables are empty, hydration from SQLite afterwards with this window's session/active tab preserved, debounced snapshot diffs on every tab/session change, `applyExternalSessions()` hook for the sync engine that adopts structure from rows but keeps this device's newer local view state). Installed from `App.tsx` after `initPerWindowViewState`; independent windows opt out; silent when `window.sessions` is absent.
- `window.sessions` namespace (preload + `electron/ipc/sessions.ts` + iOS bridge + `electron.d.ts`).
- K1 fixed: the 12 settings missing from `partialize` are persisted; `src/store/__tests__/persistedSettings.test.ts` statically guards every simple setter against the allow-list.
- Q4/K-workspaces fixed: `src/lib/workspaceSnapshot.ts` (v2 `{ v, tabs, activeTabId, displayOrder, icon }`, tolerant parser for v1 and pre-v9 NULL rows), `openWorkspaceSession` store action (opens the saved snapshot as a session `ws:<id>`, switches if already open, remaps ids that are still open elsewhere, never disturbs the current session), Settings → Workspaces saves v2 and loads tabs + layout. Tests: `src/store/__tests__/workspaceRestore.test.ts` (save → close → reopen: tabs, per-space order, display order, per-tab state, active tabs, layout; no duplicate on re-open; legacy v1/NULL/garbage; iPhone-compatible plain JSON).
- K7 fixed (Hebrew related words), K8 (NULL title counts as untitled), K9 (playlist overwrite reports real `created_at`) — each with an updated contract test.
- `src/platform/sync/{hlc,fractional,tabFields}.ts` with tests.

**Gate check:** implementation ✔ · tests ✔ (165 files / 4071 tests) · desktop typecheck + build ✔ · iOS simulator build + self-test 12/12 ✔ · docs ✔.

## Phase 2 — iOS/Capacitor foundation — GATE MET

**Done (2026-09-21)**
- Capacitor 8.5.2 + official plugins added as devDependencies (installed into the shared `node_modules` from the main checkout with `--no-save`; worktree lockfile updated with `--package-lock-only`, per CLAUDE.md's no-`npm install`-in-worktree rule).
- `vite.ios.config.ts` (separate entry `src/index.ios.html` → `src/platform/ios/main.tsx`; desktop `src/main.tsx` untouched), `capacitor.config.ts`, `src/platform/ios/csp.ts`.
- `ios/` project (`cap add ios`, SPM), local Swift package `ios/App/BereanNative` (`SQLiteConnection.swift`, `BereanSQLitePlugin.swift`, XCTests), `BereanBridgeViewController` registration, xcconfig layering (`Berean.xcconfig` + `Version.xcconfig` + gitignored `Signing.xcconfig`), `scripts/ios/patch-xcodeproj.mjs` (idempotent pbxproj wiring incl. the "Copy Bundled Databases" phase), `scripts/ios/{bundled-dbs.txt,copy-data.sh,build.sh,run.sh,test.sh,version.mjs}`, `npm run ios:*` scripts.
- JS runtime: `src/platform/ios/{plugins,capacitorSqliteAdapter,services,bridge,selfTest,IosBoot}.ts(x)` — the same shared services over the plugin; `window.*` bridge typed against `src/types/electron.d.ts` (drift fails typecheck); an in-app self-test (12 checks incl. FTS5, Strong's, cross refs, notes CRUD, transaction rollback) is the app's first screen until the mobile shell lands.
- Build: `vite build -c vite.ios.config.ts` OK; `cap sync ios` OK; iOS 26.5 platform installed from this session (Q6; 8.5 GB, second attempt after a network failure); `xcodebuild … -destination 'generic/platform=iOS Simulator'` **BUILD SUCCEEDED**; installed and launched on an iPhone 17 Pro simulator.
- Found and fixed: Capacitor 8's `SceneDelegate.swift` instantiates `CAPBridgeViewController()` in code, so the storyboard's custom class is ignored — the root controller is now `BereanBridgeViewController()` there (this is where local plugins get registered).
- **Self-test 12/12 on the simulator** (timings, cold): berean.db v43 / 47 tables (3 ms) · 23 bundled DBs, 150 MB (12 ms) · Genesis 1 (4 ms) · every text lists books (33 ms) · FTS5 phrase + "love" 526 hits (36 ms) · H7225 entry + 49 occurrences (107 ms) · GEN 1:1 62 refs + 3 TSKe groups (130 ms) · notes create→update→FTS→trash→purge (6 ms) · highlights (1 ms) · verse tags · settings · transaction rollback.

**Gate check:** simulator build ✔ · boots to renderer ✔ · docs ✔.

## Decisions received 2026-09-21 (now authoritative)

Q1 iCloud transport: proceed with per-device journals in the iCloud Drive container, transport-abstracted, validate technically before locking. Q2 bookmarks: preserve the existing model (verse tags); no new system (D-005 confirmed). Q3 youtube_seed.db: audit and split (bundled index + on-demand, resumable, versioned, integrity-checked transcript download); nothing removed. Q4 workspaces: fixed (Phase 5). Q5 deep links: `berean://` first, routing kept abstract for Universal Links later. Q6 commits: checkpoint commits on `feature/ios-app` authorised, no push. Known bugs found during migration are to be fixed, not preserved (K7–K9 done).

## Decisions needed from the developer (non-blocking unless marked)

| # | Question | Recommendation | Blocks |
|---|---|---|---|
| Q1 | **iCloud transport** — accept D-004 (iCloud Drive ubiquity-container journals, zero native code on the Mac) over native CloudKit (which would need a signed native Node addon in Electron plus iCloud entitlements on Developer-ID builds)? | Accept D-004. Revisit only if device testing shows iCloud Drive latency/reliability unacceptable. | Phases 6–9 (design is done; implementation starts after Phase 5 regardless — the engine is transport-agnostic and the transport can be swapped) |
| Q2 | **"Bookmarks"** — the repo has no scripture bookmark feature. Treat the brief's bookmark requirements as satisfied by verse tags (+ pinned tabs, PDF page bookmarks moved to DB), or add a new first-class Bookmarks feature on both platforms? | Verse tags (D-005). | R043 only |
| Q3 | **`youtube_seed.db` on iPhone** — it is 187 MB (video index + transcripts) and is merged into `berean.db` on first run, so bundling it costs ~190 MB download + ~190 MB in the data container. Options: (a) bundle as on desktop; (b) bundle only the video index (no transcripts, ~10 MB) and let iOS fetch the feed live; (c) ship transcripts as a separate on-demand download from GitHub Releases like the TTS voice pack. | (c) — keeps the app small, keeps the dev-only fetch guard, transcripts remain read-only on iOS. | Phase 4 packaging choice; everything else proceeds |
| Q4 | **Workspace "Load" today only restores the panel layout, not the saved tabs** (`WorkspacesSection.tsx:35-42` ignores `state_json`). For sync the brief wants workspaces to carry tabs. Fix desktop Load to also restore the tab snapshot (as the Save side already stores it)? | Yes, fix on desktop as part of Phase 9 (small, and makes the feature whole). | none |
| Q5 | **Universal links** — do you want `https://<your domain>/…` links to open Berean (needs a hosted `apple-app-site-association` on a domain you control, e.g. sitgmeat.com)? `berean://` works regardless. | Custom scheme first; universal links when a domain is chosen. | none |
| Q6 | **Simulator runtime download** (~8 GB, `xcodebuild -downloadPlatform iOS`) — OK to run it from this session when Phase 2 starts? | Yes. | Phase 2 simulator testing |

## Known issues found during the audit (pre-existing, desktop)

| # | Issue | Plan |
|---|---|---|
| K1 | 12 Settings toggles were not in `partialize` and silently reset on restart | **FIXED** (Phase 5) + static guard test |
| K2 | `Tab.isPinned` has no UI that sets it (dead field) | Keep the field (harmless, synced); no mobile UI for it unless asked |
| K3 | Two overlapping cross-window tab-sync mechanisms (`broadcastTabState` and `crossWindowSync.ts`) | Leave both as-is (desktop-only); the device-sync merge borrows `crossWindowSync.mergeTabSets`' policy |
| K4 | `dailyNoteLocation` is in the cross-window shared list — correct for one machine, wrong across devices | LOCAL in device sync (already classified) |
| K5 | `lxx.db` (24 MB) is bundled on desktop but never opened | Not shipped on iOS; desktop untouched |
| K6 | Three different bundled-data path strategies | Unified in Phase 1/3 (R026) |
| K7 | `lexicon.getRelated` never returns Hebrew results: `strongs_hebrew.db.derivation` stores bare numbers ("from the same as 24") but the query matches `LIKE '%H24%'`; Greek works because its derivation text carries the `G` prefix (`src/platform/services/lexiconService.ts` `getRelated`; asserted as-is in `lexiconService.contract.test.ts`) | **FIXED** (Phase 5): bare-number whole-token match for Hebrew; contract test asserts H7218 → H7225 |
| K8 | `notes.create({})` without a title stores SQL `NULL`, while the "untitled" search special case matches only `title = ''` — omitted-title notes are invisible to that search path (`notesService.ts` create/untitledNoteRows) | **FIXED** (Phase 5): untitled search matches NULL titles too |
| K9 | `playlists.save(name, items, existingId)` returns `createdAt: now` even on an overwrite although the row keeps its original `created_at` (`playlistsService.ts`) | **FIXED** (Phase 5) |

## Known limitations (iPhone) — see `feature-matrix.md` §10

- **Read Aloud voices** — system voices via `AVSpeechSynthesizer`, not Kokoro (Phase 16; spike for Kokoro-in-WKWebView scheduled with the device work in Phase 21).
- **AI Lookup** — desktop-only (local Ollama model); `window.aiLookup` reports unavailable on the phone.
- **YouTube** — plays through the embed player in a native web view; no youtube.com login/comments inside the app; embed-disabled videos open in the YouTube app/Safari; PiP from the fullscreen control only (Phase 17). Playback continues when another space is shown (the space is parked, not unmounted).
- **Universal links** — not configured: they need a domain with an `apple-app-site-association` file and the associated-domains entitlement (D-008, `ios-build.md` §6). `berean://` links and the Share Sheet cover every route today.
- **Spotlight** — notes, tab sessions (`berean://session/<id>`), saved workspaces and the books + chapters of the default translation are indexed, incrementally on `data:changed` (R093); individual verses are deliberately not indexed — the app's own search covers those. Results open through the shared deep-link router.

## Phase 10 — Mobile navigation shell — GATE MET (simulator) (2026-09-21)

**Done**
- `src/platform/ios/main.tsx` renders `src/mobile/MobileApp.tsx` (the self-test stays under More → Diagnostics). Boot: settings hydration + debounced persistence (`src/lib/settingsBridge.ts`, shared with desktop `App.tsx` by extraction), fonts (`src/lib/fontFamilies.ts`, shared), theme following iOS light/dark, SQLite tab mirror (`installTabPersistence`), history, sync-applied refresh, deep-link target registration.
- Primitives: `Sheet` (fractional detents, framer drag with velocity settle, body scroll only at the top detent, backdrop + explicit Close for VoiceOver), `ActionList`/`useActionSheet`, `Page`/`IconTap`/`ListSection`/`Row`, `useLongPress` (movement-cancel, click suppression), `haptics` (Capacitor Haptics, best-effort).
- `NavigationStack` (per space; spring push/pop; 28 px edge-swipe pop via `useDragControls`), `SpaceBar` (Scripture / Notes / Search / More), `TabPill` (count + title; swipe left/right → adjacent tab; +), `TabGrid` (cards, close, long-press → rename / close others / close), `SessionSwitcher` (switch/create; rename/delete via actions).
- `ReaderPage`: prev/current/next `ChapterView` pages on a draggable track (direction lock, 28 % or velocity threshold, book boundaries, haptic tick), `usePinchFontSize` (two-finger only → `setBibleFontSize`, 12–32 px, badge, haptic at bounds), Go-to sheet (`ReferencePicker`: typed reference via `parseRef`, book grid by testament → chapters → verses), translation action sheet, Strong's toggle, `StrongsSheet` (collapsed gloss → full entry, related chips, occurrences → `navigateToVerse`, Open in Lexicon).
- `SettingsPage`: theme (segmented), colour preset page, text size stepper, line height, scripture font page, default translation page, verse numbers toggle, embedded iCloud + About sections. `MorePage`: Lexicon/YouTube spaces, verse tags (graph tab), history page (shares `useHistoryNavigate` exported from `HistoryModal`), PDF library page (`fileMissing` shown), diagnostics.
- Interim hosts: a scripture tab that is not a Bible tab (PDF, tags, compare) renders `BiblePanel floating`; Notes → `NotesPanel floating`; Lexicon → `LexiconPanel floating`; YouTube → `YouTubeTab floating`; Search → `SearchTab floating` — every desktop feature reachable now; native phone pages replace them in Phases 13–17 (feature-matrix rows say which).
- Verified on the simulator by tapping through: reader → tab grid → backdrop close → More → Diagnostics (13/13) → back → Notes (hosted panel) → Search (hosted panel); deep link `berean://verse/Gen/1/1` delivered through `appUrlOpen`.
- Tests: `src/mobile/__tests__/primitives.test.tsx` (Page/Row/ListSection markup, ActionList order + states, NavigationStack push/pop, SpaceBar mapping, ReferencePicker parse + grids, useLongPress timing/cancel).

**Gate check:** implementation ✔ · tests ✔ (173 files / 4117) · desktop typecheck + build ✔ · simulator ✔ · docs ✔.
**Known gaps (tracked in the matrix / next phases):** verse long-press action sheet, selection toolbar, highlights/tags/notes-for-verse sheets (Phase 12); native Notes/Search/Lexicon/YouTube pages (13–17); tab reorder/move/duplicate, session icon/reorder/archive (15); onboarding (R086); keyboard avoidance for the hosted editor (R083).

## Phases 11–12 — Reading and scripture interactions — IMPLEMENTED (simulator) (2026-09-21)

- `src/components/bible/verseInteraction.ts`: `VerseInteractionContext` (`pointer` default / `touch`). VerseRow reads it: in touch mode a 450 ms long-press (movement-cancelled, click-suppressed) or a contextmenu event builds a `VerseActionContext` — the verse, its text selection mapped to `verse.text` offsets (extracted `computeSelectionRange`), and the desktop implementations (`copyVerse`, `copyReference`, `addVerseNote` now returns the id, `playAudioFromHere`, `applyHighlight`/`removeHighlight`, new range helpers `applyRangeHighlight`/`clearRangeHighlights`, tag ranges). Desktop behaviour is unchanged (default context; the selection toolbar is suppressed only in touch mode).
- `src/mobile/study/VerseActionSheet.tsx` (highlight swatches for the verse or the selection, copy selection/verse/reference, add note → opens in Notes, notes-for-verse, cross references, play audio, tag verse / chapter), `VerseNotesSheet.tsx`, `CrossRefsSheet.tsx` (TSKe groups + classic votes, source persisted via `crossRefSource`), `TagPickerSheet.tsx` (same `addMembers` flow as the desktop popover), `SelectionBar.tsx` (verse-number selection → copy verses/refs, add note, notes, cross refs, play, tag, highlight palette, clear; helpers exported from `VerseSelectionBar`).
- Reader: `ReaderOptionsSheet` ("Aa"), continuous-scroll mode renders the shared `ContinuousChapterScroll`, More → previous/next chapter.
- Verified on the simulator with real pointer events (Quartz): long-press → sheet; yellow highlight applied to Gen 1:2; notes-for-verse; cross references (TSKe "God" group); backdrop tap dismisses without selecting the verse beneath. (An earlier apparent "backdrop lets taps through" was an artefact of AppleScript's `click at`, which presses accessibility buttons directly.)

## Phase 13 — Notes on the phone — IMPLEMENTING (2026-09-21)

- `src/mobile/notes/NotesHomePage.tsx` — search (`searchNotes`, debounced), type filter chips, folder chips, pinned section, recent list (every note incl. verse and daily), + new note, calendar → today's daily note (same find-or-create as `NotesPanel.openDailyNote`), Trash, "All views" (hosted desktop panel for board/calendar/folder management until their pages land).
- `src/mobile/notes/NoteEditorPage.tsx` — `NoteEditorPM` full-screen; title input in the header; edit/view toggle; the desktop save contract (500 ms debounced `updateNote`, 2-minute idle version snapshot, flush + snapshot on leave/`pagehide`/`visibilitychange`, `bumpNoteToken`); note actions sheet (pin, status, move to folder, version history with restore, copy as Markdown, share via `@capacitor/share`, move to trash); wikilink → note by title (or create), verse ref → reader tab (translation resolved like desktop), Strong's ref → Strong's sheet.
- `src/mobile/notes/TrashPage.tsx` — restore / delete permanently / empty.
- `NotesSpace` in `MobileApp`: `requestOpenNote` (verse sheet "Add note", history, deep links) pushes the editor.
- Verified on the simulator with real pointer/keyboard events: new note → typed text saved and previewed in the list; title edit persisted; daily note created from the calendar button. (The earlier "inputs don't focus" scare was my tap coordinates hitting the status bar.)

## Phase 14 — Search — IMPLEMENTING (2026-09-21)

- `src/lib/scriptureSearch.ts`: `runScriptureSearch` (word-replacer variants as separate queries merged + deduped, phrase-mode exact post-filter ignoring , ;, book scope pushed into the query, "all texts" fan-out, KJVA word-replacer → Strong's bridge via lexicon occurrences), `runStrongsSearch`, `groupHitsByBook`. Tests in `src/lib/__tests__/scriptureSearch.test.ts`. ScriptureSearchView keeps its own copy for now (identical steps; consolidating it is a desktop-side refactor for Phase 20).
- `src/mobile/search/SearchPage.tsx`: scope segmented control (Scripture / Notes / Lexicon), debounced search, results grouped by book with `applyFindHighlight` snippets and the text label when searching all texts, tap → reader with the landed-verse highlight (`targetVerseQuery` / `targetVerseStrongsWords`), typed reference → jump, recent queries (`recentSearchQueries`), filter sheet (match mode, text, canonical book groups), `openSearchTab` compatibility through `pendingSearchQuery`.
- Reader: tab title / history / per-tab back stack now update on chapter change exactly as the desktop BiblePanel does (a search landing on Exodus 20 renames the tab and records history).

## Phase 16 — Read Aloud — IMPLEMENTING (2026-09-21)

- `ios/App/BereanNative/Sources/BereanNative/BereanSpeechPlugin.swift` — `voices`, `speak` (one utterance per verse, rate mapped onto `AVSpeechUtteranceDefaultSpeechRate`), `pause`/`resume`/`stop`/`status`; delegate → `start` / `boundary` / `end` / `cancel` events.
- `src/lib/tts/nativeSpeechBackend.ts` — `NativeSpeechBackend implements TTSBackend` (generation counter drops stale events after stop/skip; boundary char offsets → `SpokenWord`; rate/voice changes restart the current verse; preview), `createNativeVoiceProvider` (English first, Enhanced/Premium tiers). Activated in `src/platform/ios/main.tsx` via `setActiveTTSBackend`. Tests: `nativeSpeechBackend.test.ts` (3).
- `BereanAudioPlugin.swift` — `.playback`/`.spokenAudio` session, `MPNowPlayingInfoCenter`, `MPRemoteCommandCenter` (play/pause/toggle/next/previous/stop → `command` events); `Info.plist` `UIBackgroundModes: audio`; `src/mobile/audio/useIosAudioSession.ts` keeps them in step with `audioPlayback`.
- `src/mobile/audio/AudioBar.tsx` — bar above the tab pill (ref, prev/play-pause/next/stop) and the player sheet (chapter progress, verse grid seek via `seekToVerse`, speed, auto-advance, voices). `MobileApp` mounts `useTTSPlayback()` like `App.tsx`.
- Verified on the simulator: "Play from here" on Exodus 20 → the bar shows Exodus 20:4 after ~12 s with the current word highlighted (native `boundary` events).

## Phase 17 — YouTube — IMPLEMENTING (2026-09-21)

- **Finding:** YouTube's embed player rejects the WebView's `capacitor://localhost` origin as a Referer (error 153 on every video), and Capacitor iOS refuses `iosScheme: 'https'` (`WKWebView.handlesURLScheme` check in `CAPInstanceDescriptor.normalize`). So the player is native: `ios/App/BereanNative/Sources/BereanNative/BereanWebViewPlugin.swift` — a WKWebView added over the bridge view at the rect the page reports, `loadHTMLString(…, baseURL: https://player.berean.app/)` with the IFrame embed (`playsinline`, inline + PiP media playback allowed), wrapper JS relays `onReady`/`onStateChange`/`onError`/`infoDelivery` as `ready`/`state`/`error`/`position` events, `command` forwards IFrame API calls, link taps go to the system. `src/components/youtube/TouchYouTubePlayer.tsx` is the placeholder that positions it (ResizeObserver + scroll/resize), reports state to `YouTubeTab` (which saves positions every 5 s and on leave with the desktop's near-end rule), and hides it when the YouTube space is left. `YouTubeTab` renders it instead of `<webview>` when `window.__berean_platform === 'ios'`; all Electron-only effects no-op on the null webview ref.
- `src/platform/services/youtubeFetchService.ts` — the desktop network layer ported (InnerTube browse + continuation, RSS exact dates, handle resolution cached in settings, Data API Full Sync (dev + key only), `fillMissingDetails`, `fetchDescription`, `searchVideos`; stars preserved on upsert incl. pre-synced `youtube_user` stars). `capacitor.config.ts` enables `CapacitorHttp` so `fetch` bypasses CORS natively. The API key is loaded through `import.meta.glob` only in dev builds (verified absent from the production bundle). Tests: `youtubeFetchService.test.ts` (4).
- Transcript packs: `BereanDownloadsPlugin.swift` (URLSession download tasks, progress events, cancel → resume data kept on disk, `done` with streamed SHA-256, files under `appsupport:downloads/`), `src/mobile/youtube/transcriptPacks.ts` (manifest from the web root, base URL setting with GitHub-release default, verify → `mergeTranscriptPack` → delete file → `data:changed`), `TranscriptPacksPage` (per-channel availability from `getTranscriptAvailability`, download/cancel/resume/retry states). `scripts/data/publish-transcripts.sh` uploads the packs as release assets (`gh`). `copy-data.sh` also drops the manifest in the web root. `Info.plist`: `NSAllowsLocalNetworking` so a LAN/self-hosted pack server works.
- Verified on the simulator: a video plays in the native player (captions visible), position 27.5 s saved to `youtube_watch_history` and mirrored to `youtube_user`; "Called To Be Saints" pack downloaded from a local server, hash verified, 12 transcripts / 11,379 segments merged, ✓ shown.

## Phase 18 — Native integrations — IMPLEMENTING (2026-09-21)

- **Share Extension (R092, D-008):** `ios/App/ShareExtension/{ShareViewController.swift,Info.plist,ShareExtension.entitlements}`; target + "Embed Foundation Extensions" phase added by `scripts/ios/patch-xcodeproj.mjs` step 8 (idempotent; the embed phase must precede the run-script phases — Xcode otherwise reports "Cycle inside App"). `BereanShareInboxPlugin.swift` (`take`, `readFile`) + `src/platform/ios/shareInbox.ts` route reference → passage, YouTube link → video, other text/link → general note, PDF → library (SHA-256 matched to synced rows). Findings while making it work: the simulator build had to sign "to run locally" so the App Group entitlement is embedded (`build.sh` no longer passes `CODE_SIGNING_ALLOWED=NO`); `UIApplication.openURL:` through the responder chain is refused since iOS 18 ("BUG IN CLIENT OF UIKIT") — `UIScene.open(_:options:)` is the working API. Verified on the simulator: Safari → Share → Berean → "Shared link" note; inbox items `Deut 6:4-5` → Deuteronomy 6 at v4, `youtu.be/…` → video plays, generated PDF → library + viewer.
- **Share out (R090):** verse "Share…" (`VerseActionSheet`, selection-aware) and note "Share…" (`NoteEditorPage`) through `@capacitor/share`; "Print / Export PDF…" opens the desktop `PrintPreviewModal` whose `app.printNote` / `app.exportNotePDF` now reach `BereanPrintPlugin.swift` (print controller; PDF via `UIGraphicsPDFRenderer` → share sheet).
- **Spotlight (R093):** `BereanSpotlightPlugin.swift` + `src/platform/ios/spotlight.ts` (full index at boot, incremental on `data:changed`, removals); `SceneDelegate` hands `NSUserActivity` continuations to `BereanSpotlightPlugin.handleContinuation` → router.
- **App Intents (R094):** `ios/App/App/BereanIntents.swift` — OpenScripture, SearchBerean, OpenDailyNote, StartReadAloud, OpenWorkspace (+ `AppShortcutsProvider`), each opening a `berean://` link (`OpenURLIntent` is iOS 18+, so the intents use `UIApplication.open` with `openAppWhenRun`). Router additions: `berean://daily` (store `requestDailyNote()` consumed by the Notes space — works from any space), `berean://workspace?name=`, `berean://share`, `play=1` on video links.
- **YouTube follow-ups:** the YouTube space is parked (hidden, mounted) while a video tab is open and another space shows, so the native player keeps playing (before: unmounting closed it) and `NoteEditorPage` offers "Insert video timestamp" (`berean:requestTimestamp` → `YouTubeTab`, which now reads the native player's position on iOS → `berean:insertTimestamp`). `NoteEditorPM` had no `berean:insertTimestamp` listener at all — it was lost when the CodeMirror editor was deleted — so ⌘⇧L and "Insert timestamp link into active note" were no-ops on desktop; fixed in the shared editor (link run at the cursor). `TouchYouTubePlayer` was remounting after every 5 s position save (`startTime` read from a live ref) — start time is now latched per video. `settings/YouTubeSettingsPage.tsx`: watch history (open / remove / clear), transcript packs, pack server URL (the editor the packs page header promised).
- **Also fixed:** the iOS entry never imported `pdf_viewer.css`, so the PDF text layer rendered as visible text under each page.
- Tests: 177 files / 4130 green; typecheck clean; `npm run build` OK; `npm run ios:build` OK (app + extension).

## Feature-completeness wave (Phases 13–18 leftovers) — 2026-09-21

Done in one pass after Phase 18 (three parallel implementation lanes started this work and were cut off by the account's monthly spend limit mid-way; their partial output was reviewed, completed and integrated by the lead):

- **Settings (R087, done):** every applicable desktop setting is reachable — `SettingsPage` (appearance incl. glass appearance, ambient animation, three font pickers; reading incl. Hermas translation, red letter, continuous scroll, word replacer), `NotesSettingsPage`, `AudioSettingsPage` (native voices / rate / auto-advance / autoplay), `YouTubeSettingsPage`, `DataSettingsPage` (history, workspaces, sessions, danger zone with native confirm), `ExperimentalSettingsPage` (PDF flag now gates the More → PDF library row as desktop's sidebar does), `WordReplacerPage`, Study trail section. Not applicable on the phone and listed as such: Vault sync, Import (e-Sword / BibleGateway bridges are desktop-only), Viewer window, keyboard Shortcuts.
- **Onboarding (R086, done):** `src/mobile/onboarding/OnboardingFlow.tsx`, same `onboardingCompleted` gate as desktop; verified first launch on the simulator.
- **Search (R033/R038/R085):** verse-tag filter (any / every), tagged-verse browse mode, relevance / book-order sort with direction, incremental rendering (50-row chunks with an IntersectionObserver sentinel + Show more) — shared additions in `src/lib/scriptureSearch.ts` (8 tests).
- **Notes (R036):** note icon (emoji picker from the desktop set) with the icon in the editor header and list rows; folder CRUD on the home page (+ chip, long-press a folder → rename / subfolder / delete / delete with notes); the first daily-note open asks for location (R101). Desktop has no colour or free-tag editor for notes (`tags` are import-source markers), so none was invented.
- **Study Trail (R042, testing):** `src/mobile/trail/*` — sessions page, session page hosting the desktop views, sticky notes + tags sheets; `installTrailNavigator` (additive, `trailNav.ts`) makes plain taps navigate on touch; `EverythingView` gained `hideHeader` / `emptyHint` props; recorder + state sync installed at boot; arrival prompt mounted. Verified: two deep-link navigations recorded as stops and shown in Everything.
- **Compare (R088, testing):** `ComparePage` (interleaved cells of the shared `VerseRow`, translation chips, reference picker, prev/next; same tab-state fields as the Mac) + "Compare translations" in the verse sheet. Verified: Deuteronomy 5 KJVA / LXX from the verse sheet.
- **Native pieces:** `BereanPowerPlugin` (R103), `location.ts` (R101), Spotlight now indexes sessions / workspaces / books / chapters with a new `berean://session/<id>` route (R093), `PrivacyInfo.xcprivacy` + permission strings + `ITSAppUsesNonExemptEncryption` (R122), full-bleed app icon + launch screen from `assets/icon.png` (R123), `platformCapabilities.ts` (R013).
- **Fixed while here:** `navigateToVerse` wrote Bible state into a PDF / tags tab when that was the active Scripture tab (a deep link with a PDF tab open went nowhere) — it now lands in the most recent Bible tab or a new one; the trail recorder was never installed on the phone.
- Tests: 177 files / 4133 green; typecheck clean; `npm run build` OK; `npm run ios:build` OK.

## Follow-up batch (tabs, queue, files, bug) — 2026-09-21

- Tab grid drag-to-reorder mode (`TabGrid` + `reorderDiff.ts`, tested); Read Aloud queue + playlists page (`src/mobile/audio/QueuePage.tsx`, `useQueueAutosave` mounted); long-press on note refs / Strong's refs → action sheets (R037); Notes home "…" menu: Import Markdown file, Export all idioms (PDF), New folder, desktop views; note "Export Markdown file…" (`src/lib/noteMarkdownFile.ts` — the vault frontmatter dialect, 5 tests) — R049/R090/R099.
- **Bug fixed (desktop + phone):** `tabPersistenceRuntime.applyExternalSessions` merged a device's local tab state over the synced rows with a spread, so a compare tab's `compareColumns` became bare shells (`[{}, {}]`) after any remote apply / restart — on the phone this threw at boot (`textId.toLowerCase`), on the Mac the compare view would have lost its columns. Now `mergeTabState` (per-column merge) and `splitTabState` no longer emits all-empty nested locals; regression test in `tabFields.test.ts`; `columnsForState` also tolerates already-corrupted rows.
- The iOS entry now prints `Error` name/message/stack for `console.error`/`warn` (Capacitor's console bridge otherwise shows `{}`).

## Bridge completeness (Phase 4/10 follow-up, 2026-09-21)

`src/platform/ios/bridgeExtras.ts` installs the namespaces the first bridge left out, so every hosted desktop panel runs on the phone: `app` (real: `openExternal` → SFSafariViewController, `getVersion`, `isDev`, `openStudyTrailWindow` → event for the future trail page; the multi-window / menu / updater members resolve harmlessly and log once), `studyTrail` (one-to-one with the preload, `onDataChanged` from `data:changed`), `youtube` (DB subset; `refresh`/`fullSync`/`searchVideos`/`fetchDescription` reject with "Phase 17" until the network layer is ported; dev-only transcript fetch stays dev-only), `pdf` (rows from the service, bytes under `Library/Berean/pdfs/` via `@capacitor/filesystem`, import through a file input with SHA-256 matching to synced metadata, `fileMissing`), `aiLookup` (unavailable: local Ollama model is desktop-only). `bridgeSurface.test.ts` fails if a renderer namespace is neither installed nor listed desktop-only. The shell provides `ActivePanelContext` to hosted panels (tags graph, PDF viewer, YouTube, Lexicon) and the More-hosted spaces (Lexicon, YouTube) now render their own roots (they were stuck on the More page). Verified on the simulator: YouTube feed from the bundled index, Lexicon panel, tags graph.

## Developer decisions Q3 / Q5 — done (2026-09-21)

- **Q3 youtube_seed.db:** audit in `audit/youtube-seed.md`; decision D-007; `scripts/data/split-youtube-seed.mjs` (5 s) produces `data/youtube_index.db` (7.0 MB, bundled — `bundled-dbs.txt`) + 61 per-channel packs (0.2–41 MB, 222 MB total, gitignored) + `manifest.json` (sha256 per pack; copied into the bundle as `youtube_transcripts.manifest.json`). `youtubeIndexMerge.ts` (`mergeYoutubeIndex` at iOS boot, `mergeTranscriptPack` for downloads) with tests; `youtubeService.getTranscriptStatus` now checks real segment presence; `getTranscriptAvailability()` per channel for the Phase 17 download UI. Desktop unchanged (`extraResources` filter narrowed so the packs never ship in the desktop app). Still to build in Phase 17: the native resumable/cancellable download + verify + merge flow and its UI.
- **Q5 deep links:** `src/lib/deepLinks.ts` (parse/format/route, tests), desktop target over the store, Electron protocol registration + `open-url`/argv delivery + pending queue, iOS `CFBundleURLTypes` + `appUrlOpen` queue until the shell registers a target; `berean-pdf://` links in notes now navigate (they were inert before — fixed bug).

## Blockers

None.

## Change log

- 2026-09-20 — Phase 0 complete.
- 2026-09-21 — Phase 1/3 gate met (161 files / 4058 tests); Phase 2 gate met (simulator build + boot); Phase 4 simulator half (12/12 self-test); Phase 5 data model started (v43, sessionsService, tabFields, fractional, hlc).
- 2026-09-21 — checkpoint commit 8af0cc8; developer decisions Q1–Q6 received; Phase 5 gate met (store mirror, legacy import, settings persistence, workspace restore, K7–K9); commit 0cb6a28.
- 2026-09-21 — Phase 6 engine gate met (167 files / 4086 tests).
- 2026-09-21 — Phase 7 desktop half: FsSyncStore + Electron sync host + iCloud settings section + renderer refresh (169 files / 4091 tests); commit 899d843.
- 2026-09-21 — Phase 7 iOS half: BereanCloud plugin, CloudSyncStore, iOS sync host, entitlements/container wiring; simulator 13/13; commit 80436b6.
- 2026-09-21 — Phases 8–9 engine gate: v45/v46, remaining entities, dependents/vanished capture, causal capture (170 files / 4100 tests); commit 1828f84.
- 2026-09-21 — Compaction (§8) done; commit 8191f47. Q3 youtube seed split + Q5 deep-link router done; commit 60316d6.
- 2026-09-21 — Phase 10 mobile shell boots on the simulator (173 files / 4117 tests); commit 17abf99.
- 2026-09-21 — Phases 11–12 reader options + scripture interaction sheets on the simulator; commit 1921d54.
- 2026-09-21 — Phase 13 native notes home/editor/trash on the simulator; commit 2994562.
- 2026-09-21 — Phase 14 shared search algorithm + SearchPage (174 files / 4122 tests); commit 51b82bd.
- 2026-09-21 — Phase 15 tab/session actions, Workspaces + Archive pages; commit b5e0dd8. Bridge completeness; commit 0109263.
- 2026-09-21 — Phase 16 Read Aloud via native speech backend + audio session on the simulator; commit 363f47c.
- 2026-09-21 — Phase 17 native YouTube player, channel fetch port, transcript packs (177 files / 4130 tests).
