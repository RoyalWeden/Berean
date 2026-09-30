# Berean data safety — threat model, guarantees, merge policies

Audit and hardening of 2026-09-28 (ids `DATA-SAFE-*`), on branch `feature/ios-app`.
- Operational summary: [sync.md](sync.md).
- Design: [icloud.md](icloud.md).
- Inventory: [data-architecture.md](data-architecture.md).
- Research memo with Apple sources: [research/data-loss-research-2026-09-28.md](research/data-loss-research-2026-09-28.md).

**The guarantee:** Berean never silently discards recoverable user data.

It is not "data can never be lost". Changes that never left a device can be lost with that device;
see §6.

**The rule behind every decision:** when in doubt, PRESERVE, then RECONCILE, then MERGE, then
VERSION, then CONFLICT, then RETRY. It never OVERWRITES, DELETES, ASSUMES or DROPS.

## 1. What Berean actually syncs through

Berean does **not** use CloudKit. It uses iCloud Drive (a ubiquity container):
- each device writes only its own folder `sync/v1/devices/<deviceId>/`;
- that folder holds append-only `journal-*.jsonl` files, a `manifest.json` and occasional
  compaction snapshots;
- every device reads every folder.

**Two apps, two containers.** Berean (`com.berean.app`) syncs only through `iCloud.com.berean.app`;
Berean Dev (`com.berean.app.dev` — `npm run dev`, MAS-dev, iOS dev builds) only through
`iCloud.com.berean.app.dev`. Separate bundle IDs, App Groups, URL schemes and Mac database folders
keep development data out of production at every layer ([icloud-lifecycle.md](icloud-lifecycle.md)
§6). A container, not the iCloud "environment", is what separates iCloud Documents data.

Every CloudKit concept in the brief has a direct file-journal equivalent:

| CloudKit concept | Berean equivalent |
|---|---|
| record change tag / `serverRecordChanged` | per-record version (HLC) + lineage + per-field clocks (`sync_record_meta`) — a write never replaces a version it has not seen; it merges |
| ancestor / client / server record | lineage (what a version descends from) + field clocks (which version last set each field) |
| change tokens (database / zone) | per-device cursor = `sync_applied (device, seq)`, written **in the same transaction** as the op's effect |
| expired token / zone reset | a pruned journal → bootstrap from that device's snapshot under the normal merge rules (idempotent) |
| `partialFailure` | journal files are invisible until the manifest lists them; the outbox is cleared only after every file is written; each op is applied in its own transaction |
| missed / coalesced push | notifications only accelerate: every start, foreground, network return and a 60 s interval re-read all manifests |
| tombstones | `sync_record_meta.deleted` with a deterministic version; notes' Trash is a field (`deleted_at`) |
| `CKAccountChanged` | `ubiquityIdentityToken` hash (iOS) + a container check (both platforms) → hold |
| user deleted the zone | the device's own history is missing from the container → hold (never re-upload by itself) |

## 2. Threat model — every vector found, and its status

