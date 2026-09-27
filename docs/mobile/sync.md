# Sync — operational summary

The full design (journal format, HLC, compaction) is [icloud.md](icloud.md). This page is what the
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

## Lifecycle

| Moment | What runs |
|---|---|
| Launch (sync on) | open engine → start capture → adopt pre-sync data once → **reconcile since the last capture** → watch the container → sync every 60 s |
| iCloud unavailable at launch (signed out, container not ready) | **capture still runs** (DATA-SYNC-001); push / pull report "unavailable" and retry; nothing is lost |
| Turning sync on | needs iCloud now (a clear error otherwise) → **full reconciliation** (changes made while it was off) |
| Turning sync off | engine stops; pending ops stay in the outbox |
| Foreground / wake | sync |
| Background / quit | push (best effort; the outbox persists regardless) |
| Container change | debounced (1.5 s) sync |

## Merge rules (summary)

- Records: last writer wins by hybrid logical clock (HLC), whole-record.
- Tombstones stop an older edit from resurrecting a deleted record; ops are idempotent per
  `(device, seq)`; each device's stream is applied in order, stopping at gaps.
- **Note edited on both devices while apart:** the later HLC is current; the other text becomes a
  conflict copy (`note_versions`, kind `conflict`).
- **Note deleted (Trash or purge) on one device while edited on another, neither having seen the
  other (DATA-SYNC-002):** the note ends up **in the Trash with the edited content** on every
  device. The deletion is honoured and the work is recoverable with Restore; neither is silent.
  If the deleting device had already seen the edit, it is an ordinary delete.
- Same-name verse tags created apart → "Name (2)" deterministically.
- **Same-range highlights created apart → one record** (id = range, DATA-HL-001).
- **Same-day daily notes created apart → one note** (id `daily-<date>`, DATA-DAILY-001).
- Tabs: union membership, fractional order. **The tab on screen never moves under the user**
  (DATA-TAB-001): a remote change to it is held until they leave it, and their own newer change
  wins.

## Reconciliation (DATA-SYNC-001)

`engine.reconcileLocal(full)` re-captures what event capture missed:
- rows of tables with `updated_at` (or append-only `created_at`) changed since the `captured_at`
  watermark, minus 10 min;
- a one-query compare of the small tables that lack one (folders, highlights, tags …);
- rows that vanished.

Hash-guarded, so an unchanged record produces nothing, and idempotent. Without it:
- edits made while iCloud was unavailable at launch were never journaled;
- a remote edit with the stale base then overwrote them silently.

## Diagnostics (Settings → iCloud, both apps)

- state (Up to date · Changes waiting · iCloud unavailable · Needs attention)
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
- There is no automatic rich-text merge. Concurrent note edits keep both texts (current + conflict
  copy), and the user chooses in Versions.
- Push on backgrounding is best effort (the WebView may be suspended first). The outbox persists,
  and the next launch or foreground pushes.
- A note that arrives before its folder briefly shows at the root until the folder arrives.
