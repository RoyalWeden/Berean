# Berean iPhone — iCloud Synchronisation Design

Status: **engine implemented and integration-tested with an in-memory transport (Phase 6, 2026-09-21); hardened 2026-09-27 (DATA-SYNC-*, see [sync.md](sync.md) — capture independent of transport, startup reconciliation, concurrent delete-vs-edit → Trash with the edit, on-screen tab held, deterministic daily-note / highlight ids, diagnostics)**; iCloud Drive transports (Electron fs, iOS BereanCloud) and device runs are Phases 7–9/21. Decision record: `decisions.md` D-004, D-006. Code: `src/platform/sync/{types,journal,entities,engine,hlc,fractional,tabFields}.ts`, tests in `src/platform/sync/__tests__/`.
Requirements: R050–R066.

---

## 1. Constraints that shaped the design

| Constraint | Consequence |
|---|---|
| The Mac app is Electron (Node + Chromium), not a native app | Native CloudKit / Core Data + CloudKit are unavailable on the Mac side without a signed native addon. iCloud **Drive** (ubiquity container files) is the only Apple sync surface both processes can use with zero native code on the Mac. |
| No accounts, no backend, no logins | Everything rides on the device's iCloud account. |
| Must work offline and queue changes | File writes land locally at once; the iCloud daemon uploads whenever it can. |
| Conflicts must not lose meaningful work; no blind LWW for note content | Two devices never write the same file (per-device journals), so iCloud-level file conflicts cannot arise; record-level merge is deterministic shared TypeScript; concurrent note edits are preserved as versions. |
| Must survive reinstall / new device | The container holds a complete, replayable history + periodic snapshots. |
| Bible DBs must not sync | Only `berean.db` user entities are journaled. |
| Octarine vault must not sync on iPhone v1 | The vault subsystem is untouched and desktop-only. |

## 2. Topology

```
iCloud ubiquity container  iCloud.com.berean.app        (developer configures the id — see ios-build.md)
└── Documents/
    └── sync/
        └── v1/
            ├── devices/
            │   ├── <deviceId-A>/
            │   │   ├── manifest.json        ← A's latest seq, name, platform, appVersion, schemaVersion,
            │   │   │                          applied: { <deviceId-B>: seqB, … }  (what A has merged)
            │   │   ├── journal-000001.jsonl ← append-only ops (one JSON object per line)
            │   │   ├── journal-000002.jsonl
            │   │   └── snapshot-000002.json ← optional compaction of everything ≤ seq 2
            │   └── <deviceId-B>/ …
            └── README.txt                    ← "Managed by Berean. Do not edit."
```

- **A device writes only inside its own `devices/<deviceId>/` folder.** Reads everything.
- `deviceId` is a UUID generated once per install and stored in `berean.db.sync_state`
  (never in the cloud-shared blob, never in localStorage). A reinstall is a *new* device; the
  old device folder is left in place (harmless, compacted away later — see §8).
- Mac path: `~/Library/Mobile Documents/iCloud~com~berean~app/Documents/sync/v1/`
  (Electron: plain `fs`; the folder is created by iCloud once the iOS app has initialised
  the container in this account, or by the Mac app itself — both are tested in Phase 21; a
  user-chosen fallback folder inside iCloud Drive is supported via Settings for the case
  where the container folder does not appear on the Mac).
- iOS path: `FileManager.default.url(forUbiquityContainerIdentifier:)/Documents/sync/v1/`
  via the `BereanCloud` plugin (`ios/App/BereanNative/Sources/BereanNative/BereanCloudPlugin.swift`,
  JS face `src/platform/ios/cloudSyncStore.ts`): `NSFileCoordinator` for every read/write
  (`.forReplacing` + atomic `Data.write` / `.forDeleting`), `NSMetadataQuery`
  (`NSMetadataQueryUbiquitousDocumentsScope`, path-prefix predicate, 1.5 s batching) → `change`
  events with the changed relative paths, `startDownloadingUbiquitousItem` for a `.name.icloud`
  placeholder or a non-`.current` download status (throttled to once a minute per file, `read`
  answers `downloading: true` meanwhile), paths relative to `sync/v1` and validated (no `..`, no
  absolute, no placeholder names). The container id is the `BEREAN_ICLOUD_CONTAINER` build setting
  (`ios/App/Berean.xcconfig`, overridable in `Signing.xcconfig`), which fills `App.entitlements`,
  the Info.plist key `BereanICloudContainer` (read by the plugin) and — through the
  "Finalize Info.plist" build phase, because build settings do not expand inside plist *keys* —
  the `NSUbiquitousContainers` dictionary that makes the container a visible "Berean" folder in
  iCloud Drive, i.e. the folder the Mac reads.
