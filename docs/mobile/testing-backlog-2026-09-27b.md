# Testing backlog — 2026-09-27, data layer / iCloud / persistence audit (ids DATA-*, UI-MENU-*)

Source: the developer's final data-layer / iCloud brief. Architecture:
[data-architecture.md](data-architecture.md) · [sync.md](sync.md) · [icloud.md](icloud.md) · [database.md](database.md).
"Auto" = vitest over the real engine, services and schema (in-memory transport); "Sim" = iOS simulator
probe; **Dev** = physical device + real iCloud.

| ID | Finding → requirement | Implementation | Files | Tests | Manual | Status |
|---|---|---|---|---|---|---|
| DATA-SYNC-001 | Capture only ran while iCloud was reachable at launch (both apps) → offline-start edits were never journaled and a later remote edit overwrote them silently | engine opens + captures whenever sync is enabled; `reconcileLocal` (watermark + one-query full compare) at every start, full on enable; FsSyncStore never fakes the container | sync/engine.ts, sync/entities.ts, ios/syncHost.ts, electron/sync/host.ts, electron/sync/fsSyncStore.ts | engine.integration (4) | Dev: sign out → edit → sign in | COMPLETE (Auto) |
| DATA-SYNC-002 | Purge beat a concurrent offline edit (silent loss); a later edit un-trashed a trashed note (silent resurrection) | concurrent delete / trash vs edit → note in the Trash with the edited content on every device | sync/engine.ts | engine.integration G/H | Dev: delete on A offline, edit on B | COMPLETE (Auto) |
| DATA-SYNC-003 | Pending ops must survive restart / reboot | verified: SQLite outbox | — | engine.integration (restart while unavailable), M | Dev: kill during pending sync | COMPLETE (Auto) |
| DATA-SYNC-004 | Sync failures must be diagnosable | status: state, conflicts, failed ops, last received, schema; Settings → iCloud shows them | sync/types.ts, engine.ts, settings/sections/ICloudSection.tsx | engine suite | Dev: look at Settings → iCloud | COMPLETE |
| DATA-TAB-001 | Another device navigating a synced tab moved the reading position on screen | remote changes to the on-screen tab are held until the user leaves it; stale view never written back; user's newer change wins; tab snapshot flushed on backgrounding | store/tabPersistenceRuntime.ts | tabPersistenceRuntime (3 new) | Dev: same tab on two devices | COMPLETE (Auto) |
| DATA-DAILY-001 | Same-day daily notes created on two devices = two notes | id `daily-<date>` | services/notesService.ts | engine.integration (daily) | Dev | COMPLETE (Auto) |
| DATA-HL-001 | Same range highlighted apart = two stacked records | id = range | services/highlightsService.ts | engine.integration (highlights) | Dev | COMPLETE (Auto) |
| DATA-ID-001 | Some synced tab / archive ids were a timestamp only | random suffix | App.tsx, AiLookupPanel, VerseRow, BiblePanel, store | — | — | COMPLETE |
| DATA-ENT-001 | Folders / highlights / workspaces round trips | verified | — | engine.integration (3 new) | Dev | COMPLETE (Auto) |
| DATA-MIG-001 | Upgrades keep data | verified + v42 → v46 test | — | bereanMigrations | Dev: install over the TestFlight build | COMPLETE (Auto) |
| DATA-SHARE-001 | Share inbox deleted items before handling them; a share during a drain could be lost | one file per item; take / handle / record / ack; idempotent | ShareViewController.swift, BereanShareInboxPlugin.swift, ios/plugins.ts, ios/shareInbox.ts | shareInbox (3) | Dev: share, kill app, reopen | COMPLETE (Auto + Swift build) |
| DATA-PRIV-001 | No note content / payloads in logs | audit clean; the Search query log is dev-only now | mobile/search/SearchPage.tsx | — | — | COMPLETE |
| DATA-DOC-001 | Documentation | data-architecture.md, sync.md, icloud.md, database.md, matrix, progress | docs/mobile/* | — | — | COMPLETE |
| UI-MENU-001 | Note + menu cropped at the top with the keyboard open | shared `useAnchoredMenu` / `layoutAnchoredMenu`: room from the + to the top safe area above the keyboard, scrolls only when needed, below only with more room | primitives/anchoredMenu.ts, notes/NoteInsertButton.tsx, noteEditor.css, MobileApp.tsx | anchoredMenu (5) | Sim: 8 options at y 104–469 over a 335 pt keyboard, Island inset 62; option inserted, typing continued | COMPLETE (Dev: detents, Dynamic Type) |

## Real-device iCloud matrix (still to run — nothing here has touched real iCloud)

**Devices.** A = physical iPhone. B = the Mac (desktop build on the same Apple Account), or a second
iOS device. Both need iCloud Drive on and Berean → Settings → iCloud enabled.

1. **Fresh install on A:**
   - Bible and library texts open offline.
   - Create a note with formatting, a Scripture reference and a folder; a highlight; a verse tag;
     several tabs; a saved workspace.
   - Force-quit and reopen: everything is there.
2. **Basic sync A → B:** wait for Settings → iCloud "Up to date" on A, open B, and verify every
   item's content, not only its presence.
3. **Reverse B → A:** edit the note, rename the folder, recolour the highlight, rename the tag and
   the workspace on B; verify on A.
4. **Offline on A:**
   - Airplane mode; create and edit a note, folder, highlight and tag; force-quit and reopen offline.
   - Everything is present, and Settings shows "iCloud unavailable" or "Changes waiting".
   - Reconnect: B receives all of it.
5. **Signed out / iCloud off at launch on A:** edit, sign in again, then verify B receives the edits
   (DATA-SYNC-001).
6. **Conflict:** both devices offline, edit the same note differently, reconnect both. One version
   is current, and the other is in the note's Versions on both devices.
7. **Delete:**
   - A deletes a note offline, B keeps it → gone on both.
   - A deletes, B edits the old note offline → the note is in the Trash on both with B's text.
8. **Same tab on both:** A and B show the same synced tab. Navigate it on A; B does not move until
   B leaves that tab.
9. **Daily note:** both offline, open today's note from the Calendar on both, type, reconnect. One
   daily note, the other text in Versions.
10. **Termination:** type in a note, background the app immediately and force-quit, reopen. The
    text is there; repeat with the keyboard open, autocorrect active and sync pending.
11. **Share Extension:** share text from Safari into Berean, force-quit before it opens, reopen.
    Exactly one note.
12. **Note + menu:** in a Scripture-sheet note and the Notes tab, with the keyboard up, at low and
    full sheet heights, at the largest Dynamic Type: every option is visible or scrolls, and nothing
    sits under the Island or the keyboard.
13. **Reinstall A:** delete the app, reinstall, enable iCloud. Everything returns from B's journals
    and snapshots.

Only one physical iPhone is known to be available. The second device is the Mac (same engine,
fs transport) or the simulator signed into the same account.
