# 12 - Risk Register (native Swift migration)

> **Baseline note.** Investigated at `807c2d9`. The final baseline is `d97fb05`. The only code changes between them are PRs #9, #10 and #11, listed in `01-REPOSITORY-STABILIZATION.md`: fixes for sync defects D1-D4, note table-cell formatting, and audio cache keys. Anything below describing those defects as present is corrected where noted.

Audit snapshot, 2026-11-05. This is a register, not a plan. Nothing here authorises a stage; doc 11 section 10 says each stage exit is the owner's decision.

**Basis.** Every entry cites a section of docs 02-11, 14 or 17 (or a code path those documents cite). Where a source is INFERRED, UNVERIFIED or BLOCKED in its own document, the entry says so. No fact here comes from outside those documents.

**Treatment of known defects.** Sync defects D1-D4 (doc 05 section 2) were fixed in PR #9, note table-cell flattening (doc 09 section 2.3) in PR #10, and the audio cache path traversal (doc 17 S-8) in PR #11, all merged at `d97fb05`. They are treated as fixed in the current app. Doc 05 D5-D7 and doc 17 S-17 are not covered by those PRs and remain open. The *lessons* of the fixed items are kept as migration risks (R-04, R-10, R-12, R-31, R-42).

**Scales.** Likelihood: Low / Medium / High, as the cited documents support it (most are INFERRED; no probability data exists). Impact: Low / Medium / High / Critical. Critical means unrecoverable loss of user content or a silent divergence across devices. Severity is the combined judgement, used only for counting and ordering.

---

## Summary

| ID | Risk | Likelihood | Impact | Severity |
|---|---|---|---|---|
| R-01 | Data loss during first-run import | Medium | Critical | Critical |
| R-02 | Sync hash drift (S1, S12) | High | Critical | Critical |
| R-03 | Sync bookkeeping or tombstones dropped at import (S2, S3, S21) | Medium | Critical | Critical |
| R-04 | Native writes to the database or vault without capture (S24, S20, D4, D5) | Medium | High | High |
| R-05 | Device-id duplication across old and native copies (S4, S5, S22) | Medium | High | High |
| R-06 | Schema gating between old and new devices (S6, S7, S17) | High | High | High |
| R-07 | Retired devices holding unpublished edits (S8, S19, D1) | Medium | Critical | Critical |
| R-08 | Premature pull, compaction or folder cleanup (S15, S16, S17) | Medium | High | High |
| R-09 | Identifier, date and text normalisation drift (S10, S11, S12) | Medium | High | High |
| R-10 | Port inherits fixed sync defect classes (D1-D3, D5-D7, S18) | Medium | High | High |
| R-11 | Account and container mismatch (S13, S14, S25, D7) | Medium | High | High |
| R-12 | Bundle ID, team and container continuity broken | Low | Critical | High |
| R-13 | MAS versus direct-download data locations | High | High | High |
| R-14 | Sandboxed native app cannot reach DMG data | High | High | High |
| R-15 | Updater bridge for installed DMG users | High | High | High |
| R-16 | WKWebView and LevelDB localStorage state lost | High | High | High |
| R-17 | Non-portable secrets and sessions | High | Low | Low |
| R-18 | Windows users left behind | Medium | Medium | Medium |
| R-19 | Notes editor Markdown fidelity | High | Critical | Critical |
| R-20 | Parity ambiguity over formerly lossy behaviour (table cells) | Medium | Medium | Medium |
| R-21 | Highlight offset anchoring | Medium | High | High |
| R-22 | TextKit 2 stability and performance | Medium | High | High |
| R-23 | Kokoro G2P without eSpeak changes the voice | High | Medium | Medium |
| R-24 | eSpeak NG GPL exposure | Medium | High | High |
| R-25 | Neural Engine and background audio | Medium | Medium | Medium |
| R-26 | iPhone memory and jetsam | Medium | High | High |
| R-27 | Ask Berean without a bundled runtime | Medium | Medium | Medium |
| R-28 | App Store review | Medium | High | High |
| R-29 | Privacy policy inaccurate for a new submission | High | Medium | Medium |
| R-30 | YouTube Data API key in shipped bundles | Medium | Medium | Medium |
| R-31 | YouTube surface cannot be native | High | Medium | Medium |
| R-32 | Feature parity slippage | High | High | High |
| R-33 | Long dual-maintenance period | High | High | High |
| R-34 | Loss of momentum | Medium | High | High |
| R-35 | Single-developer capacity | High | High | High |
| R-36 | Minimum OS choices | Medium | Medium | Medium |
| R-37 | Test coverage gaps | High | High | High |
| R-38 | Migration backup and rollback gaps | Medium | High | High |
| R-39 | PDFs have no second copy | Medium | High | High |
| R-40 | SQLite engine and FTS differences | Medium | Medium | Medium |
| R-41 | OS-level contracts and deep links | Medium | Medium | Medium |
| R-42 | Lessons of fixed defects not carried into native code (S-8, S-17) | Medium | Medium | Medium |
| R-43 | iCloud dataless files and very large records | Medium | Medium | Medium |
| R-44 | Shortcut conflicts and muscle memory | High | Low | Low |

---

## A. Data and sync

### R-01 Data loss during first-run import
- **Description.** The import path is the one place a native app can destroy the only copy. The audit's own strategy copies with `VACUUM INTO` or the backup API, validates, then renames, and never modifies the source (04 section 11.1, 11.5). Hazards: copying files rather than using the backup API (WAL `-shm`), a backup failure that does not stop a migration (04 M1), rebuilding the database from exported rows (05 S2), and relying on the vault as a source, which is lossy (04 section 6.5: `status` and `idiom_*` not restored; Study Trail, verse tags and AI chats not observed in sidecars; no HLCs or tombstones).
- **Likelihood / impact.** Medium / Critical.
- **Affected systems.** `berean.db` (586 MB production, doc 11 section 1 item 4), `pdfs/`, `backups/`, sync tables, vault.
- **Mitigation.** Follow 04 section 11.5 steps 1-12 and 04 section 12: untouched source, verified import copy, pre-migration copy; full `integrity_check`, `foreign_key_check`, FTS check; never merge two local databases; treat backup failure as a stop; never delete `berean.db.bak-*`, `backups/`, `pdfs/` or vault contents; keep a permanent "Open the old database" tool (04 section 12 item 6). Raise the 3-file backup retention so a pre-native backup is not evicted (04 section 12 item 2).
- **Detection.** The 04 section 11.6 table (row counts per table, per-table content digest, FTS sample queries, PDF hashes); local migration report with counts only (04 section 12 item 7); doc 11 section 5 matrix.
- **Rollback / recovery.** Mac before first native write: discard the copy, old app untouched (04 section 11.7). After native writes: old app opens its own source and receives native edits through sync if sync was on; otherwise a reverse export is needed (04 section 11.7). Automated restore does not exist (04 M3).

