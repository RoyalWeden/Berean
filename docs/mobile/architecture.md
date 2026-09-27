# Berean iPhone — Architecture

Status: designed in Phase 0; implemented incrementally in Phases 1–19. Decisions: `decisions.md`.

---

## 1. Shape

```
                                   BEREAN
                                     │
                 ┌───────────────────┴────────────────────┐
                 │                                        │
            SHARED APP LAYER                        PLATFORM LAYER
      (src/ — React + TypeScript)             (adapters + native code)
                 │                                        │
   ┌─────────────┼──────────────┐              ┌──────────┴──────────┐
   │             │              │              │                     │
 store/      platform/       components/    electron/            ios/ + src/platform/ios/
 (zustand)   services/       (desktop UI)   (main, preload,      (Capacitor app, Swift
             sync/           mobile/        IPC, vault, ollama,   plugins, in-process
             db/             (iPhone UI)    windows, updater)     window.* bridge)
```

**Rule of thumb:** if a module needs `electron`, `fs`, `path`, `BrowserWindow`, `net`,
`child_process`, or `better-sqlite3`, it lives in `electron/`. If it needs `Capacitor`, `WKWebView`
or Swift, it lives in `ios/` or `src/platform/ios/`. Everything else is shared and must import
neither.

## 2. The platform boundary is `window.<namespace>`

The audit (`audit/data-and-platform.md` §1, `audit/feature-inventory.md`) confirms the renderer
reaches the platform exclusively through 25 `window.*` namespaces installed by
`electron/preload.ts` and typed by `src/types/electron.d.ts` — ~680 call sites. We keep that
contract exactly; what changes is *who implements it*:

| Namespace | Electron (today) | iOS |
|---|---|---|
| `bible`, `lexicon`, `crossrefs`, `highlights`, `verseTags`, `tagGraph`, `settings`, `notes`, `appHistory`, `workspaces`, `playlists`, `studyTrail`, `pdf` (DB part), `youtube` (DB part), `aiLookup` (chats part) | IPC → `electron/ipc/*.ts` → **shared services** (Phase 1 moves the SQL here) | in-process `src/platform/ios/bridge.ts` → **same shared services** over the Capacitor SQLite adapter |
| `app` | IPC to main (windows, menus, updater, print, dialogs, system signals) | `src/platform/ios/appBridge.ts`: implements the subset that has meaning (openExternal → Safari VC, getVersion, native theme, resource mode, print → share PDF) and exposes `capabilities` for the rest |
| `crossWindow`, `viewer`, `windowControls`, `vault`, `bgImport`, `eSwordImport`, `ttsModel` (download part) | Electron only | **absent** — `platform.capabilities.{multiWindow,viewer,windowChrome,vault,importers,…} = false`; UI never renders those affordances |
| `youtube` (network part), `ttsAudioCache` | `net.fetch`/`fs` | `fetch` / `@capacitor/filesystem` |

A `src/platform/index.ts` exports `platform: { name, capabilities, paths, share, clipboard, haptics, deepLinks, cloud, audioSession, spotlight }` — the *new* adapters that neither the desktop nor the renderer had before (Share Sheet, haptics, deep links, iCloud). Desktop implements the ones that make sense (clipboard, cloud) and no-ops the rest.

## 3. Shared services (Phase 1)

`src/platform/services/` — one module per domain, plain async TypeScript, no globals:

```
bibleService.ts      lexiconService.ts     crossrefsService.ts    highlightsService.ts
notesService.ts      verseTagsService.ts   tagGraphService.ts     settingsService.ts
historyService.ts    workspacesService.ts  playlistsService.ts    studyTrailService.ts
sessionsService.ts   tabsService.ts        pdfService.ts (rows)   youtubeUserService.ts
```

Each takes a `ServiceContext { userDb: DatabaseAdapter; textDb(id): Promise<DatabaseAdapter|null>; lexiconDb(lang); crossrefsDb(); events: EventEmitter; clock; ids }` and exposes the exact method set the corresponding `window.*` namespace has today. Extraction is **mechanical**: the SQL strings and row mappers from `electron/ipc/*.ts` move verbatim; `db.prepare(sql).all(a,b)` becomes `await db.all(sql, [a,b])`; `db.transaction(fn)()` becomes `await db.transaction(async tx => …)`. The Electron handler becomes `ipcMain.handle('notes:create', (_e, d) => services.notes.create(d))` plus the existing cross-window broadcast, which stays in `electron/ipc/notes.ts` (it was never DB logic).

