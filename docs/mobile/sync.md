# Sync — operational summary

The full design (journal format, HLC, compaction) is [icloud.md](icloud.md). Lifecycle, first-sync progress, the shared UI state and live UI: [icloud-lifecycle.md](icloud-lifecycle.md). This page is what the
code does today, including the 2026-09-27 hardening (DATA-SYNC-*). Inventory: [data-architecture.md](data-architecture.md).

## Architecture (unchanged, verified)

`services → berean.db → data:changed → SyncEngine (capture → sync_outbox) → SyncStore → transport`

- Transport-agnostic engine (`src/platform/sync/engine.ts`). Transports:
  - `FsSyncStore` (Mac, plain fs on the iCloud Drive container);
  - `CloudSyncStore` → the BereanCloud plugin (iPhone, NSFileCoordinator + NSMetadataQuery);
  - `MemorySyncStore` (tests).
- **iCloud service used: iCloud Documents (CloudDocuments) only.** Not CloudKit, not the key-value
  store, no Background Modes. The entitlements (`App.entitlements`) match exactly: the container,
  CloudDocuments, ubiquity container and App Group.

## Lifecycle (event-driven since DATA-SYNC-007 — `src/platform/sync/hostCore.ts`, shared by both hosts)

| Trigger | What runs |
|---|---|
| A local change is captured into the outbox | sync after 1.5 s (typing coalesces into one pass) |
| Container notification (iPhone `NSMetadataQuery`; Mac `fs.watch`) | sync. On the iPhone the plugin has already requested the download of every changed file, and the "download finished" update is the next notification |
| A request while a sync runs | one more pass right after (never lost, never overlapping) |
| App foreground / Mac wake / network back (`online`) | sync |
| Background / quit | push (best effort; the outbox persists) |
| Every 60 s | sync — a **safety net only** (NSMetadataQuery runs only in the foreground and coalesces; the pass reads manifests and applies only what is new — the change-token equivalent) |
| Launch (sync on) | open the engine → capture → adopt → reconcile since the last capture → sync |
| iCloud unavailable at launch | capture still runs; push / pull retry |

### End to end

- **Outbound:** UI → service → `berean.db` → `data:changed` → capture (`sync_outbox`) → host core wakes →
  `engine.push` → our journal plus manifest written with NSFileCoordinator → the iCloud daemon uploads
  (the status shows **Uploading** until `ubiquitousItemIsUploaded`).
- **Inbound:** the other device's upload lands → `NSMetadataQuery` update → the plugin requests the downloads
  and notifies JS → `engine.noteNotified` + sync → files present → HLC-ordered apply into
  `berean.db` → `data:changed(remote)` + `onApplied(entities)` → `applySyncInvalidation` → tokens,
  tab mirror, tags, workspaces → views re-read the database → re-render.
- **Open note (DATA-LIVE-001, one rule — `src/lib/notes/liveNote.ts`)** — every surface that shows an
  open note follows it, in the SAME mounted editor (no remount, no reopen):
  - Mac Notes panel and **Mac Scripture right panel**, via `useLiveNote`. The right panel's note used
    to be a snapshot fetched once when opened, so remote edits showed only after reopening it.
  - iPhone Notes tab and **iPhone Scripture verse-sheet** editor, via `useNoteAutosave`, the same rule.

  The rule:
  - clean (no save pending, no keystroke for 2 s) → the new text and title apply at once, the cursor
    stays at the same offset, and the keyboard stays up;
  - dirty → the remote text is kept as an "external" version and applied after the pause, unless
    the user's own newer save supersedes it;
  - a composition in progress → the editor hands the content back to the host
    (`onExternalDeferred`), which keeps it as a version.

  Also fixed: incoming text equal to an older local state (e.g. a revert) was mistaken for our own
  echo and skipped, and a title-only change was ignored.
- **On-screen tab:** held until the user leaves it (DATA-TAB-001), then applied.

### Timing you should expect on real devices

The code adds about 1.5 s (outbound debounce) plus about 1.5 s (notification batching) plus a pass. The rest is
Apple's: the iCloud daemon's upload and the other device's download. These are typically a few
seconds on Wi-Fi and can take longer on cellular, in Low Power Mode, or after the app was just
foregrounded (the metadata query only runs in the foreground). There are no background pushes. The
diagnostic log shows each step with a timestamp, so the Apple part can be measured.

## Merge rules (summary — since 2026-09-28, DATA-SAFE-*; full model in [data-safety.md](data-safety.md) §3)

- **Per-field merge, not whole-record last-writer-wins.** Every version carries its lineage and a
  clock per field. A version the receiver already contains is skipped; one built on the receiver's
  version replaces it. Versions made apart merge field by field: a pin on one device and an edit on
  another BOTH survive. This was the cause of "changes appear overridden".
- Only a field both devices changed can conflict. The higher field clock wins on every device and
  the other value is kept: note text/title → a conflict copy in Versions (journaled, so every device
  has it); other records → `sync_conflicts` (counted in Settings → iCloud).
- **Deletion vs change made apart:** a note stays in the **Trash with the change** (every arrival
  order, and the resolving device publishes the outcome); any other record is deleted and the
  change's values are kept in `sync_conflicts`. A record re-created after its deletion was seen is
  applied normally.
