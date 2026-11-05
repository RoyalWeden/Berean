# 04 — Database and Data Migration Audit

> **Baseline note.** Investigated at `807c2d9`. The final baseline is `d97fb05`. The only code changes between them are PRs #9, #10 and #11, listed in `01-REPOSITORY-STABILIZATION.md`: fixes for sync defects D1-D4, note table-cell formatting, and audio cache keys. Anything below describing those defects as present is corrected where noted.

Audit of commit `807c2d974b795f95f4c05b8ae4b6796c273b572c`, 2026-11-05. Read-only on the code. This document describes what a future migration to native Swift would involve. It does not recommend implementing anything now.

**Status labels**

- **VERIFIED**: confirmed by reading the code, by a command on a copy, or by running the real engine in a scratch harness.
- **INFERRED**: follows from verified facts but was not executed.
- **UNVERIFIED**: comes from memory or third-party material and was not confirmed here.
- **BLOCKED**: could not be checked in this environment.

**How evidence was gathered**

- All bundled databases were copied to a scratch folder and opened read-only (`file:...?immutable=1`). The FTS integrity check ran on a further throwaway copy.
- The production `berean.db` was copied to scratch, read for schema and counts only, and the copy was deleted. No note content was read.
- The final v49 schema was produced by running the real migrations on an in-memory database.
- Harness probes bundled the real `engine.ts`, services and migrations with the repo's own `Sim` test harness, outside the repo.
- Nothing in the repo was modified except this file and `05-ICLOUD-AND-SYNCHRONIZATION.md`.

---

## 1. Summary of findings

1. **There are 27 `.db` files in `data/`.** 26 hold data and `berean.db` is a 0-byte stub. All read-only copies pass `integrity_check`, with `foreign_key_check` empty, `journal_mode=delete`, `user_version=0` and `application_id=0`. VERIFIED.
2. **One user database holds everything mutable: `berean.db`, at schema v49.** That is 47 ordinary tables, 2 external-content FTS5 tables, 6 triggers and 35 indexes. Version tracking uses a `schema_version` table, not `PRAGMA user_version`, which is 0. VERIFIED.
3. **Native Apple SQLite can open these files as they are.** FTS5 with `unicode61` works on the macOS SDK library (3.54.0). The iPhone app already runs the same FTS5 DDL on system SQLite. VERIFIED on macOS, INFERRED on iOS because it ships.
4. **SwiftData and Core Data are poor fits, and GRDB is the strongest candidate.** The schema has text primary keys, external-content FTS5, triggers, ATTACH, and a sync layer that reads tables through `SELECT *` and `PRAGMA table_info`. Keep the file and its schema; do not convert the data model. See §10.
5. **User data lives in more places than the database.** Chromium `localStorage` on the Mac and WKWebView `localStorage` on the iPhone hold settings that have no equivalent in `berean.db`: `wordReplacerRules`, `customThemes`, chat drafts and others. Native code has no supported API for reading either store. VERIFIED that the data is there; the fallback extraction in §11.4 is INFERRED.
6. **DMG and MAS share a bundle ID but not a data location.** A sandboxed native app inherits MAS data automatically and cannot see DMG data. Apple's `container-migration.plist` is move-only and runs only when the container is first created. That container already exists on this Mac, so the mechanism would not run here. VERIFIED locally; Apple behaviour from Apple's documentation and forum.
7. **The migration runner has gaps that matter for downgrade.** It does not refuse a database newer than the build, and a failed pre-migration backup does not stop the migration (`bereanMigrations.ts:1329-1332`). VERIFIED.
8. **A native rewrite that computes `hashFields` differently can revert real edits.** In a harness probe, hash drift on one device pushed an old note text over a newer offline edit on every device. The edit survived only as a conflict copy. VERIFIED. Details are in 05 §14 (S1).

---

## 2. Every SQLite database

### 2.1 Bundled databases (read-only)

**Pragma results.** Every file below returned `integrity_check=ok`, an empty `foreign_key_check`, `journal_mode=delete`, `user_version=0`, `application_id=0`, `page_size=4096` and `encoding=UTF-8`. `PRAGMA foreign_keys` read 0, which is a per-connection setting, not a property of the file. FTS5 `integrity-check` passed for all 20 databases with `verses_fts`. VERIFIED on copies.

The `delete` journal mode is deliberate. `build/afterPack.js:25-43` converts packaged databases because a WAL file in a read-only bundle cannot create `-shm`. If a conversion fails, it only warns.

| File | Size (bytes) | Tables and rows | FTS / triggers | Shipped on |
|---|---:|---|---|---|
| `kjva.db` | 20,316,160 | books 80, verses 36,890 (has `text_tagged`) | `verses_fts`, `verses_ai` | Mac, iOS |
| `kjv.db` | 8,826,880 | books 66, verses 31,102 | `verses_fts`, `verses_ai` | Mac, iOS |
| `lxx_brenton.db` | 17,125,376 | books 53 (`sort_order`), verses 28,694 (`text_tagged`) | `verses_fts`, `verses_ai` | Mac, iOS |
| `lxx.db` | 25,108,480 | books 59, verses 30,603 | `verses_fts`, no trigger | Mac only; called an orphan in `scripts/ios/bundled-dbs.txt` |
| `enoch.db` | 528,384 | books 1, verses 1,063 | yes | Mac, iOS |
| `jubilees.db` | 602,112 | books 1, verses 1,305 | yes | Mac, iOS |
| `recog_clement.db` | 1,638,400 | books 10, verses 1,997 (`title`) | yes | Mac, iOS |
| `hermas.db` | 454,656 | books 3, verses 637 | yes | Mac, iOS |
| `hermas_taylor.db` | 503,808 | books 3, verses 648, crossrefs 163 | yes | Mac, iOS |
| `t12p.db` | 401,408 | books 12, verses 984 | yes | Mac, iOS |
| `2baruch.db` | 286,720 | books 1, verses 669 | yes | Mac, iOS |
| `ep_barnabas.db` | 208,896 | books 1, verses 125 | yes | Mac, iOS |
| `asc_isaiah.db` | 155,648 | books 1, verses 295 | yes | Mac, iOS |
| `apoc_abraham.db` | 131,072 | books 1, verses 282 | yes | Mac, iOS |
| `apoc_elijah.db` | 102,400 | books 1, verses 170 | yes | Mac, iOS |
| `didache_hoole.db` | 94,208 | books 1, verses 100 | yes | Mac, iOS |
| `t_jacob.db` | 98,304 | books 1, verses 137 | yes | Mac, iOS |
| `1clement.db` | 180,224 | books 1, verses 394 | `verses_fts(text)` only, no index, no trigger | Mac, iOS |
| `gad.db` | 135,168 | books 1, verses 375 | `verses_fts(text)` only, no index, no trigger | Mac, iOS |
| `t_job.db` | 135,168 | books 1, verses 321 | `verses_fts(text)` only, no index, no trigger | Mac, iOS |
| `strongs_hebrew.db` | 8,007,680 | entries 8,674, occurrences 162,979 | none; `idx_occ_strong` | Mac, iOS |
| `strongs_greek.db` | 29,442,048 | entries 5,523, occurrences 475,634 (extra `text_id`) | none; 2 indexes | Mac, iOS |
| `cross_references.db` | 20,762,624 | meta 1, refs 344,799 | none; `idx_from`, `idx_to` | Mac, iOS |
| `tske_refs.db` | 47,230,976 | tske_refs 643,847 | none; `idx_tske_from`, `idx_tske_to` | Mac, iOS |
| `youtube_seed.db` | 196,485,120 | youtube_videos 11,097, transcripts 5,977, segments 2,700,386, sync 62 | no FTS in the seed | Mac only |
| `youtube_index.db` | 7,294,976 | meta 2, videos 11,097, transcripts 5,977, sync 62 | none; 4 indexes | iOS only (`package.json` excludes it from the Mac build) |
| `berean.db` | 0 | empty stub | none | not a real database; it matches the `*.db` extraResources filter |

