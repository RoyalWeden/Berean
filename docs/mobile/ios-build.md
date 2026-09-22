# Berean iPhone — Build, Signing, Devices, TestFlight

Requirements: R015, R016, R120–R124. Kept current as the iOS project evolves.

---

## 1. Environment (verified 2026-09-21)

| Tool | Found | Requirement |
|---|---|---|
| Xcode | 26.6 (17F113) at `/Applications/Xcode.app` | Capacitor 8 needs Xcode ≥ 26.0 ✔ |
| iOS SDK | 26.5 (`iphoneos`, `iphonesimulator`) | ✔ |
| Swift | 6.3.3 | ✔ |
| Node / npm | 24.14.0 / 11.9.0 | ✔ |
| `xcode-select` | points at **CommandLineTools** — `xcodebuild` fails unless `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` is exported. All `npm run ios:*` scripts set it; to fix globally: `sudo xcode-select -s /Applications/Xcode.app` | developer action (optional) |
| Simulator runtimes | iOS 26.5 (23F77) installed 2026-09-21 via `xcodebuild -downloadPlatform iOS` (8.5 GB; the first attempt failed with a network error — just re-run it) | ✔ |
| Paired devices | none (`xcrun devicectl list devices`) | plug in / pair the iPhone in Xcode → Window → Devices and Simulators |
| Code-signing identities | `Apple Distribution` and `Developer ID Application` identities present for your team; **no `Apple Development` identity** | Xcode creates one automatically once you sign in (Xcode → Settings → Accounts) and enable *Automatically manage signing* |
| CocoaPods | not installed | not required (Capacitor 8 uses Swift Package Manager) |

## 2. Developer must configure (never committed)

Create `ios/App/Signing.xcconfig` (gitignored) from `ios/App/Signing.xcconfig.example`:

```
DEVELOPMENT_TEAM = <your team id>
BEREAN_TEAM_ID = <your team id>
BEREAN_BUNDLE_ID = com.berean.app        # or your own
BEREAN_ICLOUD_CONTAINER = iCloud.com.berean.app   # the iCloud Drive container on your App ID (must match the Mac app's Settings → iCloud container id)
CODE_SIGN_STYLE = Automatic
```

`BEREAN_ICLOUD_CONTAINER` feeds `ios/App/App/App.entitlements` (committed, generic — it only
references the build setting), the Info.plist key `BereanICloudContainer` and, via the
"Finalize Info.plist" build phase (`scripts/ios/finalize-info-plist.sh`), the
`NSUbiquitousContainers` entry that makes the container show up as a "Berean" folder in iCloud
Drive on the Mac. The Electron app's default container id (`iCloud.com.berean.app`, Settings →
iCloud) must be the same string, or the two apps will look at different folders.

`ios/App/Berean.xcconfig` (committed) holds the defaults and includes `Signing.xcconfig` last, so
anything you put there overrides the committed values; `Version.xcconfig` is generated from
`package.json` by `scripts/ios/version.mjs`.

Then, once, in the Apple Developer portal / Xcode:

1. **App ID** for the bundle identifier with capabilities: iCloud (iCloud Documents), App Groups,
   Background Modes (audio), Associated Domains (only if you want universal links — see §6).
2. **iCloud container** `iCloud.com.berean.app` (Xcode → Signing & Capabilities → iCloud → +).
3. **App Group** `group.com.berean.app` on both the app and the Share Extension targets.
4. Sign in to Xcode with the developer account; tick *Automatically manage signing* on the `App`
   and `ShareExtension` targets. Xcode will mint the `Apple Development` certificate and
   provisioning profiles.
5. **App Store Connect**: create the app record (name "Berean", bundle id, SKU, primary category
   *Reference*), fill in the privacy nutrition labels (see §7), export compliance (§7).

Nothing in the repository contains your team id, certificates or profiles.

## 3. Everyday commands

| Command | What it does |
|---|---|
| `npm run ios:sync` | `vite build -c vite.ios.config.ts` (renderer → `out/ios`), `scripts/ios/version.mjs`, `cap sync ios` (copies `out/ios` → `ios/App/App/public`, updates plugins), `scripts/ios/patch-xcodeproj.mjs` (idempotent project wiring) |
| `npm run ios:open` | opens `ios/App/App.xcodeproj` in Xcode |
| `npm run ios:build` | command-line simulator build (no signing needed) — `scripts/ios/build.sh simulator` |
| `npm run ios:run` | boots an iPhone simulator, installs and launches (`scripts/ios/run.sh [name]`) |
| `npm run ios:device` | Debug build for a connected iPhone (needs `Signing.xcconfig`) |
| `npm run ios:archive` | Release archive for TestFlight/App Store (upload is a manual Xcode Organizer step) |
| `npm run ios:dev` | Vite dev server for the iOS bundle (live reload on device via `cap run ios --livereload --port 5183`) |
| `npm run ios:test` | runs the BereanNative XCTest suite on a simulator |
| `npm run ios:bump-build` | increments `CURRENT_PROJECT_VERSION` in `Version.xcconfig` |