### R-02 Sync hash drift (S1, S12)
- **Description.** The Swift port must reproduce `hashFields` and `fieldHashes` exactly: 32-bit FNV-1a over UTF-16 code units of `JSON.stringify` output, sorted-key rules, number formatting (`12.0` prints `12` in JS), `SELECT *` column semantics, aggregate record shapes (05 section 13 table). Any difference makes every record look changed; reconcile gives every field a new clock, and a pending edit on another device loses to old text (05 S1, reproduced: both devices ended on `base`, the offline edit survived only as a conflict copy). S12 adds Unicode normalisation or line-ending changes by the importer, which would alter Hebrew and Greek text.
- **Likelihood / impact.** High / Critical.
- **Affected systems.** Sync engine, every synced entity (24 kinds per 05 section 3), all devices.
- **Mitigation.** Golden corpus from the TypeScript engine (05 section 15 phase 0; doc 08 section 11.2); hash parity must be 100% before sync starts (05 section 15 precondition 1; 04 section 11.6). Transitional option: run the existing engine in JavaScriptCore so hashes are identical by construction (05 section 13). If a difference is unavoidable, recompute `hash` and `field_hash` locally without creating ops, only directly after the old app's final full reconcile with an empty outbox (05 section 15). Adding a column to a synced table also changes every hash (05 section 11), so schema growth is a burst of ops.
- **Detection.** Swift-versus-TS hash test across unicode, emoji, surrogates, floats, null, nested, large strings (05 section 16 test 1). Today there is no dedicated golden test (11 G1). Stop conditions: a burst of ops above a set multiple of record count, any unexplained `sync_conflicts` increase (05 section 15).
- **Rollback / recovery.** Stop the native device; its journal stays valid and other devices carry on (05 section 15 phase 3). Damage already published as new clocks is not undone by stopping; conflict copies in `note_versions` are the recovery source.

### R-03 Sync bookkeeping or tombstones dropped at import (S2, S3, S21)
- **Description.** If import clears or rebuilds `sync_state`, `sync_outbox`, `sync_record_meta`, `sync_applied`, `sync_failed` or `sync_conflicts`, adoption republishes every record. Reproduced: a note purged on another device returned to Trash on three devices (`note-trashed`) (05 S2; 04 section 11.5). Tombstones are never garbage-collected and must survive (05 section 10). S21: treating `notes.deleted_at` as a tombstone turns Trash into permanent deletion or the reverse; there are three deletion models to keep (05 section 10).
- **Likelihood / impact.** Medium / Critical.
- **Affected systems.** Sync tables, Trash, sessions, tabs (production has 1,029 tombstones among 1,141 tab records, 05 section 11).
- **Mitigation.** Bookkeeping moves with the file untouched (04 section 11.5 closing rule); native preserves all three delete models (05 section 10); import precondition list in 05 section 15 (outbox empty or carried unchanged, no hold, bookkeeping intact).
- **Detection.** Row counts of sync tables before and after (04 section 11.6); sync audit digest of `(entity, key, hlc, hash)` across devices (05 section 15 ongoing verification).
- **Rollback / recovery.** Restore from the verified pre-migration copy before sync is enabled. After republish the recovery is manual from backups plus iCloud journals; 05 section 15 names Phase 5 schema growth as the point of no return.

### R-04 Native writes without capture; dual vault writers (S24, S20, D4, D5)
- **Description.** The D4 lesson: any write path that does not emit `data:changed` is invisible to sync, and the next remote edit fast-forwards over it with no conflict copy (05 section 2, D4). S20: old Mac and native Mac both enabled on one vault means mtime races (D5: `vault:reconcile` trusts file mtime). D4 and D1-D3 are fixed in the current app per this audit's brief, but a port written from the documents still must capture on every write path. D5 is not covered by PR 9.
- **Likelihood / impact.** Medium / High.
- **Affected systems.** Vault (Mac only, `vault.ts`), trash expiry, any native bulk write.
- **Mitigation.** Every native write goes through the capture path (doc 08 section 5.6 and open item S9: capture inside the transaction is an optional behaviour change). Only one app may own the vault at a time. Keep `vault.ts` in a Mac-only target (08 S11). Never use the vault as primary migration source (04 section 6.5).
- **Detection.** Sync audit digest (05 section 15); a vault test that actually calls app code, since `vault-sync.test.ts` is a tautology (11 G3).
- **Rollback / recovery.** Disable vault sync on one app; restore the text from `note_versions` or iCloud journals if any; the Octarine text is otherwise gone from the database and overwritten at the next export (05 D4 harness output).

### R-05 Device-id duplication across old and native copies (S4, S5, S22)
- **Description.** Two writers on one device id write the same seq and file names; iCloud then picks a file and ops are lost (05 S4). A DMG Electron left installed beside native is a second legitimate device writing stale tabs and edits (S5). A restored iPhone backup may or may not trip fork detection, which depends on file birthtime (S22; 04 section 14: whether Migration Assistant and restores preserve birthtime is UNVERIFIED).
- **Likelihood / impact.** Medium / High.
- **Affected systems.** Sync folder `devices/<id>/`, `resolveDeviceId` fork rules.
- **Mitigation.** Device-id policy in 05 section 15: keep the id only for in-place upgrades where the old app is gone (iPhone, MAS); force a fork with a new id when a DMG database is copied; rollback uses the old app's own id.
- **Detection.** Fork check, `manifest-ahead` check, the sync audit; manifest listing of `appVersion` per device (05 section 15 phase 4).
- **Rollback / recovery.** Retire one writer; republish `own:<old>`; device folders are never deleted automatically (05 section 15 phase 5).

### R-06 Schema gating between old and new devices (S6, S7, S17)
- **Description.** A device refuses a whole peer stream when `manifest.schema` is higher than its own. If native stamps schema 50, every old device stops pulling from it and shows only "Update Berean"; edits still reach native, so data flows one way (05 S6, reproduced; 05 section 11). If native keeps 49 but adds an entity or changes a JSON shape in `tabs.sync_state_json`, `ai_chats.messages` or `playlists`, old devices park or silently mis-apply it (S7). There is no downgrade guard: an older build accepts a newer database silently (04 M2; 17 S-17). Doc 08 open item S3 asks the same question; 04 M2 answers it from code.
- **Likelihood / impact.** High / High.
- **Affected systems.** `bereanMigrations.ts` (v49), sync manifests, every old device, rollback ability.
- **Mitigation.** Additive-only rule and no schema growth until every device is native (04 section 11.7 downgrade rule; 05 section 15 phases 3-5; doc 08 section 1 item 8). Add a too-new refusal to the old builds before anything ships (17 S-17; 04 M2). Native writes no renamed columns, no `NOT NULL` without default, no dropped tables, no changed JSON shapes.
- **Detection.** Schema-snapshot equality for every fixture version (11 section 10 stage 2); manifest `schema` and `appVersion` per device; `lastError: "Update Berean to sync with: ..."` appearing on any device.
- **Rollback / recovery.** Ship a higher-version Capacitor or Electron build on the same file and container (05 section 15 phase 4); after schema growth, restore from backups plus iCloud journals, with possible loss (05 section 15 point of no return).