- Hosts: `electron/sync/host.ts` (main process) and `src/platform/ios/syncHost.ts` (in the
  WebView) run the same `SyncEngine` with the same settings keys (`icloudSyncEnabled`), the same
  device-id rule and the same triggers (start, container change, 60 s interval, foreground /
  wake, push on background / quit); both expose `window.sync` (`src/types/electron.d.ts`
  `SyncAPI`) so Settings → iCloud and the App.tsx refresh hook are shared code.

## 3. Operation log format

One line per op (`.jsonl`); ops are immutable once written. Each journal file is capped at
~256 KB or 500 ops, then a new sequence-numbered file starts (small files download fast and
never need partial reads).

```jsonc
{
  "op": "upsert",                 // "upsert" | "delete" | "adopt" (see §7)
  "seq": 4127,                    // per-device monotonically increasing, contiguous
  "hlc": "1758416400123-0007-a3f9…", // hybrid logical clock: wallMs-counter-deviceId
  "entity": "note",               // entity kind (see §5)
  "id": "8c1c…-uuid",             // stable record id (existing UUIDs are reused)
  "fields": { "title": "…", "content": "…", "updated_at": 1758416400123, … },
  "base": "1758410000000-0001-b2…" // hlc this device last saw for this record (for conflict detection)
}
```

- **HLC** (hybrid logical clock): `max(wallClock, lastHlc+1)` with a counter and the device id
  as tiebreak. Gives a total order that respects causality even with skewed clocks. Implemented
  once in `src/platform/sync/hlc.ts` (pure, tested).
- `fields` carries the full record for `upsert` (records are small: a note is typically < 50 KB;
  images in notes are already base64 in content on desktop — sync inherits that; a size guard
  refuses to journal a single op > 2 MB and surfaces it in the sync status UI).
- `delete` carries `{ deleted_at }` only; it is a tombstone.
- Ops for the same record within a 3-second window are coalesced before flush (so typing in a
  note produces one op per pause, not one per keystroke).

## 4. Merge rules (shared TypeScript: `src/platform/sync/engine.ts` + `entities.ts`)

> **Superseded in part on 2026-09-28 (DATA-SAFE-*).** Record-level LWW (rule 2) and the single-`base`
> divergence test (rule 4) were replaced by per-field merge with lineage (`merge.ts`); deletes vs
> changes follow data-safety.md §3.4. The rules below remain accurate for ordering, tombstones,
> aggregates, fractional order, idempotence and schema versions. Current model:
> [data-safety.md](data-safety.md) §3.

Bookkeeping (migration v44, all device-local): `sync_record_meta(entity, key, hlc, device,
deleted, hash)` holds every synced record's current HLC, the device that produced it, whether it
is a tombstone, and a hash of its synced fields; `sync_applied(device, seq)` records what has been
applied; `sync_outbox` holds captured-but-unpushed ops; `sync_failed` holds ops that threw while
applying (retried up to 5 times, never blocking the rest). No synced table needed new columns.

Applied identically on every device when replaying another device's journal:

1. **Ordering:** ops are applied in HLC order across all devices (tie-break device id, then seq);
   each device's own stream is read in `seq` order and stops at the first file that is not
   available locally yet (never skips a gap).
2. **Record-level LWW by HLC** for `upsert` vs `upsert`: the op with the greater `hlc` wins the
   whole field set it carries. Because full records are carried, this is field-set replacement,
   which matches how the app writes (every save writes the whole row). Capture hashes the synced
   fields, so a bulk re-capture (reorder, empty trash) only journals records that actually changed.
