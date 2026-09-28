# Berean data architecture — inventory, ownership, classification

Audit of 2026-09-27 (ids `DATA-*`, ledger [testing-backlog-2026-09-27b.md](testing-backlog-2026-09-27b.md)).
Everything here was checked against the code, not only the design docs. **Merge and safety model since 2026-09-28: [data-safety.md](data-safety.md)** — every synced record merges per field (the "Conflictable" column below: LWW now means per-field, with the other value kept). Sync design and merge rules:
[icloud.md](icloud.md) · operational summary: [sync.md](sync.md) · schema: [database.md](database.md).

## 1. Where data lives (every persistent store in the repo)

| Store | Location | Written by | Notes |
|---|---|---|---|
| **berean.db** (user data) | Mac: `userData/berean.db` (better-sqlite3). iPhone: `Application Support/Berean/berean.db` (BereanSQLite plugin, `appsupport:`), WAL, `foreign_keys = ON`, busy timeout 5 s, in device backups | the shared services (`src/platform/services/*`) only | the **authoritative local store** for all user data; one migration history for both apps (`bereanMigrations.ts`, v46) |
| Bible / lexicon / cross-ref DBs (KJV + Apocrypha, LXX, 1 Enoch, Jubilees, the other library texts, Strong's H/G, TSK) | app bundle (`bundle:` → opened **read-only**) | never | bundled, offline, never synced; user data refers to them by `text_id` + book / chapter / verse or Strong's number |
| iCloud Drive container `iCloud.com.berean.app/Documents/sync/v1` | ubiquity container (iPhone via BereanCloud + NSFileCoordinator; Mac via fs) | the sync engine only (per-device folders) | journals + manifests + snapshots — the sync TRANSPORT, never read by the UI |
| App Group `group.com.berean.app/inbox` | shared container | Share Extension (writes) · main app (reads, acks) | only the "Open in Berean" inbox — `item-<id>.json` + shared PDF files |
| `localStorage['berean-app-state']` (zustand persist) | WebView / Chromium storage | the store | device UI state & preferences (see §3) — never synced |
| other `localStorage` keys | same | UI | `berean-crash` (crash marker), `berean:embedBlocked`, `berean-viewer-font-scale`, `berean_search_diag` (dev flag) — local conveniences |
| Application Support `downloads/`, `tts-cache/`, `tts-model/`, `pdfs/` | device | downloads / TTS / PDF import | caches excluded from backup; PDF bytes are local (their metadata syncs, matched by SHA-256) |
| UserDefaults | — | Capacitor internals only | no Berean data |
| Keychain · NSUbiquitousKeyValueStore · CloudKit | — | — | **not used** |

## 2. Ownership — one source of truth per layer

```
UI (React)  →  zustand store (in-memory cache + device UI state)
              →  window.<namespace> bridge (IPC on Mac / in-process on iPhone)
                →  shared services  →  berean.db   ← AUTHORITATIVE for user data
                                           │ data:changed events
                                           ▼
                                   sync engine (capture → sync_outbox in berean.db)
                                           ▼
                                   SyncStore (transport) → iCloud Drive journals
remote journals → engine.pull → merge rules → berean.db → data:changed(remote) → UI refresh
```

- The database is authoritative. The store holds a cache (tabs mirrored to the `sessions` / `tabs`
  tables by `tabPersistenceRuntime`) plus device-only UI state.
- The iCloud journals are only a transport. Nothing reads them except the engine, and the app never
  waits on them.
- **Notes while being edited:** the ProseMirror editor owns the live document, autosave writes it to
  berean.db, and remote changes follow the editor's external-update policy
  ([notes-editor-ios.md](notes-editor-ios.md) §5): they are never applied while the user is typing.
- **Canonical note content** is Markdown (`notes.content`, produced by the editor's serializer). It
  is the only synced representation; HTML / ProseMirror JSON are derived at render time.

## 3. Classification matrix

LOCAL = this device only · SYNC = iCloud journal · BUNDLED = shipped read-only · TRANSIENT = memory only.

| Data | Local store | Sync | Mac | iPhone | Conflictable | Migrated | Notes |
|---|---|---|---|---|---|---|---|
| Notes (general, verse, daily, idiom) | `notes` | ✔ | ✔ | ✔ | ✔ conflict copies | ✔ | stable UUID ids; daily notes `daily-YYYY-MM-DD` (DATA-DAILY-001) |
| Note versions (history + conflict copies) | `note_versions` | ✔ append-only | ✔ | ✔ | — | ✔ | conflict copy ids are deterministic (`conflict-<hlc>`) |
| Note folders (+ nesting) | `note_folders.parent_id` | ✔ | ✔ | ✔ | LWW | ✔ | membership is `notes.folder_id` (child-side) |
| Highlights | `highlights` | ✔ | ✔ | ✔ | LWW (colour) | ✔ | id = the range (DATA-HL-001); references `text_id`/book/chapter/verse(/words) |
| Verse tags · members · tag graph edges | `verse_tags`, `verse_tag_members`, `tag_edges` | ✔ | ✔ | ✔ | same-name tags → "Name (2)" | ✔ | `verse_tag_verse` is derived locally |
| Sessions (workspaces of tabs) · tabs | `sessions`, `tabs.sync_state_json` | ✔ | ✔ | ✔ | union + fractional order | ✔ | the on-screen tab holds remote changes until left (DATA-TAB-001) |
| Tab local view (scroll, cursor, pane sizes) | `tabs.local_state_json`, `session_local_state` | LOCAL | ✔ | ✔ | — | ✔ | reading scroll position never syncs |
| Tab history (‹ › stacks), MRU | zustand | LOCAL | ✔ | ✔ | — | — | duplicated tabs copy then diverge independently |
| Saved workspaces (layout + tabs snapshot) | `workspaces` | ✔ | ✔ | ✔ | LWW | ✔ | desktop `layout_json` is ignored on iPhone |
| Archived tab groups | `archived_groups` | ✔ | ✔ | ✔ | tombstones | ✔ | |
| Calendar tab (month, selected) | tab sync fields | ✔ (as tab) | ✔ | ✔ | — | — | the calendar's dots come from `notes` (no separate store) |
| Playlists · AI chats · PDF metadata / highlights / bookmarks · YouTube stars & resume · study trail | their tables | ✔ | ✔ | ✔ | LWW | ✔ | PDF bytes local; `trail_collapse`, `trail_embeddings` LOCAL |
| Navigation history (History tab) | `history` | LOCAL | ✔ | ✔ | — | ✔ | where this device went |
| Search history (recent searches) | zustand `recentSearchQueries` | LOCAL | ✔ | ✔ | — | — | shared by every search entry point on the device |
| Settings / display prefs / themes / TTS / print | `settings` table + zustand | LOCAL | ✔ | ✔ | — | ✔ | per-device by design (screen sizes, fonts, keyboards differ) |
| Note fold state | `note_heading_collapse`, `note_thread_collapse` | LOCAL | ✔ | ✔ | — | ✔ | |
| Sync bookkeeping | `sync_state`, `sync_outbox`, `sync_record_meta`, `sync_applied`, `sync_failed` | LOCAL | ✔ | ✔ | — | ✔ v44 | the outbox survives restart / reboot |
| Bible & library texts, Strong's, cross refs | bundled DBs | BUNDLED | ✔ | ✔ | — | — | never journaled (not in the entity registry) |
| Sheet detent, keyboard, open menus, selections, search-sheet state | memory | TRANSIENT | | | | | |

## 4. Journeys traced (what happens, end to end)

1. **Create note → type → close → restart:** editor → autosave (500 ms debounce; flushed on
   pagehide / backgrounding / unmount) → `notes.update` → berean.db → a `data:changed` event → the
   engine captures it into `sync_outbox` (SQLite). On restart the note loads from berean.db. An op
   whose capture was cut off by a kill is recovered by the startup reconciliation (DATA-SYNC-001).
2. **Offline → edit → background → terminate → reopen → reconnect:** every step is local. The
   outbox persists; push retries on start, foreground and every 60 s; iCloud Drive uploads when it can.
3. **Device A creates → B receives → B edits → A receives:** journals plus the container watch
   (NSMetadataQuery / fs.watch) and the 60 s interval → pull → hybrid logical clock (HLC) ordered
   apply → UI refresh (`sync.onApplied` → tokens). If the note is open and being typed in on the
   receiving device, the external change is kept as a version, not applied under the cursor.
4. **Both edit the same note offline:** changes to different fields both survive; if both changed
   the text, the later one is current and the other text is a conflict copy in Versions, identical
   on every device (data-safety.md §3).
5. **Folder → move note → sync:** the folder row, `parent_id` and `notes.folder_id` are
   independent records. Out-of-order arrival is harmless (a note may briefly point to a folder not
   yet received; the folder list shows it when it lands).
6. **Highlight / 7. tag → sync:** records keyed by id; a same-range highlight converges to one.
8. **Workspace / tabs → close → reopen → sync:** tabs are mirrored to SQLite (debounced, flushed
   on backgrounding), hydrated at start; a remote change to the on-screen tab waits (DATA-TAB-001).
9. **Calendar day → daily note → sync:** the same `daily-<date>` id on every device → one note.
10. **Note in the Scripture sheet → type → + menu → option → continue:** the + menu never
    unmounts the editor or takes focus; it is laid out above the keyboard (UI-MENU-001);
    autosave → sync as in 1.