### R-07 Retired devices holding unpublished edits (S8, S19, D1)
- **Description.** If the old app's outbox is not drained before its last run, its edits exist only locally and are gone when that app is deleted (05 S8; `data-safety.md` section 6 as cited). Migration during a D1 window means the last edit never published (S19). `status: synced` can overstate success; on Mac it says nothing about iCloud upload, since `FsSyncStore` has no `pendingUploads` (05 section 7). D1 is fixed in the current app, but only devices that took the fix are protected, and the lesson is that "synced" is not proof.
- **Likelihood / impact.** Medium / Critical.
- **Affected systems.** Any device being retired, particularly sync-off users for whom the local file is the only copy (04 section 11.1 item 6).
- **Mitigation.** Pre-migration checklist: successful sync on every device, empty `sync_outbox`, no holds, then a full backup (04 section 12 item 1); promote Export All Notes (04 section 12); keep the source for at least one release cycle (04 section 11.5 step 12); retire only after every known device reports native and all `applied` values are current (05 section 15 phase 5).
- **Detection.** Outbox count and `applied` per device; sync audit digest across devices (05 section 15).
- **Rollback / recovery.** Reopen the retired device's untouched database and let it sync, if it still exists; otherwise only backups and the vault export remain.

### R-08 Premature pull, compaction or folder cleanup (S15, S16, S17)
- **Description.** Pulling before import finishes bootstraps against a partial database, and the quarantine guard may flag real records (S15). Deleting an old device folder as "cleanup" strands records whose only publisher it was, because snapshots hold only records the device currently publishes (S16; 05 section 9). Native compaction with different rules can prune a journal before a slow Electron device applies it; the 90-day silence rule also catches a long-idle Mac (S17).
- **Likelihood / impact.** Medium / High.
- **Affected systems.** `devices/` folders, compaction, snapshots, quarantine.
- **Mitigation.** Start sync only after verification (04 section 11.5 step 10); never delete device folders automatically; native compaction stays conservative: never prune another device's needs and never while any manifest reports an older `appVersion` (05 section 15 phase 4). The container is user-visible in Files and iCloud Drive (`NSUbiquitousContainerIsDocumentScopePublic`), so a user can delete journals by hand, and `README.txt` is the only protection (05 section 4).
- **Detection.** Holds (quarantine, container, account, database, fork); per-device record counts; any drop in a device's record count is a stop condition (05 section 15).
- **Rollback / recovery.** Restore the folder from iCloud versions if available, or republish from a surviving full device (05 section 9: a survivor publishes them only on a change).

### R-09 Identifier, date and text normalisation drift (S10, S11, S12)
- **Description.** Deterministic ids collide across devices by design: `daily-<date>`, `conflict-<hlc>`, session id `default`, `share-<item>` (05 section 4, 13). A different timezone or sunrise rule creates two daily notes for one day (S11); normalised ids create duplicates (S10); rewriting `updated_at` or text turns every touched record into a real change (S12).
- **Likelihood / impact.** Medium / High.
- **Affected systems.** Daily notes (03 N12 sunrise day boundary), PDFs, notes, vault-derived ids.
- **Mitigation.** Port id generation with golden cases (05 section 13); importer never rewrites `updated_at` or text; heading-collapse key function unchanged (09 section 2.9).
- **Detection.** Duplicate-id and duplicate-daily scans in the sync audit; DB content digest (04 section 11.6).
- **Rollback / recovery.** Merge duplicates by hand through the app; originals remain in `note_versions`.

### R-10 Port inherits fixed sync defect classes (D1-D3, D5-D7, S18)
- **Description.** The Swift engine, if written from the TypeScript logic, can reproduce the defect classes: in-flight coalesce deleted unpublished (D1), snapshot bootstrap order violating foreign keys, so fresh devices lack tag edges (D2, S18), failed ops pruned by `MAX(seq)` (D3), skipping a gap while `sync_failed` is non-empty (05 section 7, INFERRED), mtime-trusting reconcile (D5), unsynced entity kinds (D6), no Mac account check (D7). D1-D4 are being fixed in PR 9; D5-D7 are not covered by that PR.
- **Likelihood / impact.** Medium / High.
- **Affected systems.** `BereanSync` (doc 08 section 5.6), snapshot bootstrap, `captureVanished`.
- **Mitigation.** Regenerate sync fixtures after PR 9 (11 section 10 stage 0); D1-D4 scenarios must be green in the Swift suite (11 section 10 stage 3); fix D5-D7 or specify them before porting.
- **Detection.** Stage A and B interop tests with zero divergence over fuzz seeds, then Stage C on real devices in the Dev container (11 section 10 stage 3); `chaos.fuzz` has one test and no property library (11 G13).
- **Rollback / recovery.** As R-02.

### R-11 Account and container mismatch (S13, S14, S25, D7)
- **Description.** A different container or team ID gives an empty container; the user enables sync and gets a parallel cloud world; Mac and iPhone can diverge silently by picking different containers (S13). A release environment or other team ID makes the container unavailable and looks like signed-out (S14; team must stay `6C8RCZVUZR`). The Mac has no account check (D7); signing in with a second Apple ID goes unnoticed (S25). Whether the iPhone account-token hash is stable across relaunch and OS updates is UNVERIFIED (05 section 8).
- **Likelihood / impact.** Medium / High.
- **Affected systems.** iCloud containers `iCloud.com.berean.app` and `.dev`, `berean-identity.json`, `isForeignContainerPath`.
- **Mitigation.** Same container and team (05 section 13); keep the dev/prod isolation checks (05 section 12); give the Mac host an account check instead of copying the current host.
- **Detection.** `hold: account`, `hold: container`; identity file mismatch.
- **Rollback / recovery.** Resolution choices on iPhone: switch back, or republish into the new account, deleting nothing (05 section 8).