Worktree note: `cap sync` writes plugin package paths into `ios/App/CapApp-SPM/Package.swift`
relative to the real `node_modules` (a symlink into the main checkout in worktrees). After
merging to `main`, run `npm run ios:sync` once so the paths point at `main`'s own `node_modules`.

All set `DEVELOPER_DIR` themselves. None of them touch the desktop build.

## 3b. Transcript packs (D-007)

`node scripts/data/split-youtube-seed.mjs` (after `youtube:buildSeed` in dev) writes `data/youtube_index.db`
(bundled) and `data/youtube_transcripts/*.db` + `manifest.json`. Publish the packs once per seed version
with `scripts/data/publish-transcripts.sh` (GitHub release `transcripts-v<seedVersion>`, needs `gh auth`);
the phone downloads from `https://github.com/RoyalWeden/Berean/releases/download/transcripts-v<N>/` by
default, or from any host set in the `transcriptPacksBaseUrl` setting (plain http only on the local
network — `NSAllowsLocalNetworking`).

## 4. Running on your iPhone

1. Connect the iPhone by cable (first time), trust the computer, enable Developer Mode on the
   phone (Settings → Privacy & Security → Developer Mode) — iOS 16+.
2. `npm run ios:open` → select the device in the run destination → ⌘R. Or `npm run ios:device`.
3. Debugging the WebView: Safari → Develop → *your iPhone* → Berean. Console logs from the
   renderer appear there; native logs in Xcode's console.
4. Wireless debugging: Xcode → Devices → *Connect via network*.

## 5. TestFlight

1. Bump `version` in `package.json`; `npm run ios:sync` regenerates `Version.xcconfig`
   (`MARKETING_VERSION`), and `npm run ios:bump-build` increments the build number
   (`CURRENT_PROJECT_VERSION`) — TestFlight needs a higher build number per upload.
2. Xcode → Product → Archive (scheme `App`, destination *Any iOS Device*).
3. Organizer → Distribute → App Store Connect → Upload (Xcode-managed signing).
4. App Store Connect → TestFlight → add internal testers. First upload requires the export
   compliance answer (§7).

**This project never uploads for you.** Archiving/uploading is a manual Xcode step by design (R139).

## 6. Deep links & universal links

- Custom schemes `berean://` and `berean-pdf://` (the legacy form PDF "Copy link" writes into
  notes) are registered in `Info.plist` (`CFBundleURLTypes`) and, on desktop, in
  electron-builder's `protocols` + `app.setAsDefaultProtocolClient` (packaged builds only, so a
  dev build never steals the scheme from the installed app; set `BEREAN_REGISTER_PROTOCOL=1` to
  opt in). One router, `src/lib/deepLinks.ts` (`parseDeepLink` / `routeDeepLink` /
  `formatDeepLink`), serves every transport: Electron `open-url` + second-instance argv →
  `app:deepLink` → `App.tsx`; iOS `@capacitor/app` `appUrlOpen` / `getLaunchUrl` →
  `src/platform/ios/deepLinks.ts` (queues until the mobile shell registers its target); links
  clicked inside a note (`NoteEditorPM` `onLinkClick`).
  Routes: `berean://verse/<book>/<chapter>[/<verse>[-<end>]][?text=]`, `berean://open?ref=John%203:16`,
  `berean://note/<id>`, `berean://lexicon/H7225`, `berean://video/<id>[?t=]`, `berean://pdf/<id>[/<page>]`,
  `berean://search?q=…`, `berean://trail/<id>`. Unknown or malformed links are ignored (never guessed).
- Universal links (`https://sitgmeat.com/berean/…` or any domain you control) need an
  `apple-app-site-association` file hosted at that domain and the Associated Domains capability.
  Optional; documented, not assumed. `parseDeepLink` already accepts the `https://<host>/berean/<route>`
  form, so enabling them is entitlement + AASA only.

## 7. App Store readiness checklist

| Item | Status | Notes |
|---|---|---|
| Bundle identifier | developer | §2 |
| Entitlements: iCloud Documents container (done, Phase 7), App Groups, audio background mode | iCloud ✔ (`App.entitlements`, id from `BEREAN_ICLOUD_CONTAINER`); App Groups / audio: Phase 16 / 18 | `App.entitlements` |
| `PrivacyInfo.xcprivacy` | Phase 22 (not yet in repo) | declares UserDefaults + file-timestamp API reasons; no tracking |
| Permission strings | Phase 13/18 (not yet in repo) | `NSLocationWhenInUseUsageDescription` (daily-note sunrise — same text as desktop), `NSPhotoLibraryUsageDescription` (insert image into note) |
| Export compliance | developer answers in ASC | App uses only Apple-provided TLS/HTTPS and SQLite — "exempt" (`ITSAppUsesNonExemptEncryption = NO`, to be set in Info.plist in Phase 22) |
| Privacy nutrition labels | developer | Data not collected; iCloud data is the user's own |
| YouTube | documented | Embedded via WKWebView per YouTube ToS; PiP behaviour documented in `feature-matrix.md` |
| App icon 1024 px, launch screen | Phase 22 (Capacitor placeholder icon today) | from `assets/` |
| Age rating, category | developer | Reference |
