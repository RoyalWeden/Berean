# Berean on the Mac App Store

How the sandboxed Mac App Store (MAS) build differs from the direct-download (DMG) build, what
each entitlement is for, how iCloud sync works inside the sandbox, and the steps to build, verify
and submit. The iPhone equivalent is `docs/mobile/testflight.md`.

## 1. Three builds, one App ID

| | Mac — DMG (direct download) | Mac — Mac App Store | iPhone |
|---|---|---|---|
| Command | `npm run build:local` / CI (`tag:stable`) | `npm run build:mas` → `npm run build:mas:pkg` | `npm run ios:archive` |
| Bundle ID | `com.berean.app` | `com.berean.app` | `com.berean.app` (+ `com.berean.app.share`) |
| Signing | Developer ID Application, hardened runtime, notarized in CI | Apple Distribution + Mac Installer Distribution, App Sandbox | Apple Distribution (Xcode, automatic) |
| Entitlements | `build/entitlements.mac.plist` | `build/entitlements.mas.plist` (+ `.mas.inherit.plist` for helpers) | `ios/App/App/App.entitlements` |
| Updates | electron-updater (GitHub Releases) | the App Store (`process.mas` disables electron-updater) | TestFlight / App Store |
| User data | `~/Library/Application Support/Berean` | `~/Library/Containers/com.berean.app/Data/Library/Application Support/Berean` | app container |
| iCloud container | `~/Library/Mobile Documents/iCloud~com~berean~app` by path | the same container, opened through `URLForUbiquityContainerIdentifier` | the same container |

App Store Connect has one **Berean** record (`com.berean.app`) with a macOS and an iOS platform —
never a second record.

## 2. Mac App Store entitlements — each one maps to a feature

| Entitlement | Feature |
|---|---|
| `com.apple.security.app-sandbox` | required for the Mac App Store |
| `com.apple.security.application-groups` = `6C8RCZVUZR.com.berean.app` | Electron/Chromium helper-process IPC: the browser process checks in a Mach service `<TeamID>.<bundle id>.MachPortRendezvousServer.<pid>`, which the sandbox allows only under an app-group prefix the app holds. With an empty array the app crashes at launch (reproduced 2026-09-28). Not a data-sharing group; needs no App Group registration. The iPhone's `group.com.berean.app` is for its Share Extension and does not belong on the Mac. |
| `com.apple.security.cs.allow-jit`, `…allow-unsigned-executable-memory` | V8 (Electron) |
| `com.apple.security.network.client` | YouTube, cross-reference fetch, Read Aloud voice and transcript downloads |
| `com.apple.security.files.user-selected.read-write` | Open/Save panels: vault folder, custom sync folder, PDF / image / e-Sword import, exports |
| `com.apple.security.files.bookmarks.app-scope` | keeps a folder picked in the Open panel (vault, custom sync folder) reachable after relaunch (§4) |
| `com.apple.developer.icloud-container-identifiers`, `…ubiquity-container-identifiers` = `iCloud.com.berean.app`; `…icloud-services` = `CloudDocuments`; `…icloud-container-environment` = `Production`; `com.apple.application-identifier`, `com.apple.developer.team-identifier` | iCloud sync with the iPhone — iCloud Documents, **not CloudKit** (§3) |
| `com.apple.security.personal-information.location` | daily notes begin at local sunrise (`NSLocationWhenInUseUsageDescription`) |
| `com.apple.security.print` | File › Print for notes |

**Removed:** `com.apple.security.files.downloads.read-only`. App Review rejected 0.2.1 under
Guideline 2.4.5(i) (June 15 2026) because nothing uses it. Nothing does: e-Sword import and every
other import go through the Open panel; Read Aloud voice downloads go to the app's own storage;
nothing reads `~/Downloads`. It must not return — `electron/__tests__/entitlements.test.ts`,
`npm run audit:prod` and `scripts/mac/verify-mas.mjs` (run by `build:mas`) all fail if it does.

Helpers (`build/entitlements.mas.inherit.plist`) get `app-sandbox` + `inherit` only.

The DMG build is not sandboxed and keeps its three hardened-runtime keys
(`allow-jit`, `allow-unsigned-executable-memory`, `allow-dyld-environment-variables`); nothing in
this document changes it.

## 3. iCloud sync inside the sandbox

Sync is a folder of per-device journals in the iCloud Drive ubiquity container
(`docs/mobile/icloud.md`, `docs/mobile/sync.md`); the iCloud daemon moves the files. The DMG build
reaches the folder by path. The sandbox changes three things, all handled in
`electron/sync/macContainer.ts` + the Node-API helper `native/mac-icloud/berean_icloud.m`:

1. `os.homedir()` is the sandbox container, so the path must come from the system: the helper calls
   `-[NSFileManager URLForUbiquityContainerIdentifier:]` (on a worker thread) and returns the
   container root.
2. That call is also what **extends the sandbox to the container**; without it every read is denied.
   `electron/sync/host.ts` makes it before any path access (`ensureMasContainer`, from
   `startEngine` and `sync:getConfig`). Once iCloud has returned the container the app may create
   its `Documents` folder — the DMG build still never creates the container itself.
