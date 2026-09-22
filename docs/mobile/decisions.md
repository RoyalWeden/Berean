# Berean iPhone — Decision Log

Every significant architectural decision for the iPhone migration, in the order it was made.
Entries are never deleted; a reversed decision gets a new entry that references the old one.

Format: **decision · date · reason · alternatives considered · consequences · affected requirements**

---

## D-001 — Capacitor is the iPhone application shell

- **Date:** 2026-09-20
- **Decision:** The iPhone target is a Capacitor 8 iOS app whose WKWebView runs the existing
  React/TypeScript renderer bundle (built by Vite), plus a small set of local Swift Capacitor
  plugins for the things a WebView cannot do (SQLite, iCloud ubiquity container, Spotlight,
  App Intents, inline native WebView for YouTube, audio session).
- **Reason:** The repository audit shows the renderer never touches Node or Electron directly —
  every platform call goes through `window.<namespace>.<method>()` objects installed by
  `electron/preload.ts` (25 namespaces, ~680 call sites in ~100 files, all typed in
  `src/types/electron.d.ts`). That boundary is already a platform interface; Capacitor lets the
  same renderer run on iOS with those objects re-implemented in-process. React Native or SwiftUI
  would mean rewriting 65K lines of renderer UI and the ProseMirror editor for no gain.
- **Alternatives considered:** React Native (full UI rewrite; ProseMirror needs a WebView anyway);
  SwiftUI (same, plus two codebases); PWA (explicitly forbidden — no iCloud container, no App
  Store, no App Intents, no bundled 165 MB of SQLite); Tauri mobile (immature iOS story in 2026,
  no advantage over Capacitor for a web renderer).
- **Consequences:** Capacitor 8 requires Xcode 26 (installed: 26.6) and iOS 15+; we target iOS 17+
  (needed for `WKWebsiteDataStore(forIdentifier:)`, modern App Intents, and to keep the mobile
  CSS free of legacy workarounds). The Electron desktop build is untouched by this decision.
- **Affected requirements:** R001, R002, R010–R014.

## D-002 — iOS SQLite is a custom local Capacitor plugin over the system `libsqlite3`

- **Date:** 2026-09-20
- **Decision:** Write `ios/App/Plugins/BereanSQLite` (Swift, ~300 lines) exposing
  `open / query / run / batch / attach / close` over the C API of the SQLite that ships with iOS.
  Bundled text databases are opened **read-only, in place, from the app bundle** with
  `SQLITE_OPEN_READONLY | immutable=1` (no copy). The user database (`berean.db`) lives in
  `Library/Application Support/Berean/` (excluded from iCloud backup: the iCloud sync journal is
  the backup).
- **Reason:** Verified Apple's SQLite build has `ENABLE_FTS5` (`pragma compile_options` on macOS
  3.54.0; the iOS 26.5 SDK's `sqlite3.h` carries the FTS5 API), and every text DB uses an FTS5
  `verses_fts` table. `@capacitor-community/sqlite` would work but links SQLCipher even for
  unencrypted DBs (export-compliance paperwork, larger binary) and its `copyFromAssets` flow
  duplicates ~165 MB of read-only content into the data container. A local plugin is smaller,
  has no third-party runtime, and gives exact control over `ATTACH`, journal modes and read-only
  URI flags.
- **Alternatives considered:** `@capacitor-community/sqlite` 8.x (SQLCipher, copy-on-install);
  `@capawesome-team/capacitor-sqlite` (sponsorware); sql.js/wa-sqlite in WASM (every DB in WebView
  memory — 165 MB+; user-DB persistence would need an OPFS/VFS layer; no FTS5 guarantee).
- **Consequences:** We own the plugin's correctness and tests (Swift unit tests + TS contract tests
  that run the same queries against better-sqlite3 and the plugin). The plugin API is deliberately
  the minimum the shared `DatabaseAdapter` interface (D-003) needs.
- **Affected requirements:** R003, R004, R020–R024.

## D-003 — One shared service layer over an async `DatabaseAdapter`; Electron IPC becomes thin

- **Date:** 2026-09-20
- **Decision:** Move the SQL/business logic that iOS needs offline out of `electron/ipc/*.ts` into
  `src/platform/services/*` (plain TypeScript, no Node/Electron imports) written against an async
  `DatabaseAdapter` (`all/get/run/exec/transaction/attach`). Electron implements the adapter with
  better-sqlite3 (`electron/db/adapters/betterSqliteAdapter.ts`) and its IPC handlers become
  one-line delegations. iOS implements it with the D-002 plugin and installs the same
  `window.<namespace>` objects in-process (`src/platform/ios/bridge.ts`). Schema migrations move to
  `src/platform/db/bereanMigrations.ts` so both platforms run the identical 42-step history.