| # | Vector | Before | Now |
|---|---|---|---|
| T1 | **Two devices change different fields of one record while apart** (pin on A, text on B) | whole-record last-writer-wins: the later op carried the other device's STALE copy of every field and won. Notes kept the lost text as a conflict copy ("appears overridden"); folders, highlights, tags, tabs and workspaces lost it silently. **The reported overwrite bug.** | per-field merge (§3): both changes survive, no conflict |
| T2 | Both change the SAME field | LWW, silent for everything except note text | the higher field clock wins deterministically; the other value is kept (note text/title → a conflict copy in Versions; anything else → `sync_conflicts`) |
| T3 | Three or more devices; versions arriving out of order (A→B→C, C first) | judged by one `base` field: spurious conflicts, and a stale op could become the current note | lineage recognises "C already contains B" → fast-forward, no conflict |
| T4 | Replays / duplicate delivery / snapshot overlapping journals / lost bookkeeping | `sync_applied` only; a replay produced spurious conflicts and could promote stale text via the Trash rule | recognised twice over: `sync_applied` and lineage ("already have this version") — replaying every journal changes nothing (chaos invariant I3) |
| T5 | **Empty / partial local database read as "the user deleted everything"** | startup reconciliation turned any known-but-missing row into a cloud DELETE | deletions inferred from absence are capped (VANISH_LIMIT: 20 or 25 %); an emptied table is never inferred; the rest is **quarantined**: held, reported, restorable from iCloud or confirmed by the user |
| T6 | **Uninstall + reinstall** | structurally safe already (a new database = a new device id, no sync bookkeeping, so nothing to delete) | verified by tests: a reinstall publishes nothing, deletes nothing, and repopulates from iCloud; also while other devices are offline |
| T7 | **Restored backup / copied database** (iPhone backup, Time Machine, Migration Assistant) — same device id, OLDER sequence number | the next push reused sequence numbers others had already applied (**skipped there — silent loss**) and its manifest dropped the newer files | detected (database file identity changed, or own manifest in iCloud ahead of the database) → forked to a new device id; everything it was the last writer of is republished; the old device's journal is pulled like any other, **bringing back edits made after the backup** |
| T8 | A copy and the original running at the same time | same as T7, racing | the runtime push check sees the manifest ahead → the host reopens the engine → fork + republish |
| T9 | **iCloud account switch** | the database merged into / published to whatever container was signed in | iOS: account identity hash (ubiquityIdentityToken) → hold; both platforms: "this device's history is missing from the container" → hold. Nothing crosses either way until the user chooses; switching back resumes by itself |
| T10 | Container URL cached across an account change (Apple: must be re-resolved) | cached for the life of the process | re-resolved whenever the identity token changes |
| T11 | Delete vs concurrent edit (non-note) | a stale edit with a later clock resurrected the record | deletion wins in every arrival order; the edit's values are kept in `sync_conflicts` |
| T12 | Note purged vs concurrent change | Trash-with-edit, but order-dependent (found by the chaos suite: devices diverged) | one rule for every order — the note stays IN THE TRASH with the surviving content — and the resolving device publishes the outcome so every device converges on one version |
| T13 | Conflict copies made only by the devices that observed the conflict | never journaled → other devices lacked them | journaled like any record (deterministic id `conflict-<clock>`) |
| T14 | A merge outcome labelled with one side's version | a later op built on that side fast-forwarded over the other side's changes (found by the chaos suite) | a merge outcome is a **new version**; tombstones keep a deterministic version |
| T15 | Crash after the outbox commit, before the manifest write | pushed ops invisible to others until the next change | the next pass repairs the manifest (also when it never existed) |
| T16 | Crash between a database write and its capture | recovered by the watermark reconciliation — except writes that do not bump `updated_at` (pin, colour) | + a full hash reconciliation every 7 days |
| T17 | Ops of an entity this build does not know | marked applied and **dropped** | parked in `sync_failed`, re-armed on the next app version |
| T18 | Ops failing to apply 5× | never retried again | re-armed on the next app version; always shown in Settings |
| T19 | Migration on an existing database | each step transactional, but no backup and no integrity check | `PRAGMA quick_check` first (a damaged database is never migrated — `DatabaseDamagedError`) + a consistent `VACUUM INTO` backup, newest 3 kept, excluded from device backups |
| T20 | Damaged database at sync start | read as-is → missing rows → deletions | integrity check → **database hold**: no push, no pull, no inferred deletion |
| T21 | Share Extension: an item failing 3× | acknowledged = deleted from the App Group (**dropped**) | never acknowledged while unhandled; retried next launch |
| T22 | Share Extension: kill between creating the note and recording the item as handled | a second note on the next drain | the note's id is derived from the item (`share-<item>`) — creation is idempotent |
| T23 | Tab / history ids from `Date.now()` + `Math.random()` | tiny but non-zero cross-device collision chance | crypto-random id part |
| T24 | The confirmed "Delete all notes" | would now be held by T5's guard | marked as explicit intent (`scope: explicit-delete-all`) and propagated; its warning now says it deletes on every device and in iCloud |
| T25 | Notifications missed / delayed / app killed / backgrounded | — | never needed for correctness: start, foreground, network return, 60 s interval |
| T26 | Clock skew, timestamp-only ordering | HLC (tolerates skew; > 1 h ahead clamped) | unchanged. Merges use causality (lineage) first, the HLC only to order truly concurrent writes |
| T27 | Unsynced local-only data at uninstall / device loss | — | **cannot be recovered** (see §6). Settings shows pending changes; Export all notes gives an independent copy |