### R-12 Bundle ID, team and container continuity broken
- **Description.** An in-place App Store update requires the same bundle ID `com.berean.app` under the same team, preserving `iCloud.com.berean.app`, `group.com.berean.app`, extension ids `com.berean.app.share` and `.widget`. A new bundle ID is a new App Store record: no update path, no container data, no iCloud access, no TestFlight continuity (17 section 11.2 item 1). The Mac MAS app-group entry `6C8RCZVUZR.com.berean.app` exists only for Chromium rendezvous; removing it changes the sandbox profile and needs re-validation by App Review (17 item 11).
- **Likelihood / impact.** Low / Critical (a mistake here is hard to undo).
- **Affected systems.** App Store record, iCloud container, App Group, Share Extension, widget, URL schemes `berean` and `berean-pdf` (17 section 11.1).
- **Mitigation.** Keep all identity values in 17 section 11.1; use Berean Dev identity (`com.berean.app.dev`) for early native builds so production is untouched (doc 08 section 14); keep `config/app-identity.json` as the single source and verify signed artifacts against it.
- **Detection.** `verify-mas.mjs` and `ios:check`-style identity checks (17 section 10.2; 02 section 16).
- **Rollback / recovery.** None for a new App Store record; hence the Dev rehearsal in 05 section 15 phase 1.

### R-13 MAS versus direct-download data locations
- **Description.** DMG and MAS share a bundle ID, so one Mac can hold two independent databases with different device ids; installing one over the other at `/Applications/Berean.app` changes which location is used (04 sections 7, 11.2; 17 section 11.2 item 3). On the author's Mac the MAS container exists but has no Berean folder, so MAS with real data has never been observed (04 section 14, BLOCKED). If both exist the importer must show both and let the user choose, never merging (04 section 11.5 step 1).
- **Likelihood / impact.** High / High.
- **Affected systems.** First-run detection, sync device ids, vault.
- **Mitigation.** Route by current distribution (04 section 11.2 table): MAS to sandboxed native inherits the container; DMG to non-sandboxed Developer ID uses the same paths. First-run check examines both locations.
- **Detection.** Source detection step in the importer; migration report.
- **Rollback / recovery.** Source untouched; choose the other source.

### R-14 Sandboxed native app cannot reach DMG data
- **Description.** For DMG users moving to a sandboxed app, the data lies outside the sandbox. `container-migration.plist` is rejected: it moves rather than copies, runs only at first container creation, and the container already exists on this Mac (04 section 11.2). The temporary-exception entitlement has unknown App Review acceptance; Electron writing into the container may be blocked by app-data protection.
- **Likelihood / impact.** High / High.
- **Affected systems.** DMG users, security-scoped bookmarks, `sandbox-bookmarks.json` (04 section 6.3).
- **Mitigation.** `NSOpenPanel` grant with app-scoped bookmark, or a final Electron release that exports a bundle through `VACUUM INTO` plus PDFs plus a localStorage JSON (04 section 11.2); the export also covers R-16.
- **Detection.** First-run source detection fails closed with a visible message; migration report.
- **Rollback / recovery.** Old app untouched.

### R-15 Updater bridge for installed DMG users
- **Description.** Installed DMG apps update through `electron-updater` and GitHub Releases. A native app arrives by that route only if the final Electron release accepts a signed zip containing the native app under the same signing identity; this is UNVERIFIED (04 section 11.2; 17 section 11.2 item 4). Existing Electron installs need one bridging release. Rollback of a bad Mac release means publishing a higher version; `allowDowngrade` is unset and no revert script or runbook exists (17 section 10.4). The release pipeline has its own weaknesses: notarization silently skipped when `APPLE_ID` is unset (S-15), and a failing Windows job blocks the Mac release (S-16).
- **Likelihood / impact.** High / High.
- **Affected systems.** `electron-updater`, `latest-mac.yml`, `release.yml`, Sparkle or successor.
- **Mitigation.** Prototype the bridge before committing to a Mac route (see doc 15 B-12); decouple Mac publishing from the Windows job; assert notarization in CI (17 S-15); rehearse rollback (11 section 10 stage 6).
- **Detection.** Update-channel test on a clean DMG install; Gatekeeper and notarization verification of the shipped zip.
- **Rollback / recovery.** Publish a higher-version Electron build; installs that already took a bad version keep it until then (17 section 10.4).

### R-16 WKWebView and LevelDB localStorage state lost
- **Description.** Zustand persists `berean-app-state` and many `berean*` keys to localStorage. Mac: Chromium LevelDB, private format. iPhone: WKWebView WebsiteData, path UNVERIFIED (04 section 6.1). Not enumerated field by field which settings exist only there; `wordReplacerRules`, `customThemes`, `dailyNoteLocation`, chat drafts, replies and groups have no copy in `settings` (04 section 6.1, 11.4). Loss resets user-authored settings silently (11 G15: one store test, no export test).
- **Likelihood / impact.** High / High.
- **Affected systems.** Both platforms, onboarding of settings into native storage.
- **Mitigation.** Priority order: user content, user-authored settings, preferences, UI state (04 section 11.4). Preferred: a bridge release that writes all `berean*` keys to a JSON file at every launch, needing at least one launch before the native update. Fallback: hidden WKWebView at the old origin `capacitor://localhost` (INFERRED, test first); LevelDB parser as last resort. Build the field map first (04 section 14).
- **Detection.** Compare the exported key list with the importer's accepted keys; first-run report lists what was not carried across.
- **Rollback / recovery.** Keep the JSON file and the old app's storage; the old app still holds its own copy.

### R-17 Non-portable secrets and sessions
- **Description.** Provider keys (`provider-keys.json`, Electron `safeStorage`) are treated as non-portable; YouTube and BibleGateway sessions are Chromium-encrypted; sandbox bookmarks work only for the same signed identity (04 section 6.3). Whether a native app signed by the same team can read the Keychain item is UNVERIFIED (04 section 14).
- **Likelihood / impact.** High / Low.
- **Affected systems.** Mac Ask Berean cloud provider, YouTube login, vault folder access.
- **Mitigation.** Plan for re-entry; show what was not carried across (04 section 11.5 step 11). Cloud consent should fail closed and be re-asked (04 section 6.3).
- **Detection.** Post-import checklist screen.
- **Rollback / recovery.** User re-enters keys and signs in again.

### R-38 Migration backup and rollback gaps
- **Description.** A failed backup does not stop a migration (M1); a newer database opens silently (M2); no automated rollback (M3); migrations are not reversible (M4); several migrations swallow `ALTER` errors (M5); backups are full copies, about 430-470 MB each on production (M6) (04 section 3). Retention keeps 3, so a pre-native backup can be evicted after three schema steps (04 section 12).
- **Likelihood / impact.** Medium / High.
- **Affected systems.** `runMigrations`, backup folders, iOS storage.
- **Mitigation.** Native treats backup failure as a stop (04 section 11.5 step 7); compare versions by `MAX(version)`, never row count (v18 is missing, 04 section 3); build a restore tool before it is needed.
- **Detection.** Backup presence and size check in the migration report.
- **Rollback / recovery.** Manual restore from `VACUUM INTO` copy.

