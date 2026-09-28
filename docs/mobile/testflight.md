# Berean on TestFlight

This is Berean's actual release path. Build details: [ios-build.md](ios-build.md).

Verified on 2026-09-28 on this Mac:
- `npm run ios:archive` produced a Release archive of **0.6.19 (1)**;
- a local App Store Connect export (not uploaded) signed it for distribution;
- both targets received App Store ("Team Store") provisioning profiles;
- `get-task-allow` = false;
- iCloud container environment = Production.

## 1. Prerequisites

| Item | Value in this repo |
|---|---|
| Apple Developer team | set in `ios/App/Signing.xcconfig` (gitignored; template `Signing.xcconfig.example`) |
| App ID (app) | `com.berean.app` — capabilities: iCloud (iCloud Documents) and App Groups |
| App ID (Share Extension) | `com.berean.app.share` — App Groups |
| iCloud container | `iCloud.com.berean.app` |
| App Group | `group.com.berean.app` |
| Signing | automatic (Xcode manages the profiles; `-allowProvisioningUpdates`) |
| Deployment | iOS 17.0+, iPhone only (`TARGETED_DEVICE_FAMILY = 1`) |
| Export compliance | `ITSAppUsesNonExemptEncryption = false` (Apple TLS and SQLite only), so App Store Connect does not ask the encryption question |
| Privacy manifest | `ios/App/App/PrivacyInfo.xcprivacy` |

## 2. App Store Connect app record (once)

1. App Store Connect → Apps → **+** → New App.
2. Enter:
   - Platform: iOS;
   - Name: **Berean** (or any available name; it can change later);
   - Primary language;
   - Bundle ID: **com.berean.app**;
   - SKU: anything, e.g. `berean-ios`.
3. Nothing else is needed for internal TestFlight.

## 3. Version and build number

- **Marketing version** = `package.json` `version`, currently 0.6.19. `npm run ios:sync` writes it
  into `ios/App/Version.xcconfig`, so iOS and the Mac release share one version.
- **Build number** = `CURRENT_PROJECT_VERSION` in `ios/App/Version.xcconfig`. Run
  **`npm run ios:bump-build`** before every upload after the first. App Store Connect rejects a
  build number it has already seen for the same version.
- **A new public version:** bump `package.json` `version`. The build number can then continue or
  restart at 1.

## 4. iCloud environment — nothing to deploy

Berean syncs through an **iCloud Drive (iCloud Documents) container**, not CloudKit records.
- There is no CloudKit schema, record type or index to deploy, and no production schema to compare.
- **Never** use CloudKit Console to reset the container.
- The distribution export sets `icloud-container-environment = Production`. That is harmless for
  iCloud Documents: development and TestFlight builds use the **same** container, so the same
  data.
- Installing the TestFlight build over the Xcode-installed development build (same bundle ID)
  keeps the app's local data. The first launch migrates the database if needed, taking a
  pre-migration backup ([data-safety.md](data-safety.md)).

## 5. Archive

```bash
cd <repo>
npm run ios:bump-build      # not for the very first upload (build 1)
npm run ios:archive         # = ios:sync (production web bundle) + Release archive
```

`ios:archive` refuses a web bundle that still contains the simulator test probe (exit 3). The
archive is written to `ios/App/build/Berean.xcarchive`.

**Alternative: Xcode › Product › Archive** (scheme App, "Any iOS Device"). Run `npm run ios:sync`
first: Xcode archives whatever web bundle is in `ios/App/App/public`.

## 6. Validate and upload (Xcode Organizer)

1. **Open the archive in Organizer.** If you used `npm run ios:archive`, double-click
   `ios/App/build/Berean.xcarchive` in Finder: Organizer imports it. An Xcode Product › Archive
   appears there by itself.
2. Select the archive and check that it reads **0.6.19 (N)**, `com.berean.app`, and your team.
3. **Distribute App** → **TestFlight & App Store** (or App Store Connect → Upload). Xcode validates,
   signs for distribution, and uploads.
4. Fix any validation error before retrying. Never bypass a signing or entitlement error.

## 7. Processing

App Store Connect → Berean → TestFlight shows the build as **Processing**. This usually takes
5–30 minutes, and Apple emails when it finishes.

## 8. Internal testing (your own use)

1. TestFlight → Internal Testing → **+** → group "Michael – Berean Beta"; enable automatic
   distribution.
2. Add yourself as a tester (your App Store Connect user).
3. Add the processed build. "What to test": *Bible reading, notes, search, tabs, iCloud sync,
   offline use, stability.*
4. **On the iPhone:** install **TestFlight** from the App Store → accept the invitation → Install
   Berean.
5. **First launch:**
   1. Check that your data is there.
   2. Turn on Settings › iCloud if it isn't on.
   3. Wait for **Up to date**.
   4. Check that the Mac and the iPhone sync.

## 9. Updates

```bash
# a focused fix …
npm test && npm run typecheck
npm run ios:bump-build
npm run ios:archive
```

Then do Organizer → Distribute. With automatic distribution the internal group gets the build, and
the iPhone's TestFlight offers the update. Your data stays: updates keep the local database and
migrate it (with a backup), and iCloud Sync continues where it was.

## 10. Later — external testers, App Store

- **External testing:** an External group, Test Information, and the first build goes through
  TestFlight App Review. Invite by email or public link.
- **App Store:**
  - metadata, screenshots, privacy details and age rating;
  - pick the tested build and submit for review;
  - release manually.
- Neither is part of the current workflow.
