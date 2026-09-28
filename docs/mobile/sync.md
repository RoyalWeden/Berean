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

## Lifecycle (event-driven since DATA-SYNC-007 — `src/platform/sync/hostCore.ts`, shared by both hosts)

| Trigger | What runs |
|---|---|
| A local change is captured into the outbox | sync after 1.5 s (typing coalesces into one pass) |
| Container notification (iPhone `NSMetadataQuery`; Mac `fs.watch`) | sync. On the iPhone the plugin has already requested the download of every changed file, and the "download finished" update is the next notification |
| A request while a sync runs | one more pass right after (never lost, never overlapping) |
| App foreground / Mac wake / network back (`online`) | sync |
| Background / quit | push (best effort; the outbox persists) |
| Every 60 s | sync — a **safety net only** |
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
- There is no automatic rich-text merge. Concurrent note edits keep both texts (current + conflict
  copy), and the user chooses in Versions.
- Push on backgrounding is best effort (the WebView may be suspended first). The outbox persists,
  and the next launch or foreground pushes.
- A note that arrives before its folder briefly shows at the root until the folder arrives.