3. **Delete vs upsert:** a tombstone wins over any op with a smaller `hlc` and loses to any op with
   a greater `hlc`. **Notes, since 2026-09-27 (DATA-SYNC-002):** when the delete (Trash or purge)
   and the edit were concurrent (the op's `base` is not the receiver's record HLC), the note ends up
   IN THE TRASH carrying the edited content on every device — neither a silent resurrection nor a
   silent loss; a delete that had seen the edit is an ordinary delete.
   Trash semantics are preserved: `notes.deleted_at` is a *soft* delete field on the record, so
   "move to trash" is an `upsert` with `deleted_at` set, and only "purge" is a `delete` op.
   Sessions/tabs/archived groups keep their tombstone rows; other entities are hard-deleted and the
   tombstone lives in `sync_record_meta`.
4. **Note content conflict preservation (R058):** every note op carries `base` = the record's HLC
   the writer last had. When an incoming note `upsert` arrives and `base` ≠ the local record's
   current HLC, both sides changed the note since they last agreed. Then:
   - the op with the greater `hlc` becomes the note's content (on both devices);
   - if the two contents differ, the losing content is written to `note_versions` with
     `kind = 'conflict'` and the deterministic id `conflict-<losing hlc>` — both devices create
     the identical row, and repeated syncs never duplicate it;
   - the version history shows the conflict copy for one-click restore (badge: Phase 13).
   Adopted pre-sync copies that differ (the same note id imported on two devices via the vault)
   get the same treatment. Nothing is ever discarded. Tested: cases E, H and adoption.
5. **Set-typed entities (sessions ↔ tabs, folders ↔ notes, tags ↔ members):** membership is a
   property of the child (`tabs.session_id`, `notes.folder_id`, `verse_tag_members.tag_id`), so
   moving a tab between sessions is an `upsert` on the tab; deleting a session tombstones the
   session and each of its tabs (explicit ops, so a concurrently *moved* tab with a greater `hlc`
   survives in its new session). Union semantics fall out naturally:
   *Mac: {Tab 1, Tab 2}* + *iPhone: {Tab 1, Tab 3}* → *{Tab 1, Tab 2, Tab 3}* (tested: case K/L).
   **Tag names are unique** (schema constraint): two devices creating "Covenant" while apart both
   keep their tag; the later-created one (by `created_at`, then id) is renamed "Covenant (2)" on
   every device deterministically, and the user can merge them in the Tag Manager (case F).
   **Cascades without events:** the app deletes or rewrites some rows together with a parent
   without emitting events for them (a purged note's versions, a deleted verse tag's members and
   edges, a deleted PDF's highlights and bookmarks, a deleted trail session's nodes and
   connections, a deleted folder's notes moved to the root, a merged trail's re-parented nodes).
   Each entity adapter declares these as `dependents`; after any delete or bulk event the engine
   re-captures the dependents (hash-guarded, so only rows that actually changed produce ops) and
   tombstones every record it had journaled that no longer exists (`captureVanished`). Tested:
   cases Q, R, S.
   **Aggregates:** playlists carry their items; trail sessions carry their paused intervals and
   tag ids (`trail_tag_members` has a composite key and is rewritten per session). A membership
   whose tag has not arrived yet is parked in `sync_state` and re-established when the tag lands.
5b. **Capture is causal within a device:** the HLC and the record snapshot are taken at event
   time (synchronously in the `data:changed` handler), not when the serialised capture runs, so
   an op never carries an HLC that predates a record it references (a session tagged after its
   pause event would otherwise apply before the tag on the other device). A direct event for a
   record whose synced fields did not change but whose op is still unpushed moves that op's HLC
   forward to the event time. Bulk/dependent re-captures use the triggering event's HLC.
   `verse_tag_verse` (the expanded verse index) is derived locally from each member's `ranges`.
   Playlists sync as one record including their items (the app rewrites all items on save).
6. **Ordering fields** use fractional indexing (`order_key` string, `src/platform/sync/fractional.ts`):
   reordering writes only the moved record; concurrent reorders converge deterministically
   (ties broken by id). Applies to `tabs.order_key`, `sessions.order_key`, `verse_tags.order_key`,
   `playlist_items.order_key`.
7. **Idempotence:** every applied `(deviceId, seq)` is recorded in `sync_applied`; replaying a
   journal is a no-op. This is what makes interrupted syncs safe.
