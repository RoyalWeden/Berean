# 05 — iCloud and Synchronization Audit

> **Baseline note.** Investigated at `807c2d9`. The final baseline is `d97fb05`. The only code changes between them are PRs #9, #10 and #11, listed in `01-REPOSITORY-STABILIZATION.md`: fixes for sync defects D1-D4, note table-cell formatting, and audio cache keys. Anything below describing those defects as present is corrected where noted.

Audit of commit `807c2d974b795f95f4c05b8ae4b6796c273b572c`, 2026-11-05. Read-only on the code; no CloudKit or iCloud data was changed. This document proposes no change to production schemas and does not recommend implementing anything now.

**Status labels:** VERIFIED (read in code, seen on disk, or reproduced in a harness), INFERRED, UNVERIFIED, BLOCKED.

**How the harness runs were done.** Scratch scripts outside the repo bundled the real `engine.ts`, services and migrations with the repo's `Sim` harness, over the in-memory transport. They prove engine logic. They do not prove real iCloud timing. On-disk facts come from metadata-only listings of the iCloud folders: names, counts and flags. No journal file was opened.

---

## 1. What it is

**It is not CloudKit. It is iCloud Documents: a hand-built, per-device, append-only journal of JSON files in a ubiquity container, with iCloud Drive as a dumb file transport.** VERIFIED:

- `App.entitlements`, `build/entitlements.mas.plist` and `.mas.dev.plist` declare `com.apple.developer.icloud-services = CloudDocuments` only.
- No `CKContainer`, `CKRecord` or `NSUbiquitousKeyValueStore` is used in the app sources. The comment in `entitlements.mas.plist` says "iCloud Documents — not CloudKit".
- `BereanCloudPlugin.swift` uses `url(forUbiquityContainerIdentifier:)`, `NSFileCoordinator` and `NSMetadataQuery`.
- On disk: `~/Library/Mobile Documents/iCloud~com~berean~app/Documents/sync/v1/` contains `berean-identity.json`, `README.txt` and `devices/`.

**The merge logic is entirely Berean's**, in TypeScript: hybrid logical clocks, lineage, per-field merge, tombstones, compaction. iCloud provides no conflict resolution or transactions, and no ordering between files.

```
UI → services → berean.db → data:changed → SyncEngine.capture → sync_outbox
sync_outbox → journal-*.jsonl + manifest.json in devices/<id>/ → iCloud daemon
other device: NSMetadataQuery / fs.watch / 60 s timer → read manifests + journals
  → sort by HLC → per-op transaction (merge + sync_applied) → data:changed(remote) → UI
```

| Layer | Mac | iPhone |
|---|---|---|
| Engine | `src/platform/sync/engine.ts` | same file |
| Lifecycle | `electron/sync/host.ts` + `hostCore.ts` | `src/platform/ios/syncHost.ts` + `hostCore.ts` |
| Store | `electron/sync/fsSyncStore.ts`: plain `fs`, temp + rename | `src/platform/ios/cloudSyncStore.ts` → `BereanCloudPlugin.swift` |
| Evicted files | `brctl download` (DMG); `startDownloadingUbiquitousItemAtURL` through `native/mac-icloud/berean_icloud.m` (MAS) | `startDownloadingUbiquitousItem` |
| Change signal | recursive `fs.watch`, 1.5 s debounce | `NSMetadataQuery`, foreground only |

`native/mac-icloud/berean_icloud.m` does only two things: return the container URL, which is what opens the container to the sandbox, and request a download. It contains no sync logic. It loads only when `process.mas` is true.

---

## 2. Summary of defects found in current code