**Schema variations a native reader must handle**

- `verses_fts` comes in two shapes: `fts5(text, book_id UNINDEXED, chapter UNINDEXED, verse_num UNINDEXED, content=verses, content_rowid=id)` and a three-file variant with `text` only.
- `text_tagged`, `title` and `sort_order` exist only in some files. The code probes for them with `hasColumn` (`DatabaseAdapter.ts`).
- The real column names are `book_id`, `verse_num` and `chapters_count`. CLAUDE.md §7 documents `book`, `book_abbr` and `book_num`. **That documentation is wrong.** The same is true of §17: real `notes` uses `verse_ref` with integer timestamps, not `book_num`/`chapter`/`verse`.

**Other database files**

| File | Status |
|---|---|
| `verse_embeddings.db` | Dev-only artifact. `electron/db/embeddingsDb.ts` looks for it, but it is not shipped, and every caller degrades to null. VERIFIED by comment and absence from `data/`. |
| e-Sword files | Opened read-only during import (`electron/ipc/eSwordImport.ts:280,301,320`). Not stored. |
| Transcript packs | iOS downloads per-channel pack files, merged with `mergeTranscriptPack` (`youtubeIndexMerge.ts:55`). |
| Chromium databases | `Cookies`, `SharedStorage`, `Trust Tokens` in `userData` are Electron-internal. |

### 2.2 `berean.db` — the user database

Location: see §7. Opened read-write in `electron/db/berean.ts:115-117` (WAL, `foreign_keys=ON`) and in `BereanSQLitePlugin.swift` `open` (same pragmas). Text and lexicon files are opened read-only.

**Inventory at v49.** VERIFIED by running the migrations: `sqlite_master` holds 57 tables (47 ordinary + 2 FTS5 + 8 FTS shadow), 35 explicit indexes (automatic primary-key indexes not counted), and 6 triggers. `sqlite_sequence` is extra.

The sync column uses the entity name from `entities.ts`; "local" means the data never leaves the device.

| Table | PK | Added | Sync | Notes |
|---|---|---|---|---|
| `notes` | id (implicit rowid) | v1 | `note` | 22 columns; `deleted_at` is Trash and syncs as a field |
| `note_folders` | id | v10 | `note_folder` | hard delete |
| `note_versions` | id | v12 | `note_version` | append-only; `conflict-<hlc>` ids |
| `note_heading_collapse` | note_id+heading_key | v24 | local | |
| `note_thread_collapse` | note_id+thread_key | v27 | local | |
| `highlights` | id | v1/2 | `highlight` | |
| `settings` | key | v1 | local | JSON values; 110 keys in production |
| `workspaces` | id | v1/9 | `workspace` | |
| `history` | id | v9 | local | capped at 500 rows in production |
| `pdfs` | id | v11/46 | `pdf` | metadata only, bytes never sync |
| `pdf_highlights` | id | v11 | `pdf_highlight` | |
| `pdf_bookmarks` | id | v46 | `pdf_bookmark` | |
| `playlists` | id | v26 | `playlist` | aggregate with items |
| `playlist_items` | id | v26 | inside `playlist` | FK CASCADE |
| `ai_chats` | id | v21/48 | `ai_chat` | `messages` merges by element id |
| `study_profiles` | id | v49 | `study_profile` | see 05 D6 |
| `ai_saved_contexts` | id | v49 | `ai_saved_context` | see 05 D6 |
| `verse_tags` | id | v37/42 | `verse_tag` | unique NOCASE name |
| `verse_tag_members` | id | v37 | `verse_tag_member` | FK CASCADE |
| `verse_tag_verse` | composite | v37 | derived locally | rebuilt from `ranges` |
| `tag_edges` | id | v42 | `tag_edge` | 2 FK CASCADE; see 05 D2 |
| `trail_sessions` | id | v28/40 | `trail_session` | aggregate |
| `trail_paused_intervals` | id | v28 | inside `trail_session` | |
| `trail_nodes` | id | v28-36 | `trail_node` | |
| `trail_connections` | id | v28-36 | `trail_connection` | 31 columns; `ties` unused |
| `trail_notes` | id | v39/41 | `trail_note` | |
| `trail_tags` | id | v40 | `trail_tag` | |
| `trail_tag_members` | tag_id+trail_session_id | v40 | inside `trail_session` | FK CASCADE, deferred when tag is absent |
| `trail_collapse` | scope+key | v38 | local | |
| `trail_embeddings` | id | v28 | local | BLOB Float32 |
| `sessions` | id | v43 | `session` | tombstones |
| `tabs` | id | v43 | `tab` | `local_state_json` excluded |
| `archived_groups` | id | v43 | `archived_group` | tombstones |
| `session_local_state` | session_id | v43 | local | |
| `youtube_videos` | video_id | v3-5 | local (cache) | |
| `youtube_sync` | channel_handle | v3 | local | |
| `youtube_watch_history` | video_id | v5 | local (cache) | mirrored from `youtube_user` |
| `youtube_user` | video_id | v45 | `youtube_user` | stars and positions |
| `youtube_transcripts` | video_id | v13 | local | |
| `youtube_transcript_segments` | id INTEGER | v13 | local | FK CASCADE |
| `sync_state`, `sync_outbox`, `sync_record_meta`, `sync_applied`, `sync_failed`, `sync_conflicts` | various | v44/47 | engine bookkeeping | device-local |
| `schema_version` | none | runner | local | one row per migration |