8. **Schema migrations across versions:** every manifest carries `schemaVersion`. A device never
   applies ops whose `schemaVersion` is newer than its own; it shows "Update Berean on this device
   to sync" and keeps writing its own journal (the newer device applies older ops through the
   normal migration path because fields are additive — the migration rules in
   `bereanMigrations.ts` are the same on both platforms).

## 5. Entity classification (what syncs, what stays local)

| Entity (table) | Class | Notes |
|---|---|---|
| `notes` | **SYNC** | all columns incl. `deleted_at` (trash), `folder_id`, `pinned`, `status`, `icon`, idiom columns, `text_id`, `verse_ref`, `tags`, `imported_at` |
| `note_versions` | **SYNC** (append-only) | user-created versions + conflict copies |
| `note_folders` | **SYNC** | |
| `highlights` | **SYNC** | |
| `verse_tags`, `verse_tag_members`, `verse_tag_verse` | **SYNC** | `graph_x/graph_y/graph_pinned` sync too (they are user-arranged, small) |
| `tag_edges` | **SYNC** | |
| `sessions` (new table, D-006) | **SYNC** | id, name, icon, order_key, tab_filter, archived_at, created_at, updated_at |
| `tabs` (new table, D-006) | **SYNC** (sync fields) + **LOCAL** (local fields) | see §6 |
| `archived_groups` (new table) | **SYNC** | today `archivedGroups` in localStorage |
| `workspaces` | **SYNC** | `layout_json` is desktop presentation — synced but iOS ignores it; `state_json` (tabs snapshot) applied |
| `playlists`, `playlist_items` | **SYNC** | |
| `ai_chats` | **SYNC** ✔ | small JSON (`ai_chat` entity) |
| `pdfs`, `pdf_highlights`, `pdf_bookmarks` (v46) | **SYNC metadata** ✔ | the PDF bytes are **not** journaled. `pdfs.file_hash` (SHA-256, v46) lets the other device attach the same file on import instead of duplicating the row; until then the platform's `pdf.list/get` report `fileMissing` (desktop: "file not on this device — import it to read" in the picker, and a plain message in the viewer). Bookmarks moved from localStorage to `pdf_bookmarks` (one-time import on first open) |
| `trail_*` (study trail: sessions, nodes, connections, notes, tags) | **SYNC** ✔ except `trail_collapse` (LOCAL) and `trail_embeddings` (LOCAL, derived) | `trail_session` is an aggregate (row + paused intervals + tag ids); `trail_node`, `trail_connection`, `trail_note`, `trail_tag` are records. `resumeSession` was rewritten without `UPDATE … ORDER BY … LIMIT` (needs `SQLITE_ENABLE_UPDATE_DELETE_LIMIT`, absent on iOS/system SQLite) |
| `history` | **LOCAL** | device navigation history (brief: reading position stays local) |
| search history (`recentSearchQueries`, zustand) | **LOCAL** | recent searches of this device |
| `settings` | **LOCAL** | |
| `youtube_videos`, `youtube_sync`, `youtube_transcripts*` | **LOCAL** (cache/seed) | `youtube_user` (v45) ✔ = stars + resume positions; the service writes it alongside `youtube_videos.is_starred` / `youtube_watch_history`, a remote row is mirrored back into them, and a star for a video not fetched yet is applied when the video arrives (`upsertVideos`, `mergeYouTubeSeed`). Stars survive "clear video cache" |
| `note_heading_collapse`, `note_thread_collapse` | **LOCAL** | UI fold state |
| `sync_state`, `sync_applied`, `sync_outbox` (new) | **LOCAL** | sync bookkeeping |
| zustand `berean-app-state` (display prefs, print prefs, TTS prefs, MRU, nav stacks…) | **LOCAL** | settings stay local per brief |
| Bible / lexicon / cross-ref DBs | **never** | bundled content |

## 6. Tab & session field classification

`Session` (store) → `sessions` row:

| Field | Class |
|---|---|
| `id`, `name`, `icon`, `tabFilter` | SYNC |
| order among sessions (today array index) | SYNC (`order_key`) |
| `activeTabId` per space | LOCAL (which tab is on screen is device presentation) |
| `tabs` (membership) | derived from `tabs.session_id` |