## 3. The merge model (`src/platform/sync/merge.ts`)

Every record version is named by its HLC. Each device keeps, per record:
- the current version;
- its **lineage** (the versions it descends from, newest 256);
- a **clock per field** (the version that last changed it).

Every op carries the same three things (lineage newest 64). The field clocks change only for the
fields a write actually changed (per-field hashes). Applying remote version R to local version L:

1. **L contains R** (R is L or an ancestor) → nothing to do. This covers replays, duplicates,
   relays and overlapping snapshots.
2. **R descends from L** → R replaces L (fast-forward).
3. **Concurrent** → per field:
   - equal → keep;
   - one side has seen the other's write and the other has not → the one that has seen it wins;
   - each has seen the other's → the causally later one (higher HLC) wins;
   - neither has seen the other's → a true conflict: the higher clock wins everywhere, and the
     other value is kept.

   The outcome is a **new version** containing both.
4. **Deletion vs change**, made apart:
   - notes → the note stays in the Trash holding the change;
   - anything else → deleted, and the change's values are kept in `sync_conflicts`.

   A record re-created after its deletion was seen descends from the tombstone and is applied.
   Tombstones keep the deleting op's version (deterministic on every device).

Records recorded before v47 have no lineage (NULL). For them the old rules apply: containment by
equality, and the record clock stands in for field clocks. Nothing is dropped as "known" merely
for being older.

## 4. Entity inventory and policies

All ids are stable and never regenerated by sync. Where the brief's policy table says "per-field
merge", both devices' changes to different fields survive (§3).

| Entity (table) | Id | Policy | Deletion |
|---|---|---|---|
| note (`notes`) | UUID (crypto); daily notes `daily-<date>`; shared items `share-<item>` | per-field merge; concurrent text/title → a conflict copy in Versions | Trash = the `deleted_at` field (merges like any field); purge = tombstone; purge vs change → Trash with the change |
| note_version | UUID; conflict copies `conflict-<clock>` (deterministic) | append-only; conflict copies journaled | removed with their note's purge (explicit) |
| note_folder | UUID | per-field (rename vs move both survive); rename vs rename → one wins, other in `sync_conflicts` | tombstone; notes pointing at a deleted folder show at the root (never deleted) |
| highlight | the range (`hl-<text>-<book>-<ch>-<verse>…`) | per-field (colour, label) | tombstone; recolour vs delete → deleted, recolour kept in `sync_conflicts` |
| verse_tag / member / tag_edge | UUID | per-field; same-name tags created apart → "Name (2)" deterministically | tombstones; members cascade with their tag |
| session / tab / archived_group | crypto-random ids | per-field (`sync_state_json` is one field); union membership; fractional order; the on-screen tab holds remote changes until left (DATA-TAB-001) | tombstone rows |
| workspace | UUID | per-field (rename vs content both survive) | tombstone |
| playlist | UUID | per-field (items are one field) | tombstone |
| ai_chat, pdf metadata / highlight / bookmark, youtube_user, trail_* | UUID / video id | per-field | tombstones |
| settings, history, search history, tab local view | — | LOCAL — never synced | — |

## 5. Invariants (asserted by tests)

1. A locally acknowledged user change cannot disappear without an explicit user deletion, an
   explicit conflict (kept), or a documented destructive action.