**FTS and triggers**

- `notes_fts` (v19): `fts5(title, content, content='notes', content_rowid='rowid', tokenize='unicode61')`, kept in step by triggers `notes_ai`, `notes_ad`, `notes_au`.
- `youtube_transcripts_fts` (v13): external content on `youtube_transcript_segments`, `unicode61`, with triggers `yt_seg_ai`, `yt_seg_ad`, `yt_seg_au`.
- There are no other triggers, no views, and no `CHECK` constraints.

**`notes_fts` depends on the implicit rowid of a table with a TEXT primary key.** This is a migration hazard.

- `VACUUM`, `VACUUM INTO` and a bare `INSERT INTO m SELECT * FROM n` all preserved rowids in a test on macOS SQLite 3.54.0. VERIFIED.
- SQLite's documentation does not promise this for tables without an INTEGER PRIMARY KEY. UNVERIFIED as a guarantee.
- An importer that inserts rows one at a time will assign new rowids. It must therefore run `INSERT INTO notes_fts(notes_fts) VALUES('rebuild')` and then the FTS `integrity-check`.

**Production shape** (copy of the DMG production database; counts only). VERIFIED:

| Measure | Value |
|---|---|
| File size | 586 MB, plus a 4.5 MB WAL at copy time |
| Schema | v48 (48 rows, no row for 18). The installed app reports 0.8.1, and this checkout is v49, so production lags this commit. |
| Quick check | ok |
| Free pages | 24,373 of 143,074 (about 95 MB) |
| `notes` | 3,900; largest single `content` 9,155,367 characters (embedded base64 image, inferred from size) |
| `note_versions` | 706 rows, about 76 MB of content |
| `tabs` | 1,158 |
| `trail_nodes` / `trail_connections` | 5,107 / 5,673 |
| `sync_record_meta` | 16,794 rows (38 MB) |
| `sync_applied` | 1,811 rows across 2 devices |
| `sync_conflicts` | 26 |
| `youtube_transcript_segments` | 2,700,386 |
| `tag_edges`, `pdfs` | 0 |

Transcript data dominates the file: about 161 MB of segments, 71 MB of the segment index, and more than 83 MB of FTS. This data is re-creatable, while the user-authored part of the database is much smaller.

---

## 3. Migration system

**Where it lives.** `src/platform/db/bereanMigrations.ts`, shared by Electron and iOS. Current version: **49**. `BEREAN_SCHEMA_VERSION` is the last array entry (line 1307). VERIFIED.

**Version tracking.**

- A `schema_version(version INTEGER NOT NULL)` table, with `MAX(version)` as the current value (lines 1309-1313).
- `user_version` is not used. It reads 0.
- v18 is deliberately missing: an unrelated branch consumed the number on a shared dev database (comment at line 430). A fresh database has 48 rows with maximum 49. VERIFIED. A native runner must compare by `MAX`, never by row count.

**Execution.** Each migration runs in its own transaction, and `schema_version` is written inside it (lines 1334-1342). A failure leaves the database at the previous version. VERIFIED by reading.

**Integrity check.** When upgrading an existing database, `PRAGMA quick_check` runs first and `DatabaseDamagedError` is thrown if it fails (lines 1326-1328). `quick_check` is weaker than `integrity_check`: it does not compare indexes with table content. The same check runs again before sync starts.

**Backups.**

- Mac: `VACUUM INTO` a `.tmp`, then rename, in `userData/backups`, keeping the newest 3 (`electron/db/berean.ts:122-133`). Production has 2, totalling 858 MB.
- iOS: `BereanSQLitePlugin.backup`, same approach, folder excluded from device backup.

**Gaps.** VERIFIED by reading:

| # | Gap | Evidence | Consequence |
|---|---|---|---|
| M1 | A failed backup does not stop the migration | `bereanMigrations.ts:1329-1332`; `onBackupFailed` only logs | Disk-full can migrate with no backup. Each step is transactional, so this is a loss of the safety net, not of data. |
| M2 | A database newer than the build is accepted silently | `pending` is empty when `current > known`; no check at lines 1320-1323 | Downgrade opens a newer file with no warning. It works only because of the additive-only rule in the file header. |
| M3 | No automated rollback | Backups are never restored by code | Recovery is manual. |
| M4 | Migrations are not reversible | Up-only array | Rollback means restoring a backup or relying on additive compatibility. |
| M5 | Several migrations swallow `ALTER` errors | `try { ALTER … } catch {}` in v9-v25, v40-v42 | A real failure would be recorded as success. Later versions use `hasColumn`. |
| M6 | Backups are full copies, including re-creatable transcripts | About 430-470 MB per backup on production | iOS storage pressure. Backup size is a real cost for native as well. |

The bundled files have no version stamp of their own; `user_version` is 0. Only the `youtubeSeedVersion` setting and `youtube_index.db` `meta.seed_version` track content versions. A native app has no way to verify a bundled text's version without adding its own check. `scripts/ios/copy-data.sh` also copies by size and mtime only.

---

## 4. FTS5 tokenizers and Apple SQLite

Every FTS table uses `unicode61`: explicitly in `notes_fts` and `youtube_transcripts_fts`, and by default in `verses_fts`, where no `tokenize=` is given. No custom tokenizer is used. VERIFIED from `sqlite_master`.

| Check | Result | Status |
|---|---|---|
| macOS SDK `libsqlite3` version | 3.54.0 | VERIFIED (Swift script) |
| `ENABLE_FTS5` | present | VERIFIED |
| `unicode61`, `porter`, `trigram`, `ascii` | all created successfully | VERIFIED on macOS |
| iOS system SQLite has FTS5 with `unicode61` | v13 and v19 migrations run through `import SQLite3` in a shipped app | INFERRED from shipping; iOS version numbers were not measured |
| `better-sqlite3` bundled SQLite | 3.53.1 (package 12.10.0) | VERIFIED |
| Minimum iOS 17 SQLite version | not measured | UNVERIFIED |

