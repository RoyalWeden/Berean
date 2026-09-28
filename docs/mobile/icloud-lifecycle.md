# iCloud lifecycle, first sync, progress, live UI — 2026-09-28 (DATA-UX-*)

This document covers the device and app lifecycle.
- Data-loss guarantees and the merge model: [data-safety.md](data-safety.md).
- Operational summary: [sync.md](sync.md).
- Apple sources: [research/liquid-glass-progress-research-2026-09-28.md](research/liquid-glass-progress-research-2026-09-28.md)
  and [research/data-loss-research-2026-09-28.md](research/data-loss-research-2026-09-28.md).

## 1. What Berean controls and what Apple controls

Berean syncs through an **iCloud Drive ubiquity container**. It does not use CloudKit records,
subscriptions or `CKServerChangeToken`.

| Concern | Controlled by | Berean's behaviour |
|---|---|---|
| Deleting the app from a device | iOS / macOS | the local sandbox (`berean.db`) is removed by the OS. Berean runs no code at uninstall and has no code path that deletes iCloud data. Apple does not explicitly document that container files outlive the app (research memo: UNCONFIRMED); Berean assumes they do and never deletes them itself. |
| Settings › Apple Account › iCloud "Apps using iCloud", Manage Storage | the system | an app cannot remove itself from that list (UNCONFIRMED in Apple docs; no supported API exists). Berean does not try. Deleting Berean's data there is the user's explicit choice; Berean then **holds** rather than re-uploading by itself (data-safety T9/T15). |
| Turning iCloud off for Berean in system Settings | the system | the container is unavailable → status "iCloud unavailable"; local data is untouched; changes queue locally |
| Turning **Berean's** iCloud Sync off (Settings › iCloud) | Berean | the engine stops. Nothing is deleted anywhere; this device keeps its copy. Turning it on again runs a full local reconciliation, then syncs. |
| Account switch | the system signals; Berean reacts | iOS: identity-token hash → **held**; both: own history missing → **held**; nothing crosses; switching back resumes |
| Device "registration" | Berean | each install writes only its own folder `devices/<id>/` (journal + manifest). It is a history, not a live registration: an uninstalled device's folder stays, harmless, and is shown as **inactive** after 90 days of silence. It is never deleted by another device, and it can never cause a deletion. A reinstall is a new id. |

## 2. Sync state, one source of truth

- **Authoritative:** the sync engine. That is the Mac's main process, or the iPhone's WebView host.
- **UI mirror:** `src/lib/syncUi.ts`, a zustand store that subscribes once to `window.sync`.
  - It owns the enable and disable actions.
  - Every toggle reads it: the iPhone Settings row, the iPhone iCloud page and the Mac Settings section.
    So the toggles always agree.
- **User-facing states:** `presentSync()` maps the engine snapshot to them.

The user-facing states:

| Group | States |
|---|---|
| Off | `disabled` |
| Starting | `checkingAvailability`, `initializing` |
| First sync | `bootstrapping` |
| Pass stages | `fetchingRemoteChanges`, `applyingRemoteChanges`, `uploadingLocalChanges`, `finalizing` |
| Steady | `upToDate`, `changesWaiting`, `offline` |
| Problems | `accountUnavailable`, `held` (data-safety holds), `error` |

Engine activities are `checking`, `fetching`, `applying`, `uploading` and `finalizing`. They come
from `SyncProgress` in `status.progress`, pushed to the UI as they change (throttled to about
8 per second).

## 3. First sync and progress — honest numbers only

Apple's guidance is to prefer determinate progress when it is known, and never to invent it.

| Stage | Determinate? | Source |
|---|---|---|
| checking | no | account and container checks |
| fetching | devices read / devices listed | the manifests |
| applying | **yes** | the exact number of changes to apply is known before applying, with per-kind counts ("Notes 612 of 850") |
| uploading | **yes** | changes written / queued |
| finalizing | no | merge publications, manifest, UI refresh |

- **First sync** means this device has never received anything (`firstSync` flag). The UI says
  "Setting up iCloud…" and "Restoring… N of M".
- **Where it shows:**
  - iPhone: turning the switch on from the Settings row opens the iCloud page, which shows the
    panel. It is non-blocking: "You can keep using Berean — this continues in the background."
  - Mac: the panel shows in Settings › iCloud.
- **When the total changes:** each pass computes its own exact total. Changes that arrive during a
  pass are counted in the next pass; the bar never goes backwards (tested).

## 4. Live UI — no refresh, no reopen, no polling

