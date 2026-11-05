# 17 - Security, Privacy, Release and App Identity

> **Baseline note.** Investigated at `807c2d9`. The final baseline is `d97fb05`. The only code changes between them are PRs #9, #10 and #11, listed in `01-REPOSITORY-STABILIZATION.md`: fixes for sync defects D1-D4, note table-cell formatting, and audio cache keys. Anything below describing those defects as present is corrected where noted.

Audit of commit `807c2d974b795f95f4c05b8ae4b6796c273b572c` (package.json 0.8.1, iOS `CURRENT_PROJECT_VERSION = 7`), checkout `/Users/roywe/Berean-audit`, detached HEAD, read-only. Purpose: input to a possible later migration to fully native Swift. Nothing here recommends implementing anything now. Findings are neutral engineering observations; severities are the auditor's judgment under the stated threat model (section 1).

Labels: **VERIFIED** (read in code, or measured/grepped in this audit), **INFERRED** (follows from verified code, not exercised), **UNVERIFIED** (stated by a doc or comment, not confirmed), **BLOCKED** (not checkable under the audit rules: no live app interaction, no real user data, containers or iCloud, no secrets printed, no signed build, no device).

Method notes. The built `out/` bundle from `npm run build` in `/Users/roywe/Berean-audit` was grepped for a key prefix with `grep -c`; no secret value was printed or recorded. Real user data, containers and iCloud were never read. Machine for any measured item: Apple M5 MacBook Air, 32 GB, macOS 27.2.

---

## 1. Threat model used

Berean is a single-user local app whose renderer displays untrusted text (notes imported from e-Sword/BibleGateway/Octarine vault files, shared PDFs, model output, YouTube transcript text, web research excerpts, deep links and iCloud-synced records from the same Apple ID). The realistic attacks are: (a) hostile content reaching the renderer (XSS-class), then using the bridge to read/write the user's files or secrets; (b) a hostile deep link or share-extension payload; (c) supply-chain/update-channel compromise; (d) accidental data loss or identity breakage during release/migration. Attacks requiring local malware with the user's privileges are out of scope: the DB is not encrypted in any case (section 7).

---

## 2. Electron security boundaries (Mac and Windows)

### 2.1 BrowserWindow web preferences (VERIFIED, `electron/main.ts`, `electron/ipc/bgImport.ts`, `electron/ipc/youtube.ts`)

| Window | Lines | contextIsolation | nodeIntegration | sandbox | webviewTag |
|---|---|---|---|---|---|
| Presenter/viewer | main.ts:806-808 | true | false | **false** | default (false) |
| Study Trail | main.ts:898-900 | true | false | **false** | default |
| Berean Chat | main.ts:971-973 | true | false | **false** | default |
| Verse picker | main.ts:1033-1035 | true | false | **false** | default |
| Floating tab | main.ts:1084-1087 | true | false | **false** | **true** |
| Main window | main.ts:1179-1184 | true | false | **false** | **true** |
| Hidden render windows (print, preview, PDF) | main.ts:1790, 1818, 1846 | default (true since Electron 12) | default (false) | `sandbox: false`, no preload | default |
| BibleGateway import windows | bgImport.ts:355-357, 799-801 | true | false | **false** | default |
| YouTube transcript workers (dev-gated) | youtube.ts:1076-1077 | **false** | false | default | default |

Findings:

- **S-1 (Medium, hardening gap).** `sandbox: false` on every app window. The preload (`out/preload/index.js`, 46,353 bytes) calls `require` only for `electron` (grep: one `require("electron")`; source `electron/preload.ts:1` imports only `contextBridge, ipcRenderer`). A preload that needs only `electron` is compatible with Chromium's renderer sandbox, so `sandbox: false` looks unnecessary for the preload; whether any other reason exists (for example a Node API used elsewhere in a renderer) was not tested. INFERRED. With `sandbox: false` and a renderer compromise, a Chromium sandbox escape is not needed to reach the OS-level process privileges of the renderer; `contextIsolation: true` and `nodeIntegration: false` still keep page JS away from Node. In the **MAS** build the App Sandbox still applies (entitlements below), so the practical exposure is the **DMG** (hardened runtime but not App-Sandboxed, `build/entitlements.mac.plist`) and Windows.
- **S-2 (Medium).** `webviewTag: true` on the main window (`main.ts:1183`) and floating windows (`:1086`). The code comment at `main.ts:1181-1182` says "webviewTag disabled in MAS ... YouTube uses a dedicated BrowserWindow instead", but the value set is `true`: the comment contradicts the code (stale comment; VERIFIED). There is **no `will-attach-webview` handler** anywhere in `electron/` (grep for `will-attach-webview` found nothing), so webview preferences (preload, `nodeIntegration`, `webSecurity`, `allowpopups`, partition) are not constrained by the main process; they depend entirely on the renderer's `<webview partition="persist:youtube" src=...>` at `src/components/youtube/YouTubeTab.tsx:1836` being written safely. A compromised renderer could attach a webview with a preload or relaxed preferences. VERIFIED (absence of handler); exploitation INFERRED.
- **S-3 (Low-Medium).** `web-contents-created` applies `keepLinksOutOfApp` to every non-webview WebContents (`main.ts:187`) but skips `webview` guests, so the YouTube guest has no `setWindowOpenHandler` or `will-navigate` restriction from the main process; it can open windows and navigate anywhere, including to non-YouTube origins in the `persist:youtube` session. By design (YouTube login, channel browsing), but the channel allowlist is described as a "soft guard (for focus), not a security restriction" in `CLAUDE.md` section 12.
- **S-4 (Medium).** Permission handling is asymmetric. `session.defaultSession.setPermissionRequestHandler` (`main.ts:1471-1477`) grants only `geolocation`, `clipboard-sanitized-write`, `clipboard-read` and denies the rest, **without checking the requesting origin or frame**. The `persist:youtube` session and `BG_PARTITION` (`persist:biblegateway-import`) have **no** permission request or check handler (grep: `setPermissionRequestHandler` appears once, `setPermissionCheckHandler` never). `main.ts:1450-1451` only calls `session.fromPartition('persist:youtube')`. Electron's default for a session without a handler is to grant requests (per Electron's documented behaviour), so web content in those partitions can obtain permissions such as notifications, media devices or others the OS then gates. INFERRED from Electron documentation, not exercised. In the MAS build the OS sandbox entitlements limit what can actually be granted (no camera/microphone entitlement is declared, section 5).
- **S-5 (Info).** Dev-only controls are properly gated: `BEREAN_CDP_PORT` (`--remote-debugging-port`) and `BEREAN_QA_USER_DATA` are applied only inside `if (!app.isPackaged)` (`main.ts:124-138`); `devToolsEnabled` (`electron/devTools.ts:11-13`) is true only for unpackaged or `development` identity; `youtube:fetchTranscripts` is gated and returns `{ error: 'unavailable in production' }`. `scripts/audit-production.mjs` scans `out/renderer`, `out/preload` and the iOS web bundle for `__bereanStore`, `127.0.0.1:9555`, `'unsafe-eval'`, `localhost:5173` and similar. (The scan does not cover `out/main`, where `is.dev` is a runtime check.) VERIFIED.
- **S-6 (Info).** No Electron fuses are configured: `grep -n "flipFuses\|fuses" package.json build/*.js` found nothing. `ELECTRON_RUN_AS_NODE` and `--inspect`/`NODE_OPTIONS` handling is therefore Electron's default, and the DMG's hardened-runtime entitlements include `com.apple.security.cs.allow-dyld-environment-variables` (`entitlements.mac.plist`), so a local user-level attacker can still inject through environment variables into the non-sandboxed DMG build. Out of scope under the threat model, noted for completeness. VERIFIED.