**Unicode tables can differ between SQLite versions.** Search behaviour on Hebrew and Greek is exercised by `remove_diacritics`. The on-disk index was built by whichever SQLite created it. After changing engine, run a rebuild and compare sample queries rather than assuming identical tokens. Bundled `verses_fts` indexes are read-only, so they were built by the data scripts, and only query-side tokenization runs on device.

---

## 5. Compile-option differences

| Option | better-sqlite3 | Apple macOS | Why it matters |
|---|---|---|---|
| Foreign keys default | ON (`SQLITE_DEFAULT_FOREIGN_KEYS=1`) | OFF (`PRAGMA foreign_keys` read 0) | Native code must set it on every connection, or CASCADE silently stops working. The iOS plugin does. |
| Double-quoted strings | `DQS=0` (rejected) | `DQS=3` (accepted) | Bad SQL passes on Apple and fails on Mac. |
| URI filenames | `USE_URI=0` | `USE_URI` on | The iOS `ATTACH` of `file:…?immutable=1` depends on this. It would fail under `USE_URI=0`. |
| WAL synchronous | NORMAL (`=1`) | NORMAL (`=1`) | Same. A power cut can lose the last commits but not corrupt the file. |
| `recursive_triggers` | off | compile list shows `DEFAULT_RECURSIVE_TRIGGERS`, but `PRAGMA` read 0 | Set it explicitly. It changes whether `INSERT OR REPLACE` fires delete triggers, and so affects FTS consistency. No code uses `INSERT OR REPLACE` on `notes` today. |

All VERIFIED on macOS. iOS equivalents UNVERIFIED.

---

## 6. Non-SQLite storage

### 6.1 Renderer `localStorage`

**Main blob.** `berean-app-state` (zustand `persist`, `src/store/index.ts:3435`) through a 500 ms debounced writer. VERIFIED.

The partialized fields split into three groups:

- **Settings with no copy in `settings`** (need checking key by key, see below): `wordReplacerRules`, `wordReplacerEnabled`, `customThemes`, `themePreset`, font families, `dailyNoteLocation`, `aiLookupCollections`, `aiLookupProfileId`, layout defaults.
- **Tab and session state:** `tabs`, `sessions`, `archivedGroups`, `sessionDisplayOrders`, `tabMRUList`. These are mirrored to SQLite by `src/store/tabPersistence.ts`. SQLite is canonical for sync, so native should read SQLite.
- **Task and history UI:** `tasksVisible`, `completedTaskIds`, `historyExpandedDays` and similar.

`hydrateSettingsIntoStore` also loads settings from SQLite (`src/App.tsx:662+`, `src/lib/settingsBridge.ts`), so some fields exist in both places. **Which fields are SQLite-backed was not enumerated field by field.** That table must exist before a native importer is written. UNVERIFIED per field.

**Other keys.** VERIFIED by grep:

| Purpose | Keys |
|---|---|
| Real user content | `berean-chat-drafts-v1`, `berean-chat-replies-v1`, `berean-chat-groups-v1` |
| Legacy, imported once per PDF | `berean:pdfBookmarks:<id>` (moved to `pdf_bookmarks` at v46; unopened PDFs may still hold them) |
| Preferences | `berean.onlineResearch` (iOS), `berean.haptics.enabled`, `berean.readerWidth`, `berean.verseSheetMode`, `berean.notesHome.v1`, `berean.notesHome.view.v1`, `berean.picker.searchHistory`, `berean.linkEditorMode`, `berean.noteInfoWidth`, `berean-study-trail-window`, `berean-verse-picker-font-scale`, `berean-chat-window-sidebar`, `berean-chat-days-open`, `berean-chat-folders-open`, `berean-viewer-font-scale`, `berean-ask-why-sync`, `berean:folderViewExpanded2`, `berean:skipFolderDeleteConfirm`, `berean:hint:*` |
| Caches and diagnostics | `berean:notesCache:v1`, `berean:embedBlocked`, `berean:syncTrace`, `berean-crash`, `berean_search_diag` |
| Per-window view state | `src/lib/perWindowViewState.ts` |

**Physical location**

- Mac: `<userData>/Local Storage/leveldb`, a Chromium LevelDB with a private format. Present in production. VERIFIED.
- iPhone: WKWebView's WebsiteData under the app's `Library/WebKit` tree, keyed by origin. Private format and path. UNVERIFIED path.

### 6.2 What is not used

- **`electron-store`:** not present. VERIFIED by grep.
- **Capacitor Preferences:** listed in `capacitor.config.ts` `includePlugins`, but no code calls it. VERIFIED by grep. `src/` and the native sources also contain no `UserDefaults` use for app data.
- **IndexedDB:** no app use found by grep. An `IndexedDB` folder exists in the Berean-dev profile; its owner was not identified. UNVERIFIED.

### 6.3 Keys and secrets

| Item | Location | Protection | Portable to native? |
|---|---|---|---|
| BYO provider API keys | `<userData>/provider-keys.json` | `safeStorage.encryptString`, base64; mode 0600; refused if encryption is unavailable (`electron/secrets/providerKeys.ts`) | **No, treat as non-portable.** Decryption needs Electron's Keychain item. Re-entry is the safe plan. Whether a native app signed by the same team could read that item is UNVERIFIED. |
| Cloud consent and model choice | `<userData>/ai-cloud-settings.json` | Plain JSON, not secret; unrecognised values read as off | Yes. It must fail closed, and consent should arguably be re-asked. |
| YouTube login | Partition `persist:youtube` cookies | Chromium encrypted cookies | No. Sign in again. |
| BibleGateway import session | `BG_PARTITION` session | Same | No. Not needed after import. |
| Sandbox folder access | `<userData>/sandbox-bookmarks.json` (MAS) | Security-scoped app bookmarks | Only for the same signed app identity; test it. The user may need to re-pick the folder. |
| iOS API keys | None | Desktop-only per `src/types/electron.d.ts:923`; no Keychain code in the iOS sources | Not applicable |

`electron/youtube-key.ts` is a build-time local file, not user data.