The chain is:

> another device's upload → iCloud Drive → `NSMetadataQuery` (iPhone) or `fs.watch` (Mac) → the
> engine pulls → changes are written to `berean.db` → `onApplied(kinds)` → `applySyncInvalidation`
> → store tokens → mounted views re-read.

| Kind | Mounted UI |
|---|---|
| notes, folders, versions | the note-change and verse-note tokens: lists, reader dots, Scripture side panels, calendar, previews. Open editors follow the live-note rule: a clean editor updates in place; a dirty editor keeps the remote text as a version. |
| highlights | the highlight token |
| verse tags | reloaded |
| tabs, sessions | the tab mirror is re-hydrated. The on-screen tab is held until the user leaves it (DATA-TAB-001). **New: a change arriving during a tab drag is applied when the drag ends** (DATA-TAB-002, with a 30 s safety release). |
| workspaces | reloaded |
| playlists, PDFs, YouTube stars/resume, AI chats | **new:** data epochs make those lists re-read. Previously they needed reopening. |
| study trail | its own change channel (fires for remote changes too) |

**No polling as the mechanism.** Notifications and lifecycle events drive every pass:
- start, foreground, network return and wake;
- a local change (debounced about 1.5 s);
- a container notification.

A 60 s safety-net pass exists because `NSMetadataQuery` runs only in the foreground and can
coalesce updates (Apple). That pass reads manifests and applies only what is new: the equivalent
of a change-token fetch. Missed notifications are therefore always recovered (tested).

While the iCloud page is open, it refreshes its **display** every 5 s: iCloud upload completion
is not announced. This never triggers a sync.

## 5. Uninstall / reinstall (tested; physical test pending)

- A reinstall means an empty database, a new device id, and no sync bookkeeping. It can only
  receive.
- Tested (`lifecycle.integration.test.ts`, `dataSafety.integration.test.ts`): after a reinstall,
  Berean:
  - restores everything;
  - publishes zero ops and deletes nothing;
  - leaves other devices intact, including a device that is offline during the reinstall.
- A restored backup or copied database forks its id (data-safety T7).

## 6. Development vs production

| | Development | Production |
|---|---|---|
| Desktop | `electron-vite dev` (`is.dev`): DevTools menu, `[Dev]` titles, relaxed CSP, YouTube full-sync / transcript fetch, `window.__bereanStore` (`import.meta.env.DEV`), persistent debug switches (**DEV-only since 2026-09-28**) | `electron-vite build` + `electron-builder` (`files: out/**`): all of the above compiled out or gated by `app.isPackaged` |
| iPhone | the `BEREAN_E2E_PROBE=1` simulator probe (`window.__bereanStore`, probe server, relaxed CSP) | `npm run ios:sync` (no probe). **`ios:device` / `ios:archive` refuse a bundle containing the probe** and `ios:archive` always re-syncs first |
| iCloud container | `iCloud.com.berean.app` | the same (one production identifier set; Debug and Release share `Berean.xcconfig`) |
| Bundle / App Group | `com.berean.app` / `group.com.berean.app` | same |

**Policy for the shared container.** Development builds on Michael's devices sync real data. There
is deliberately no separate development container: the data is his own, and the data-safety holds
protect it.

**`npm run audit:prod`** scans the shipped bundles (`out/`, `ios/App/App/public`) and the iOS
configuration for development-only code. It passed on 2026-09-28.

The Settings pages Experimental, Danger zone and the iCloud diagnostic log are intentional user
features. They are opt-in, and they never show content.

## 7. Physical-device plan (Michael — not yet run)

| # | Test |
|---|---|
| 1–5 | iCloud off → on: watch the first-sync panel (stages, "Restoring… N of M"), wait for "Up to date" |
| 6–8 | Open tabs, Notes and a Scripture side panel update without reopening |
| 9–12 | A change on the Mac appears on the iPhone, and back |
| 13–16 | Background the iPhone, change something on the Mac, return: it appears |
| 17–20 | Turn iCloud Sync off (the Mac keeps everything), then on (reconciles) |
| 21–27 | Delete Berean from the iPhone (the Mac keeps everything); reinstall; turn on; everything returns; no duplicates |
| 28–32 | Light, dark, Reduce Transparency, Increase Contrast, largest Dynamic Type on the iCloud page and Scripture |
| 33 | VoiceOver on the iCloud page (switch, status, progress announced) |
| 34 | Keyboard open (Notes search bar above the keyboard) |
| 35–36 | Poor or no network, then back: converges |