### R-39 PDFs have no second copy
- **Description.** PDF bytes do not sync (metadata only; other devices show `fileMissing` until the same file is imported, matched by `file_hash`) and are not re-creatable, unless the vault export ran (04 section 6.4, 12 item 5; 05 section 3).
- **Likelihood / impact.** Medium / High.
- **Affected systems.** `<userData>/pdfs/`, iPhone `Library/Berean/pdfs`, PDF highlights and bookmarks (no PDF tests, 11 G4).
- **Mitigation.** Count and hash PDFs first; verify every `pdfs.filename` exists and SHA-256 equals `file_hash` (04 section 11.6); copy by hash (04 section 11.5 step 6); close G4 before stage 1.
- **Detection.** PDF check row of 04 section 11.6.
- **Rollback / recovery.** Source folder kept untouched.

### R-40 SQLite engine and FTS differences
- **Description.** Apple SQLite differs from better-sqlite3: foreign keys default OFF, double-quoted strings accepted, URI filenames, `recursive_triggers` reading 0 despite the compile list (04 section 5). Unicode tables may differ between SQLite versions, affecting Hebrew and Greek `unicode61` behaviour (04 section 4). iOS minimum-version SQLite and FTS5 options are UNVERIFIED. GRDB FTS5 build needs are UNVERIFIED (04 section 14).
- **Likelihood / impact.** Medium / Medium.
- **Affected systems.** All SQL, FTS indexes, `ATTACH` with `immutable=1`.
- **Mitigation.** Set `foreign_keys` and `recursive_triggers` explicitly on every connection; compare sample searches after any engine change (04 section 4).
- **Detection.** FTS equality tests (11 section 10 stage 2).
- **Rollback / recovery.** Rebuild FTS from content tables.

### R-43 iCloud dataless files and very large records
- **Description.** On this macOS files keep names and carry the `dataless` flag; the `.icloud` placeholder logic is effectively unused and a read materialises the file, blocking a thread (05 section 12 item 1; 05 section 4: 4,896 listing lines carry the flag). Snapshot cost forces a full download of 4,552 files, not measured (05 section 9). The Mac has no `NSFileCoordinator` (05 section 12 item 2). The largest note is about 9.1 M characters, so one op exceeds the 256 KB chunk target (05 section 3). The 2026-09-22 Mac freeze is the recorded precedent (05 section 12; project memory cited there).
- **Likelihood / impact.** Medium / Medium.
- **Affected systems.** Mac sync store, snapshot publish, native file access.
- **Mitigation.** A native Mac app should use file coordination (05 section 12); read off the main thread; test with evicted files.
- **Detection.** Instruments and a dataless-file test matrix.
- **Rollback / recovery.** Disable sync; local database unaffected.

---

## B. Notes, text and reader

### R-19 Notes editor Markdown fidelity
- **Description.** No Apple component covers callouts, columns, threads and tables with this private dialect (09 section 0; 07 section 1 item 3). `swift-markdown` is the wrong base: it cannot disable indented code, does not keep `html: false` literal behaviour, and cannot take the custom `==`, `[[ ]]`, `<u>`, `<mark>` rules (09 section 2.3). A Swift port of markdown-it's used subset plus prosemirror-markdown's serializer is effort L; full editor parity is XL, 9-15 engineer-months on both platforms, low confidence (09 section 2.6 sum). Byte differences show as edits on every device and cause sync ping-pong (09 section 2.9). Old unnormalised notes will meet the new engine (448 of 3,325 once mismatched, 09 section 2.3).
- **Likelihood / impact.** High / Critical.
- **Affected systems.** Notes, version history, vault round trip, FTS (reads Markdown), sync.
- **Mitigation.** Build the engine first and prove it with no UI: `swift(serialize(parse(x)))` equals the TS result byte for byte over every real note, plus fuzz and the 29-30 round-trip cases (09 section 2.3); serialize only after a real edit (09 section 2.9); the raw Markdown mode no longer exists, `Cmd+Shift+M` toggles Edit/View (09 section 0). Option D, a WKWebView editor, is temporary only (09 section 2.5).
- **Detection.** The real-note corpus is BLOCKED (no vault access, 11 G12); until it exists fidelity is unmeasured.
- **Rollback / recovery.** Version history strings are identical (09 section 2.9); notes remain Markdown in the database.

### R-20 Parity ambiguity over formerly lossy behaviour (table cells)
- **Description.** Before PR 10, saving a note dropped inline formatting in table cells because `table()` wrote `cell.textContent` (09 section 2.3). Treated as fixed. The migration risk: a native engine built from older documents or goldens either reproduces the loss or diverges from the fixed output, and bytes differ across devices. Trailing spaces at line ends and hand-aligned table spacing also do not survive today (09 section 2.3).
- **Likelihood / impact.** Medium / Medium.
- **Affected systems.** Markdown engine goldens, notes with tables.
- **Mitigation.** Regenerate goldens after PR 10 merges; record explicitly which known losses are reproduced and which fixed (doc 15 C-10).
- **Detection.** Golden test that includes formatted table cells (11 section 2.1 G12 notes only plain cells are tested today).
- **Rollback / recovery.** Version history retains pre-save text.

