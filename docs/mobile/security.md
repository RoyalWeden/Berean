# Berean iPhone — Security & privacy audit (R112, R113)

Audited 2026-09-21 against the code on `feature/ios-app`. "Verified" means read in the source
and, where marked, exercised on the simulator.

## 1. Local data

| Item | Finding |
|---|---|
| `berean.db` location | `Library/Application Support/Berean/` inside the app sandbox (`BereanSQLitePlugin`); not in Documents, so it is never exposed through the Files app. |
| File protection | iOS applies `NSFileProtectionCompleteUntilFirstUserAuthentication` to every file an app creates by default (since iOS 7); no lower class is requested anywhere. The DB is readable after the first unlock so background audio / sync can run. |
| Backups | The user DB (and PDFs) are included in device backups — iCloud sync is opt-in, so for a user who never enables it the backup is the only durable copy. Found during this audit: the SQLite plugin excluded the whole `Berean/` support directory from backup; fixed so only `downloads/`, `tts-cache/`, `tts-model/` are excluded (re-downloadable). Note exports go to `Library/Caches/exports/`. |
| Bundled texts | opened `readonly immutable` from the app bundle; never written. |
| Transcript packs | downloaded into the app container (`appsupport:downloads/`), SHA-256 verified against the bundled manifest before merge, deleted after merge. |
| Note exports | written to `Library/Caches/exports/` only for the duration of a share; overwritten per export. |

## 2. iCloud data

| Item | Finding |
|---|---|
| What syncs | notes, note folders/versions, highlights, verse tags, tabs/sessions/workspaces, playlists, trail data, PDF metadata + bookmarks, YouTube stars/positions (`icloud.md` §3). Never: Bible texts, transcripts, settings, API keys, the SQLite file itself. |
| Where | the app's own iCloud Drive container (`BEREAN_ICLOUD_CONTAINER`), per-device append-only journals + snapshots (D-002/D-004). Only devices signed into the same Apple ID can read it; Apple encrypts iCloud Drive at rest and in transit. |
| Integrity | every op is checked for shape on apply; unknown entities are skipped, malformed ops are logged and skipped (`engine.ts` apply loop), never crash the app. |

## 3. Deep links and shared input

| Surface | Validation |
|---|---|
| `berean://` URLs (URL scheme, Spotlight, App Intents, note links) | parsed by `src/lib/deepLinks.ts` only: references go through `parseRef` (unknown book → ignored), ids are looked up in the DB (a missing note/PDF/session is a no-op), numbers are range-checked, unknown routes are ignored. No route accepts a file path. |
| Share Extension inbox | JSON written by the extension into the App Group; `readFile` rejects names containing `/` or `..`; PDFs are copied into the container and hashed; text becomes a note body (rendered by the ProseMirror parser — no raw HTML injection; markdown-it runs with `html: false`). |
| Links inside notes | `berean://` links route internally; `http(s)` links open in `SFSafariViewController` (`window.app.openExternal`), never in the app's WebView. |
| YouTube | the embed loads in a separate native `WKWebView` with an `https://player.berean.app/` base; link taps leave to the system browser; the app WebView never navigates off `capacitor://localhost`. |
| Transcript pack server URL setting | used only as a download base; packs are hash-verified against the bundled manifest, so a hostile server cannot inject transcript rows. |

## 4. Network and third parties

| Item | Finding |
|---|---|
| Outbound connections | YouTube (feed/embeds/thumbnails, only when the YouTube space is used), the transcript-pack host (only on demand), iCloud (Apple, only when sync is on), Apple Speech (on-device). No first-party server, no analytics, no crash reporter (R113). |
| API keys | the YouTube Data API key exists only in the developer's gitignored `electron/youtube-key.ts`; the phone loads it through `import.meta.glob` in dev builds only and it is verified absent from the production bundle (Phase 17). |
| ATS | default App Transport Security; `NSAllowsLocalNetworking` only so a self-hosted pack server on the LAN works. |
| Privacy manifest | `PrivacyInfo.xcprivacy`: no tracking, no collected data types. |

## 5. Secrets in the repository

Pre-commit scan rejects the developer's team id, name, private keys and Google API keys;
`Signing.xcconfig` is gitignored; `Signing.xcconfig.example` documents the shape. Verified at
every checkpoint commit on `feature/ios-app`.

## 6. Open items

- Device-only checks (Phase 21): confirm file protection class with `ls -lO` via Xcode's
  container download; confirm the share sheet never receives the DB path.
- If universal links are ever configured (D-008), the AASA file must list only the `/berean/`
  path prefix.