### 2.2 Content-Security-Policy (`electron/csp.ts`, VERIFIED)

Packaged build, `buildCSP(false)`:

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https:; font-src 'self' data:; media-src 'self' blob: data: https:;
connect-src 'self' https: berean-model:; frame-src 'self' https://www.youtube.com data:;
worker-src 'self' blob:
```

- A packaged app loads over `file://`; `onHeadersReceived` (`main.ts:1491-1498`) never fires for `file://`, so the **only** enforcing policy is the `<meta>` tag injected into `src/index.html` at build time by `electron.vite.config.ts`. The file header (`csp.ts:1-21`) says exactly this. Confirmed: `out/renderer/index.html` exists (1.21 kB); its CSP content was not byte-compared to `buildCSP(false)` in this audit (UNVERIFIED), but the build hook is the documented mechanism.
- **S-7 (Low-Medium).** `connect-src https:` and `img-src https:` permit the renderer to send data to **any** HTTPS host, so a script-injection compromise could exfiltrate note content (the bridge returns it) to an arbitrary server. `script-src` is strict (no `unsafe-inline`, no `unsafe-eval`, WASM-only carve-out), which is the stronger control. There is no `object-src`, `base-uri`, `form-action` (these fall back only partly: `default-src 'self'` does cover `object-src`, but `base-uri` and `form-action` do not fall back to `default-src`). `style-src 'unsafe-inline'` is required by the React/Tailwind inline styles. INFERRED.
- Dev build adds `'unsafe-inline' 'unsafe-eval'`, `ws:` and `http:`; not shipped.
- The iOS WKWebView gets a separate CSP meta tag from `src/platform/ios/csp.ts` (Vite iOS config injects it). Contents not diffed in this audit; UNVERIFIED.
- `main.ts` setting `autoplay-policy=no-user-gesture-required` (`:118`) is app-wide, including the YouTube guest.

### 2.3 External links (`electron/externalLinks.ts`, new, VERIFIED)

`isSafeExternalUrl` allows only `http:`, `https:`, `mailto:` (`SAFE_SCHEMES`); `openExternalSafely` guards `shell.openExternal`; `leavesApp(current, next)` compares protocol and host; `keepLinksOutOfApp(contents)` sets `setWindowOpenHandler` to deny and open externally, and cancels `will-navigate` when the target leaves the app. The IPC `app:openExternal` (`main.ts:1556`) routes through `openExternalSafely`. The only other direct call is the Help menu item `shell.openExternal('https://sitgmeat.com')` (`main.ts:626`, constant URL). Good: no `shell.openPath` or `showItemInFolder` calls exist (grep). Residual: `mailto:` links can be crafted with attacker-controlled bodies; `https://` URLs can point to phishing sites (user-click required). Not applied to the YouTube webview (S-3). `will-navigate` covers only top-level navigation; `will-redirect` and subframe navigation are not handled; INFERRED low impact.

### 2.4 Custom protocol `berean-model://` (`electron/ttsModelProtocol.ts`, VERIFIED)

Registered privileged (`standard, secure, supportFetchAPI, corsEnabled, stream`) before ready (`:44-50`). The handler decodes the path, joins with `getTTSModelsRoot()`, `normalize`s and rejects anything not under the root with 403 (`:65-77`); symlink resolution (`realpath`) is not applied, so a symlink placed inside `userData/tts-models` pointing elsewhere would be followed (requires prior local write access). Low.

---

## 3. IPC validation (sample across handlers)

Totals (doc 02 section 5.1): 295 `ipcMain.handle` channels, 22 `ipcMain.on`, 1 `once`. **Observations that apply to all of them (VERIFIED by grep):**

- No handler validates the sender: `grep -rn "senderFrame\|validateSender\|isTrustedSender" electron/` (excluding tests) returned **nothing**. Any frame of any renderer or `<webview>` guest that can reach `ipcRenderer` (only windows with the preload: all app windows) can call every channel. The preload is attached to all app windows, not to the YouTube webview (no `preload` attribute at `YouTubeTab.tsx:1836`), which limits this in practice.
- There is **no schema validation library** (no zod/ajv grep hit in `electron/`); handlers use TypeScript types only, which are erased at runtime. Argument validation, where present, is ad hoc.
- `ipcParity.test.ts` only checks that each preload `invoke` has a main handler, not argument shape.

Sampled handlers and their input handling:

| Channel (file:line) | Input | Validation observed | Risk |
|---|---|---|---|
| `app:openExternal` (`main.ts:1556`) | `url: unknown` | scheme allow-list (`isSafeExternalUrl`) | OK |
| `ttsAudioCache:get` / `put` (`ipc/ttsAudioCache.ts:43, 58`) | `key: string` | none; `fileFor(key)` is `join(cacheDir(), \`${key}.pcm\`)` (`:29-31`) | **S-8 (Medium-Low).** A key like `../../x` makes `get` read any `*.pcm` file and `put` write attacker-controlled bytes to `<path>.pcm` outside the cache directory (extension forced to `.pcm`, so it cannot overwrite normal user files, but it can create/overwrite files with that extension anywhere the process can write). Eviction `unlinkSync(fileFor(evictKey))` uses keys from the JSON index (`:64`), which an attacker who can write the index could influence. Requires a compromised renderer. VERIFIED (code); not exploited. |
| `pdf:readBytes` (`ipc/pdf.ts:68-76`) | `id: string` | looks up the row via the service, joins `pdfsDir()` with `row.filename` | filename comes from the DB row, which `pdf:import` populates from a dialog selection (`pdf.ts:24`); an iCloud-synced record with a hostile `filename` (a `pdf` sync entity, doc 02 section 6) could contain `..` segments. Whether the sync apply path sanitizes `filename` was not checked. UNVERIFIED. |
| `vault:readNote` (`ipc/vault.ts:744-758`) | `title: string` | none, but only compares `content.includes(...)` against files under the user's vault path | Low; returns the full contents of the first matching vault file. |
| `eSwordImport:start` (`ipc/eSwordImport.ts:444-450`) | `opts.folder: string` from renderer | only `existsSync(folder)`; folder is not required to come from a prior dialog result | **S-9 (Low).** A compromised renderer can point the importer at any folder readable by the process and ingest `*.notx` etc. into notes. |
| `app:exportNotePDF` (`main.ts:1869-1888`) | `html`, `suggestedName`, `downloadLocation` | filename sanitized (`replace(/[/\\:*?"<>\|]/g, '-')`); output path comes from a **save dialog** (`dialog.showSaveDialog`) | OK; `downloadLocation` only sets the dialog's default directory (`access()` checked) |
| `app:printNote`, `app:renderPreviewPDF`, `app:exportNotePDF` (`main.ts:1790, 1818, 1846`, helper at `:1760-1770`) | `html: string` | none: the HTML is written to a temp file and loaded in a hidden `BrowserWindow({ webPreferences: { sandbox: false } })` with **JavaScript enabled** and no CSP | **S-10 (Medium).** If note HTML (from imported/synced content) contains `<script>` or remote resources, it executes/loads in a `file://` hidden window. The window has no preload and `nodeIntegration` default false, so impact is bounded to script running in a file:// origin that can fetch the network and read same-directory files; whether the HTML generator (`src/lib/notePreviewRender.ts`) sanitizes (a `grep -il "sanitize\|DOMPurify"` in `src/` returned no hit for the print pipeline; markdown-it is configured `html: false` per `docs/mobile/security.md` section 3, which would limit script injection) was not exhaustively traced. INFERRED. |
| `app:saveNoteImageAs` (`ipc/noteImages.ts:53-63`) | `dataUrl`, `alt` | destination via `dialog.showSaveDialog` | OK |
| `app:openFolderDialog` (`main.ts:1561`) → `pickFolder` (`electron/mac/folderAccess.ts:38`) | none | native dialog; MAS stores a security-scoped bookmark | OK |
| `notes:update`, `notes:*` (`ipc/notes.ts`) and the other service-backed handlers | arbitrary objects | passed to `services().notes...`; SQL is parameterized in the service layer (`bibleService.ts` uses `?` placeholders and an FTS expression builder `safeFtsQuery`) | SQL injection not observed in sampled paths; `queryVerses` caps refs at 500 (`bibleService.ts:~118`) |
| `youtube:*` channels (`ipc/youtube.ts`, 19 channels, 30 raw `.prepare`) | URLs/ids | `.prepare` with bound params in the sampled lines; fetch hosts fixed (`www.googleapis.com`, `www.youtube.com`) | not exhaustively reviewed |
| `ailookup:*` (22 channels, 4,156-line `aiLookup.ts`) | question, options | provider ids validated by `ID_RE = /^[a-z][a-z0-9-]{1,31}$/` and key length/whitespace checks in `providerKeys.ts`; key never returned to the renderer (`read` is main-only) | good for key handling; the rest not reviewed |

Not sampled (UNVERIFIED): `studyTrail:*` (43 channels), `sessions:*`, `verseTags:*`, `tagGraph:*`, `sync:*` (10), `window`/`cross-window:*` relay (`cross-window:sendTo` accepts a target id; semantics live in the renderer), `app:openFloatingTab(type, state)` (state is an arbitrary object appended to the URL query string; not reviewed for URL injection), `chat:*`, `glass:*`.

Broad statement: the IPC boundary relies on (1) the renderer being trusted, (2) `contextIsolation`, and (3) a strict `script-src`. It does not defend against a compromised renderer. For a native migration this boundary disappears; but equivalent validation is required on any new file-path, URL and import entry points (Swift has no equivalent unless defined).

---

## 4. iPhone native bridge exposure (Capacitor)

VERIFIED (static): 14 first-party plugins registered in `BereanBridgeViewController` (doc 02 section 2.5), 63 methods, plus 9 `@capacitor/*` plugins from `includePlugins`. The WebView origin is `capacitor://localhost` with `server` settings in `capacitor.config.ts:36`. `CapacitorHttp.enabled` is on (native HTTP for CORS-less endpoints), which means page JS can make arbitrary native HTTP requests that bypass CORS (and, for non-`https` hosts, rely on ATS).

Path handling in plugins (VERIFIED from `ios/App/BereanNative/Sources/BereanNative`):