`Tab` → `tabs` row: `id, session_id, space_id, type, title, is_pinned, order_key, origin_tab_id,
origin_space_id, sync_state_json, local_state_json, created_at, updated_at, deleted_at`.
The per-type `state` object is split into two JSON columns by the rules below (the store still
sees one merged `state`; the split happens in `tabsService`):

| Tab type | SYNC (`sync_state_json`) | LOCAL (`local_state_json`) | EPHEMERAL (never persisted) |
|---|---|---|---|
| bible | `bookId, chapter, endChapter, verse, translation, showStrongs, compareMode, compareColumns[].{textId,bookId,chapter}, compareSyncScroll, hiddenAnnotations, rightPanelTab, rightPanelNoteId, rightPanelLexiconEntry, rightPanelVerseFilter, rightPanelSlotBTabs, rightPanelSlotB, rightPanelNoteIdB, rightPanelLexiconEntryB, rightPanelVerseFilterB, searchMode, scriptureSearchQuery, scriptureLayout, searchTextId, searchWordMode, searchTestamentFilter, searchBookFilter, searchSortMode, searchTagFilter, searchTagFilterAll, noteBack, scriptureBack, searchBack` | `scrollPosition, compareColumns[].scrollPos, rightPanelOpen, rightPanelWidth, bottomPanelHeight, rightPanelNoteCursor, rightPanelNoteFocused, rightPanelExpandAll(B), rightPanelScrollTop(B), rightPanelNoteCursorB, rightPanelNoteFocusedB, searchScrollTop, searchScrollAnchor` | `targetVerse, endVerse, targetVerseQuery, targetVerseWordMode, targetVerseStrongsWords, targetVerseStrongsExtraWords` |
| note | `noteId, isNew, verseRef, homeView.{noteSearch, noteSearchWordMode, noteFilter, statusFilter, noteSort, viewMode, expandAll}` | `scrollTop, cursorPos, listScrollTop, continuousDailyDate, homeView.{previewNoteId, previewFolderId}` | — |
| lexicon | `strongsNum, searchQuery, searchLang, lexHistory` | `scrollTop, searchScrollTop` | — |
| youtube | `videoId, playlistId, url, youtubeLayout, panelA, panelB` | `scrollTop` | — |
| search | `query` | `scrollTop`, `results` (re-run on open; results are derived) | — |
| pdf | `pdfId, title, page` | `scrollTop` | — |
| tags | `selectedTagId` | — | — |

`Tab.isPinned`, `originTabId/originSpaceId` → SYNC. `tabMRUList`, `tabNavStacks`,
`tabLastAccessed`, `selectedVersesByTab`, `scrollByTab` → LOCAL (store, as today).

Rationale: a tab's *identity and where it points* is the thing the user expects to find on the
other device; *how far it was scrolled and how wide a pane was* is device presentation.

## 7. Bootstrap, adoption and new devices

- **First enable on a device with existing data (R063):** every existing row of every SYNC entity
  is journaled once as an `adopt` op (`hlc` derived from the row's own `updated_at`, so an older
  desktop note never overrides a newer iPhone edit of the same id — ids are UUIDs already, so two
  devices adopting the same note is impossible unless it was synced earlier by another means).
  Tabs/sessions currently in localStorage are migrated into the new SQLite tables first (Phase 5),
  then adopted.
- **Reinstall safety (DATA-SAFE, verified by tests):** a reinstall starts with an empty database:
  a new device id and no sync bookkeeping, so it cannot produce a single deletion — it only
  receives. A restored or copied database forks its device id (data-safety.md T7/T8); another
  iCloud account holds sync (T9).
- **New device / reinstall:** reads every device's latest snapshot (if any) then journals after it;
  applies in HLC order. Until the first full pass completes the UI shows "Restoring from iCloud…"
  with progress, but the app is usable (Bible reading never waits on sync).
- **iCloud unavailable / signed out:** `BereanCloud.status()` reports it; the app keeps journaling
  to a local outbox (`sync_outbox`) and flushes when the container becomes available. Settings
  show the state plainly. Since 2026-09-27 this is true even when iCloud is unavailable at LAUNCH
  (the engine and its capture start regardless; earlier builds only started when iCloud was
  reachable), and a watermark reconciliation at every start re-captures anything missed.

