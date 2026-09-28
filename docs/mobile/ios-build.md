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
| `npm run ios:build` | command-line simulator build ("Sign to Run Locally", no team needed; entitlements embedded so the App Group / Share Extension work) — `scripts/ios/build.sh simulator` |
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

### 4b. Phase 21 device pass (what to verify once, per `testing.md` §5 and §8)

The simulator cannot exercise these; they need the phone (and, for sync, the Mac app on the same
iCloud account with the same container id):

1. **Install + launch** from Xcode (`Signing.xcconfig` in place). Note the `[perf]` console lines
   (Safari → Develop → iPhone → Berean) into `testing.md` §6.
2. **iCloud sync matrix** (`testing.md` §5, cases A–O): enable sync on both; create a note on the
   phone → appears on the Mac; edit both offline → conflict copy; tab session created on the Mac
   → appears in the phone's session switcher; workspace saved on the Mac → opens from Spotlight
   on the phone; delete a tag on the Mac → gone on the phone.
3. **Read Aloud in the background / lock screen**: start a chapter, lock the phone → speech
   continues, lock-screen card shows the reference, play/pause/next work from the card and
   AirPods; an incoming call pauses and playback resumes.
4. **YouTube**: playback continues while switching spaces; PiP from the fullscreen control; the
   Now Playing / audio session does not fight Read Aloud.
5. **Share Extension** from Safari (URL), Notes (text), Files (PDF) → the right destination.
6. **Spotlight**: search a note title / "Genesis 3" / a session name → tapping opens it.
7. **Siri / Shortcuts**: "Open Scripture", "Search Berean", "Open today's daily note", "Start Read
   Aloud", "Open workspace" appear in the Shortcuts app and run.
8. **VoiceOver** run-through (`testing.md` §7): space bar, reader, verse sheet, notes editor.
9. **Dynamic Type** at Accessibility XL: chrome scales, reader stays readable.
10. **Location**: first daily-note open asks; deny → note still opens (midnight boundary).
11. **Kokoro-in-WKWebView spike** (R096): measure whether the Kokoro WASM model loads and
    speaks a verse in WKWebView within memory limits; record the result in `decisions.md`.

## 5. TestFlight

The full, verified procedure is **[testflight.md](testflight.md)**. In short:
`npm run ios:bump-build` (every upload after the first) → `npm run ios:archive` → Organizer →
Distribute → TestFlight. Export compliance is pre-answered (`ITSAppUsesNonExemptEncryption = false`).

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
  `berean://search?q=…`, `berean://trail/<id>`, `berean://daily`, `berean://workspace?name=…`,
  `berean://share` (drain the Share Extension inbox), `&play=1` on video links. Unknown or
  malformed links are ignored (never guessed).
- **Share Extension** (`ios/App/ShareExtension/`, D-008): "Berean" in the system Share Sheet for
  text, one web URL and up to five files. The extension writes to the App Group inbox
  (`BEREAN_APP_GROUP`) and opens `berean://share`; the app routes each item (reference →
  passage, YouTube link → video, other text → note, PDF → library). The target is created by
  `scripts/ios/patch-xcodeproj.mjs` step 8 (product `$(BEREAN_BUNDLE_ID).share`, same xcconfigs
  as the App target, embedded via "Embed Foundation Extensions" — placed before the run-script
  phases, or Xcode reports "Cycle inside App"). The App Group must exist on the developer's App
  ID for device builds; the simulator build signs "to run locally" with the entitlements
  embedded, which is why `build.sh simulator` no longer passes `CODE_SIGNING_ALLOWED=NO`.
- **Spotlight** (`BereanSpotlightPlugin`): notes are indexed as `CSSearchableItem`s whose
  identifier is the note's `berean://note/<id>` link; tapping a result continues the activity in
  `SceneDelegate` → the router. **App Intents** (`ios/App/App/BereanIntents.swift`): Open
  Scripture, Search Berean, Open Today's Daily Note, Start Read Aloud, Open Workspace — each
  opens a deep link, so Siri / Shortcuts share the router too.
- Universal links (`https://sitgmeat.com/berean/…` or any domain you control) need an
  `apple-app-site-association` file hosted at that domain and the Associated Domains capability.
  Optional; documented, not assumed. `parseDeepLink` already accepts the `https://<host>/berean/<route>`
  form, so enabling them is entitlement + AASA only.

## 7. App Store readiness checklist

| Item | Status | Notes |
|---|---|---|
| Bundle identifier | developer | §2 |
| Entitlements: iCloud Documents container (done, Phase 7), App Groups, audio background mode | iCloud ✔ (`App.entitlements`, id from `BEREAN_ICLOUD_CONTAINER`); App Group ✔ (`BEREAN_APP_GROUP`, app + `ShareExtension.entitlements`); `UIBackgroundModes: audio` ✔ | `App.entitlements` |
| `PrivacyInfo.xcprivacy` | ✔ `ios/App/App/PrivacyInfo.xcprivacy` (patch step 9 adds it to Copy Bundle Resources) | no tracking, no collected data; UserDefaults (CA92.1), file timestamp (C617.1), disk space (E174.1), system boot time (35F9.1) |
| Permission strings | ✔ `Info.plist` | `NSLocationWhenInUseUsageDescription` (daily-note sunrise; asked on the first daily-note open), `NSPhotoLibraryUsageDescription` (insert image into note) |
| Export compliance | ✔ `ITSAppUsesNonExemptEncryption = NO` in `Info.plist`; developer confirms in ASC | only Apple-provided TLS/HTTPS and SQLite |
| Privacy nutrition labels | developer | Data not collected; iCloud data is the user's own |
| YouTube | documented | Embedded via WKWebView per YouTube ToS; PiP behaviour documented in `feature-matrix.md` |
| App icon 1024 px, launch screen | ✔ full-bleed icon + launch image generated from `assets/icon.png` (`Assets.xcassets`) | regenerate from `assets/icon.png` if the desktop icon changes |
| Age rating, category | developer | Reference |