2. An authoritative deletion is not resurrected by a stale device.
3. A newer version is never silently overwritten by an older one.
4. A conflict keeps enough to recover the other value (Versions / `sync_conflicts`).
5. Duplicate operations are idempotent; replaying every journal changes nothing.
6. A reinstall causes no cloud deletion.
7. An empty or partial local state is never read as "delete everything remotely".
8. A partial failure never produces false success.
9. A device's cursor advances only in the transaction that applied the op.
10. A stale open editor cannot overwrite newer data. Notes follow the live-note rule; per-field
    capture means a stale screen writing a few fields claims only those fields.
11. Stable ids never change in transit.
12. A migration failure cannot cause cloud deletion (the migration throws; sync never starts on a
    damaged database).
13. An account switch cannot leak or delete across accounts.
14. No lifecycle event performs a mass cloud deletion. The only mass deletion is the
    double-confirmed "Delete all notes".

### Tests

The unit tests for the merge model are `merge.test.ts`.

The scenario suite `dataSafety.integration.test.ts` has 30 scenarios, one per vector, run with the
real services, schema and engine. They cover:
- pin vs edit; rename vs move;
- 3–4 devices in every arrival order;
- deletions;
- reinstall, including while another device is offline;
- quarantine and restore;
- restored and copied databases;
- account and container changes;
- partial push, and a kill before the manifest write;
- replay; unknown entity ops; a kill mid-pull; no notifications;
- tabs, workspaces and tags;
- explicit delete-all.

The seeded chaos suite `chaos.fuzz.test.ts` generates random sequences on 2–5 devices, with:
- offline periods;
- crashes;
- lost bookkeeping (full replays);
- reinstalls;
- random sync order.

It asserts:
- I1: convergence;
- I2: no silent loss of any note text written;
- I3: replay idempotence;
- I4: reinstalls publish no deletions;
- I5: no false holds.

It ran **5,000 seeds, all passing**. The 8 seeds that exposed bugs are permanent regression tests,
and the default run is 120 seeds. `FUZZ_SEEDS=5000` reproduces the full run.

## 6. Limitations — what can still be lost, honestly

- **Changes that never reached iCloud die with the device or the app.** That covers uninstalling
  Berean, a lost or reset device, and signing out of iCloud without keeping a copy. It applies to
  changes while "Changes waiting", "Offline" or "Uploading" shows in Settings → iCloud, and to
  everything when sync is off. iOS removes the app's local data on uninstall. Berean cannot recover
  what was only there. **Before deleting the app, check Settings → iCloud says "Up to date"**, or
  use Export all notes.
- **A reinstall is a new device.** The old device's journal stays in iCloud, harmless. Its unsynced
  outbox is gone (see above).
- **Merged concurrent text is not character-merged.** When two devices edit the same note's text
  while apart, one text is current and the other is a conflict copy in Versions. The user merges by
  hand.
- **A same-field conflict on other records keeps the other value only in `sync_conflicts`**
  (diagnostics count; no restore UI yet).
- **Deterministic ids made anew after a deletion elsewhere follow the deletion rule.** Today's
  daily note, or a highlight on a verse, recreated by a device that never saw its deletion: a note
  lands in the Trash with its text; a highlight is deleted with its value logged. This keeps every
  device in agreement.
- **Very long histories.** Lineage keeps the newest 256 versions (64 per op). Beyond that, an
  ancient replay can produce a redundant conflict copy — noise, never loss.
- **Device identity forks rely on the database file's creation time and the own manifest.** A copy
  whose creation time is preserved AND that never pushes after the original is only caught at its
  next push.
- **iCloud Drive itself.**
  - Upload and download timing is Apple's.
  - Files can be evicted (they are then re-requested; a device waits at the gap and never skips).
  - A journal file deleted from iCloud stops other devices at that gap: never silently skipped,
    but it needs attention.
  - Quota-exceeded behaviour is not confirmed from Apple documentation (research memo).

## 7. Recovery paths