### R-21 Highlight offset anchoring
- **Description.** Highlights are character offsets into plain `verse.text` of a specific `text_id`, with no quoted-text or hash anchor; legacy word-level rows use a word index into tagged tokens, a second coordinate system; a text DB correction that shifts characters silently misplaces highlights (03 H02; 06 section 9.2). The screen string differs from the plain text (word replacer, supply brackets, inline Strong's). A bijective `DisplayMap` is needed. It is not verified over the 19 text DBs (11 G7) and the corpus is BLOCKED (06 M2).
- **Likelihood / impact.** Medium / High.
- **Affected systems.** Reader, highlight toolbar, highlight sync (03 H06), `scriptureHighlight.ts`, `verseUtils.ts`.
- **Mitigation.** Treat the conformance corpus (every highlighted `(text_id, verse)` rendered by both engines) as a gate before any native release that writes highlights (06 section 9.2). Never re-seed texts without a re-anchoring plan (03 H02: Enoch splits and KJV italics re-seed are the precedent). Bundled texts have no version stamp (04 section 3).
- **Detection.** Export all highlight rows, render, and diff against the web renderer's DOM offsets (06 M2).
- **Rollback / recovery.** Highlight rows are unchanged in the database; fix the map and re-render.

### R-22 TextKit 2 stability and performance
- **Description.** One TextKit 2 text view per chapter must hold 60 fps on Psalm 119 and a two-chapter continuous scroll with 500 highlights (UNVERIFIED, 06 M1). `NSTextTable` under TextKit 2 on iOS 27, and stability on long notes with custom fragments and attachments, are unknown (09 section 4). Selection across table or column boundaries is reduced under Option A (09 section 2.5). Accessibility of one large text view needs per-verse children; no VoiceOver audit exists (06 section 1 item 7; 07 I9). Edge-back, pager and native sheets gesture arbitration is UNVERIFIED (07 I3).
- **Likelihood / impact.** Medium / High.
- **Affected systems.** Scripture reader and notes editor on both platforms.
- **Mitigation.** Time-boxed spikes (06 section 16 M1, M4; 09 investigation plan E4-E6); Option B (one text view per block) is the fallback (09 section 2.5); raising the floor to iOS 27 / macOS 27 removes risk at the cost of users (09 section 2.5).
- **Detection.** Instruments on real chapters with synthetic highlights; doc 10 baseline suite for before-and-after (10 section 8).
- **Rollback / recovery.** Architecture change before shipping; no user data involved.

### R-31 YouTube surface cannot be native
- **Description.** Playback is a hosted web view with native chrome (06 section 12). Programmatic PiP without a user gesture on macOS WebKit is UNVERIFIED; Google sign-in inside `WKWebView` may be rejected by Google policy for embedded user agents (UNVERIFIED, test early). The channel feed scrapes channel pages and carries its fragility and ToS exposure unchanged; the transcript fetch is dev-only and must stay out of shipping binaries (06 section 12; project rule in 03 M04).
- **Likelihood / impact.** High / Medium.
- **Affected systems.** YouTube space, PiP, timestamp insert, transcripts.
- **Mitigation.** Report it to stakeholders as web content with native chrome (06 section 12); prototype sign-in and PiP first (06 M6); keep the fetch tooling in a separate non-shipping target.
- **Detection.** Prototype with a test account.
- **Rollback / recovery.** Keep the web island; drop auto-PiP if blocked.

### R-30 YouTube Data API key in shipped bundles
- **Description.** The key is compiled into every Mac and Windows bundle from a CI secret, recoverable from the asar; its restrictions are unknown (17 S-14; `electron/ipc/youtube.ts:19,330,357`). A native app must re-provision it; the `player.berean.app` Referer assumes ownership of `berean.app`, not verified (17 section 11.2 items 9 and 12). The iPhone app has no such key today.
- **Likelihood / impact.** Medium / Medium.
- **Affected systems.** YouTube search, channel data, the Google Cloud project.
- **Mitigation.** Decide how the key ships natively (doc 15 C-8); confirm restrictions in the Google console (doc 15 D-6).
- **Detection.** Quota monitoring in Google Cloud (external).
- **Rollback / recovery.** Rotate the key; shipped binaries keep the old one until updated.

---

## C. Read Aloud and AI

### R-23 Kokoro G2P without eSpeak changes the voice
- **Description.** Today's phonemes come from eSpeak NG through `kokoro-js` and `phonemizer`. A Swift path needs another G2P (closed-corpus lexicon, CMUdict plus rules plus names, MisakiSwift, FluidAudio); each sounds somewhat different, and `PRONUNCIATION_RESPELLINGS` is tied to eSpeak's rules, so changing G2P voids all tuning (09 section 3.3, 3.4). The corpus is 26,000 unique words; 94.80% of words match eSpeak if stress is ignored (46.99% with stress); this compares eSpeak with itself and says nothing about how another table sounds (09 section 3.4). Stress may matter to Kokoro prosody. On the Yeshua respelling see doc 15 C-9.
- **Likelihood / impact.** High / Medium.
- **Affected systems.** Read Aloud on Mac and iPhone, word replacer output (not in the stored texts, so extra to the 26,000), `textPrep.ts`.
- **Mitigation.** A/B listening gate (09 section 3.4); lexicon plus function-word rules plus IPA overrides; direct IPA entries bypass spelling tricks (09 section 3.3).
- **Detection.** Blind listening by Michael; BLOCKED here, no audio was generated (09 section 3.3).
- **Rollback / recovery.** Keep the current Electron and Capacitor voices until accepted.

### R-24 eSpeak NG GPL exposure
- **Description.** `phonemizer` declares Apache-2.0 but embeds eSpeak NG (GPL v3 or later); `kokoro-js` imports it, so a GPL engine is INFERRED to ship today in the Electron Mac app, the MAS build and the iPhone App Store build (09 section 3.4). Linking eSpeak into a Swift app is not acceptable for App Store distribution (09 table, INFERRED). The exposure is current, not only post-migration. Legal status of data derived from eSpeak dictionaries needs review, as does the licence of CMUdict (full text not read) and of misaki dictionaries.
- **Likelihood / impact.** Medium / High.
- **Affected systems.** All shipping apps with Read Aloud; any Swift G2P choice.
- **Mitigation.** Legal review (doc 15 D-1); prefer a G2P built from permissive sources; do not ship derived eSpeak data without review.
- **Detection.** Licence inventory of every bundled model and dictionary.
- **Rollback / recovery.** Disable Berean Voices in a release if counsel requires.

### R-25 Neural Engine and background audio
- **Description.** Apple's iOS 27 documentation states any Neural Engine access in the background needs the Background Inference entitlement; interaction with the `audio` background mode is not documented; GPU work from the background is denied per DTS replies (secondary); a June 2026 forum post reports ANE background inference worked on iOS 26 and broke in iOS 27 Seed 1 (secondary) (09 section 3.5). An ANE-only design carries real risk for locked-screen reading. Silence risks app suspension if synthesis falls behind (09 section 3.6, INFERRED).
- **Likelihood / impact.** Medium / Medium.
- **Affected systems.** iPhone Read Aloud with screen locked, `BereanAudioPlugin` successor.
- **Mitigation.** CPU (ORT or Core ML `.cpuOnly`) as the safe baseline; deep prefetch of many seconds; pre-render before backgrounding is the alternative (09 section 3.5). Add interruption, route-change and media-services-reset handling that does not exist today (09 section 3.6).
- **Detection.** Physical-device tests R3-R7 (09 section 4); BLOCKED here.
- **Rollback / recovery.** Fall back to CPU inference.

### R-26 iPhone memory and jetsam
- **Description.** Kokoro ONNX inference runs in-process with 19 bundled text databases and a 7 MB YouTube index; limits were never measured on a device (07 section 1 item 6, 15.3; BLOCKED). A native app puts everything in one process, so jetsam headroom is shared with text, DB and images (09 section 3.6, INFERRED). Oldest iOS 17 devices may need a device floor for Berean Voices (09 section 3.5). Memory-mapped large DBs: `cross_references` 19.8 MB, `tske_refs` 45 MB, `strongs_greek` 28 MB (07 section 15.3).
- **Likelihood / impact.** Medium / High.
- **Affected systems.** iPhone reader, search, Read Aloud, YouTube embed.
- **Mitigation.** Define targets first (cold launch, chapter swipe, FTS-as-you-type, resident memory with a Kokoro session loaded, jetsam margin with a YouTube embed); `os_proc_available_memory` checks; unload on warning; fp16 model; `increased-memory-limit` (behaviour not confirmed) (07 section 15.3; 09 section 3.6).
- **Detection.** Physical-device Instruments runs; doc 10 section 8 suite.
- **Rollback / recovery.** Disable voices on low-memory devices.

### R-27 Ask Berean without a bundled runtime
- **Description.** The Mac pipeline is 4,156 lines in `electron/ipc/aiLookup.ts` using Ollama on `localhost:11434`, a user-installed daemon; the iPhone is model-free (`modelFreeLookup`, 117 lines) with optional online research; there is no cloud-key feature on iPhone (08 section 5.9; 09 section 1.5; 07 section 15.1; 03 G07, G10). Embedding queries need the same `nomic-embed-text` model; another model's vectors are meaningless against the index (09 section 1.5), and recall@5 is already modest at 26.7%. Foundation Models quality is unknown and its availability is UNVERIFIED. A sandboxed Mac app needs a network-client entitlement to reach Ollama (08 section 5.9, INFERRED). Cloud calls to Anthropic need disclosure review (17 section 9.1).
- **Likelihood / impact.** Medium / Medium.
- **Affected systems.** Ask Berean, Berean Chat, collections and profiles (synced entities `study_profile`, `ai_saved_context`, `ai_chat`).
- **Mitigation.** Decide the canonical behaviour per platform (doc 15 C-4); freeze `scripts/eval/bench` cases as the quality oracle and port only deterministic pre/post-processing (11 section 13); the 19 raw `.prepare` statements must first move behind domain APIs if the pipeline is ported (08 section 5.9).
- **Detection.** The bench harness needs Ollama and a GPU and was not run (11 section 13).
- **Rollback / recovery.** Mac keeps Ollama HTTP client; no data at risk.

---

## D. Release, store and policy

### R-28 App Store review
- **Description.** History: MAS rejection 2.4.5(i) for an unused Downloads entitlement (June 2026) and ITMS-90683 for an always-location string, both fixed (17 section 9.1). Open: whether Apple's rules on disclosing and obtaining permission before sharing personal data with third-party AI are met by the Anthropic BYO-key flow (17 section 9.1); the App Review acceptance of temporary-exception entitlements is UNVERIFIED (04 section 11.2); MAS still needed an iCloud profile and installer certificate per the last recorded note, UNVERIFIED for this commit (17 section 10.2); whether Developer ID supports the iCloud Documents entitlement is UNVERIFIED (04 section 11.2). A native app drops `allow-jit` and unsigned-executable-memory, reducing friction (17 item 11, INFERRED).
- **Likelihood / impact.** Medium / High.
- **Affected systems.** Mac MAS, iPhone, same store record (17 section 9.2 recommendation).
- **Mitigation.** Review each entitlement against use; reconcile the privacy label with R-29 before submission; phased release; the `release-berean` human checkpoints stay (17 section 10.3).
- **Detection.** Local `verify-mas` and App Store export check before upload.
- **Rollback / recovery.** The App Store has no downgrade; rollback is a higher-version Capacitor build that can still read the database (04 section 11.3); phased release limits exposure.

### R-29 Privacy policy inaccurate for a new submission
- **Description.** `docs/privacy.md` (and `privacy.html`, both "Last updated: May 2026") says "No location data is accessed" and "entirely offline"; the app requests geolocation once per launch for sunrise day boundaries, uses many network hosts, syncs through iCloud, and has an iPhone app, Share Extension and widget (17 section 9.2). Missing: AI/cloud flow, BibleGateway import, model downloads, contact for iCloud data deletion. The new binary is submitted under the same record.
- **Likelihood / impact.** High / Medium.
- **Affected systems.** Store listing, privacy label, MAS metadata review comparing the location entitlement.
- **Mitigation.** Reconcile policy and label before or with any identity-preserving binary (17 section 9.2); wording in doc 15 C-7.
- **Detection.** Table comparison in 17 section 9.2 repeated against the native binary's actual calls.
- **Rollback / recovery.** Update the policy; resubmit metadata.

### R-18 Windows users left behind
- **Description.** The CI builds an unsigned NSIS x64 installer from the Electron code; a Swift app does not run on Windows. Whether Windows installers reach real users is UNVERIFIED (17 section 11.2 item 5; 02 section 1 item 3; 02 section 20). If any exist they stay on the last Electron build, with electron-updater verifying only the SHA-512 in `latest.yml`, and no iCloud on Windows, so the only cross-platform paths are vault export and the DB file (17 item 5). CLAUDE.md calls Windows deferred. S-16 couples Mac publishing to the Windows job.
- **Likelihood / impact.** Medium / Medium.
- **Affected systems.** `release.yml` Windows job, GitHub Releases feed, `%APPDATA%\Berean`.
- **Mitigation.** Establish whether anyone uses it (doc 15 A-8); decide a fate (doc 15 C-1); decouple Mac and Windows publishing (17 S-16).
- **Detection.** Release download counts (external, not available to the audit).
- **Rollback / recovery.** Keep the last Electron Windows release available.

### R-36 Minimum OS choices
- **Description.** Floors today: iOS 17.0; Electron `LSMinimumSystemVersion` 12.0 (08 section 12). Candidate native floors carry different costs: iOS 17 / macOS 14 means more `#available` forks; iOS 18 / macOS 15 is the audit's default; 26 gives glass and rich text for free but drops users. `TextEditor` with selection is iOS 26+ and still not usable for this editor (09 section 0). Kokoro ports and MisakiSwift need iOS 18 / macOS 15; Core AI is iOS 27 only; some editor hooks are iOS 27 (09 section 2.5, 4). macOS 12-13 users are dropped by any macOS 14+ floor; their number is UNVERIFIED. Install-base data is not available to the audit (08 section 12; 06 M9; 07 I1).
- **Likelihood / impact.** Medium / Medium.
- **Affected systems.** All native targets, `BereanDesign` glass modifiers.
- **Mitigation.** Decide after App Store Connect and GitHub Releases data; wrap glass in `if #available` so raising the floor later deletes code (08 section 12).
- **Detection.** Install-base data (external).
- **Rollback / recovery.** Raising a floor later is a code deletion; lowering it is expensive.

### R-44 Shortcut conflicts and muscle memory
- **Description.** The existing user's habits conflict with Mac conventions: `Cmd+H` is History (app hide remapped to `Cmd+Shift+H`), `Cmd+G` toggles Strong's against system Find Next, `Cmd+Shift+S` toggles sidebar against Save As, `Cmd+Y` as History collides with editor redo, `Ctrl+Cmd+S` is both the system sidebar toggle and a Strong's candidate, `Cmd+Shift+V` collides with Paste and Match Style, and `Cmd+L` menu label differs from renderer behaviour (06 section 8.3, M7).
- **Likelihood / impact.** High / Low.
- **Affected systems.** Menu bar, command layer, notes editor keymap.
- **Mitigation.** Decisions in doc 15 C-5; the code-derived table in 06 section 8.3 supersedes CLAUDE.md.
- **Detection.** Manual test of each binding with editor focus and Scripture focus.
- **Rollback / recovery.** Rebindable later; shortcut editing is deferred today (03 U10).

---

## E. Programme risks

### R-32 Feature parity slippage
- **Description.** 03 inventories features across scripture, search, notes, highlights, shell, media and Ask Berean; 07 section 14 is a ledger that nothing may be silently lost; several surfaces are Mac-only (multi-window, presenter, vault, BibleGateway and e-Sword import) (03 U07, N10, N14, N15). Items documented but absent or partial: highlight sync across translations (H05), pinned tabs (U03), shortcut editing. The editor alone is XL and the sum for parity on both platforms is 9-15 engineer-months, low confidence (09 section 2.6). Whether the standalone window and floating rail are used is unknown (06 M10).
- **Likelihood / impact.** High / High.
- **Affected systems.** Entire native scope.
- **Mitigation.** Keep the 07 section 14 ledger as the acceptance list; each feature row is an automated pass or a signed manual pass (11 section 10 stage 5); read-only native milestone is a safe early point (08 section 14).
- **Detection.** Parity checklists (11 section 7) and cross-platform parity table (11 section 9).
- **Rollback / recovery.** Old apps keep shipping until parity.

### R-33 Long dual-maintenance period
- **Description.** The Electron Mac, the Capacitor iPhone and the Swift apps may share one container for weeks or months; iPhone and Mac updates can land at different times (05 S9; 17 section 11.2 item 7). The whole of 05 section 13 must hold for that period, behaviour under mixed versions was not tested, and every schema and format change needs older apps to tolerate it (04 section 11.7; 08 section 1 items 3 and 8). Retention windows interact: 90-day silence rule, keep-source-one-release-cycle (05 section 9; 04 section 11.5).
- **Likelihood / impact.** High / High.
- **Affected systems.** Both old apps, release pipeline, CI.
- **Mitigation.** Phased rollout with the old apps kept working at least through the 90-day window (05 section 15 phase 4); no schema growth until retirement; hold doc 08 section 10.2 release independence.
- **Detection.** Manifest `appVersion` list per device; sync audit.
- **Rollback / recovery.** Rollback table in 05 section 15.

### R-34 Loss of momentum
- **Description.** Stage 0 alone requires a golden exporter, closing gaps G1, G2, G4, G5, G6, a Swift CI job and a baseline run before any Swift code ships (11 section 10 stage 0); seven stages precede retirement of the old apps. The docs give no schedule; this risk is INFERRED from stage count and the effort classes in 09 (L = 1-3 months, XL = more than 3). A stalled migration leaves the dual-maintenance cost of R-33 with no end date.
- **Likelihood / impact.** Medium / High.
- **Affected systems.** Programme.
- **Mitigation.** Treat each stage exit as a separate owner decision (11 section 10); keep the early milestones useful on their own: golden corpus and CI improve the current app (11 section 3-4); read-only native app is a safe milestone (08 section 14).
- **Detection.** Stage gates not met by dates the owner sets.
- **Rollback / recovery.** Stop at any gate; nothing before stage 3 writes to production data.

### R-35 Single-developer capacity
- **Description.** The project has one developer; the shared-package design rejects separate repositories for that reason (08 section 3 row C). Effort classes assume one experienced Swift engineer (09 section 0), and the doc 09 sum for editor plus Read Aloud plus reader is 9-15 months with low confidence. Test and manual device work add to it: 11 section 12 lists checks that must be manual and on a physical device.
- **Likelihood / impact.** High / High.
- **Affected systems.** Programme, release cadence of the existing app during the migration.
- **Mitigation.** Sequence by the dependency graph (08 section 14); external review before commitment is already the plan; avoid parallel streams.
- **Detection.** Throughput against stage budgets; the current app's release cadence slipping.
- **Rollback / recovery.** Pause; the existing apps remain shippable.

### R-37 Test coverage gaps
- **Description.** From doc 11 section 2.1: no hash golden test (G1); op encode/decode has 4 cases (G2); no real vault path test and `vault-sync.test.ts` is a tautology (G3); no PDF tests (G4); no `studyTrailService` contract test (G5); no historical-schema fixture (G6); highlight offsets unverified over the text DBs (G7); no native bridge tests beyond 7 files (G8); no snapshot or accessibility tests (G9); no UI automation (G10); no Xcode CI job and the native suite is one file with 5 tests (G11); notes round trip has 29 hand-written cases and no real corpus (G12); one fuzz test (G13); real iCloud timing untested (G14); settings migration has 1 store test (G15); no performance budgets (G16). Counts are regex counts and the suite was not re-run (11 section 14). Test counts in other documents are likewise INFERRED (08 section 1 item 2).
- **Likelihood / impact.** High / High.
- **Affected systems.** Every oracle the migration relies on.
- **Mitigation.** Close G1, G2, G4, G5, G6 and replace the tautology test in stage 0 (11 section 10); freeze the TS implementation as the oracle (11 section 1 item 5).
- **Detection.** Stage 0 exit criteria.
- **Rollback / recovery.** Do not start a stage with an unmet entry gate.

### R-41 OS-level contracts and deep links
- **Description.** `berean://` and `berean-pdf://` URLs live inside users' notes and vault exports; the Share Extension's App Group JSON inbox, widget URL `<scheme>://chat/new`, Spotlight identifiers and five App Intents are contracts with the OS and already-installed extensions (17 section 11.2 item 10).
- **Likelihood / impact.** Medium / Medium.
- **Affected systems.** Notes content, extensions, Shortcuts.
- **Mitigation.** Register the same schemes; keep the inbox format (`item-<uuid>.json`, legacy `pending.json`, 04 section 6.4); drain pending items before the move.
- **Detection.** Open every link form from a test note; extension round trip.
- **Rollback / recovery.** Re-register schemes in a patch release.

### R-42 Lessons of fixed defects not carried into native code (S-8, S-17)
- **Description.** The audio cache key path traversal (17 S-8: `ttsAudioCache.ts:29-31, 43, 58`; fix in PR 11) and the missing too-new refusal (17 S-17; not in PR 11) show defect classes a rewrite can reintroduce: renderer-supplied strings used as file paths, and no downgrade guard. The iPhone WebView also has raw SQL access through `BereanSQLite` today (17 S-11), which a native app removes.
- **Likelihood / impact.** Medium / Medium.
- **Affected systems.** Native audio cache, import paths (e-Sword accepts any folder string, S-9), schema checks.
- **Mitigation.** Validate and confine every path built from user or note data; carry the S-8 test into the Swift suite; add the too-new refusal.
- **Detection.** Security test list in 17; path-traversal unit tests.
- **Rollback / recovery.** Patch release.