## 8. Compaction — implemented (`engine.compact` / `pruneCompacted` / `applySnapshot`)

When a device's *live* journal (files newer than its last snapshot) exceeds 5 MB or 5,000 ops
(`COMPACT_AFTER_BYTES` / `COMPACT_AFTER_OPS` in `journal.ts`; checked after every push), it
writes `snapshot-<seq>.json` — `{ format, device, seq, schema, writtenAt, records[] }` where
`records` is the current state of every record this device is the **current writer of**
(`sync_record_meta.device = me`): upserts with the HLC each record carries, and tombstones. The
manifest gains `snapshot: { name, seq, records, bytes }`; the previous snapshot file is removed
once the new one is written.

Journal files ≤ `snapshot.seq` are deleted **only after** every other known device's manifest
reports `applied[thisDevice] ≥ snapshot.seq`, or that device has been silent for 90 days
(`COMPACT_SILENT_MS` — it will bootstrap from the snapshot). "Known" = has a folder in the
container, which every transport creates the first time the device comes online, so a device that
has only pulled so far still blocks pruning. A device never touches another device's folder.

**Bootstrap:** when a device's cursor for another device is below that device's `snapshot.seq`
and the journal file containing `cursor + 1` is no longer listed (pruned, or the reader is new),
the reader applies the snapshot's records through the normal merge rules (LWW by each record's
own HLC, tombstones, note conflict copies) without per-record `sync_applied` rows, then records
`(device, snapshot.seq)` once and continues with the journal from `snapshot.seq + 1`. The pass
is idempotent, so an interruption simply re-runs it. Tested: cases V (thresholds, write, guarded
prune, continued journal), W (new device bootstraps from snapshot + journal; its own newer data
untouched; tombstone honoured; re-run is a no-op), X (silent device unblocks pruning and later
bootstraps). Settings → iCloud shows the journal size and the last compaction point.

## 9. Failure handling

| Failure | Behaviour |
|---|---|
| Partial file (interrupted upload) | `.jsonl` parsed line-by-line; a trailing partial line is ignored and retried on the next pass; `manifest.json` is written atomically (temp + rename / `NSFileCoordinator` coordinated write) |
| Missing intermediate journal (evicted / not downloaded) | Reader stops at the gap for that device (contiguous `seq` requirement), requests download (`startDownloadingUbiquitousItem` / `brctl download`), retries |
| Clock skew | HLC tolerates it; a wall clock > 1 h ahead of the latest seen HLC is clamped and logged |
| Corrupt op line | Skipped, counted, surfaced in sync status ("2 unreadable changes from MacBook") — never fatal |
| Schema newer than mine | See §4.8 |
| Storage full | Journal write fails → outbox retains ops; status shows error |

## 10. Security & privacy

- Data is in the user's private iCloud container (end-to-end protection as configured by the
  user's Apple account; Advanced Data Protection applies to iCloud Drive).
- No third party ever sees the journal. No analytics.
- File protection class on iOS: `NSFileProtectionCompleteUntilFirstUserAuthentication` for
  `berean.db` (so background sync can run after unlock-once).

## 11. Testing plan (see `testing.md` §iCloud)

- **Unit:** HLC, fractional index, merge rules (every row of the conflict matrix), coalescing,
  journal file rotation, idempotent apply, adoption.
- **Integration (vitest):** two `SyncEngine` instances over one temp folder (`fs` store) with an
  in-memory adapter, driven through the real services: create/edit/delete/reorder on both,
  offline (store paused) then reconnect, simultaneous edits, delete-vs-modify, session membership
  divergence — assertions on the resulting rows on both sides.
- **Device:** the R065 matrix on the developer's Mac + iPhone, recorded with dates.

## 12. Open items for the developer

- Confirm the ubiquity container id (`iCloud.com.berean.app` assumed from the existing
  `appId`).
- Confirm that D-004 (iCloud Drive journals) is acceptable versus native CloudKit + CloudKit JS
  (the trade-offs are in `decisions.md`).