- **Reason:** The brief forbids duplicating business logic and forbids scattering platform
  checks in UI. The only place desktop and iOS genuinely differ for core data is the SQLite driver.
  Converting the shared services to `async` is mechanical; the SQL stays byte-identical so desktop
  behaviour is preserved and can be regression-tested against the existing IPC tests.
- **Alternatives considered:** Keep sync better-sqlite3 code and duplicate it for iOS (two copies of
  ~5K lines, guaranteed drift); run the existing sync code on iOS via sql.js (see D-002 — memory and
  persistence problems); RPC from the WebView to a Node runtime on iOS (no such runtime exists).
- **Consequences:** Desktop-only subsystems stay in `electron/` untouched: vault/Octarine, importers
  (BibleGateway, e-Sword), Ollama/AI lookup, TTS model download, multi-window, viewer/presenter,
  menus, auto-updater, YouTube feed/transcript fetching. The better-sqlite3 adapter serialises
  transactions with an async mutex because `BEGIN…COMMIT` around an awaited callback must not
  interleave with another IPC handler's writes.
- **Affected requirements:** R020–R024, R030–R040, R100.

## D-004 — iCloud sync transport is **iCloud Drive files in the app's ubiquity container**, with a per-device append-only change journal (no shared file is ever written by two devices)

- **Date:** 2026-09-20
- **Decision:** User data (notes, highlights, verse tags, sessions/tabs, workspaces, note folders,
  playlists — see `icloud.md` for the full entity list) synchronises through the iCloud ubiquity
  container `iCloud.com.berean.app`. Each device writes **only** to
  `Documents/sync/v1/devices/<deviceId>/…` (a manifest plus numbered journal files of change
  operations); every device reads every other device's journal and merges it into its local SQLite
  with shared TypeScript merge rules. No two devices ever write the same file, so iCloud Drive
  file-level conflicts cannot occur by construction. Compaction rewrites only the compacting
  device's own files. Desktop reads/writes the container as a plain folder
  (`~/Library/Mobile Documents/iCloud~com~berean~app/Documents/`); iOS goes through a local Swift
  plugin (`BereanCloud`) that uses `FileManager.url(forUbiquityContainerIdentifier:)`,
  `NSFileCoordinator`, `NSMetadataQuery` and `startDownloadingUbiquitousItem`.
- **Reason (the deciding constraint):** the Mac app is Electron. CloudKit, Core Data + CloudKit and
  `NSPersistentCloudKitContainer` are native-only APIs; using them from Electron needs a signed
  native Node addon plus iCloud entitlements on a Developer-ID build, and dev builds would have no
  entitlement at all. iCloud Drive's ubiquity containers are ordinary folders on macOS synced by
  the system daemon regardless of which process writes them — this is exactly how Obsidian
  (Electron on Mac) syncs vaults to Obsidian iOS, and how this user's existing Octarine vault sync
  already works (`com~apple~CloudDocs`). It is offline-first by nature (writes land locally, the
  daemon uploads later), needs no backend and no account, and also gives Windows a path later
  (iCloud for Windows syncs the same containers).
- **Alternatives considered:**
  - *CloudKit native on iOS + CloudKit JS on Mac.* Real Apple record store with server-side change
    tags. Rejected for v1: CloudKit JS needs an Apple-ID web sign-in popup inside Electron (from a
    `file://` origin), a public API token, network for every operation (we would still build the
    offline queue ourselves), and Apple has not updated CloudKit JS meaningfully in years. Kept as
    a documented future option if file sync proves unreliable.
  - *Native CloudKit Node addon on Mac.* Highest fidelity, highest cost, unusable in unsigned dev
    builds. Rejected.
  - *Sync the SQLite file itself through iCloud Drive.* Guaranteed corruption/conflicts. Rejected.
  - *One JSON file per record written by any device.* Simple, but concurrent edits of the same
    record produce iCloud file conflicts that Electron cannot read back (`NSFileVersion` is native
    only) — silent data loss. Rejected in favour of per-device journals.
  - *Custom backend / accounts.* Explicitly forbidden by the brief.