- A merge's outcome is a new version; tombstones keep the deleting op's version (deterministic).
- Idempotent twice over: `(device, seq)` in `sync_applied` AND lineage ("already have it").
  Replaying every journal changes nothing.
- Same-name verse tags created apart → "Name (2)". Same-range highlights → one record
  (DATA-HL-001). Same-day daily notes → one note (DATA-DAILY-001).
- Tabs: union membership, fractional order. **The tab on screen never moves under the user**
  (DATA-TAB-001).

## Data safety (DATA-SAFE-*, [data-safety.md](data-safety.md))

| Protection | What it does |
|---|---|
| Deletions are never inferred from a partial database | missing rows beyond 20 / 25 % of an entity, or an emptied table, are **held** (quarantine) — Settings: *Restore from iCloud* / *They were deleted* |
| Reinstall = new device | an empty database has no sync bookkeeping, so it can only receive; tested: publishes nothing, deletes nothing |
| Restored / copied database | detected (file creation time, or own manifest ahead) → new device id + republish; the old device's journal brings back later edits |
| Account / container change | iOS identity hash + "own history missing" check → **held**, nothing crosses; switching back resumes |
| Damaged database | `PRAGMA quick_check` before sync and before a migration → held / not migrated |
| Migration | consistent backup (`VACUUM INTO`) before upgrading, newest 3 kept |
| Unknown / failing ops | parked, never dropped; re-armed on the next app version |
| Crash windows | outbox cleared only after all files are written; a manifest missing after a crash is repaired; each op applied + recorded in one transaction; weekly full reconciliation |
| Share inbox | never acknowledges an unhandled item; idempotent note creation (`share-<item>`) |
| Emergency copy | iPhone Settings → iCloud → **Export all notes** (Markdown, Files / AirDrop) |

## Reconciliation (DATA-SYNC-001)

`engine.reconcileLocal(full)` re-captures what event capture missed:
- rows of tables with `updated_at` (or append-only `created_at`) changed since the `captured_at`
  watermark, minus 10 min;
- a one-query compare of the small tables that lack one (folders, highlights, tags …);
- rows that vanished.

Hash-guarded, so an unchanged record produces nothing, and idempotent. Without it:
- edits made while iCloud was unavailable at launch were never journaled;
- a remote edit with the stale base then overwrote them silently.

## Sync status (DATA-SYNC-005)

| State | Means |
|---|---|
| Up to date | nothing waiting either way that this device can see: outbox empty, our files uploaded, no other device ahead |
| Changes waiting | local changes are not yet in our journal |
| Offline | changes are waiting and there is no network |
| Uploading | in our journal, but iCloud has not accepted the files yet |
| Downloading | another device's manifest is ahead of what we applied, or its files are still arriving |
| Applying changes | a pull is applying other devices' changes |
| iCloud unavailable | not signed in, or the container is missing (capture continues) |
| Needs attention | an error, unreadable entries, or changes that failed to apply |
| Paused to protect your data | a hold (see Data safety): records missing locally, another iCloud account or container, a damaged database — nothing is pushed, pulled or deleted until resolved |

A device only knows another device is ahead once that device's manifest has arrived here. Until
then, "Up to date" means up to date with everything iCloud has delivered to this device.

## Diagnostics (Settings → iCloud, both apps)

**Diagnostic log** switch: a ring buffer of `local:captured`, `sync:run`, `push:start` / `push:written`,
`remote:notified`, `pull:start` / `pull:waiting` / `pull:done`, `remote:applied`, `ui:invalidate` and
`state`. Each entry carries entity kinds, 8-character id prefixes and counts. There are **no titles or
content** (tested). It is also printed to Xcode's console (iPhone) or the main-process log (Mac), with
Copy log.

The status panel also shows:
- the state (above), what is waiting for iCloud upload, what is still to receive, and the last iCloud notification
- pending ops, last push / pull, last received (count and time), conflict copies
- changes not applied (`sync_failed`, retried up to 5 times), unreadable entries, last error
- journal size and compaction point, database schema version, known devices

Logs carry entity names and ids only — never note content.

## Share Extension inbox (DATA-SHARE-001)

The extension writes one `item-<uuid>.json` per shared item (no read-modify-write). The app `take`s
without removing, handles each item, records the id as handled (settings `shareInboxHandled`), then
`ack`s it. A kill or failure at any point loses nothing and never handles an item twice. A failing
item is retried on the next two drains, then acknowledged. The legacy single `pending.json` is still
read.

## Known limitations

- **Real iCloud has not been exercised by automated tests.** Everything above is verified with the
  real engine, services and schema over the in-memory transport, plus the simulator. Real iCloud
  Drive upload / download timing, eviction, account changes and a second physical device need the
  device plan in [testing-backlog-2026-09-27b.md](testing-backlog-2026-09-27b.md).
- There is no automatic rich-text merge. Concurrent edits of the same note's TEXT keep both texts
  (current + conflict copy), and the user chooses in Versions. (Different fields — pin, folder,
  title vs text — merge automatically.)
- What never reached iCloud is lost with the device or the app (uninstall): see data-safety.md §6.
- Push on backgrounding is best effort (the WebView may be suspended first). The outbox persists,
  and the next launch or foreground pushes.
- A note that arrives before its folder briefly shows at the root until the folder arrives.