### 6.4 Filesystem data

| Data | Mac path (`<userData>` = §7) | iPhone path | Syncs? | Re-creatable? |
|---|---|---|---|---|
| Imported PDFs | `<userData>/pdfs/<id>.pdf` | `Library/Berean/pdfs` (`Directory.Library`, `bridgeExtras.ts:54`) | **No, metadata only** | **No.** Only copy unless the vault export ran. |
| Note images | Inline base64 in `notes.content` | Same | Yes, inside notes | Extracted to `{vault}/attachments/` only on vault export |
| Vault Markdown | User folder, `vaultPath` | None; iPhone has no vault | Separate one-way-plus-watcher path | Export of the database, and lossy (§6.5) |
| Voice packs | `<userData>/tts-models/<model>` | `Application Support/Berean/tts-models` (excluded from backup) | No | Re-download |
| TTS audio cache | `<userData>/tts-audio-cache` | Native cache paths | No | Yes |
| Transcripts | Inside `berean.db` from `youtube_seed.db` | Inside `berean.db` from packs; files in `Application Support/Berean/downloads` | No | Yes |
| Embeddings | Not shipped; `trail_embeddings` table has 0 rows in production | None | No | Yes |
| Share inbox | None | App Group `inbox/` (`item-<uuid>.json`, legacy `pending.json`) | No | Pending items are user data until handled |
| Backups | `<userData>/backups` | `Application Support/Berean/backups` | No | Safety copies |
| Manual leftovers | `berean.db.bak-*` in production | None | No | Keep; do not delete |
| Logs | Electron-log default; Dev under `~/Library/Logs/Berean-dev` | Console only | No | Diagnostics |

The chat widget's Swift file was grepped for `sqlite`, `group` and `UserDefaults` and showed no database access. VERIFIED by grep.

### 6.5 The vault is not a complete backup

`runExportAll` (`electron/ipc/vault.ts:1000+`) writes Markdown plus JSON sidecars: `berean-settings.json`, `berean-pdfs-meta.json`, `berean-note-versions.json`, `berean-note-folders.json`, `berean-pdf-highlights.json`, `berean-youtube-starred.json`, `berean-tab-state.json`, and PDFs under `.attachments/`.

It is not lossless, and it must not be the primary migration source:

- `importVaultFile` restores a limited field set; `status` and `idiom_*` are not in its upsert (`vault.ts:655-666`).
- Study Trail, verse tags and AI chats were not observed in the sidecar list that was read. Treat them as absent until checked.
- It has no sync metadata, so it cannot preserve tombstones or HLCs.
- `berean_id` plus `updated` timestamps do let it act as a good last-resort text recovery.

---

## 7. Storage locations per identity

Identities come from `config/app-identity.json`, read by `src/platform/appIdentity.ts`. Team `6C8RCZVUZR`. `userData` is set explicitly at `electron/main.ts:123`.

| Distribution | Bundle ID | Sandbox | `userData` / DB folder | iCloud container | Evidence |
|---|---|---|---|---|---|
| Mac DMG, production | `com.berean.app` | No | `~/Library/Application Support/Berean` | `iCloud.com.berean.app` by path; **no iCloud entitlement** | VERIFIED: `codesign` on `/Applications/Berean.app` 0.8.1, and DB present |
| Mac App Store, production | `com.berean.app` | Yes | `~/Library/Containers/com.berean.app/Data/Library/Application Support/Berean` | Same, through `URLForUbiquityContainerIdentifier` | Path INFERRED from sandbox behaviour; on this Mac the container exists but has no Berean folder, so MAS has not run real data here |
| `npm run dev` | not packaged | No | `~/Library/Application Support/Berean-dev` | `iCloud.com.berean.app.dev` by path | VERIFIED |
| MAS dev build | `com.berean.app.dev` | Yes | `~/Library/Containers/com.berean.app.dev/Data/Library/Application Support/Berean-dev` | Dev container | Folder exists and is empty here |
| iPhone production | `com.berean.app` | iOS container | `Library/Application Support/Berean/berean.db`; PDFs `Library/Berean/pdfs` | `iCloud.com.berean.app` | VERIFIED in plugin |
| iPhone Berean Dev | `com.berean.app.dev` | iOS container | Same relative paths, separate container | `iCloud.com.berean.app.dev` | VERIFIED in xcconfig generation |

**App Groups differ per platform.** iOS uses `group.com.berean.app` and `.dev`, only for the Share Extension inbox. Mac MAS uses `6C8RCZVUZR.com.berean.app` only for Electron's Mach rendezvous, per the comment in `build/entitlements.mas.plist`. **It holds no user data.** Group containers exist on this Mac. VERIFIED.

**Three facts for the migration**

1. DMG and MAS share a bundle ID, so one Mac can have two independent databases with different device IDs.
2. Berean Dev never shares data with production, enforced at build, at sync-folder level (`berean-identity.json`), and at runtime (`identityProblem`). The Dev identity is therefore a safe rehearsal environment.
3. `com.berean.app.sandboxtest` containers exist on this Mac. They do not appear in `config/app-identity.json`. Treat them as leftovers.

**The iOS backup documentation is out of date.** `docs/mobile/decisions.md` D-002 says `berean.db` is excluded from iCloud backup. The code sets `isExcludedFromBackup = false` and explains why (`BereanSQLitePlugin.swift`, R017). The code is right.

---

## 8. Foreign keys, transactions, concurrency, WAL

**Foreign keys.** Declared on only 6 relationships: `playlist_items`, `verse_tag_members`, `tag_edges` (2), `trail_tag_members`, `youtube_transcript_segments`. All CASCADE. Everything else, including `notes.folder_id`, `note_versions.note_id` and `trail_*`, is a soft reference that cleanup code and the sync engine maintain.

- Orphans are possible by design (v24 comment).
- A native importer must not add foreign keys. Synced records can arrive in any order, and foreign keys would reject them.
- Keep `foreign_keys=ON`, because CASCADE deletes are relied upon (`entities.ts:190`).

**Transactions.** `BEGIN IMMEDIATE` around an awaited callback in both adapters. Outside statements wait on `txTail`; nested transactions become savepoints. `DatabaseAdapter.ts` documents the rule that a callback awaits only its handle. Its header names `betterSqliteAdapter.ts` and `memoryAdapter.ts`, which do not exist; the real class is `SyncSqliteAdapter`.