- **Conflict rules (shared TypeScript, identical on both platforms):** every op carries a hybrid
  logical clock timestamp and the writing device id. Records merge field-wise last-writer-wins on
  the HLC; deletions are tombstones that win over older updates and lose to newer ones. **Note
  content is never silently overwritten:** if two devices edited the same note since their last
  common base, the later edit becomes current and the other is stored as a `note_versions` row
  (`kind = 'conflict'`) and surfaced in the note's version history. Sessions/tabs merge as sets
  (union of tabs, tombstoned closes, fractional-index ordering), so *Mac: Tab 1, Tab 2* + *iPhone:
  Tab 1, Tab 3* → *Tab 1, Tab 2, Tab 3*. Details in `icloud.md`.
- **Consequences:** A `BereanCloud` Swift plugin and an Electron `fs`-based store implement one
  `SyncStore` interface. The local schema gains a `sync_state` table (device id, per-device applied
  sequence, pending ops) and every synced table gains `updated_at`/`deleted_at` where missing.
  Evicted (`.icloud` placeholder) files on macOS are downloaded with `brctl download`. Physical
  Mac ↔ iPhone testing is mandatory before R005–R009 can be marked COMPLETE. If the developer
  prefers CloudKit despite the Mac constraint, this decision is the one to revisit first.
- **Affected requirements:** R005–R009, R050–R062.

## D-005 — "Bookmarks" in the brief map to Berean's existing verse-tag system; no new bookmark feature is invented

- **Date:** 2026-09-20 — **confirmed by the developer 2026-09-21** ("do not create a second bookmark system; preserve the existing model; PDF page bookmarks stay tied to the PDF data model")
- **Decision (provisional):** The repository has no scripture bookmark feature (the only
  "bookmarks" are per-PDF page bookmarks in `localStorage`, `src/components/pdf/PDFViewer.tsx:45`).
  The brief's bookmark requirements (identity + target, synced) are satisfied by **verse tags**
  (`verse_tags`, `verse_tag_members`, `verse_tag_verse` tables) which already carry identity,
  colour, and verse/chapter ranges, plus pinned tabs. Verse tags therefore join the iCloud entity
  list. PDF page bookmarks move from `localStorage` into the user DB so they sync with PDF
  highlights.
- **Reason:** The brief says the desktop feature model is the source of truth and forbids inventing
  a new feature taxonomy. Adding a parallel "bookmark" concept next to verse tags would be exactly
  that.
- **Inventory (verified 2026-09-21 by grep over `src/` and `electron/`):** no scripture bookmark
  entity, table, IPC channel or UI exists. Bookmark-like mechanisms that DO exist: verse tags
  (`verse_tags`/`verse_tag_members`/`verse_tag_verse`, tag manager, tag picker, `#tag` filters in
  search — the user's way of saving/collecting scripture), pinned notes (`notes.pinned`), pinned
  tabs (`Tab.isPinned`, typed but no UI sets it), PDF page bookmarks (`localStorage`
  `berean:pdfBookmarks:<pdfId>`), and navigation history. **Disposition:** verse tags are the
  bookmark-equivalent synchronised data (R054); pinned notes sync with notes; PDF page bookmarks
  move into the PDF data model (`pdf_bookmarks` table, Phase 9/44) so they sync alongside PDF
  highlights; no new Bookmarks feature.
- **Alternatives considered:** Add a first-class Bookmarks feature to both platforms — rejected by
  the developer.
- **Affected requirements:** R007, R043.

## D-006 — Berean "Sessions" are the synced workspace unit; DB "Workspaces" are synced saved snapshots

- **Date:** 2026-09-20
- **Decision:** The brief's *workspace* (id, name, ordering, membership, persistent tabs) is
  Berean's `Session` (Arc-style tab group: `sessions[]`, `currentSessionId`, per-space tab lists,
  `activeTabId`) which today lives only in the zustand `berean-app-state` localStorage blob. The DB
  `workspaces` table (named snapshots of `panelLayout + tabs + activeTabId`, Settings → Workspaces)
  is a second, smaller entity. Both sync. Sessions and tabs are lifted out of localStorage into
  SQLite tables (`sessions`, `tabs`) with stable ids, fractional ordering and tombstones; the zustand
  store keeps its shape and hydrates from the service, so the ~200 store actions and every
  component keep working.
- **Reason:** Tabs cannot be synced from a debounced localStorage blob with no per-record identity
  or timestamps. Moving them to SQLite gives the sync engine the same primitives as notes, keeps
  the existing store API, and fixes the pre-existing "fast window close loses the last 500 ms of
  tab state" hazard the store's own comments describe.