3. `brctl download` cannot run in the sandbox; evicted `.icloud` placeholders are requested with
   `-startDownloadingUbiquitousItemAtURL:error:` instead (`FsSyncStore`'s injected `download`).

Everything else is unchanged: the same container, the same journal format, the same merge rules,
holds and event-driven lifecycle (folder watcher + local-change debounce, 60 s safety net). If
iCloud is signed out, the container lookup returns null and Settings › iCloud shows the folder as
missing — sync is held, never faked with a local folder. The helper is built by
`scripts/mac/build-native.mjs` (clang, Node-API — ABI-stable, no Electron headers), shipped only in
the MAS build (`build.mas.extraResources`) and loaded only when `process.mas` is true.

## 4. Folders the user picks

The sandbox grants access to a folder chosen in the Open panel for that session only.
`electron/mac/folderAccess.ts` asks the panel for an app-scoped security bookmark, stores it in
`userData/sandbox-bookmarks.json` (this Mac only, never synced) and re-opens every stored bookmark
at startup. Used by the vault folder picker (`app:openFolderDialog`) and the custom sync folder
(`sync:chooseFolder`). In the DMG build it is a plain Open panel.

Known sandbox limits (documented, not bugs): a vault path typed in or left at its default must be
chosen once with **Choose…** in the MAS build before Berean can write there; e-Sword auto-detect
cannot look in `~/Documents` — the user picks the e-Sword folder instead.

## 5. Apple Developer portal (manual)

- **App ID `6C8RCZVUZR.com.berean.app`:** iCloud (iCloud Documents, container
  `iCloud.com.berean.app`) and App Groups are already enabled — the iOS App Store profiles
  generated on 2026-09-28 carry both. Explicit App IDs are shared by iOS and macOS; nothing to add
  for the Mac.
- **Mac App Store distribution profile:** the current `build/embedded.provisionprofile`
  ("Berean MAS Distribution", created 2026-05-29) predates iCloud on the App ID and does not
  authorise the iCloud entitlements; `verify-mas` rejects it. Create a new one: Profiles › + ›
  **Mac App Store Connect** › App ID `com.berean.app` › certificate *Apple Distribution* › name
  e.g. "Berean MAS Distribution 2026-09". Download it and save it as
  `build/embedded.provisionprofile` (gitignored). The old profile can stay; nothing depends on it.
- **Mac Installer Distribution certificate:** not in the keychain; `build:mas:pkg` needs it.
  Xcode › Settings › Accounts › team 6C8RCZVUZR › Manage Certificates… › + › *Mac Installer
  Distribution*.
- **Optional, local testing of the signed sandboxed app with real iCloud:** a *macOS App
  Development* profile for `com.berean.app` with this Mac registered, used with electron-builder's
  `mas-dev` target. An Apple Distribution-signed app does not launch outside the App Store.

## 6. Build and verify

```bash
npm run build:mas        # build → native helper → electron-builder (mas) → verify-mas
npm run build:mas:pkg    # productbuild → release/Berean-<version>-mas.pkg → verify-mas again
```

`scripts/mac/verify-mas.mjs` inspects the signed app and fails on: a Downloads or development-only
entitlement (`get-task-allow`, `network.server`, `allow-dyld-environment-variables`,
`disable-library-validation`, temporary exceptions) anywhere in the bundle; no sandbox; wrong
iCloud container / services / environment; the app group missing (launch crash); a helper that is
not sandbox+inherit; a wrong bundle ID, version, `ElectronTeamID` or `ITSAppUsesNonExemptEncryption`;
the helper or the Bible databases missing; a profile that is development, expired, for another App
ID or not authorising iCloud. Upload the `.pkg` with **Transporter** (it validates on upload).

**Version and build:** `CFBundleShortVersionString` = `CFBundleVersion` = `package.json` version.
App Store Connect needs a higher build than any earlier macOS upload (0.2.1), so any 0.6.x
version is fine. Re-uploading the same version needs a new build number:
`npm run build:mas -- --config.buildVersion=<version>.1`.

## 7. App Store Connect — the next macOS version

The macOS version 0.2.1 is *Rejected*. A rejected version is not live, so it can be reused:
open it, change the version number to the new release (e.g. 0.6.20), replace the build with the
new upload, and reply in App Review explaining the fix (text below), then resubmit. If App Store
Connect does not allow editing it, remove it from review (*Developer Rejected*) and create a new
macOS version with **+ Version or Platform › macOS**. Do not delete the app record.

Suggested App Review reply:

> The `com.apple.security.files.downloads.read-only` entitlement has been removed; Berean never
> needed it. All file access goes through the standard Open and Save panels
> (`files.user-selected.read-write`, with app-scoped bookmarks so a chosen notes folder stays
> available). Berean syncs the user's own notes, highlights and study data between Mac and iPhone
> through its iCloud Documents container `iCloud.com.berean.app`. Location is used only to compute
> local sunrise for daily notes and never leaves the Mac; printing is used by File › Print.

## 8. DMG and MAS side by side

Both builds run the same code; `process.mas` switches off the auto-updater, opens the iCloud
container through the helper and keeps folder bookmarks. Everything else — features, data model,
sync semantics — is identical. They keep separate local databases (the MAS one lives in the sandbox
container), so a Mac that moves from the DMG to the MAS build joins iCloud sync as a new device and
receives its synced data from iCloud; local-only data (unsynced settings, imported PDF files, the
Octarine vault path) is not migrated.

## 9. Data safety

Nothing here changes the container identifier, the journal format, stable IDs, the merge rules or
the holds. The sandbox cannot reach the real container until the system opens it, so a misconfigured
MAS build shows "iCloud folder not found" and holds instead of syncing against an empty local
folder. Uninstalling either Mac build (or the iPhone app) never deletes the iCloud container
(`docs/mobile/data-safety.md`).