**Concurrency on the Mac.** A single read-write connection in the main process.

- **Raw `getBereanDb()` calls bypass the queue.** They appear in `vault.ts` (18 write statements), `youtube.ts` (14) and `main.ts` (3). VERIFIED by grep count.
- Because the adapter's transaction awaits between statements, a raw write landing in that gap would run **inside** the open transaction, and a rollback would discard it silently. INFERRED; the window is narrow and no reproduction was attempted.
- Those raw writes also emit no `data:changed`, which is the root of D4 in 05.

**Concurrency on iOS.** One serial queue per handle, `SQLITE_OPEN_NOMUTEX`, `busy_timeout` 5000. No other process opens `berean.db`: the Share Extension writes JSON to the App Group inbox.

**WAL.** Set on both platforms. There are no explicit checkpoints; automatic checkpointing applies. Electron closes at `will-quit`; iOS has no close on suspend.

The rule for any copy: **never copy `berean.db` alone**. A raw copy without `-wal` loses recent commits. Use `VACUUM INTO` or the SQLite backup API from a connection, or copy all files with the owner stopped. At copy time production held a 4.5 MB WAL.

If a native app later moves the database into an App Group for a widget, iOS can kill a suspended process that holds a file lock in shared storage (`0xdead10cc`). UNVERIFIED from memory. Keeping the database in the app container avoids this.

---

## 9. better-sqlite3 versus the iOS bridge

| Behaviour | Mac (`SyncSqliteAdapter` + better-sqlite3) | iPhone (`CapacitorSqliteAdapter` + plugin) | Effect |
|---|---|---|---|
| JS number binding | Always `sqlite3_bind_double` (`better-sqlite3/src/util/data.cpp`) | Integral values bound as int64 (`SQLiteConnection.swift`) | The same value lands differently in a TEXT-affinity column: `1730000000000.0` vs `1730000000000`. INTEGER columns are unaffected. Example: `entities.ts:144` writes a number into TEXT `study_profiles.deleted_at`. INFERRED; only tombstones are affected. |
| Booleans | better-sqlite3 rejects them | Bound as 0/1 | Code valid on iPhone can throw on Mac |
| `undefined` | Mapped to NULL in adapter | Mapped to NULL in adapter | Same |
| BLOB | Buffer | Base64 `{__blob}` across the bridge | Cost only |
| Integers above 2^53 | Lossy as JS numbers | Same after JSON | Native Swift would be exact, so a comparison could differ. None observed. |
| Statement cache | 512 entries | 64 entries | Performance only |
| Sync model | Synchronous under a promise queue | Async bridge round trip | iOS is slower per statement. `batch` exists. |
| Read-only open | `{ readonly: true }` | `immutable=1` URI, no locks | Native should keep `immutable=1` for bundle files |
| Pragmas | Set in `berean.ts` | Set in `open` (not for read-only) | Same |
| Busy timeout | better-sqlite3 default, 5 s (UNVERIFIED) | 5000 ms | Same |
| Multi-statement | `exec` only | `exec` only; `run` rejects a tail | Same |
| `recursive_triggers`, DQS, URI | see §5 | see §5 | |

---

## 10. Options for native data access

The data forces a few requirements: open the existing file unchanged, run existing FTS5 external-content tables and triggers, ATTACH seed files, keep `schema_version`, read tables generically for sync, and keep `SELECT *` semantics for hash compatibility.

| Option | Fits existing file | FTS5 | Migrations | Concurrency | Sync engine fit | Verdict |
|---|---|---|---|---|---|---|
| **SQLite C API** (`import SQLite3`) | Yes | Full, raw SQL | Hand-written | Hand-written; `SQLiteConnection.swift` is a working 233-line start | Full control | Viable, with the most code and the most risk of memory and threading bugs |
| **GRDB** | Yes | Supported, and raw SQL always works | `DatabaseMigrator` uses its own `grdb_migrations` table, so bridge or skip it and keep `schema_version` | `DatabasePool` gives WAL readers and a serialized writer | Row-as-dictionary, observation; a transaction can cover both the write and the outbox | **Best fit.** Maintained, close to raw SQL, and it can eliminate the capture race structurally. Dependency risk is modest. Exact FTS5 and system-SQLite build requirements UNVERIFIED (search found nothing). |
| **SQLite.swift** | Yes | Partial builder, raw SQL available | Thin; `user_version` is common, which is 0 here | One connection with a queue | Workable, weaker for generic row handling | Acceptable but does less than GRDB for this case |
| **Core Data** | **No.** Expects its own `Z*` tables and metadata | No FTS5 model | Model versions | Contexts | Would need a total conversion, and the generic table-driven sync would be replaced | Rejected |
| **SwiftData** | **No**, same store model. Forum evidence shows only schema-matching Core Data stores open, with failures such as "no such table: ZAPPSETTINGS" | None | Schema versions | Actor-based | As Core Data | Rejected |

**Why conversion to Core Data or SwiftData is rejected, not just discouraged.** It discards the property that makes this migration safe, which is that the same file works in old and new apps. It turns rollback into a reverse conversion, loses `sync_record_meta` and lineage, and needs a full-text replacement. `NSPersistentCloudKitContainer` would also be a different sync system with a different record identity, which is the migration described as high risk in 05.

**Recommended direction for a later decision.** Keep `berean.db` as it is. Use GRDB or the C API. Adopt `schema_version`. Keep the bundled files unchanged. This is INFERRED judgment, not a tested implementation.

---

## 11. How an existing user moves to native apps

### 11.1 Principles

1. **The source is never modified or moved until the user has run native successfully.** No `Move` manifest.
2. **Same database file format.** Native adds only additive schema, under the rule in the migration file header.
3. **Same bundle IDs, same iCloud containers.** New identities would mean new containers and a full re-sync.
4. **Rehearse on Berean Dev first** on both Mac and iPhone. Its separation from production is enforced.
5. **Fix D1-D4 from 05 in the old apps before any migration**, since mixed-version periods amplify them. This is a precondition for later, not work proposed now.
6. **Sync-off users are first-class.** `icloudSyncEnabled` is opt-in. For them, the local file is the only copy.

### 11.2 Mac: which distribution decides the route