`src/platform/db/`:
- `DatabaseAdapter.ts` — interface: `all<T>(sql, params?)`, `get<T>(sql, params?)`, `run(sql, params?) → {changes, lastInsertRowid}`, `exec(sql)`, `transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>)`, `attach(path, alias)`, `detach(alias)`, `close()`.
- `bereanMigrations.ts` — the 42 migrations from `electron/db/berean.ts`, unchanged SQL, run through the adapter; plus new ones (v43: sessions/tabs/archived_groups; v44: sync bookkeeping; v45: pdf_bookmarks; v46: conflict flags). `runMigrations(db)` shared.
- `electron/db/adapters/betterSqliteAdapter.ts` — wraps better-sqlite3; `transaction` uses an async mutex + `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK`.
- `src/platform/ios/capacitorSqliteAdapter.ts` — wraps the `BereanSQLite` plugin; `transaction` uses the plugin's `batch` (single native transaction) when the callback is a static statement list, otherwise `BEGIN`/`COMMIT` with the same mutex.
- `src/platform/db/memoryAdapter.ts` (tests only) — better-sqlite3 in-memory, used by vitest contract tests so the shared services are exercised without Electron.

## 4. iOS runtime

```
ios/App/
├── App.xcworkspace / App.xcodeproj           (Capacitor-generated, committed)
├── App/
│   ├── AppDelegate.swift                     (Capacitor default + URL/scene handlers)
│   ├── Info.plist, App.entitlements, PrivacyInfo.xcprivacy
│   ├── Assets.xcassets (icon), LaunchScreen.storyboard
│   └── public/                               (Vite build output, generated by `cap sync`, not committed)
├── Plugins/                                  (local Swift Capacitor plugins — committed)
│   ├── BereanSQLite/    open/query/run/batch/attach/close over libsqlite3; readonly bundle open
│   ├── BereanCloud/     ubiquity container status, list/read/write/watch, download requests
│   ├── BereanWebView/   inline native WKWebView overlay (YouTube), persistent data store, PiP, evaluateJS
│   ├── BereanAudio/     AVAudioSession, MPNowPlayingInfoCenter, MPRemoteCommandCenter, interruptions
│   ├── BereanSpotlight/ CoreSpotlight indexing
│   ├── BereanIntents/   AppIntents ↔ deep-link bridge
│   └── BereanSystem/    trait collection (dark/contrast/reduce motion/Dynamic Type scale), thermal, print
├── ShareExtension/                           (Swift: accepts text/URL/files → app group → berean:// open)
└── Podfile / Package.swift                   (Capacitor 8 uses SPM by default)
```

Official Capacitor plugins used: `@capacitor/app`, `@capacitor/haptics`, `@capacitor/share`,
`@capacitor/clipboard`, `@capacitor/filesystem`, `@capacitor/keyboard`, `@capacitor/status-bar`,
`@capacitor/geolocation`, `@capacitor/preferences` (device id only), `@capacitor/browser`.

Data locations on iOS:
- Bundled read-only DBs: `App.app/data/*.db` (opened `?mode=ro&immutable=1`).
- User DB: `Library/Application Support/berean.db` (+WAL) — excluded from iCloud/iTunes backup (`isExcludedFromBackup`), because the iCloud journal is the durable copy and the bundled DBs are re-installed with the app.
- PDFs / TTS cache / model: `Library/Application Support/{pdfs,tts-cache,tts-model}`.
- Sync journal: ubiquity container (§`icloud.md`).

## 5. Renderer entry & shells

`src/main.tsx` becomes the single platform switch:

```ts
const platform = await initPlatform()            // electron | ios (detects Capacitor.isNativePlatform())
if (platform.shell === 'mobile') render(<MobileApp />) else render(<App />)   // desktop untouched
```

`src/mobile/` (Phase 10+) is a new presentation shell built from primitives designed to also
compose for iPad later:

```
src/mobile/
├── MobileApp.tsx            root: SafeArea + NavigationStack + SpaceBar + TabPill + SheetHost
├── navigation/              NavigationStack (push/pop, edge-swipe back, history integration)
├── primitives/              Sheet (detents, drag, keyboard-aware), SlideOver, ActionSheet, Page, ListRow, SegmentedControl, ContextMenu (long-press)
├── reader/                  ReaderPage (horizontal chapter pager, pinch font, verse long-press), ReferencePicker, TranslationPicker, ComparePage
├── study/                   StrongsSheet, CrossRefsSheet, VerseNotesSheet, HighlightBar, TagPickerSheet
├── notes/                   NotesHomePage, NoteEditorPage (reuses NoteEditorPM), NoteRefActionSheet
├── search/                  SearchPage, FilterSheet
├── tabs/                    TabPill, TabGrid, SessionSwitcher
├── settings/                SettingsPages (bound to the same store keys)
├── youtube/ audio/ pdf/ trail/ tags/ history/
└── onboarding/
```

Shared *content* components are reused where their DOM is already touch-safe (`VerseRow`
rendering, `StrongsInline`, `LexiconPanel` entry view, `NoteEditorPM`, `ScriptureSearchView`
result rows, `CompareView` cells); desktop *chrome* (mosaic, sidebar, tab bar, hover panels) is not.
Where a shared component has a hover-only affordance, the mobile shell passes an explicit
`interaction="touch"` prop rather than sniffing the platform inside the component (R013).

### Notes editor on iOS

One shared ProseMirror editor; ProseMirror owns the live document, React / Zustand only load it,
autosave is downstream, and native text input (autocorrect, dictation, IME, the edit callout) is
left to WebKit wherever possible. Contract, action matrix, lifecycle and the external-update policy:
[notes-editor-ios.md](notes-editor-ios.md).

## 6. Sync engine

`src/platform/sync/` — `hlc.ts`, `fractional.ts`, `journal.ts` (encode/decode/rotate),
`merge.ts` (rules in `icloud.md` §4), `engine.ts` (outbox → journal writer; reader → applier;
scheduling), `SyncStore.ts` (interface: `listDevices`, `readManifest`, `writeOwn(file, bytes)`,
`readFile`, `watch`, `requestDownload`, `status`). Stores: `electron/sync/fsSyncStore.ts`,
`src/platform/ios/cloudSyncStore.ts` (over `BereanCloud`). Services emit `changed(entity, id, op)`
events; the engine subscribes and journals. Applying remote ops goes through the services'
`applyRemote()` methods (bypassing user-facing side effects like vault export, which stays a
desktop-only listener on the same event bus).

## 7. Testing architecture (see `testing.md`)

- **Contract tests** (`src/platform/services/__tests__/*.contract.test.ts`): run every service
  method against the in-memory better-sqlite3 adapter; the same suites run inside the iOS app
  against the real plugin in a debug-only "self-test" screen (Phase 21) so the SQLite plugin is
  verified with the actual queries, not mocks.
- **Desktop regression:** existing 141 vitest files stay green; `npm run build` produces the
  Electron bundle; IPC handlers keep their names and signatures (the preload file is unchanged).
- **Mobile UI tests:** vitest + jsdom pointer-event tests for `Sheet`, `NavigationStack`,
  `TabPill`, chapter pager and pinch (gesture math is pure and unit-tested).
- **XCTest:** plugin-level tests for `BereanSQLite` (readonly open, FTS5 query, ATTACH) and
  `BereanCloud` (coordinated write/read).

## 8. Security

- WKWebView loads the bundle from `capacitor://localhost` with a CSP generated by the same
  `electron/csp.ts` builder (moved to `src/platform/csp.ts`) with the `capacitor:` scheme allowed.
- Deep links are parsed with `parseRef.ts` and an allow-list of routes; no file paths, no
  arbitrary JS.
- The YouTube overlay is a separate `WKWebView` with its own data store; the app WebView never
  loads third-party pages.
- Ollama host URL (R046) is user-entered, `http(s)` only, with a warning when not `localhost`/LAN.

## 9. What stays exactly as it is

`electron/main.ts` window management, menus, updater, presenter/viewer, study-trail window,
vault sync/export/import, BibleGateway and e-Sword importers, Ollama client, TTS model
download + `berean-model://` protocol, CSP handler, crash reporting, power awareness. Their
IPC channels and preload entries are not renamed. The desktop `App.tsx` shell is untouched
except where a shared component gains an explicit touch-mode prop.