- `BereanSQLitePlugin.resolve(path:)` (`:42-81`) accepts only symbolic schemes `memory:`, `bundle:` (read-only, `immutable=1`) and `appsupport:`; anything else throws `unsupported path scheme`. JavaScript never sees absolute paths. The `appsupport:` branch builds a URL from the remainder (`:54-72`); `..` handling inside `appsupport:` was not exhaustively traced (UNVERIFIED), though `backup` rejects `/` and `..` in names (`:223`).
- `BereanCloudPlugin` (`:100`) rejects absolute paths, `..` components and `.icloud` placeholder names.
- `BereanShareInboxPlugin` rejects `/` and `..` (`:57`, `:68-71`).
- `BereanDownloadsPlugin` (`:47`, `:82`) and `BereanVoicePackPlugin` (`:75-78`) validate names/paths.
- `BereanWebViewPlugin` loads only `https://www.youtube.com/embed/<videoId>` inside a wrapper with base URL `https://player.berean.app/` (`BereanWebViewPlugin.swift:29, 59`). `videoId` interpolation was not checked for character validation (UNVERIFIED); the base URL host is only a Referer value and does not need to serve content, though ownership of `berean.app` was not checked.
- `BereanLocationPlugin` replaces `@capacitor/geolocation`, When-In-Use only.
- Native SQL: `BereanSQLite.exec/run/query/batch` execute **renderer-supplied SQL** against any open handle (`bundle:` handles are read-only; `appsupport:` are read-write). That is intended (the services layer runs in JS), but it means a compromised web layer has full SQL access to the user's database, and `VACUUM INTO '<path>'` at `:237` is built with string replacement of `'` (path from app-controlled name, backups only).

Findings:

- **S-11 (Low).** Because the services layer is JavaScript, the Swift side offers raw SQL to the WebView; security depends on WKWebView content being trusted. The iPhone has no `webviewTag` equivalent, and external links open in `SFSafariViewController` (`docs/mobile/security.md` section 3), which is sound. In a Swift migration the SQL access becomes in-process and typed; this finding disappears for the new app but the semantics (what SQL runs) must be preserved.
- `PrivacyInfo.xcprivacy` (`ios/App/App/PrivacyInfo.xcprivacy`) declares `NSPrivacyTracking false`, empty `NSPrivacyCollectedDataTypes`, and accessed-API reasons for UserDefaults (CA92.1), file timestamp (C617.1), disk space (E174.1), system boot time (35F9.1). The iPhone app itself sends data off-device in these cases: YouTube (feeds, embeds), transcript pack host, iCloud (Apple), Sefaria/Wikipedia web research (user-approved), optional model calls on iPhone were not found (iPhone Ask Berean is `modelFreeLookup`; `commentary` throws). VERIFIED from doc 02 section 5.3 and 17.4; no first-party server exists.
- Unused-but-linked plugins: `@capacitor/clipboard`, `@capacitor/preferences`, `@capacitor/status-bar` have no TypeScript import (doc 02 section 13.2) but are linked natively, enlarging the exposed native surface. INFERRED, low.

---

## 5. Entitlements, sandboxing, hardened runtime (`build/*.plist`, VERIFIED)

| Build | Sandbox | Entitlements (summary) | Notes |
|---|---|---|---|
| Mac DMG (`build/entitlements.mac.plist`) | **no App Sandbox**; hardened runtime on (`package.json:184`) | `allow-jit`, `allow-unsigned-executable-memory`, `allow-dyld-environment-variables`; both `entitlements` and `entitlementsInherit` point to the same file (`:186-187`) | Full user-file access. Notarized via `build/notarize.js` after sign. Reads iCloud container by path (`~/Library/Mobile Documents/iCloud~com~berean~app/Documents`, `electron/sync/fsSyncStore.ts:169-170`) without an iCloud entitlement. |
| Mac App Store (`entitlements.mas.plist`, `.inherit.plist`) | App Sandbox | `app-sandbox`, `allow-jit`, `allow-unsigned-executable-memory`, `network.client`, `files.user-selected.read-write`, `files.bookmarks.app-scope`, iCloud container `iCloud.com.berean.app` (CloudDocuments, ubiquity, Production environment), `com.apple.application-identifier = 6C8RCZVUZR.com.berean.app`, team identifier, `personal-information.location`, `print`, `application-groups = 6C8RCZVUZR.com.berean.app` (Chromium helper rendezvous; not a data-sharing group per `docs/mac-app-store.md` section 2) | `files.downloads.read-only` was removed after App Review rejection (Guideline 2.4.5(i), June 2026); `entitlements.test.ts` and `verify-mas.mjs` enforce this. `hardenedRuntime: false` for MAS (`:213`). Helpers carry only `app-sandbox` + `inherit`. No camera/microphone entitlements. |
| MAS dev (`entitlements.mas.dev.plist`) | same | same, dev container `iCloud.com.berean.app.dev` | |
| iOS App (`ios/App/App/App.entitlements`) | iOS sandbox | iCloud container and ubiquity id `$(BEREAN_ICLOUD_CONTAINER)`, `CloudDocuments`, App Group `$(BEREAN_APP_GROUP)` | Placeholder-driven from `Identity.xcconfig` |
| iOS ShareExtension | iOS sandbox | App Group only | bundle id `$(BEREAN_BUNDLE_ID).share` (`project.pbxproj:506`) |
| iOS Widget | | | bundle id `$(BEREAN_BUNDLE_ID).widget` (`:461`) |

Observations:

- **S-12 (Info).** The DMG and the MAS app share the same bundle id and `appId` (`package.json:124`, `com.berean.app`) but have different sandboxed and non-sandboxed data locations (`~/Library/Application Support/Berean` vs `~/Library/Containers/com.berean.app/Data/Library/Application Support/Berean`; `docs/mac-app-store.md` line 18). A user who has both installed has two separate databases. Both can also open the same iCloud container (DMG by path, MAS via entitlement).
- **S-13 (Low).** `NSLocation...` strings in `package.json` (`mac.extendInfo`, `mas.extendInfo`) and iOS `Info.plist`; the DMG build has no `personal-information.location` entitlement (not needed without a sandbox).
- iOS `Info.plist` also requests `NSPhotoLibraryUsageDescription` (photo insert into notes), has `NSAllowsLocalNetworking` only, `UIBackgroundModes = audio`, and `ITSAppUsesNonExemptEncryption = false`.

---

## 6. Secrets and API keys

- **User BYO cloud key (Anthropic)**: `electron/secrets/providerKeys.ts` encrypts with Electron `safeStorage` (Keychain-backed), refuses to store if encryption is unavailable, writes `provider-keys.json` with mode `0o600` via tmp+rename, never returns the key to the renderer (`read` is main-only; `ID_RE` validates the provider id; key length cap 512, no whitespace). VERIFIED. This is **Mac-only**; the iPhone has no provider-key feature (doc 02 section 5.3). Migration implication: a Swift app cannot call Electron's `safeStorage`; the ciphertext in `provider-keys.json` is encrypted with a key held in a Keychain item owned by the Electron app (Chromium `os_crypt`); reading it from Swift requires reproducing Chromium's scheme and Keychain access control. INFERRED. Likely outcome: users re-enter keys, or a one-time export step is needed. UNVERIFIED either way.
- **Build-time YouTube Data API key (S-14, Medium, VERIFIED)**: `electron/ipc/youtube.ts:19` imports `YOUTUBE_API_KEY` from gitignored `electron/youtube-key.ts` (`.gitignore:16`); it is used as a query parameter `key: YOUTUBE_API_KEY` at `youtube.ts:330` and `:357` against `https://www.googleapis.com/youtube/v3/...`. CI writes it at build time from a secret: `.github/workflows/release.yml:42` (macOS job) and `:151` (Windows job) run `echo "export const YOUTUBE_API_KEY = '${YT_KEY}'" > electron/youtube-key.ts`; `ci.yml:41` writes an empty string. The compiled bundle **contains the key as a literal**: `grep -c "AIza" out/main/index.js` returned 1 for the local build in this audit (the local `electron/youtube-key.ts` was populated by the developer; the value was neither printed nor recorded). Every shipped DMG, ZIP, MAS and Windows installer therefore carries a recoverable Google API key (asar archives are not encrypted). It is also visible in network requests (key in the URL query). The key can be abused for quota exhaustion or billing exposure unless restricted by HTTP referrer/IP/API restrictions in the Google Cloud console; whether it is restricted is UNVERIFIED (BLOCKED: console not accessed). The iPhone bundle does not contain it: `docs/mobile/security.md` section 4 says the key is "verified absent from the production bundle", and no `AIza` literal exists in `src/`, `ios/`, `scripts/`, `.github/` or `docs/` (grep). Whether the iPhone YouTube refresh uses its own no-key InnerTube/RSS path is not re-verified here.
- Signing/notarization secrets in CI (names only; values not read): `MAC_CERT_P12_BASE64`, `MAC_CERT_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `YOUTUBE_API_KEY`, `GITHUB_TOKEN`; Windows cert secrets are commented out (`release.yml:177-179`).
- `ios/App/Signing.xcconfig` is gitignored (per `docs/mobile/security.md`); `Signing.xcconfig.example` is committed. A pre-commit scan is described that "rejects the developer's team id", yet `config/app-identity.json` (committed) contains `teamId: "6C8RCZVUZR"` and the MAS entitlements contain the same value: the doc and the repo disagree (Team ID is not a secret; it appears in every signed binary; documentation inconsistency only).
- `build/embedded.provisionprofile` is gitignored (`.gitignore:20`) while `embedded.berean-dev.provisionprofile` and `embedded.dev.provisionprofile` are present in `build/` (not listed in `git ls-files build`, so not tracked). Not read (provisioning profiles embed certificate material and entitlements; not secrets per se, but not opened).
- No secrets in logs claim: `providerKeys.ts` header states keys are never stored in logs; `electron-log` forwarding of renderer console warnings/errors to disk is described in PA-2026-10-19 P2-3 (HISTORICAL). Log content hygiene beyond that was not audited.

---

## 7. Data at rest

| Data | Location | Protection | Label |
|---|---|---|---|
| `berean.db` (notes, highlights, chats, tabs, trail, sync outbox) | Mac: `<appData>/Berean[-dev]/berean.db` (DMG) or the sandbox container (MAS); iPhone: `Library/Application Support/Berean/` | **Not encrypted**; no SQLCipher (`grep -rli "sqlcipher\|pragma key"` found nothing in `electron/`, `src/`, `ios/App/BereanNative`). Mac: relies on FileVault and the OS account. iPhone: iOS default file protection `CompleteUntilFirstUserAuthentication` (documented in `docs/mobile/security.md` section 1, not re-checked on device) | VERIFIED (absence), UNVERIFIED (protection class) |
| iPhone backups | included in device backups except `downloads/`, `tts-cache/`, `tts-model/` | | per doc |
| Vault markdown mirror (`berean-notes/`) | user-chosen folder (default Octarine iCloud workspace) | plain `.md`, iCloud Drive encryption only | VERIFIED |
| iCloud sync journals | `iCloud~com~berean~app/Documents/sync/v1/devices/<id>/` | plain files; Apple encrypts iCloud Drive in transit/at rest | VERIFIED |
| `provider-keys.json` | userData | `safeStorage`-encrypted, 0600 | VERIFIED |
| `sandbox-bookmarks.json` | userData (MAS) | security-scoped bookmarks; "this Mac only, never synced" | per docs/mac-app-store.md |
| YouTube session | `persist:youtube` partition (cookies on disk) | Chromium cookie store (encrypted via `os_crypt`) | INFERRED |
| BibleGateway session | `persist:biblegateway-import` partition | same; the user types credentials into biblegateway.com's own page inside an app window with injected scraping JS (`bgImport.ts`, `fetch`-based) | INFERRED; whether credentials or cookies are ever persisted by Berean code beyond the partition was not traced |
| `tts-audio-cache`, `tts-models`, PDFs, note images | userData | plain files | VERIFIED |
| Zustand `persist` state (`berean-app-state`) | Chromium `localStorage` in userData (Mac), WKWebView storage (iPhone) | plain LevelDB/SQLite store managed by the engine | VERIFIED (doc 02 section 7) |

Atomic write: `electron/atomicWrite.ts` (tmp + rename) for note files and keys; `runMigrations` takes a consistent backup before upgrade and refuses a damaged DB (`bereanMigrations.ts` ~1316-1330; `DatabaseDamagedError`).

---

## 8. iCloud and file access

- iCloud sync is **iCloud Drive file sync, not CloudKit** (`docs/mobile/icloud-lifecycle.md` section 1): per-device append-only journals + manifest under `Documents/sync/v1/devices/<id>/`, merged by hybrid logical clock (doc 05). The Mac DMG reads and writes the container by path without a sandbox; the MAS build obtains the container URL from `URLForUbiquityContainerIdentifier` through the Node-API helper `native/mac-icloud/berean_icloud.m` (106 lines, arm64 only); iPhone uses `NSFileCoordinator` + `NSMetadataQuery` in `BereanCloudPlugin.swift`.
- Account-switch safety: iOS identity-token hash and "own history missing" lead to a **held** state; the sync engine never deletes iCloud data itself (per lifecycle doc). Not exercised (BLOCKED).
- `NSUbiquitousContainerIsDocumentScopePublic = true` and `NSUbiquitousContainerSupportedFolderLevels = Any` in the iOS `Info.plist` make the container's `Documents` visible in the Files app and in iCloud Drive on the Mac under the app name. The sync journals are therefore user-visible and user-deletable, which the lifecycle document treats as an explicit user choice. VERIFIED (plist); behaviour on deletion INFERRED from the doc.
- MAS file access: user-selected read-write + app-scope bookmarks only. DMG: unrestricted. Vault watcher (`chokidar`, polling 1.5 s, depth 10) reads and writes the user's folder; a hostile `.md` file placed in the vault is parsed by the importer (`vault.ts`, 41 raw `.prepare`; YAML frontmatter and `title:` matching). Reconcile uses last-write-wins by `updated_at` (CLAUDE.md section 18). A vault file with a `berean_id` of another note can overwrite that note: INFERRED, by design.
- Known failure mode already seen in production use: dataless (evicted) iCloud files hanging a synchronous `readFileSync` in `vault:reconcile` (memory file `project_icloud_dataless_vault_hang`; not re-verified here, UNVERIFIED).

---

## 9. App Store compatibility, user-generated content, privacy documentation

### 9.1 User-generated content and AI

- Notes, highlights, chats and study trails are private to the user and the user's own iCloud. There is no public sharing, feed, comments, messaging or accounts; no first-party server (`docs/mobile/security.md` section 4). Apple's UGC requirements (Guideline 1.2: reporting, blocking, moderation) concern apps that publish user content to others; none of those paths exist in this codebase. INFERRED from the feature inventory; not an App Review determination.
- Berean Chat / Ask Berean (Mac only) can send the user's question to **Anthropic** with a BYO key (`src/lib/research/providers.ts`, `https://api.anthropic.com/v1/messages`), gated by `decide('cloud-question')` and a separate consent for private context (`src/lib/research/policy.ts`: `cloud-question`, `cloud-private-context`; defaults `cloudEnabled: false`, `cloudPrivateContext: false`, `web: 'off'`). Web research (Sefaria, Wikipedia) is user-approved. Apple's current guidelines on disclosing and obtaining permission before sharing personal data with third-party AI should be checked against this flow before any new App Store submission; I did not verify the exact current guideline text (UNVERIFIED). The local default is Ollama on `localhost:11434` (`electron/ollama.ts`).
- Previous review history in the repo: MAS rejection 2.4.5(i) (unused Downloads entitlement, June 2026); ITMS-90683 (always-location string from `@capacitor/geolocation`), both fixed.
- Content: the app presents religious texts and a doctrinal naming convention ("Yeshua", "Yehovah"); KJV text is displayed verbatim. No App Store guideline issue was identified by this audit; not reviewed against App Review's religious-content guidance.

### 9.2 `docs/privacy.md` accuracy (VERIFIED against code; `docs/privacy.html` has the same "Last updated: May 2026")

| Statement | Reality in this commit |
|---|---|
| "does not collect, transmit, or share any personal data ... works entirely offline" | The app does network calls (below); no first-party collection exists, so "collects no personal data" is defensible, but "entirely offline" and "does not transmit" are overstated. |
| "No location data is accessed" | **False.** Daily notes begin at local sunrise; the renderer requests geolocation once per launch (`main.ts:1471-1477` allows `geolocation`; `NSLocationWhenInUseUsageDescription` in `package.json` mac/mas `extendInfo` and iOS `Info.plist`; `BereanLocationPlugin`; `suncalc`). Location is processed on-device only per the usage strings, but the sentence is wrong and App Review/MAS metadata reviewers compare it with the entitlement `personal-information.location`. |
| "No crash reports are sent to any server" | No `crashReporter` use found (`grep crashReporter electron src` empty). Consistent. |
| "stored locally on your Mac" | Outdated: an iPhone app and iCloud Drive sync of notes, highlights, trails, chats and PDFs metadata now exist. The iCloud transfer is to the user's own iCloud account via Apple, which the document does not mention (it says only "your own tools (e.g. iCloud, Dropbox)"). |
| Network requests "YouTube ... App updates (GitHub Releases)" only | Incomplete. Observed hosts in the code: `www.youtube.com`, `i.ytimg.com`, `www.googleapis.com` (YouTube Data API with the embedded key), `www.youtube-nocookie.com`, `en.wikipedia.org`, `www.sefaria.org`, `www.biblegateway.com` (login-based notes import), `api.anthropic.com` (BYO key), `huggingface.co` and `cdn.jsdelivr.net` (Kokoro model and ONNX runtime download), `tactiq.io` (dev-only transcript fetch), GitHub Releases (updates), `github.com`, `ollama.com` (link), `sitgmeat.com` (Help menu), and the transcript-pack host on iPhone. |
| "No third-party tracking or analytics SDKs" | Consistent with `package.json`; Google (YouTube) and Anthropic receive requests as listed. |
| "Bible databases are public-domain" | Not audited here (licensing of Taylor/Hoole/other translations, Strong's, TSKE, `youtube_seed.db` transcripts). UNVERIFIED. |
| Missing | Disclosure of AI/cloud flow, BibleGateway import, model downloads, the iPhone app, the Share Extension and widget, and contact for deletion of iCloud data. |

Recommendation for tracking only (not to implement now): the privacy policy and the App Store privacy "nutrition label" must be reconciled with the above before or alongside any identity-preserving new binary, because the new app is submitted under the same App Store record.

### 9.3 Permissions inventory

Mac (`extendInfo` and entitlements): location When-In-Use (sunrise), user-selected files, iCloud Documents, print. iPhone `Info.plist`: location When-In-Use, photo library (insert photo), local networking exception, background audio. Nothing else (no camera, microphone, contacts, Bluetooth, tracking). VERIFIED. Both location strings are accurate and on-device only.

---

## 10. Signing, notarization and update channels

### 10.1 Mac direct download

- `electron-builder` 24.13.3, targets `dmg` and `zip`, **arm64 only** (`package.json` mac block). Hardened runtime and `build/notarize.js` as `afterSign` using `@electron/notarize` with `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`; `"notarize": false` in builder config (`package.json:~189`) and the hook is used instead.
- **S-15 (Medium).** `build/notarize.js` returns silently (`"skipping notarization"`) when `APPLE_ID` is unset (`:18-21` region). In CI the secret exists, but a missing/renamed secret would not fail the release; the artifact would then be signed but not notarized, or unsigned if the keychain step also fails open. Whether the workflow asserts notarization afterward was not found; UNVERIFIED. (`release.yml` retries electron-builder up to 3 times: `:103-114`.)
- Publishing: `publish.provider github`, `owner RoyalWeden`, `repo Berean`, `releaseType draft` (`package.json:251-256`). Electron-builder `--publish always` creates/updates a **draft** release; the workflow job `publish-stable` (`release.yml:206-223`) flips draft to released after both `build-mac` and `build-win` succeed. **S-16 (Medium, release-process).** `needs: [build-mac, build-win]` (`:185`, `:208`) means a failing **Windows** build blocks publishing the Mac release (and beta marking), and a success of both is the only path to the update feed. A Mac-only emergency release is impossible through this workflow without editing it. VERIFIED.
- `electron-updater` in main (`main.ts:7`, `:260-276`, `:1993-2108`): `autoDownload = false`, `autoInstallOnAppQuit = false`; opt-in `autoDownloadUpdate` setting; check at +6 s and +20 s retry, then every 5 minutes (`:2100`); `allowPrerelease = true` when channel is `beta` (`:2004`, `:2067`, `:2104`). On MAS it reports status `mas` and does not use the updater (`main.ts:1993`). Update integrity on macOS: electron-updater verifies the downloaded ZIP's SHA-512 against `latest-mac.yml`, and Squirrel.Mac requires the new app to be signed by the same identity; update metadata is fetched over HTTPS from GitHub. Compromise of the GitHub repo or release assets would be the supply-chain risk; there is no separate update-signing key (unlike Sparkle's EdDSA). INFERRED from electron-updater's documented behaviour.
- **Windows**: NSIS x64 built by CI (`release.yml:122-181`), **unsigned** (cert secrets commented out at `:177-179`; `package.json` `win` block has no `publisherName`/certificate settings). electron-updater on Windows then relies only on the SHA-512 in `latest.yml`; no Authenticode check; SmartScreen will warn. `CLAUDE.md` says Windows is "deferred"; the CI job and installer exist (doc 02 section 19). Whether Windows installers are distributed to real users is UNVERIFIED.
- Tagging: `scripts/tag-release.js` (`tag:stable`, `tag:beta`), beta series logic `0.2.8-beta.N`; CI marks `-beta|-alpha|-rc` tags as pre-release and publishes the rest as stable. Data DBs are published separately to release `data-v1` by `scripts/publish-data.js` (SHA-256 per file), downloaded in CI, so a release build depends on that mutable release asset set (`ci.yml`, `release.yml` "Download Bible/lexicon databases"). Data-asset tampering or deletion at `data-v1` would change shipped content or break CI. INFERRED.

### 10.2 Mac App Store

`mas` target arm64, sandboxed, provisioning profile `build/embedded.provisionprofile` (gitignored), `scripts/mac/package-mas.mjs` → `.pkg` upload by a human; `scripts/mac/verify-mas.mjs` verifies the signed app against `config/app-identity.json`. Disables the Network Service sandbox and the GPU (`main.ts:140-152`). MAS status as of the last recorded memory: "still needs iCloud profile + installer cert" (project memory `project_mas_release.md`, UNVERIFIED for this commit; `docs/mac-app-store.md` is 195 lines and was only partially read).

### 10.3 iPhone

TestFlight/App Store upload is manual (`xcodebuild archive/export`; the `release-berean` skill, `docs/mobile/testflight.md`). No iOS job in `release.yml` or `ci.yml` (CI builds only the web bundle: `npm run ios:build:web`; no Swift compile or XCTest). `Version.xcconfig` is generated from `package.json` by `scripts/ios/version.mjs`; `CURRENT_PROJECT_VERSION` is the build number (7). Development builds are always Berean Dev (`dev-safety-check.sh` fails Debug builds that are not `com.berean.app.dev`).

### 10.4 Version migration and recovery from a failed release

- **Schema**: forward-only migrations `BEREAN_MIGRATIONS` v1..v49 (`src/platform/db/bereanMigrations.ts`), each in its own transaction, preceded by a consistency check and a backup (`DatabaseDamagedError`, `beforeMigrate`); a failure leaves the DB at the previous version.
- **S-17 (Medium, migration).** There is **no downgrade guard**: `runMigrations` applies `m.version > current` only; if `current` is greater than the highest known migration, nothing runs and the older app proceeds against a newer schema (no `user_version`/`schema_version` too-new refusal found in `bereanMigrations.ts`, `electron/db/berean.ts` or `src/platform/db/*`). A user who installs a newer build on one device (or a future Swift build that bumps the schema), then runs an older build, can corrupt or mis-read data. Combined with iCloud sync between devices at different app versions, the sync protocol version (`sync/v1`) is the only compatibility gate found; entity kinds unknown to an older client are "skipped, malformed ops logged and skipped" (`docs/mobile/security.md` section 2), which means newer-version data is silently ignored (not lost) by older clients. INFERRED. Cross-version behaviour is not exercised in this audit.
- **Rollback of a bad Mac release**: electron-updater pulls the newest non-draft release; to roll back one would delete/mark the bad release and publish a higher version (updater does not downgrade by default; `allowDowngrade` is not set, grep). Existing installs that already took the bad version keep it until a higher version is published. The repo has `tag:stable` but no revert script. Recovery runbook not found (UNVERIFIED). `mergeYouTubeSeed` runs once (`youtubeSeedVersion=2`), so a bad seed cannot be re-run without a settings reset.
- **iPhone**: TestFlight/App Store phased release is a human step; no code-based kill switch exists. iPhone DB backup before migration uses `BereanSQLite.backup` (`VACUUM INTO`, `appsupport:backups/<name>`) per `BereanSQLitePlugin.swift:223-244` and keeps a configurable number.

---

## 11. Barriers to a new Swift app preserving the current app identity and user data

Everything below is a fact about the current deployment that a native successor must either preserve, migrate or consciously break. None of it is a recommendation to act now.

### 11.1 Identity values (VERIFIED, `config/app-identity.json`, entitlements, `Info.plist`, `package.json`)

| Item | Production value | Dev value |
|---|---|---|
| Team ID | `6C8RCZVUZR` (committed in `config/app-identity.json`, entitlements, `scripts`) | same |
| Bundle ID (Mac DMG, MAS, iPhone) | `com.berean.app` (`package.json:124`; iOS via `$(BEREAN_BUNDLE_ID)` from `Identity.xcconfig`) | `com.berean.app.dev` |
| iPhone extensions | `com.berean.app.share`, `com.berean.app.widget` | `.dev.share`, `.dev.widget` |
| iCloud container | `iCloud.com.berean.app` (iPhone, MAS; DMG reaches it by path) | `iCloud.com.berean.app.dev` |
| iPhone App Group | `group.com.berean.app` (Share Extension inbox) | `group.com.berean.app.dev` |
| Mac MAS "application group" | `6C8RCZVUZR.com.berean.app` (Chromium rendezvous only) | `6C8RCZVUZR.com.berean.app.dev` |
| URL schemes | `berean`, `berean-pdf` | `berean-dev`, `berean-dev-pdf` |
| Mac data dir | DMG `~/Library/Application Support/Berean`; MAS `~/Library/Containers/com.berean.app/Data/Library/Application Support/Berean` | `Berean-dev` |
| iPhone data | `Library/Application Support/Berean/berean.db`, `Library/Berean/pdfs`, iCloud container | |
| Sync root | `Documents/sync/v1/devices/<id>/` (journals + manifest), device ids are per install (a reinstall is a **new** device id) | |
| Widget/Spotlight/App Intents | `<scheme>://chat/new`, `CSSearchableItemActionType`, five App Intents with `openAppWhenRun = true` | |
| Provisioning | `build/embedded.provisionprofile` (MAS, gitignored), iOS automatic/manual via `Signing.xcconfig` (gitignored) | `embedded.dev.provisionprofile`, `embedded.berean-dev.provisionprofile` |

### 11.2 Barriers and constraints

1. **Same bundle ID is required for an in-place App Store update.** The iPhone Swift app can replace the Capacitor app only if it ships under `com.berean.app` with the same team, preserving `iCloud.com.berean.app`, `group.com.berean.app` and the Share Extension/Widget ids. A new bundle ID is a new App Store record: no update path, no carry-over of container data, no iCloud container access, no TestFlight continuity. The iCloud container and App Group are tied to the team and the App ID, so a different team (transfer) is a heavier operation. VERIFIED (constraint is Apple-side; INFERRED for effect).
2. **User data inside the Capacitor app is split across stores a native app must read.** (a) `berean.db` in `Library/Application Support/Berean/` is plain SQLite and portable (doc 04). (b) The Zustand `persist` state (`berean-app-state`) lives in WKWebView `localStorage`, not in SQLite; part of it is mirrored into the SQLite `settings` table by `settingsBridge`, but fields excluded from that mapping would be lost if the web storage is not migrated. Reading WKWebView storage from native code is unsupported/awkward; which fields are only in localStorage was not enumerated here (UNVERIFIED; see doc 04). (c) `@capacitor/preferences` (UserDefaults suite `CapacitorStorage`) is linked but not used by TypeScript. (d) `Library/Berean/pdfs` PDFs, downloaded voice packs and transcript packs in the container. (e) App Group inbox. On the Mac, the same applies to Chromium `localStorage`/IndexedDB in `userData` (LevelDB), and `sandbox-bookmarks.json` (MAS security-scoped bookmarks, readable only by the same app identity).
3. **MAS vs direct download.** Two Mac distribution channels share `com.berean.app` but have different data locations and sandbox rules (S-12). A Swift Mac app must pick: (i) MAS-only (sandboxed, iCloud container by entitlement, no auto-updater, review delay), (ii) Developer ID direct (not sandboxed, `iCloud` container access needs the iCloud entitlement + profile for a legitimately signed non-MAS app, or the current path-based access, Sparkle updates), or (iii) both, with the existing pair of users and two databases. Existing MAS users' data sits in the sandbox container of the bundle id `com.berean.app`; a Developer-ID Swift app with the same bundle id would **not** automatically read it. DMG users' data at `~/Library/Application Support/Berean` is not readable by a sandboxed MAS successor without a user-granted folder bookmark. INFERRED, structural.
4. **Updater replacement.** `electron-updater` + GitHub Releases + `latest-mac.yml` is what installed DMG copies use today. A Swift successor cannot update itself through that channel unless the final Electron release downloads it as an electron-updater ZIP containing the new app under the same signing identity (which works for macOS, since Squirrel.Mac replaces the bundle if the code signature identity matches). Sparkle (EdDSA-signed appcast) or a custom updater would apply from the Swift app's first release onward, but **existing Electron installs need one bridging release** that delivers the new native bundle by their current updater (INFERRED; untested). The beta channel (`allowPrerelease`) and the 5-minute check cadence are existing user-facing behaviours (Settings → Updates). MAS users update via the App Store only.
5. **Windows has no native path.** The CI builds an unsigned NSIS x64 installer from the same Electron code (`release.yml:122-181`). A Swift/AppKit/SwiftUI app does not run on Windows. Windows users, if any exist (UNVERIFIED), would be stranded on the last Electron build, with updates from GitHub Releases only if that channel is kept alive; electron-updater would offer them no signature protection (S-16 area). Their data is local (`%APPDATA%\Berean`) with no iCloud (macOS/iOS only), so the only cross-platform path is the markdown vault export (`vault.ts`) and the DB file itself.
6. **Intel Macs.** DMG/MAS builds are arm64-only (`package.json` mac/mas targets), so Intel Macs already have no current Electron build; no extra barrier from Swift, but nothing to preserve either. VERIFIED. The `berean_glass.node` addon is universal; irrelevant after migration.
7. **Sync protocol compatibility during a mixed-version period.** The Swift apps must read and write the exact journal/manifest format (`sync/v1`), HLC semantics, tombstones, conflict copies in `note_versions` (doc 05), because the Electron Mac, the Capacitor iPhone and the new Swift apps could be live on the same iCloud container for weeks. Device ids are per install; a native reinstall is a new device (`docs/mobile/icloud-lifecycle.md` section 1) and the old device folder stays as an inactive history. VERIFIED (doc); behaviour under mixed versions was not tested.
8. **Schema without downgrade guard** (S-17). A Swift app on an unchanged v49 schema is compatible; any added table/column makes older Electron/iPhone builds sharing the DB or the sync stream unsafe. Because no too-new refusal exists, shipping a Swift app that migrates the same `berean.db` forward would silently break rollbacks.
9. **Key material.** Provider keys (`provider-keys.json`, Chromium `safeStorage`) are bound to the Electron app's Keychain item; the YouTube Data API key is embedded in the old Mac binary and would have to be re-provisioned in the native app, with a plan for the existing key's restrictions (S-14).
10. **Deep links and system integrations.** `berean://` and `berean-pdf://` links embedded in users' notes (wikilink/verse links, timestamp links) and in the vault markdown exports must keep working: the Swift app must register the same schemes, and note content that stores `berean://` URLs is a durable dependency. Spotlight index identifiers, Shortcuts/App Intents (five intents), the widget URL `<scheme>://chat/new`, and the Share Extension's App Group JSON inbox format are all contracts with the OS and with already-installed extensions. VERIFIED (code).
11. **Entitlement-specific history.** MAS rejected `files.downloads.read-only` once; the MAS app-group entry `6C8RCZVUZR.com.berean.app` exists only for Chromium's rendezvous and would be unnecessary for a native app, but removing it changes the sandbox profile and must be re-validated against App Review. A native app also no longer needs `allow-jit`/`allow-unsigned-executable-memory`, which reduces review friction (INFERRED).
12. **Third-party identities.** The `player.berean.app` Referer base URL (`BereanWebViewPlugin.swift:29`) assumes ownership of `berean.app` (not verified); the YouTube Data API key's Google Cloud project; GitHub repo `RoyalWeden/Berean` (update feed, data release `data-v1`, GitHub Pages `docs/` and `sitgmeat.com`); the Apple ID used for notarization; privacy and support URLs in the store listing. A new app inherits all of these ownership dependencies.

### 11.3 What is not a barrier (checked)

- SQLite files are standard SQLite 3 with FTS5 virtual tables and triggers (doc 04); no proprietary format.
- The sync journals are plain files in an iCloud Drive container; iCloud access is through standard Apple APIs that Swift uses natively (the iPhone app already does so in Swift).
- The Share Extension, widget and App Intents are already Swift.
- Bundled text DBs are read-only SQLite opened `immutable=1`.

---

## 12. Findings summary (ordered by severity under the stated model)

| ID | Severity | Summary | Where |
|---|---|---|---|
| S-14 | Medium | YouTube Data API key compiled into every shipped Mac/Windows bundle; recoverable from the asar; restrictions unknown | `electron/ipc/youtube.ts:19,330,357`; `.github/workflows/release.yml:42,151`; `out/main/index.js` |
| S-17 | Medium | No schema downgrade guard; mixed-version DB or sync use can misbehave | `src/platform/db/bereanMigrations.ts` `runMigrations` (~1316) |
| S-1 | Medium | `sandbox: false` on every window although the preload requires only `electron` | `electron/main.ts:806-808, 898-900, 971-973, 1033-1035, 1087, 1184, 1790, 1818, 1846`; `ipc/bgImport.ts:357, 801` |
| S-2 | Medium | `webviewTag: true` with no `will-attach-webview`; stale MAS comment | `main.ts:1086, 1183`; `YouTubeTab.tsx:1836` |
| S-4 | Medium | Permission handler is origin-blind; no handler on `persist:youtube` or BibleGateway partitions | `main.ts:1471-1477`, `main.ts:1450` |
| S-10 | Medium | Note HTML executed in a hidden JS-enabled `file://` window for print/PDF | `main.ts:1760-1800, 1840-1860` |
| S-15 | Medium | Notarization silently skipped when `APPLE_ID` is unset | `build/notarize.js` |
| S-16 | Medium | A Windows build failure blocks the Mac release; Windows installer unsigned | `.github/workflows/release.yml:185, 208, 177-179` |
| S-8 | Fixed (PR #11) | `ttsAudioCache` key path traversal (read/write `*.pcm`) | `electron/ipc/ttsAudioCache.ts:29-31, 43, 58` |
| S-7 | Low-Medium | CSP `connect-src https:`/`img-src https:` allow arbitrary HTTPS exfiltration; no `base-uri`/`form-action` | `electron/csp.ts:30,40` |
| S-3 | Low-Medium | YouTube guest has no navigation/window-open restriction | `main.ts:187` |
| S-9 | Low | e-Sword import accepts any folder string from the renderer | `ipc/eSwordImport.ts:444-450` |
| S-11 | Low | iPhone WebView has raw SQL access through `BereanSQLite` | `BereanSQLitePlugin.swift` |
| docs | Medium (compliance) | `docs/privacy.md` says "No location data is accessed" and "entirely offline"; omits iCloud, iPhone app, AI/cloud, BibleGateway, model downloads | `docs/privacy.md`, `docs/privacy.html` |

Not verified at all: dependency vulnerabilities (no `npm audit` run; network access to the advisory service was not part of this audit), Electron 32.3.x security advisories (Electron 32 is not the current stable release as of this audit's date and no support-window check was performed), code-signing identity validity, notarization stapling on shipped DMGs, and actual restrictions on the Google API key.

## 13. Files and symbols cited

`electron/main.ts`, `electron/csp.ts`, `electron/externalLinks.ts`, `electron/ttsModelProtocol.ts`, `electron/devTools.ts`, `electron/preload.ts`, `electron/secrets/providerKeys.ts`, `electron/ipc/{ttsAudioCache,pdf,vault,eSwordImport,noteImages,bgImport,youtube,aiProviders}.ts`, `electron/sync/{fsSyncStore,macContainer}.ts`, `electron/mac/folderAccess.ts`, `src/platform/db/bereanMigrations.ts`, `src/platform/services/bibleService.ts`, `src/lib/research/{policy,providers}.ts`, `src/components/youtube/YouTubeTab.tsx`, `build/{entitlements.mac,entitlements.mas,entitlements.mas.inherit,entitlements.mas.dev}.plist`, `build/notarize.js`, `build/afterPack.js`, `package.json` (build block), `.github/workflows/{ci,release}.yml`, `config/app-identity.json`, `capacitor.config.ts`, `ios/App/App/{Info.plist,App.entitlements,PrivacyInfo.xcprivacy}`, `ios/App/ShareExtension/ShareExtension.entitlements`, `ios/App/App.xcodeproj/project.pbxproj`, `ios/App/BereanNative/Sources/BereanNative/{BereanSQLite,BereanCloud,BereanShareInbox,BereanDownloads,BereanVoicePack,BereanWebView}Plugin.swift`, `docs/privacy.md`, `docs/privacy.html`, `docs/mac-app-store.md`, `docs/mobile/security.md`, `docs/mobile/icloud-lifecycle.md`, `scripts/audit-production.mjs`, `scripts/tag-release.js`, `scripts/publish-data.js`.