These existed at `807c2d9`. All were found by reading; those marked "reproduced" also ran. **D1, D2, D3 and D4 are fixed at `d97fb05` (PR #9).** D1-D3 have regression tests in `src/platform/sync/__tests__/knownLoss.integration.test.ts`. D4's fix emits a change event from the vault import paths; it has no end-to-end test, because that path needs Electron. D5, D6 and D7 remain open.

| ID | Defect | Location | Severity | Status |
|---|---|---|---|---|
| **D1** | An edit coalesced into an outbox row while a push is in flight is deleted unpublished. The other devices stay on the old text forever, status says "synced", and the weekly full reconcile does not repair it. | `engine.ts:552` (UPDATE in place), `:705` (rows read), `:729` (awaits), `:733` (`DELETE … seq <= last`) | **High** | Reproduced |
| **D2** | Snapshot bootstrap applies `tag_edge` before `verse_tag`, the FK fails, the failure is logged and then skipped for good. Fresh devices have no tag edges, and status says "synced". | `engine.ts:791` (`ORDER BY entity, key`), `:899-904` | Medium (production has 0 edges today) | Reproduced |
| **D3** | A failed op can be lost for good. `applied` publishes `MAX(seq)`, which passes the failed op, so the author prunes the file. Retry is then impossible. This contradicts "parked, never dropped". | `engine.ts:756`, `:867`, `:871`; `sync.md` | Medium | Reproduced |
| **D4** | Raw vault writes emit no event. A Mac-side external edit (Octarine) is not captured, and the next remote edit fast-forwards over it with no conflict copy and no version. | `electron/ipc/vault.ts:817`, `:905`; `engine.ts:1091` | **High** for vault users | Engine half reproduced with the same SQL; Electron path read, not run |
| **D5** | `vault:reconcile` trusts file mtime. After a forced Export All, a stale file can have a newer mtime than a later-arriving remote edit (`updated_at` is the edit's own time), and it then overwrites the database and publishes as new. | `vault.ts:884-905`, `:1064-1070` | Medium | INFERRED |
| **D6** | `study_profile` and `ai_saved_context` are in the registry but not `SYNCED_ENTITY_KINDS`. Changes are dropped at capture and only go out through the next launch's reconcile. | `entities.ts:358-363`, `engine.ts:364` | Low | Reproduced |
| **D7** | The Mac has no account check. `accountIdentity` is not passed, so `sync_state` has no `account_identity` (confirmed on the production copy). Only `checkContainer` protects it, and that does nothing while `ownSeq` is 0. | `electron/sync/host.ts:147`, `engine.ts:684` | Medium | VERIFIED by reading |

D1 needs no unusual conditions. iPhone autosave debounces at 500 ms (`useNoteAutosave.ts`), and a sync can begin from the 60 s timer or a remote notification in the middle of typing. The window is the duration of the file writes, and on iPhone each one goes through `NSFileCoordinator` and the bridge.

Harness output for D1: `mac: 'v3-typed-during-upload', phone: 'v2', outbox: 0`, and after a forced full reconcile and an 8-day relaunch the phone still had `v2` with status `synced`.

Why repair never happens: the coalesce already advanced `sync_record_meta.hash`, so every later comparison says "unchanged". A later edit of the same note heals it, carrying the latest content. Only then does the other device catch up.

Harness output for D4: Mac `phone-edit`, phone `phone-edit`, zero versions, zero conflicts. The Octarine text was gone from the database, and the vault file gets overwritten by the next export.

---

## 3. Data synced and data kept local

The authoritative list is `createEntityRegistry` (`entities.ts:315`). Anything else stays on the device. VERIFIED.

**Synced (24 kinds).** `note`, `note_folder`, `note_version`, `highlight`, `verse_tag`, `verse_tag_member`, `tag_edge`, `workspace`, `session`, `tab`, `archived_group`, `playlist` (with items), `ai_chat`, `study_profile`, `ai_saved_context`, `pdf`, `pdf_highlight`, `pdf_bookmark`, `youtube_user`, `trail_session` (with paused intervals and tag ids), `trail_node`, `trail_connection`, `trail_note`, `trail_tag`.

**Intentionally local**

| Data | Reason |
|---|---|
| `settings` (all keys, including `vaultPath`, `icloudSyncEnabled`) | Per device |
| `history` | Local navigation |
| `note_heading_collapse`, `note_thread_collapse`, `trail_collapse` | Presentation |
| `session_local_state`, `tabs.local_state_json` | Active tab, scroll, panels (`tabFields.ts`) |
| `trail_embeddings`, `verse_tag_verse` | Derived |
| `youtube_videos`, `youtube_watch_history`, transcripts | Cache; only `youtube_user` syncs |
| Sync bookkeeping | Device identity |
| **PDF bytes** | Metadata only. Another device shows `fileMissing` until the same file is imported, matched by `file_hash`. |
| localStorage, API keys, voice packs, backups | Not synced |

Note images sync, as base64 inside `notes.content` and `note_versions.content`. There is no separate asset transport. The largest production note is about 9.1 M characters, so one op can be far beyond the 256 KB chunk target (a single op is never split, `journal.ts`). Full-text snapshots grow accordingly.

---

## 4. Record identity and file format

**Record key:** `(entity, key)`, where `key` is the row's primary key.

- Mostly UUIDs.
- Deliberately deterministic ids exist and collide across devices by design: `daily-<date>` (`notesService.ts:173`), `conflict-<hlc>` (`engine.ts:1271`), the session id `'default'` (`src/store/index.ts:1300`), and vault-derived `vaultPathNoteId`.
- `adoptExisting`'s comment at `engine.ts:620`, saying the same record can exist on two devices only if it synced before, is not true for those ids. The merge rules handle them (`preferNonEmpty`, DATA-DAILY-001).

**Device id:** 16 hex characters, random, stored in `sync_state.device_id`. It must contain no `-` (`hlc.ts` throws). FsSyncStore requires `[A-Za-z0-9]+`.

**HLC:** `<13-digit ms>-<4-hex counter>-<deviceId>`, compared as plain strings (`hlc.ts`).

**Layout** (`<container>/Documents/sync/v1/`). VERIFIED in code and on disk:

```
berean-identity.json        {"identity":"production"}  — written by Mac FsSyncStore only
README.txt
devices/<deviceId>/
  manifest.json             device, name, platform, appVersion, schema, seq, files[], applied{}, snapshot?, updatedAt
  journal-000000001-000000500.jsonl     one SyncOp per line, ≤500 ops or 256 KB target
  snapshot-000012345.json   format, device, seq, schema, writtenAt, records[]
```

**SyncOp fields:** `id, seq, hlc, device, entity, key, op, fields?, base?, schema, fh?, lin?`. `SYNC_FORMAT_VERSION = 1`. Each device writes only its own folder.

**Observed scale.** Metadata only, VERIFIED:

| Container | Devices | File counts per device |
|---|---|---|
| Production | 3 | 7 files; 4,554 files (4,552 journals, 1 snapshot); 338 files |
| Dev | 4 | 6, 13, 34 and 82 files |

No `.icloud` placeholders exist on this Mac. Of the production files, 4,896 listing lines carry the `dataless` flag, which is effectively all of them. See §12 point 1.

**Container visibility.** `NSUbiquitousContainerIsDocumentScopePublic = true` with a `Berean` name in `ios/App/App/Info.plist`. The `Documents` folder is therefore user-visible in Files and iCloud Drive, and a user can delete journals by hand. `README.txt` is the only protection. VERIFIED.

---

## 5. Lifecycle

**Enabling.** `icloudSyncEnabled` in `settings`; off by default. `sync:enable` requires the container root to exist. On Mac, the message says to open Berean on iPhone once so that iCloud creates it. The DMG has no entitlement, so it cannot create it.

**Start sequence** (both hosts): `checkDatabase` → `resolveDeviceId` → `SyncEngine.open` → `engine.start()` → `adoptExisting` → `republishIfRequested` → `reconcileLocal` → `requestSync('start')`.

**Triggers:** local change (1.5 s debounce), watcher event, foreground, wake, `online`, 60 s fallback. Background and quit push only. A pass is `push → pull → push`, serialized, with a dirty flag for requests that arrive during a pass.

**Capture.** `data:changed` → HLC and record read at event time → serial capture queue → `sync_outbox` plus `sync_record_meta` in one transaction. The database write and the capture are **not** in one transaction, which is the reason `reconcileLocal` exists.

**Pull.** Lists devices, skips own unless replaying, reads manifests, refuses `manifest.schema > own schema`, reads journals in `seq` order, stops at the first missing or undownloaded file, sorts all ops by HLC, applies each one in its own transaction with its `sync_applied` row.

---

## 6. Conflict resolution

`merge.ts` is pure and well tested. VERIFIED by reading; `merge.test.ts` and `chaos.fuzz.test.ts` exist.

| Relation | Rule |
|---|---|
| Local contains remote HLC | Ignore |
| Remote descends from local | Fast-forward |
| Concurrent | Field by field |

**Concurrent field rules.** Equal: keep. One side has seen the other's clock: the later wins. Both changed: higher clock wins, and the other value is preserved.

- Note `content` and `title`: a conflict copy in `note_versions` (`conflict-<hlc>`, journaled).
- Everything else: a `sync_conflicts` row.
- `preferNonEmpty` for note content and title; empty never beats text.
- `unionById` for `ai_chats.messages`. An element deleted on one side comes back.
- Bookkeeping fields (`*_at`, `order_key`, `hash`) resolve but are not reported.

**Deletes against edits.** A note: Trash, holding the surviving side's text, at the later time, published by the resolver. Other records: the delete wins, and the lost values go to `sync_conflicts`. A recreated record descends from the tombstone and applies normally.

**Special cases.** Same-name `verse_tags` get "Name (2)". `trail_tag_members` waiting for their tag are parked in `sync_state`.

**Limits**

- Lineage is sent with only the newest 64 entries (`LINEAGE_SEND`). Every local capture adds one, including coalesced ones. A device away while a note was saved more than 64 times no longer sees its version in the incoming lineage, so a plain fast-forward becomes "concurrent". The newer text still wins, at the cost of a spurious conflict record. INFERRED.
- `sync_conflicts` is durable but has no recovery UI beyond a count. Production has 26 rows. It was not checked whether a user can reach their values.
- `engine.ts`'s header (lines 21-30) still describes record-level last-writer-wins, which v47 replaced. The code is right and the comment is stale.

---

## 7. Offline, retries, recovery

| Situation | Behaviour | Status |
|---|---|---|
| Offline or iCloud unavailable | Capture continues; outbox grows; push and pull return early | VERIFIED |
| Crash after journal write, before outbox clear | Next push reuses the seq and overwrites the unlisted file. Safe, because the manifest had not yet listed it. | VERIFIED by reading |
| Crash before manifest write | Repaired on next push (`engine.ts:716`) | VERIFIED |
| Kill between DB write and capture | Reconcile, by watermark minus 10 min | VERIFIED |
| Write that does not bump a timestamp | Weekly full hash compare (`FULL_RECONCILE_EVERY_MS`) | VERIFIED |
| Op fails to apply | `sync_failed`, retried up to 5 times, re-armed on new app version. See D3. | Reproduced |
| Partial journal line | Skipped and retried; `truncated` stops the stream | VERIFIED |
| Unreadable line | Counted, `attention` state | VERIFIED |
| File missing or not downloaded | Stream stops at the gap | VERIFIED; but see below |
| Damaged database | `hold: database`; no push, pull or inferred deletes | VERIFIED |
| Mass missing rows | Quarantine at more than max(20, 25%) per entity, or empty table with at least 3 known records | VERIFIED |
| Restored or copied DB | Fork to a new device id, republish own records | VERIFIED in tests; depends on birthtime |
| Clock skew | Future remote HLC above 1 h does not advance local clock. Local `tick` follows the wall clock. | VERIFIED |

**A gap is skipped when anything is failing.** `engine.ts:957`: `if (f.seqFrom > expected && !failed.size) break`. With a non-empty `sync_failed`, the loop continues past a gap, and `expected` moves over it. Manifest file lists are normally contiguous, so this should rarely matter. It is the same family as D3. INFERRED, not reproduced.

**`status` can overstate success.** `synced` means nothing is known to be waiting. D1 and D2 both end in `synced`. FsSyncStore has no `pendingUploads`, so on Mac `synced` also says nothing about whether iCloud has uploaded the files. VERIFIED.

---

## 8. Account changes

**iPhone.** `identityHash` is a SHA-256 of the archived `ubiquityIdentityToken`, stored as `account_identity`. A different value produces `hold: account`, with no traffic. `checkAccount` runs on foreground; `syncRoot` re-resolves on token change. Resolution choices: switch back, or `republish` (new device id, every record published into the new account, nothing deleted). VERIFIED by reading.

**Whether the hash is stable** across relaunch and OS update on real hardware is UNVERIFIED. Archiving an opaque token is not a documented identity API. An unstable value would raise false `account` holds, which is safe but disruptive.

**Mac.** See D7. `checkContainer` compares what is visible: if own manifest and every known device are missing, `hold: container`. A Mac that has never pushed has nothing to compare. Signing out on Mac leaves the path missing or stale, which produces `unavailable`. Real behaviour of the local copy after sign-out is UNVERIFIED.

---

## 9. Initial sync and new devices

- **Existing data, first enable:** `adoptExisting` turns every live row into an upsert with an HLC from its own timestamp, then runs once (`adopted` flag).
- **Fresh install:** Empty database, nothing to infer. It pulls each device's journal from the start, or bootstraps from its snapshot if the journal no longer reaches its cursor.
- **Snapshot content:** Each device's snapshot holds only records it is the current publisher of. **A new device therefore needs every device's folder.** Losing one device's folder loses the records whose latest publisher it was, unless a survivor holds them, and it would still publish them only on a change. INFERRED.
- **Compaction:** Above 5,000 ops or 5 MB of live journal. Journals are pruned only when each other device has applied past the snapshot, or has been silent for 90 days.
- **Snapshot cost:** `publishedVersions` reads every own journal file and the old snapshot. With 4,552 dataless files, this forces a full download into memory. Not measured.
- **Progress UI** exists (DATA-UX-010) with `firstSync`.

---

## 10. Deletions and tombstones

Three models exist. A native port must keep all of them.

| Model | Tables | Mechanism |
|---|---|---|
| Hard delete + `sync_record_meta.deleted = 1` | Most tables, including purged notes | Row gone; tombstone only in meta |
| Soft tombstone column | `sessions`, `tabs`, `archived_groups`, `study_profiles`, `ai_saved_contexts` | `deleted_at` set; record reads as `deleted` |
| Trash | `notes.deleted_at` | **A normal synced field**, not a tombstone |

- **Tombstones are never garbage-collected.** They stay in `sync_record_meta` and in snapshots forever. That is what prevents resurrection, and it must survive migration.
- **Cascades.** Dependents are re-captured after a delete or bulk change (`dependents` in the registry).
- **Inferred deletion.** `captureVanished` can infer a delete from a missing row, guarded by the quarantine.
- **Trash expiry runs only on the Mac** (`purgeExpiredTrash`, `vault.ts:1421`). It is a raw delete with no event, so it is picked up as a vanished row at the next reconcile, and a large batch could trigger a quarantine. iPhone does not auto-purge. VERIFIED by grep; the quarantine consequence is INFERRED.
- **PDF delete.** A remote delete removes the row only. The local file is unlinked only by the local `pdf:delete` handler, so bytes are orphaned on other devices. Not harmful, but storage is lost. INFERRED.

---

## 11. Tabs, workspaces, schema, consistency

**Tabs and sessions.**

- The zustand store remains the runtime source. `tabPersistence.ts` mirrors it to `sessions`, `tabs` and `archived_groups`, and hydrates from them.
- `tabFields.ts` splits state using allow-lists: `sync_state_json`, `local_state_json`, or dropped. **A field listed in neither is lost on reload.**
- Order uses fractional keys, `order_key` per space and `display_order_key` per session.
- The on-screen tab is held until the user leaves it (DATA-TAB-001).
- Production has 1,029 tombstones out of 1,141 tab records, so tab churn dominates the record count.

**Workspaces.** `workspaces` rows sync as ordinary records, including `layout_json` and `state_json`. They are last-writer per field, and the JSON is opaque to the merge. Production has 0.

**Schema migration across devices.**

- Manifests and ops carry the schema version.
- A device refuses a whole peer stream if `manifest.schema` is higher than its own: reproduced, phone got 0 notes, `lastError: "Update Berean to sync with: mac1"`, state `attention`.
- Unknown columns are ignored on write. Unknown entities are parked.
- Columns are discovered with `PRAGMA table_info` and records read with `SELECT *`, so **adding a column to a synced table changes every hash in that table**. Reproduced: one nullable column on 30 notes produced 30 ops on the next full reconcile. An upgrade therefore republishes the table. It is not dangerous, but it is a burst.

**Consistency model.** Eventual, per device stream in order, no global order, no read-your-writes across devices. Convergence is tested in `chaos.fuzz.test.ts`. The docs state that real iCloud has not been exercised by automated tests (`sync.md`, Known limitations), and this audit could not do so either.

---

## 12. Mac and iPhone transport differences

1. **Dataless files.** `fsSyncStore.ts` treats `.<name>.icloud` as the eviction signal. On this macOS there are **none**: files keep their names with the `dataless` flag. So `readFile` does not return `null`; the read itself materializes the file, blocking a libuv thread until it finishes or fails. That path's placeholder logic and `brctl` request are effectively unused here. A failed read that is not `ENOENT` is thrown and caught by the engine, which stops that stream. VERIFIED by listing; read behaviour INFERRED and consistent with the memory note on the 2026-09-22 hang.
2. **No file coordination on the Mac.** Temp-and-rename, no `NSFileCoordinator`. Safe enough today because each device writes only its own folder. A native Mac app should use coordination.
3. **Identity file.** Only FsSyncStore writes or checks `berean-identity.json`. iPhone relies on the container being separate.
4. **Custom sync folder** exists on Mac only (`icloudSyncFolder`). A native port must keep this or migrate away from it deliberately.
5. **`listDevices`** returns only directories, and the iPhone falls back to its own id.

**Containers and entitlements**

| Identity | Container | Service | Mac DMG | Mac MAS | iPhone |
|---|---|---|---|---|---|
| Production | `iCloud.com.berean.app` | CloudDocuments | By path, no entitlement | Entitled, `Production` environment | Entitled from `Identity.xcconfig` |
| Dev | `iCloud.com.berean.app.dev` | CloudDocuments | By path (`npm run dev`) | Entitled | Entitled, always for Debug |

Separation is enforced by `isForeignContainerPath`, `identityProblem`, `berean-identity.json`, and iOS's refusal to fall back to the first entitled container. There are no iCloud Documents dev/prod environments within one container, which is why two containers exist (`appIdentity.ts`). VERIFIED.

---

## 13. Can native apps reuse it?

**Yes.** The same team, the same container ID and the CloudDocuments entitlement give a Swift app access to the same files. Nothing in the format is tied to JavaScript apart from the items below, and there are no server records to migrate. **Reuse is by far the lowest-risk path.** Moving to CloudKit would be a second migration with a new identity model, for no data-safety gain during the transition. VERIFIED for format; entitlement use by a new binary is INFERRED. Native DMG entitlement support is UNVERIFIED (04 §11.2).

**What a Swift port must reproduce exactly.** Any drift here causes data problems, not just bugs.

| Item | Detail | Failure if wrong |
|---|---|---|
| `hashFields`, `fieldHashes` | 32-bit FNV-1a over **UTF-16 code units** of `JSON.stringify` output. Top-level and nested keys sorted (`hashFields`) or not (`fieldHashes`). Length suffix in hex or base 36. | See S1 |
| JSON number format | JS: `12.0` prints as `12`. Swift `Double` prints `12.0`. Exponents differ too. | S1 |
| Row reading | `SELECT *` semantics, all columns incl. `null`, integers as numbers, column set from the live table | S1 |
| Aggregate records | Playlist `items`, `trail_session.paused_intervals`, `tag_ids`, with the same key sets and order | S1 |
| HLC | Format, string ordering, `receive` drift rule | Ordering errors |
| Device id | Hex, no `-`, one writer per id, `resolveDeviceId` fork rules | S4 |
| Op validation | `isValidOp` regexes | Ops counted as unreadable |
| Manifest | Every field, including `applied` and `snapshot` | Pruning errors |
| Merge | All of `merge.ts`, including `preferNonEmpty`, `unionById`, bookkeeping regex | Divergence |
| Deterministic ids | `conflict-<hlc>`, `sync_conflicts.id`, `daily-<date>`, `share-<item>` | Duplicates |
| Tag rename, deferred memberships, YouTube mirror | `entities.ts` | Divergence |
| Tab split | Allow-lists in `tabFields.ts`; JSON shapes in `sync_state_json` | Old apps lose fields |
| Holds | Quarantine, container, account, database, fork | Loss of the fail-closed behaviour |

**Options for the engine during transition**

| Option | Risk | Note |
|---|---|---|
| Run the existing TS engine in JavaScriptCore inside the native app | Lowest semantic risk; needs a Swift `DatabaseAdapter` and `SyncStore` | Hash, merge and format stay identical by construction. `JSON.stringify` and UTF-16 semantics come free. Good transitional design. |
| Port to Swift, with golden tests from the TS engine | Medium to high | Needs a shared corpus of ops, hashes and merge outcomes |
| Move to CloudKit | Highest | Separate project after all devices are native |

---

## 14. Circumstances where an apparently successful migration causes loss, duplication or divergence

Each row is a scenario in which the app looks fine after moving.

| # | Scenario | Result | Status |
|---|---|---|---|
| **S1** | Native computes hashes differently from TS (float format, UTF-16, key order, an added column) | Reconcile sees every record as changed. **Every field gets a new clock**, so a pending edit on another device loses to old text. Reproduced: both devices ended on `base`, and `phone offline edit` survived only as a conflict copy. | Reproduced |
| **S2** | Import clears sync bookkeeping, or rebuilds the database from exported rows | Re-adoption: every record republished. Purged notes return to Trash on all devices. Reproduced: `note-trashed` on 3 devices. Non-notes log conflicts. | Reproduced |
| **S3** | Tombstones not imported | As S2, for every record deleted before the move | INFERRED from S2 |
| **S4** | Old app and native run the same device id from a copy, and iCloud is slow | Both write the same seq and file name. The fork check needs to see the other's manifest first. iCloud conflict resolution then picks a file, losing ops, and receivers skip reused seqs (data-safety T7). | INFERRED |
| **S5** | DMG Electron left running or launched later beside native, with its own DB | Two legitimate devices; works, but is a duplicate writer until retired. Its stale tabs and edits keep arriving. Fork check may not apply, as the file is unchanged. | INFERRED |
| **S6** | Native stamps `schema` 50 | **Every old device stops pulling from it**, and shows only "Update Berean". Their edits still reach native, so data flows one way until updated. Reproduced. | Reproduced |
| **S7** | Native keeps `schema` 49 but writes a new entity or new JSON shape | Old device parks it, and D3 can lose it after pruning. A changed JSON shape in `sync_state_json` applies silently and old UI drops fields. | INFERRED |
| **S8** | Old device outbox not drained before its last run | Its edits exist only locally. If that app is then deleted, they are gone (`data-safety.md` §6). | VERIFIED in docs and code |
| **S9** | iPhone App Store update while the Mac stays on Electron, or the reverse | Mixed versions indefinitely. Everything in §13 must hold for months. | INFERRED |
| **S10** | Native stores a new id for PDFs or notes, or normalizes ids (case, trim) | Duplicates; old record plus new record, both live | INFERRED |
| **S11** | Native generates `daily-<date>` differently, e.g. timezone or sunrise logic | Two daily notes for a day, on different devices | INFERRED |
| **S12** | Importer rewrites `updated_at` or normalizes text (line endings, Unicode NFC, trailing space) | Every touched record is a real change; ops overwrite, and the hash differs (S1). Hebrew and Greek normalization would change stored text. | INFERRED |
| **S13** | A new bundle ID or container is used for native | Empty container; user enables sync and gets `adoptExisting` as a brand-new world, with a parallel cloud copy. iPhone and Mac can diverge silently if they pick different containers. | INFERRED |
| **S14** | Native uses a release environment or different team ID | Container unavailable; may look signed out. Team ID must stay `6C8RCZVUZR`. | INFERRED |
| **S15** | Native pulls before finishing its import | Bootstrap merges against a partial database; a guard may quarantine real records | INFERRED |
| **S16** | Device folder deleted as "cleanup" of old device ids | Records whose only publisher was that device cannot bootstrap on new devices | INFERRED |
| **S17** | Native prunes or compacts with different rules | A slow Electron device loses its journal before applying; the 90-day rule also applies to a long-idle Mac | INFERRED |
| **S18** | Fresh native install bootstraps from a snapshot | D2: tag edges missing, status `synced` | Reproduced as D2 |
| **S19** | Migration during a D1 window | Old device's last edit never published. After retirement the only copy is on the retired machine. | Reproduced as D1 |
| **S20** | Vault still enabled on old Mac and native Mac simultaneously | Both write and watch the same vault; mtime races, D4 and D5 | INFERRED |
| **S21** | Native treats `notes.deleted_at` as a tombstone | Trash becomes permanent deletion, or restored notes never reappear | INFERRED |
| **S22** | iPhone storage restored from a backup of the Capacitor era after the native update | Fork fires if the file creation date changed; if not, only `manifest-ahead` catches it, and a stale manifest delays that | UNVERIFIED |
| **S23** | Native reinstall with sync off then on | New device, no loss, but anything unsynced is gone, and a large re-download follows | VERIFIED by design |
| **S24** | Native writes the database without emitting capture, as `vault.ts` does | D4 at scale | Reproduced as D4 |
| **S25** | User enables native on a second Apple ID on Mac | No account guard on Mac today (D7); a port that copies the Mac host inherits that | VERIFIED gap |

---

## 15. Reversible migration and verification strategy

Not a proposal to change production schemas. Everything below keeps the current format.

**Phase 0: Preconditions in the old apps (later work, not now).** Fix D1-D4 and D6, ship to everyone, wait for adoption. Add a golden corpus from the TS engine: ops, records, hashes, merge outcomes.

**Phase 1: Dev rehearsal.** Berean Dev on Mac and iPhone only, with `iCloud.com.berean.app.dev`. Production is not touched. Run the full §16 list.

**Phase 2: Read-only shadow.** A native build with production identity on an internal device, pointing at a **copy** of the database. It reads journals, applies them to the copy, publishes nothing and writes nothing to the container. Compare with the live app daily: row digests, hash parity, zero unexplained differences. This is the main safety step. It costs nothing to reverse.

**Phase 3: Single-device write.** One native device becomes a real writer with a **new device id** (a normal fork path) and an unchanged schema number. Old devices continue. Native stays strictly additive. The `schema` value stays at the old value until all devices move. Reversal: stop the app. The device's journal stays valid and other devices carry on.

**Phase 4: Mixed population.** Phased App Store rollout. Keep the old apps working for at least the 90-day silent window. Native compaction stays conservative: never prune another device's needs, and never prune while any manifest reports an older `appVersion`.

**Phase 5: Retirement.** Only after every known device reports native, and all `applied` values are current. Device folders are never deleted automatically. Schema growth resumes here.

**Device id policy at import**

| Case | Policy | Reason |
|---|---|---|
| In-place upgrade, same file (iPhone, MAS), old app gone | May keep the id; storage identity unchanged | Continuous single writer |
| Copy made from a DMG database, old app may run again | **Force a fork, with a new id**, republish `own:<old>` | Prevents S4 |
| Rollback to old app after native writes | Old app on its own file continues with its own id | Separate writers; pull brings native's edits across |

**Before enabling native sync, the import must have passed:**

1. All 04 §11.6 checks, including 100% hash parity. If parity fails, stop. Do not "repair" by publishing.
2. `sync_outbox` from the old app either empty or carried across unchanged.
3. No active hold.
4. Bookkeeping intact: `sync_record_meta`, `sync_applied`, `sync_failed`, `sync_conflicts`.
5. Manifest for the old device id readable.

If a hash algorithm difference is ever found to be unavoidable, the recovery is to recompute **`hash` and `field_hash` locally without creating ops**. They are never sent, so this is safe, but only directly after the old app's final full reconcile with an empty outbox, so that no real change hides in the recalculation. VERIFIED that hashes are local: `SyncOp` has no hash field.

**Ongoing verification during the transition**

- A "sync audit" command comparing per-entity count and a digest of `(entity, key, hlc, hash)` across devices through a local report. This detects D1-type divergence, which `status` cannot.
- Report `failedOps`, `unreadable`, conflicts and hold state before each rollout step.
- Stop conditions: any unexplained `sync_conflicts` increase, a burst of ops above a set multiple of record count, any hold, any drop in a device's record count.

**Rollback at each step**

| Step | Rollback | Data cost |
|---|---|---|
| Phases 1-2 | Delete the build | None |
| Phase 3 | Stop native; its edits are in the journal and reach old apps | None if pushed |
| Phase 4 | Ship a higher-version Capacitor or Electron build; same file, same container | None if additive rules held |
| After schema growth (Phase 5) | Restore from backups, plus iCloud journals | Possible; this is the point of no return |

---

## 16. Test list

**Compatibility, with golden data**

1. Swift hash equals TS hash across the corpus: unicode, emoji, surrogates, floats, null, nested, large strings.
2. Op encode and decode round trip against TS; `isValidOp` parity.
3. Merge table parity across all `merge.test.ts` cases.
4. HLC ordering parity, including counter rollover and drift.
5. `resolveDeviceId` fork parity.

**Mixed versions (real devices, Dev container)**

6. Electron Mac + native iPhone: edit, delete, purge, restore, tag, trail, playlist, chat, PDF metadata, in each direction.
7. Native Mac + Capacitor iPhone, same list.
8. Three devices with one offline for over 64 saves of a note.
9. Offline both sides, same note, both fields and different fields.
10. Delete against edit, each arrival order.
11. Schema gate behaviour with a native bump (S6), with the UI message read by a person.
12. Unknown entity from native on old build, then pruning (D3).

**Lifecycle**

13. D1: type continuously during a push on iPhone, large batch, then verify the other device.
14. D2: fresh device from a snapshot with tag edges.
15. D4 and D5: Octarine edit while Berean is running, and after forced export.
16. Kill during push, pull, compaction and prune, at each step.
17. Airplane mode for days, with thousands of ops.
18. Dataless journals on Mac, including offline reads.
19. Eviction on iPhone under storage pressure.
20. iCloud signed out, signed in as another account, switched back; Mac and iPhone.
21. iCloud Drive off for the app only.
22. Device restored from backup; Migration Assistant; Time Machine.
23. User deletes a device folder, or all of `Documents/sync`.
24. 90-day silent device returns.
25. Notes of 9 MB through the journal, snapshot and bridge.
26. Real upload delay: outbox empty but files not yet uploaded, then the app is deleted.
27. Production-size data: 4,500+ journals, 17,000 meta rows, initial sync time and memory on iPhone.

**Safety**

28. Empty database with sync on publishes nothing and deletes nothing.
29. Production and Dev cannot cross, in native builds: container, App Group, URL scheme, folder.
30. Native release build never includes the Dev container.

---

## 17. Documentation discrepancies

| Doc says | Code does |
|---|---|
| `engine.ts` header: record-level last-writer-wins | Per-field merge since v47 |
| `sync.md`: "Unknown / failing ops: parked, never dropped" | Lost after pruning (D3) |
| `engine.ts:28`: "Nothing is discarded" | True for the merge itself; D1 and D4 lose data before it |
| `fsSyncStore.ts`: evicted files appear as `.name.icloud` | None exist on this macOS; files are dataless |
| `sync.md` account row: iOS identity plus own-history check | Correct, and it means no account check on Mac (D7) |
| `decisions.md` D-002: `berean.db` excluded from device backup | Included (R017) |
| `engine.ts:620`: "ids are UUIDs" | Deterministic ids exist |

---

## 18. Could not verify

| Item | Status |
|---|---|
| Real iCloud timing, conflict file behaviour and eviction under this design | BLOCKED: not exercised; no automated coverage (`sync.md`) |
| iPhone database state, and stability of `identityHash` on hardware | BLOCKED |
| What real iCloud does if two writers produce the same file name (S4) | UNVERIFIED |
| Native Developer ID iCloud Documents support | UNVERIFIED |
| Birthtime preservation in Migration Assistant, Time Machine and iPhone restores | UNVERIFIED |
| D5, and raw writes joining an open transaction | INFERRED, not executed |
| Whether production has already been affected by D1 or D4 | UNVERIFIED: detection needs comparing devices, and note content was out of scope. `vaultSync` exists as a key, but its value was not read. |
