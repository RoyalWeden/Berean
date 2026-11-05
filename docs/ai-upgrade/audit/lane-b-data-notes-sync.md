# Lane B — Data, notes, sync, settings, Bible DBs, secure storage, downloads (inferred from code + read-only sqlite, 2026-10-28)

## Migrations / notes
- Runner: src/platform/db/bereanMigrations.ts (shared desktop+iOS). BEREAN_MIGRATIONS :21, BEREAN_SCHEMA_VERSION :1274, currentSchemaVersion :1276 (schema_version table), runMigrations :1287 (quick_check, backup hook, one txn per migration). Rules :13: never edit shipped migrations, never DROP, new columns nullable/defaulted. No v18.
- Latest **v48** (:1232-1243, ai_chats.pinned_at + folder via hasColumn). v47 per-field sync clocks + sync_conflicts. Desktop run electron/db/berean.ts:107-139 (VACUUM INTO backup, keep 3); iOS src/platform/ios/services.ts:63-70.
- notes columns: id, type, title, content, verse_ref ("BOOK.CH[.VS]", idx_notes_verse), color, created_at, updated_at, tags (JSON), imported_at v8, folder_id v10, text_id v12, idiom_* v14-17, status v20, deleted_at v22, icon v23, pinned v25. No link table.
- notes_fts v19 (:434-468) over title+content (no tags). note_folders v10 (:264): id, name, parent_id, created_at.
- System ("locked") folders are virtual: src/lib/noteMovability.ts systemFolderOf (daily, verse, esword, biblegateway); NotesFolderView.tsx:41, :941, :972; mobile notesHomeModel.ts:23.
- **No exclude-from-AI flag.** Plan: v49 `notes.ai_excluded INTEGER DEFAULT 0`, `note_folders.ai_excluded INTEGER DEFAULT 0` (hasColumn guard), inherit down folder tree; system folders via a setting keyed by SystemKey.
- AI note reads to gate: aiLookup.ts :1089, :1511, :1565-1569, :1596.
- Propagation: sync auto (src/platform/sync/entities.ts:11-14, :74-124 PRAGMA discovery; :304-305 note/note_folder); notesService.ts (NoteRow :20, rowToNote :45, update :213, setPinned :406) manual; types src/types/index.ts Note :347, NoteFolder :393; vault export electron/ipc/vault.ts:201-219 (NoteRow :140), import upsert :650-657 leaves unnamed columns; iOS markdown src/lib/noteMarkdownFile.ts:22-50/:71-98 via src/platform/ios/exportNotes.ts.
- Sync transport: iCloud Drive op-log journal (not CloudKit). Mac electron/sync/fsSyncStore.ts:169, host.ts:57, native/mac-icloud; iOS cloudSyncStore.ts + BereanCloudPlugin.swift; engine src/platform/sync/engine.ts; docs/mobile/icloud.md §5 (:177-203).

## Settings
- SQLite `settings` KV (device-local, never synced) via src/platform/services/settingsService.ts.
- Zustand `berean-app-state` localStorage v8 (store :1380, :3406, migrate :3419 identity, partialize :3522, aiLookup* :3544-3551); persistedSettings.test.ts enforces setter keys in partialize.
- Synced: DB entities only (ai_chats, sessions, tabs, workspaces). No profile construct.
- Plan: synced `study_profiles(id, name, config_json, created_at, updated_at, deleted_at)` registered via tableEntity with tombstone (entities.ts:316); active profile id device-local in Zustand.

## Bible DBs (data/*.db symlinks → main)
kjva 20.3M, kjv 8.8M, lxx 25.1M, lxx_brenton 17.1M, strongs_greek 29.4M, strongs_hebrew 8.0M, tske_refs 47.2M, cross_references 20.8M, youtube_seed 196M, youtube_index 7.3M, 16 pseudepigrapha/apostolic DBs 94K-1.6M, data/berean.db 0-byte stub.
- text_tagged `word{H7225}`, `{}` untagged, `{H1697|H1696}` multi. kjva 31,102/36,890 tagged (Apocrypha untagged); lxx_brenton 27,259/28,694 (English + G); lxx.db Greek Rahlfs 30,603/30,603 G-tagged; pseudepigrapha + kjv.db have no text_tagged. **No morphology.**
- lxx.db: no UNIQUE(book,chapter,verse) → repeated verse numbers.
- entries: strongs_id, word (lemma), transliteration, pronunciation, short_def (gloss), full_def, derivation, bdb_def, occurrence_count. Greek 5,523, Hebrew 8,674.
- occurrences: Greek has text_id (kjva 103,076; lxx 372,558); Hebrew no text_id (162,979). App ignores both (stale) and LIKE-scans text_tagged: src/platform/services/lexiconService.ts:81-120.
- books.testament ∈ {OT, NT, Apocrypha, Pseudepigrapha} (src/types/index.ts:404); apostolic fathers labelled Pseudepigrapha; lxx has sort_order + alternate books (JOSA, DANT, TOBS…). No canon/collection field.
- tske_refs(from_book, from_ch, from_vs, heading, is_reciprocal, to_book, to_ch, to_vs, to_vs_end, sort_order, context); cross_references.refs(from_*, to_*, to_vs_end, votes) + meta.
- TEXT_FILES electron/db/bible.ts:10-30 (mirrored src/platform/ios/services.ts:18): 19 texts; `lxx` → lxx_brenton.db; **lxx.db unregistered** (bundled-dbs.txt:3 "orphan"; scripts/build_lxx_greek.py:380 suggests `lxx_greek`); desktop still ships it via *.db glob.

## Secure storage
None (no safeStorage/keytar/Keychain/SecItem). YouTube key is build-time constant (electron/youtube-key.ts). Needs Electron safeStorage (Mac) + new Swift Keychain plugin (iOS).

## Downloads
- BereanDownloadsPlugin.swift (137 lines; TS src/platform/ios/plugins.ts:106-117): start/cancel/remove/list; progress/done{path,sha256,bytes}/error{resumable}/cancelled. Resumable (memory + .resume file). SHA-256 computed after move, reported only; caller compares (transcriptPacks.ts:71-82). Default session (not background). **Not atomic** (moved to final name before verify); no expected-hash input.
- BereanVoicePackPlugin.swift: temp dir → atomic dir move + .manifest.json; UIBackgroundTask grace; no SHA.
- Desktop electron/ipc/ttsModel.ts: fetch + AbortController, .download-tmp → renameSync atomic; no resume/SHA/Range. No generic desktop download manager.

## YouTube
Tables youtube_videos, youtube_sync, youtube_watch_history, youtube_transcripts (v13), youtube_transcript_segments (:345), youtube_transcripts_fts (:357-383), youtube_user (v45). Live: 2,700,386 segments, 11,490 videos. Desktop seed merge electron/db/berean.ts:12-94; iOS youtube_index.db + per-channel packs (youtubeIndexMerge.ts). Search: youtubeService.ts:282-340 (prefix-AND, bm25, 200k cap, LIKE fallback); AI: electron/ipc/youtube.ts:1262-1300 snippet() by rank, called aiLookup.ts:2574. Transcripts local only.