| Current install | Native sandboxed, same bundle ID | Native non-sandboxed Developer ID, same bundle ID |
|---|---|---|
| **MAS** | Container is inherited. `Application Support/Berean/berean.db` is at the same path. Simplest route. | Cannot see the container without user consent. Not a sensible route. |
| **DMG** | **Hard case.** Data is outside the sandbox. Needs a user-granted folder or a prepared export. | Same paths, no access problem. Simplest route for DMG users. |

**Sandbox access to the non-sandboxed data.** Options for DMG to sandboxed native:

- **`container-migration.plist`: rejected.**
  - It moves files; Apple DTS says there is no copy option.
  - It runs only when the container is first created.
  - The container already exists on this Mac (`~/Library/Containers/com.berean.app`), so it would not run. VERIFIED locally.
  - A move would also leave the old app with an empty database, and a fresh database with sync on is the condition the quarantine guard exists for.
- **`NSOpenPanel` grant: preferred.**
  - Open at `~/Library/Application Support/Berean` and have the user confirm the folder.
  - The `user-selected.read-write` entitlement already exists in the MAS file.
  - Read-write is needed because a WAL database needs `-shm`.
  - Use an app-scoped bookmark, then copy with the backup API while the old app is closed.
  - The hidden `Library` folder is a usability issue; the panel can be preset with `directoryURL`.
- **Export from a final Electron release: also good.** A last DMG build runs `VACUUM INTO` and packs PDFs and a JSON of `localStorage` into a user-chosen bundle file. Native imports it through the Open panel. This also solves localStorage.
- **Temporary-exception entitlement for `Library/Application Support/Berean`:** App Review acceptance UNVERIFIED. Do not rely on it.
- **Electron writing directly into the container:** macOS app-data protection may prompt or block. UNVERIFIED. Avoid.

**Other Mac concerns**

- **Updater.** The DMG uses `electron-updater` from GitHub Releases. A native DMG arrives by the same route only if the final Electron release accepts its signed zip. UNVERIFIED; test it.
- **Same-name app.** MAS and DMG installs both land at `/Applications/Berean.app`, so installing one over the other changes which data location is used. Any first-run check must notice both locations.
- **iCloud entitlement for a native DMG.** The Electron DMG has no iCloud entitlement and uses the folder by path, which works in production (4,552 journal files from one device, VERIFIED). A native Developer ID app should use proper `NSFileCoordinator` access. Whether Developer ID supports iCloud Documents entitlements today is UNVERIFIED. **This must be answered before choosing a route.**

### 11.3 iPhone route

The App Store update keeps the bundle ID and so keeps the container, App Group, and iCloud identity. This is the easy case for files. VERIFIED by identity config; Apple's container retention on update is standard behaviour.

Same-path items: `Library/Application Support/Berean/berean.db` with WAL, backups, tts-models and downloads, `Library/Berean/pdfs`, the App Group inbox.

**The hard part is WKWebView `localStorage`.** See §11.4.

**Rollback is restricted.** The App Store does not offer downgrades. Rollback means publishing a Capacitor build with a higher version, and it requires that the database stayed readable by that build. TestFlight allows earlier builds, but TestFlight is not how most users would recover. Use phased release.

### 11.4 localStorage extraction

| Approach | Mac | iPhone | Status |
|---|---|---|---|
| Bridge release that writes all `berean*` keys to a JSON file in `Application Support/Berean` at every launch | Yes | Yes | Preferred. Needs at least one launch of the bridge version before the native update. |
| Read LevelDB directly | Possible, private format, needs a parser | Not applicable | Fragile. Last resort. |
| Hidden `WKWebView` at the old origin that dumps `localStorage` | Not applicable | Default data store with a handler for the old scheme and host; default origin `capacitor://localhost` | INFERRED; test before relying on it. This covers users who skip the bridge release. |
| Accept loss of pure preferences | Partly | Partly | Acceptable for UI layout keys, **not** for `wordReplacerRules`, `customThemes`, chat drafts, chat groups or `dailyNoteLocation` |

Priority order: user content (chat drafts, replies, groups), then user-authored settings (word replacer, custom themes), then preferences, then UI state.

### 11.5 First-run import, step by step

**Mac (sandboxed native, DMG source). The other cases skip steps 2-4.**

1. Detect source. Check container `berean.db`, check for an export bundle, and ask whether the old app is running. If both a DMG and MAS database exist, show both with their sizes and modification times and let the user choose. **Never merge two local files.**
2. Request folder access, or accept an export bundle.
3. Confirm Electron has stopped. Check running apps, then take the lock with `BEGIN IMMEDIATE` on a read-write open.
4. Copy with the SQLite backup API or `VACUUM INTO` to `berean.import.tmp`, not by file copy.
5. Validate the copy: `PRAGMA integrity_check` (full, not `quick_check`), `foreign_key_check`, FTS `integrity-check`, `MAX(schema_version)` no higher than the build knows.
6. Rename into place atomically. Copy PDFs by hash. Leave the source untouched.
7. Run pending migrations after taking the pre-migration backup. **Treat backup failure as a stop**, unlike M1.
8. Verify (§11.6). Write `migration-state.json` with the source path, source hash, counts and timestamp.
9. Import the localStorage JSON into `settings` or native storage. Do not delete the JSON.
10. Start sync only after verification. See 05 §15.
11. Ask the user to re-enter API keys and sign in to YouTube. Show what was not carried across.
12. Keep the source for at least one release cycle. Offer removal only as an explicit user action.

**iPhone.** Same as steps 5, 7, 8, 9, 10 and 11, with the file already in place. Run them before any write. If validation fails, keep the file, stop, and offer recovery from backups or iCloud.

**No sync bookkeeping may be dropped or rewritten during import.** `sync_state`, `sync_outbox`, `sync_record_meta`, `sync_applied`, `sync_failed` and `sync_conflicts` move with the file. The harness shows why: an import with these tables cleared re-adopted every record, and a note purged on another device came back into the Trash on all three devices (`kind: note-trashed`). VERIFIED.

### 11.6 Verification