- **Alternatives considered:** Sync the whole localStorage blob as one record (LWW wipes the other
  device's tabs — violates the merge requirement); keep tabs local-only (violates R008).
- **Affected requirements:** R008, R009, R056–R059.

## D-007 — youtube_seed.db is split: a small bundled index + per-channel transcript packs downloaded on demand

- **Date:** 2026-09-21 (developer decision Q3 received 2026-09-21; audit in `audit/youtube-seed.md`)
- **Decision:** The desktop seed (`data/youtube_seed.db`, 196 MB) stays exactly as it is for the
  desktop build (`mergeYouTubeSeed`, `SEED_VERSION`). For the iPhone the same seed is split by
  `scripts/data/split-youtube-seed.mjs` into (a) `data/youtube_index.db` (~7 MB, bundled: the
  11,097 video rows, 62 channel sync rows and the 5,977 transcript *metadata* rows — so the app
  knows offline which videos have transcripts and how long they are) and (b) one transcript pack
  per channel under `data/youtube_transcripts/<handle>.db` (the `youtube_transcript_segments`
  rows for that channel; 62 packs, 0.2–19 MB each, ~190 MB total) plus `manifest.json`
  (`format`, `seedVersion`, per-pack `bytes` + `sha256` + counts). Packs are published as release
  assets and downloaded on the phone only for the channels the user chooses (Phase 17):
  resumable (URLSession download task with resume data), versioned (manifest `seedVersion`),
  integrity-checked (sha256 before merge), cancellable, stored in the app container (excluded from
  backup, never in the iCloud journal). A downloaded pack is merged into `berean.db` through the
  same tables and FTS triggers desktop uses, so `getTranscript` / `searchTranscripts` /
  `getTranscriptStatus` are unchanged on both platforms; transcript search results simply cover the
  channels downloaded so far (shown in the UI).
- **Reason:** 96 % of the seed is transcript segments (2.7 M rows, 189 MB); bundling it would
  double the app download for data most users never open, while the index is what the YouTube
  space needs to render lists offline. Per-channel packs match how the feature is used (a user
  follows a handful of channels) and give a natural, honest download UI.
- **Alternatives considered:** Bundle the full seed on iOS (app > 400 MB with the Bible DBs);
  drop transcripts on iOS (removes a desktop feature — not allowed); stream transcripts from an
  online API (the desktop feature is offline by design and transcript fetching is dev-only).
- **Affected requirements:** R026, R066, R143; feature-matrix rows "YouTube transcripts" and
  "Transcript search".

## D-008 — "Open in Berean" arrives through a Share Extension + App Group inbox; universal links are documented, not configured

- **Date:** 2026-09-21 (developer decision Q5: `berean://` first, routing kept central)
- **Decision:** The system Share Sheet target is a real app extension
  (`ios/App/ShareExtension/`, product `$(BEREAN_BUNDLE_ID).share`, wired by
  `scripts/ios/patch-xcodeproj.mjs` step 8 and embedded in the App target). It accepts text, one
  web URL and up to five files, copies PDFs and appends every item to `inbox/pending.json` in the
  App Group container (`BEREAN_APP_GROUP`, default `group.com.berean.app`), then opens the app
  with `berean://share` through `UIScene.open` (the only URL-opening API an extension may call on
  iOS 18+). `BereanShareInboxPlugin` drains the inbox on that link and on every return to the
  foreground, and `src/platform/ios/shareInbox.ts` routes each item through the same central
  router every other entry point uses (`src/lib/deepLinks.ts`): a scripture reference opens the
  passage, a YouTube link opens the video, other text or links become a general note, a PDF is
  imported into the library (SHA-256 matched, so a file already imported on the Mac attaches to
  the synced row instead of duplicating it). The App Group is the only data path between the
  extension and the app; the extension never opens `berean.db`.
- **Universal links:** not configured. They need an `apple-app-site-association` file served
  from a domain the developer controls plus the `applinks:` associated-domains entitlement; the
  router already understands the https path form (`https://<host>/berean/verse/…`), so enabling
  them later is (1) host the AASA file, (2) add `com.apple.developer.associated-domains` to
  `App.entitlements` with the domain, (3) nothing in JS. Recorded in `ios-build.md` §8.
- **Reason:** an extension is the only way to appear in the Share Sheet; an App Group inbox keeps
  the extension tiny and lets the app apply its normal services (services, sync, Spotlight)
  instead of duplicating them in the extension process.
- **Alternatives considered:** no Share Sheet input (drops "Open in Berean" — not allowed); the
  extension writing to `berean.db` directly (two processes on one SQLite file plus the sync
  engine's capture would not see the change); `UIApplication.openURL:` via the responder chain
  (refused by UIKit since iOS 18 — observed on the iOS 26 simulator).
- **Affected requirements:** R092; feature-matrix rows "Open in Berean", "Share sheet in".