| Situation | What the user does |
|---|---|
| "N items are missing on this device" (quarantine) | Settings → iCloud → **Restore from iCloud** (replays every journal; only the missing records change), or **They were deleted** (confirmation) |
| Another iCloud account signed in | sign back in (resumes), or **Use this iCloud for this device's data…** (publishes a copy there; deletes nothing) |
| Berean's data removed from iCloud | wait for it to reappear, or the same "Use this iCloud…" |
| Damaged database | sync holds; the pre-migration backups are in `Application Support/Berean/backups` (Mac: `userData/backups`); Export all notes still works |
| Anything else / belt and braces | Settings → **Export all notes** (iPhone) — every note as vault-format Markdown (re-importable) to Files or AirDrop; Mac: vault export |

## 8. Real-device test plan (not run by Claude — needs Michael's devices and real iCloud)

Automated tests use the real engine, services and schema over an in-memory iCloud Drive model,
plus the simulator for migration and backup (§9). **None of the following has been run on real
iCloud yet.** Record the date, the build and the result for each.

Run the plan first between **Berean Dev** devices (Mac `build:mas:dev` or `npm run dev`, iPhone
`ios:archive:dev` / a Berean Dev TestFlight) on `iCloud.com.berean.app.dev`. Production
(`iCloud.com.berean.app`) is exercised only afterwards, with a short real-data subset (1, 2, 18, 22,
23), once the test data has been moved out of the production container.

| # | Test | Expected |
|---|---|---|
| 1 | A creates a note → B | appears on B |
| 2 | B edits → A | appears on A |
| 3 | A and B edit the same note in Airplane Mode, reconnect both | one text current, the other in Versions on both |
| 4 | A pins, B edits text (both offline) | both the pin and the text on both — **the reported bug** |
| 5 | Three devices edit one note offline, reconnect in different orders | same result everywhere; the other two texts in Versions |
| 6 | A purges from Trash; B edits the stale copy | the note in the Trash with B's text, on both |
| 7 | Edit vs delete, reversed order | same |
| 8 | Create on both, same title / time | both notes |
| 9 | Folder renamed on A, moved on B | both |
| 10 | Rename vs rename | one name on both |
| 11 | Highlight recoloured on B while removed on A | removed on both |
| 12 | Tag renamed on A, verses tagged on B | new name and all verses |
| 13 | Workspace / tab changed on both | converge |
| 14 | Today's daily note edited on both offline | one note, one conflict copy |
| 15 | Offline: create / edit / delete, force quit, reopen, reconnect | all arrive |
| 16 | Force quit during sync (right after typing) | nothing lost |
| 17 | Toggle Wi-Fi repeatedly during a sync | converges |
| 18 | **Uninstall + reinstall A** after "Up to date" (B untouched throughout) | B unchanged; A repopulates; no deletions |
| 19 | Reinstall A while B is offline | B later still complete |
| 20 | Reinstall after offline edits on A | the unsynced edits are gone (expected — §6); everything that reached iCloud returns |
| 21 | Install the previous build, create data, install this build | migrates (a v46 backup appears); data intact |
| 22 | Sign out of iCloud, sign in again | nothing deleted; sync resumes |
| 23 | Sign in to another Apple Account | "A different iCloud account is signed in"; nothing crosses; switching back resumes |
| 24 | Restore the iPhone from an older backup | a fork is reported ("restored / copied database: 1×"); edits made after the backup come back |
| 25 | Share text to Berean, force quit immediately | exactly one note |
| 26 | Settings → Export all notes | a folder of .md files; re-import works |

## 9. What was verified where

- **Automated** (Node, the real SQLite engine): 4,700+ tests; the scenario and chaos suites above.
- **Simulator:** the real iOS upgrade path v46 → v47 on the existing simulator database:
  - `berean-v46-to-v47-*.db` created: integrity ok, 9 notes, excluded from backup;
  - the new columns present;
  - the app boots with the same 9 notes.
  - The simulator is not signed into iCloud, so sync itself was not exercised there.
- **Physical devices / real iCloud:** none (§8).