| Check | Method | Required result |
|---|---|---|
| Structure | `integrity_check`, `foreign_key_check` | ok, empty |
| Version | `MAX(version)` | expected |
| Row counts | Every table in §2.2, source vs copy | equal |
| Content | Per-table digest of ordered rows, for user tables | equal |
| FTS | `integrity-check`, plus sample searches compared with source results | ok, same result sets |
| Sync bookkeeping | Counts of `sync_record_meta`, `sync_outbox`, `sync_applied`; same `device_id` policy | as designed in 05 §15 |
| **Hash parity** | Recompute `hashFields` and `fieldHashes` in Swift for every record and compare with stored values | **100% equal**, or stop |
| PDFs | Every `pdfs.filename` exists; SHA-256 equals `file_hash` where set | all present |
| Keys | No plaintext key in any exported file | none |
| Vault | `vaultPath` and bookmark still resolve | reachable, or prompt |

### 11.7 Rollback and downgrade

| Situation | Action | Condition |
|---|---|---|
| Native fails before first write | Discard the copy; old app untouched | Always available on Mac |
| Native ran, user returns to DMG Electron | Old app opens its own untouched source | Edits made in native exist only in native and iCloud. If sync was on, the old app receives them. If off, they need a reverse export. |
| Native ran in place (MAS, iPhone) and old build returns | Old app opens the same file | Requires additive schema. **M2 means it will not warn.** A native schema number higher than the old build also stops the old build's pull (05 §14, S6). |
| Migration corrupted data | Restore a backup through a tool that exists by then | M3: this does not exist today |
| Old build opens after native wrote a non-additive change | Not recoverable by design | Do not make non-additive changes during the transition |

**Downgrade rule for the transition.** Until every device has moved, native must write nothing an older build cannot read: no renamed columns, no `NOT NULL` additions without defaults, no dropped tables, no changed JSON shapes in `tabs.sync_state_json`, `ai_chats.messages` or `playlists`.

---

## 12. Data-preservation strategy

1. **Before:** The pre-update app shows the sync state, and `Export all notes` is promoted. iPhone already has this (`exportNotes.ts`, DATA-SAFE-100). The Mac has vault export, with the limits in §6.5. Preferred sequence: a successful sync on every device, an empty `sync_outbox`, no holds, then a full backup.
2. **Copies kept:** The untouched source, a verified import copy, and the pre-migration `VACUUM INTO` copy. Do not rotate these out during the first native launches. The current 3-file retention could evict a pre-native backup after three schema steps.
3. **Excluded data:** Transcripts, voice packs and caches are re-creatable, and should not stand in the way of a backup. Consider excluding them from migration copies for storage reasons, but do not change the source.
4. **Never delete** `berean.db.bak-*`, `backups/`, `pdfs/`, or anything in the vault during migration.
5. **PDFs get special attention.** They do not sync and are the only data with no second copy, unless a vault export ran. On iPhone a device without the file shows `fileMissing`. Count and hash them first.
6. **A permanent "Open the old database" recovery tool** should exist through the transition, for the case where an import was skipped.
7. **Telemetry-free diagnostics:** Keep a local migration report, with counts only, that the user can share.

---

## 13. Test list

**Fixture preparation (Berean Dev only; never production data).** Generate a database with every table populated, including orphans, a 9 MB note, unicode titles, trashed notes, tombstoned tabs, and pending outbox rows. Keep versions at v43, v47, v48 and v49.

**Database**

1. Open all 26 bundled files through native code; run every search and lexicon query; compare with Electron results.
2. Same on iOS 17 minimum and on the oldest supported macOS, to measure SQLite versions.
3. Hebrew and Greek FTS comparison, including diacritics.
4. Migrate each fixture version to current in native code; compare the final schema with the TS runner's `sqlite_master`.
5. Confirm comparison by `MAX(version)` with the v18 gap.
6. Newer-database behaviour: native refuses or warns, and old Electron on a native file works.
7. Backup failure: disk full stops migration.
8. Damaged database: `integrity_check` failure blocks import and sync.
9. Rebuild `notes_fts` after a row-by-row import; search gives identical results.
10. Foreign-key CASCADE works on native connections.
11. `INSERT OR REPLACE` and trigger behaviour match on each engine.

**Import**

12. Copy during an active WAL: no lost commit.
13. Old app still running: import refuses.
14. Kill at every step: rerun is safe, and no half file looks complete.
15. DMG to sandboxed native through the Open panel, including security-scoped bookmark reuse after relaunch.
16. MAS to sandboxed native in place.
17. Both DMG and MAS data on one Mac: user choice, no merge.
18. Sync-off user on each route.
19. Low disk: 586 MB source plus copy plus backup.
20. Vault path preserved, in the sandbox, and bookmark failure.
21. PDFs: all present by hash; missing-file rows still show.
22. API keys: not exported; re-entry works; `ai-cloud-settings.json` fails closed.
23. localStorage JSON import, including the skipped-bridge-release path with a hidden WKWebView.
24. Share inbox items pending across the update are handled exactly once.

**iPhone**

25. App Store-style update on a device: path continuity with real TestFlight builds, Berean Dev first.
26. Phased-release rollback with a higher-versioned Capacitor build on a native-touched file.
27. Backup restore of a native-era database forks the device ID.

**Sync** tests are in 05 §16.

---

## 14. Open items

| Item | Status |
|---|---|
| Field-by-field map of localStorage vs `settings` | UNVERIFIED; needs doing before design |
| iOS SQLite version and compile options on the deployment minimum | UNVERIFIED; simulator runtimes are present, but a device check was not run |
| Whether the Electron safeStorage Keychain item can be read by a native app | UNVERIFIED |
| Developer ID support for iCloud Documents entitlements | UNVERIFIED |
| Whether WKWebView data can be read with a hidden view after the framework change | INFERRED |
| Whether `Migration Assistant` and restores preserve file birthtime, on which fork detection depends | UNVERIFIED |
| GRDB's exact FTS5 build requirements | UNVERIFIED |
| Real behaviour on an actual MAS install with data | BLOCKED: no MAS data on this Mac |
| iPhone database contents | BLOCKED: not accessible here |

**Sources for Apple behaviour:** [Migrating your app's files to its App Sandbox container](https://developer.apple.com/documentation/security/migrating-your-app-s-files-to-its-app-sandbox-container.md), [Apple forum on `container-migration.plist`](https://developer.apple.com/forums/thread/763674), [Replacing Core Data with SwiftData](https://developer.apple.com/forums/thread/766075), [Does SwiftData copy the Core Data store](https://developer.apple.com/forums/thread/769676), [Upgrading from Core Data to SwiftData](https://www.hackingwithswift.com/forums/swiftui/upgrading-from-coredata-to-swiftdata-what-am-i-missing/26356).
