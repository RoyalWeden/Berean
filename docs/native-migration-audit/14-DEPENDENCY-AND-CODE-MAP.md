# 14 - Dependency and Code Map (audit snapshot)

> **Baseline note.** Investigated at `807c2d9`. The final baseline is `d97fb05`. The only code changes between them are PRs #9, #10 and #11, listed in `01-REPOSITORY-STABILIZATION.md`: fixes for sync defects D1-D4, note table-cell formatting, and audio cache keys. Anything below describing those defects as present is corrected where noted.

Commit `807c2d974b795f95f4c05b8ae4b6796c273b572c` (package.json 0.8.1). Companion to `02-CURRENT-ARCHITECTURE.md`. Read-only audit; nothing here is a recommendation to implement now. Dispositions describe what each item would be if a fully native Swift migration were later undertaken: **replace** (a native equivalent takes over), **remove** (nothing replaces it), **keep-during-transition** (must exist while the Electron and/or Capacitor shells still ship), and **keep** (platform-neutral asset that survives unchanged).

Labels: VERIFIED (measured/read), INFERRED, UNVERIFIED, BLOCKED (see doc 02).

How "where used" was measured: a node script (`/private/tmp/claude-501/s/deps.mjs`) counted files in `src/`, `electron/`, `scripts/`, `build/`, `tests/` and root configs whose source matches `from '<pkg>'`, `import('<pkg>')`, `require('<pkg>')` (tests under `__tests__`/`*.test.*` excluded from the first count and counted separately). Numbers are files, not call sites. Packages used only by configuration (eslint, tailwind, postcss, typescript, `@types/*`) show 0 source files.

---

## 1. package.json inventory

package.json declares 25 `dependencies` and 40 `devDependencies` = 65 packages (VERIFIED). Note that `devDependencies` contains packages that ship in the product bundle (react, react-dom, lucide-react, react-mosaic-component, Radix dialog/tooltip, electron-vite-built code). With `electron-vite` the renderer is bundled, so the dev/runtime split in package.json does not reflect what ships; the "Runtime/Dev" column below states the real role.

Platform: **Mac** = Electron app, **iPhone** = Capacitor web layer or native, **Both**, **Tooling**.

### 1.1 `dependencies` (25)

| Package | Version | Function | Where used (files) | Role | Platform | Disposition | Native replacement candidate |
|---|---|---|---|---|---|---|---|
| `@radix-ui/react-popover` | ^1.1.15 | Popover primitive | `components/ui/PopoverSurface.tsx`, `notes/NoteLookDropdown`, `NoteStatusDropdown` (3) | runtime (renderer) | Both | replace | SwiftUI `.popover`, `Menu` |
| `@tanstack/react-virtual` | ^3.14.2 | List virtualization | `ScriptureSearchView.tsx`, `notes/NotesList.tsx`, `mobile/notes/VirtualNoteList.tsx` (3) | runtime | Both | replace | `List`/`LazyVStack`, `NSTableView`/`UICollectionView` |
| `better-sqlite3` | ^12.10.0 | Native Node SQLite (Mac DB engine) | 9 in `electron/`, 6 in `scripts/`, 1 in `src/platform/db` (types), 3 test files (16 total) | runtime (main) | Mac | replace | system `sqlite3` via the existing `SQLiteConnection.swift`, or GRDB.swift / SQLite.swift |
| `diff` | ^9.0.0 | Text diff | `components/notes/NoteVersionHistory.tsx` (1) | runtime | Both | replace | Swift `CollectionDifference` + word tokenizer, or swift-diff |
| `electron-log` | ^5.1.2 | Logging | 6 in `electron/` (main, folderAccess, liquidGlass, servicesHost, sync, ...) | runtime (main) | Mac | replace | `os.Logger` / OSLog |
| `electron-updater` | ^6.2.1 | Auto-update from GitHub Releases | `electron/main.ts` (1) | runtime (main) | Mac (non-MAS) | replace | Sparkle 2 for Developer ID; App Store updates for MAS/iOS |
| `framer-motion` | ^12.42.2 | Animation | 31 files (22 shared, 8 `src/mobile`, 1 `platform/ios`) | runtime | Both | replace | SwiftUI animations, `matchedGeometryEffect`, `PhaseAnimator` |
| `kokoro-js` | ^1.2.1 | Kokoro TTS (phonemizer, tokenizer, voice style) | `src/lib/tts/kokoro/kokoro.worker.ts` (1; comment references elsewhere) | runtime (Web Worker) | Both | replace | `onnxruntime-swift-package-manager` (already used on iPhone) + a Swift/native port of the phonemizer + tokenizer; or Core ML conversion. Open question: the phonemizer is currently JS |
| `markdown-it` | ^14.3.0 | Markdown parse for ProseMirror import and chat | `notes/pm/markdownIt.ts`, `ailookup/chatMarkdownParse.ts` (+1) (3) | runtime | Both | replace | `apple/swift-markdown` (cmark-gfm) or `AttributedString(markdown:)` |
| `marked` | ^18.0.4 | Markdown to HTML for note preview/print | `lib/notePreviewRender.ts` (1) | runtime | Both | replace | swift-markdown + `AttributedString`; print via `UIPrintFormatter`/PDFKit |
| `pdfjs-dist` | ^4.10.38 | PDF rendering in WebView | `lib/pdfjs.ts`, `main.tsx`, `platform/ios/main.tsx` (3) | runtime | Both | replace | PDFKit (`PDFView`, `PDFAnnotation` for highlights) |
| `prosemirror-commands` | ^1.7.1 | Editor commands | 8 files (7 shared, 1 mobile) | runtime | Both | replace (hard) | Editor core: TextKit 2 (`NSTextView`/`UITextView`) with a Swift document model, or an interim embedded web editor |
| `prosemirror-dropcursor` | ^1.8.3 | Drop cursor | 1 | runtime | Both | replace (hard) | as above |
| `prosemirror-gapcursor` | ^1.4.1 | Gap cursor | 1 | runtime | Both | replace (hard) | as above |
| `prosemirror-history` | ^1.5.0 | Undo/redo | 4 (3 shared, 1 mobile) | runtime | Both | replace (hard) | `UndoManager` |
| `prosemirror-inputrules` | ^1.5.1 | Markdown input rules | 2 | runtime | Both | replace (hard) | custom text-storage delegate rules |
| `prosemirror-keymap` | ^1.2.3 | Keymap | 4 | runtime | Both | replace (hard) | `UIKeyCommand` / `NSEvent` handling / SwiftUI `.keyboardShortcut` |
| `prosemirror-markdown` | ^1.13.5 | Markdown parser/serializer | 3 (`notes/pm/parser.ts`, `serializer.ts`, tests) | runtime | Both | replace (hard) | swift-markdown + a serializer; the on-disk note format is markdown so this is data-format critical |
| `prosemirror-model` | ^1.25.10 | Document schema | 21 | runtime | Both | replace (hard) | Swift document model (custom nodes: verse refs, threads, columns, tables, headings collapse) |
| `prosemirror-schema-list` | ^1.5.1 | Lists | 4 | runtime | Both | replace (hard) | as above |
| `prosemirror-state` | ^1.4.4 | Editor state | 34 files (31 shared, 3 mobile; 23 test files) | runtime | Both | replace (hard) | as above |
| `prosemirror-tables` | ^1.8.5 | Tables | 4 | runtime | Both | replace (hard) | `NSTextTable` / custom table attachment views |
| `prosemirror-view` | ^1.42.0 | Editor view | 32 files (26 shared, 6 mobile; 22 test files) | runtime | Both | replace (hard) | TextKit 2 view |
| `suncalc` | ^2.0.1 | Sunrise time for daily-note boundary | `lib/dailyNoteUtils.ts` (1) | runtime | Both | replace | small port (NOAA algorithm) in Swift; location via `CoreLocation` |
| `zustand` | ^4.5.2 | Global store | 11 files (10 shared, 1 mobile) | runtime | Both | replace | Observation (`@Observable`), SwiftData/Core data for persistence |

The 12 ProseMirror packages are used by the note editor (`src/components/notes/pm`, 38 files, plus the iPhone note editor). The editor is the highest-risk replacement because custom nodes, decorations (verse reference detection), threads/collapse, and the markdown round-trip are product-defining. INFERRED risk from scope: `components/notes` is 20,310 non-test lines, `NoteEditorPM.tsx` 1,587.

### 1.2 `devDependencies` (40)

| Package | Version | Function | Where used | Real role | Platform | Disposition | Native replacement candidate |
|---|---|---|---|---|---|---|---|
| `@capacitor/app` | ^8.1.1 | App lifecycle, URL open | `platform/ios/deepLinks.ts` (1) | runtime iPhone | iPhone | remove | direct `UIApplicationDelegate`/`onOpenURL` |
| `@capacitor/browser` | ^8.0.4 | SFSafariViewController | `platform/ios/bridgeExtras.ts` (1) | runtime iPhone | iPhone | remove | `SFSafariViewController` / `openURL` |
| `@capacitor/cli` | ^8.5.2 | `cap sync`, `cap open` | `scripts` + `capacitor.config.ts` | tooling | iPhone | remove | none |
| `@capacitor/clipboard` | ^8.0.1 | Clipboard | no TS import (linked natively via `includePlugins`) | runtime iPhone (unused in TS) | iPhone | remove | `UIPasteboard` |
| `@capacitor/core` | ^8.5.2 | Bridge, `registerPlugin`, `CapacitorHttp` | `platform/ios/plugins.ts`, `capacitorSqliteAdapter`, scripts (3) | runtime iPhone | iPhone | remove | direct Swift calls; `URLSession` |
| `@capacitor/filesystem` | ^8.1.3 | App-container files (PDFs) | `platform/ios/bridgeExtras.ts` + 2, `mobile` (5 incl. tests) | runtime iPhone | iPhone | remove | `FileManager` |
| `@capacitor/geolocation` | ^8.2.2 | (installed, excluded from native link) | 0 source imports; only a test references it | dead | iPhone | remove | `CoreLocation` (already: `BereanLocationPlugin.swift`) |
| `@capacitor/haptics` | ^8.0.2 | Haptics | `mobile` (1; 17 test files mock it) | runtime iPhone | iPhone | remove | `UIImpactFeedbackGenerator` / SwiftUI `.sensoryFeedback` |
| `@capacitor/ios` | ^8.5.2 | iOS runtime | `scripts` (1) + SwiftPM `CapApp-SPM` | runtime iPhone | iPhone | remove | none |
| `@capacitor/keyboard` | ^8.0.5 | Keyboard events | `mobile` (2) | runtime iPhone | iPhone | remove | `UIResponder.keyboardWillShowNotification` / SwiftUI safe area |
| `@capacitor/preferences` | ^8.0.1 | KV prefs | no TS import | dead in TS | iPhone | remove | `UserDefaults` |
| `@capacitor/share` | ^8.0.2 | Share sheet | `mobile` (6), `platform/ios/exportNotes.ts` (dynamic import) | runtime iPhone | iPhone | remove | `ShareLink` / `UIActivityViewController` |
| `@capacitor/status-bar` | ^8.0.3 | Status bar | `capacitor.config.ts` only | runtime iPhone | iPhone | remove | SwiftUI |
| `@electron-toolkit/utils` | ^3.0.0 | `is.dev` helpers | 4 `electron/`, 2 `scripts` | runtime (main) | Mac | remove | none |
| `@electron/notarize` | ^3.1.1 | Notarization | `build/notarize.js` | tooling | Mac | replace | `xcrun notarytool` in Xcode archive flow |
| `@electron/rebuild` | ^3.6.0 | Rebuild native addons | 0 source (invoked by `npm run rebuild`) | tooling | Mac | remove | none |
| `@radix-ui/react-dialog` | ^1.0.5 | Dialog/sheet | `ui/Sheet.tsx`, `HistoryModal`, `FloatingSearch`, `PrintPreviewModal` (4) | runtime | Both | replace | SwiftUI `.sheet` / `.fullScreenCover` |
| `@radix-ui/react-tooltip` | ^1.0.7 | Tooltips | 5 (4 shared, 1 mobile) | runtime | Both | replace | `.help()` / hover popovers |
| `@types/better-sqlite3` | ^7.6.8 | types | 0 | tooling | Mac | remove | none |
| `@types/diff` | ^7.0.2 | types | 0 | tooling | Both | remove | none |
| `@types/node` | ^20.12.7 | types | 0 | tooling | Both | remove | none |
| `@types/react` | ^18.3.1 | types | 0 | tooling | Both | remove | none |
| `@types/react-dom` | ^18.3.0 | types | 0 | tooling | Both | remove | none |
| `@vitejs/plugin-react` | ^4.2.1 | React transform | 3 configs | tooling | Both | remove | none |
| `autoprefixer` | ^10.4.19 | CSS | `postcss.config.js` | tooling | Both | remove | none |
| `electron` | ^32.3.3 | Mac runtime (Chromium + Node) | 40 `electron/` files, 6 scripts, 1 `src` string reference, no runtime import found (48 files total) | runtime (ships) | Mac | replace | AppKit/SwiftUI app |
| `electron-builder` | ^24.13.3 | Packaging DMG/zip/MAS/NSIS | `scripts` (1) + `package.json build` | tooling | Mac, Windows | replace | Xcode archive, `xcodebuild -exportArchive`, `create-dmg`/`hdiutil`; Windows has no native-Swift counterpart (decision needed) |
| `electron-vite` | ^2.1.0 | Dev server + bundler | `electron.vite.config.ts` | tooling | Mac | remove | none |
| `eslint` | ^9.1.1 | Lint | `eslint.config.mjs` | tooling | Both | remove | SwiftLint (optional) |
| `jsdom` | ^29.1.1 | Test DOM | `vitest.config.ts` | tooling | Both | remove | XCTest/Swift Testing |
| `lucide-react` | ^0.376.0 | Icons | 211 files (140 shared, 71 mobile) | runtime | Both | replace | SF Symbols (`SFIcon.tsx` already maps some) |
| `postcss` | ^8.4.38 | CSS | config | tooling | Both | remove | none |
| `react` | ^18.3.1 | UI | 323 files (212 shared, 108 mobile, 3 ios) | runtime | Both | replace | SwiftUI (AppKit interop where needed) |
| `react-dom` | ^18.3.1 | DOM renderer | 48 | runtime | Both | replace | SwiftUI |
| `react-mosaic-component` | ^6.2.0 | Tiling panel layout | `shell/PanelLayout.tsx`, `Onboarding.tsx`, `TrailConnectorOverlay.tsx` (+ `App.tsx`, `main.tsx` CSS) | runtime | Mac | replace | `NavigationSplitView` / `HSplitView`/`VSplitView`/custom layout; saved workspaces store mosaic JSON (`workspaces.layout_json`), so a data-format mapping is needed |
| `tailwindcss` | ^3.4.3 | Utility CSS | `tailwind.config.js` (186 lines) + `global.css` | tooling/runtime CSS | Both | remove | SwiftUI styling tokens; design tokens in `docs/design-system.md` and `src/styles/*` |
| `typescript` | ^5.4.5 | Language | 2 src files import it | tooling | Both | remove | Swift |
| `typescript-eslint` | ^8.72.1 | Lint | config | tooling | Both | remove | none |
| `vite` | ^5.2.11 | iOS web bundler | `vite.ios.config.ts` | tooling | iPhone | remove | none |
| `vitest` | ^1.5.3 | Tests | 384 test files + configs | tooling | Both | replace | XCTest / Swift Testing; the ~4,555 cases are an executable specification worth porting selectively (sync merge, parseRef, services) |

### 1.3 Transitive/undeclared packages that matter

| Package | How it arrives | Evidence | Note |
|---|---|---|---|
| `chokidar` 3.6.0 | Declared in package.json by PR #9; it wasn't at `807c2d9`. Imported by `electron/ipc/vault.ts`. Present only because `tailwindcss` depends on it | package-lock: `node_modules/tailwindcss` has `chokidar` in dependencies; no other package does | VERIFIED. Mac-only vault watcher; replace with `FSEvents`/`DispatchSource`. Undeclared dependency is a build fragility |
| `@huggingface/transformers` 3.8.1 | `kokoro-js` | lock | TTS model runtime in worker |
| `onnxruntime-web` 1.22.0-dev.20250409-89f8206ba4 | transformers | lock; pinned by `ORT_RUNTIME_VERSION` | WASM runtime; its `.wasm` is excluded from the bundle (`!out/renderer/assets/ort-wasm-*.wasm`) and downloaded at runtime |
| `onnxruntime-node` 1.21.0, `sharp` ^0.34.1 | transformers (optional/native) | lock; folders exist in `node_modules` | no first-party import; packaged presence UNVERIFIED |
| `onnxruntime` (Swift) 1.24.2 | `ios/App/BereanNative/Package.swift` (exact) | `Package.resolved` | already native; keep |
| `capacitor-swift-pm` >= 8.0.0 | `BereanNative/Package.swift`, `CapApp-SPM` | | remove with Capacitor |

---

## 2. Source map

Counts are non-test TS/TSX lines (VERIFIED, `wc -l`) unless stated. "Depends on it" is from import scanning and the layer rules in `src/platform/__tests__/importBoundaries.test.ts`.

### 2.1 Top-level layout

| Path | Size | Role | Depended on by | Disposition |
|---|---|---|---|---|
| `electron/` | 104 files, 17,036 lines | Mac main process | built by `electron-vite` | replace (becomes the native Mac app's service host); logic to port, see 2.3 |
| `src/` | 1,038 files, 141,458 lines + 7,068 CSS | React renderer, shared services, sync engine, iPhone bridge | both shells | replace (UI), keep-as-spec (services, sync, migrations) |
| `ios/` | 53 files; 3,095 Swift lines | Xcode project, app shell, 14 plugins, share ext, widget | iPhone build | keep (Swift becomes the core of the native iOS app; Capacitor shell removed) |
| `native/` | 2 files, 451 ObjC lines | Node-API addons (Liquid Glass, MAS iCloud) | Electron main | remove (Electron-specific); Liquid Glass usage informs the native UI |
| `scripts/` | 132 files | data seeding, release, iOS/Mac build, eval, perf | developers/CI | mixed, see 2.7 |
| `tests/` | 7 files | extra vitest (unit 6, integration 1) | vitest | replace/port selectively |
| `data/` | gitignored DBs (27 files, symlinked here) + `.gitkeep` | bundled content | both apps | keep (SQLite files are the product's content) |
| `assets/` | icons; `fonts/` empty | icons | electron-builder | keep icons; replace with asset catalogs |
| `build/` | 9 files | afterPack, notarize, entitlements (`mac`, `mas`, `mas.inherit`, `mas.dev`), local provisioning profiles (gitignored) | electron-builder | replace with Xcode signing config; entitlements carry over |
| `config/app-identity.json` | 1 file | production vs development identities | scripts, TS, Swift via xcconfig | keep |
| `docs/` | 77 files | design system, mobile architecture, decisions, QA backlogs | humans | keep as reference; partly stale |
| `.github/workflows` | `ci.yml` 61, `release.yml` 227 | CI and release | GitHub | replace partly (no Xcode steps exist today) |

### 2.2 `src/` subtree

| Path | Files | Lines | Role | Disposition |
|---|---:|---:|---|---|
| `src/components/bible` | 22 | 16,178 | scripture reader, verse rows, compare, search, selection bar | replace; behaviour spec lives in tests (`components/bible/__tests__`) |
| `src/components/notes` | 61 | 20,310 | note panels, folder/board views, ProseMirror editor (`pm/`, 38 files), print preview, history | replace (editor hard) |
| `src/components/shell` | 35 | 10,431 | sidebar, tab bar, header, floating search, onboarding, history modal | replace |
| `src/components/studyTrail` | 25 | 8,572 | Study Trail windows (map, threads, everything view) | replace |
| `src/components/ailookup` | 38 | 7,620 | Berean Chat UI, composer, controller | replace |
| `src/components/settings` | 23 | 5,398 | settings sections, importers | replace |
| `src/components/youtube` | 5 | 3,267 | YouTube tab (webview / native player host) | replace |
| `src/components/ui` | 38 | 2,827 | design-system primitives | replace |
| `src/components/lexicon` / `tags` / `viewer` / `audio` / `pdf` / `search` | 4 / 7 / 5 / 5 / 3 / 1 | 1,835 / 1,538 / 1,514 / 1,189 / 998 / 518 | lexicon, tag graph, presenter, audio player, PDF viewer, tab search | replace |
| `src/mobile` | 137 (+ tests) | 17,014 | iPhone shell: navigation stack, tab cards, sheets, reader, notes, search, settings, chat overlay | replace (its design is the closest spec for a native iPhone UI) |
| `src/platform/services` | 24 | 6,315 | shared domain services (SQL + rules) over `DatabaseAdapter` | replace by Swift services; SQL and rules are the portable spec |
| `src/platform/sync` | 11 | 2,995 | sync engine, HLC, journal, merge, entity adapters, memory store | replace; the **on-disk iCloud journal format is an interop contract** across Mac/iPhone devices and must be preserved or migrated (`SYNC_FORMAT_VERSION` in `types.ts`) |
| `src/platform/db` | 2 | 1,423 | `DatabaseAdapter` interface, `BEREAN_MIGRATIONS` (final migration version 49) | replace; migration SQL ports verbatim |
| `src/platform/ios` | 21 | 2,389 | iPhone bridge, plugin typings, sync/cloud/spotlight/share hosts | remove |
| `src/platform/liquidGlass` | 5 | 886 | semantic glass tokens, capability probe | replace (SwiftUI glass APIs) |
| `src/store` | 5 | 5,444 | Zustand store, trail slice, tab persistence | replace; persistence semantics are the spec |
| `src/lib` | 108 root files (13,520 lines) + subdirs `research` (25 files, 2,187), `tts` (15, 2,377), `search` (5, 661), `navigation` (3, 362), `crossRefs`, `notes`, `studyTrail` | Reference parsing, note text utilities, cross-window sync, themes, navigation, research/policy logic, TTS | replace where UI-bound; keep as spec where pure (parseRef, research policy, TTS prep) |
| `src/hooks` | 12 | 1,535 | React hooks | replace |
| `src/styles` | 3 CSS + palette ts | 2,667 | global, glass, highlight palette | replace (design tokens carry over) |
| `src/types` | 5 | 2,008 | `electron.d.ts` (1,111) window API contract, shared types | the `window.*` API in `electron.d.ts` is the best single inventory of the current service surface; keep as the contract spec |
| `src/main.tsx`, `src/App.tsx`, `src/index*.html` | | 248, 1,105 | entries | replace |

### 2.3 `electron/` subtree

| Path | Lines | Role | Disposition |
|---|---:|---|---|
| `main.ts` | 2,201 | lifecycle, windows, menu, updater, 40 IPC handlers, deep links, print/PDF | replace |
| `preload.ts` | 755 | 27 contextBridge namespaces | remove |
| `ipc/aiLookup.ts` | 4,156 | Ask Berean retrieval pipeline (22 handlers) | replace; port logic; it is the most business-rule-dense file, not shared with iPhone |
| `ipc/vault.ts` | 1,449 | markdown vault export/import/watch | replace (Mac vault feature) |
| `ipc/youtube.ts` | 1,428 | YouTube Data/InnerTube/RSS fetch, transcript workers | replace; iPhone already has `youtubeFetchService.ts` |
| `ipc/bgImport.ts` | 820 | BibleGateway import via hidden window | replace/UNVERIFIED value |
| `ipc/eSwordImport.ts` | 543 | e-Sword importer | replace |
| `ipc/lexicon.ts`, `crossrefs.ts`, `bible.ts` | 408, 352, 201 | thin handlers with residual raw SQL | replace |
| `ipc/studyTrail.ts`, `notes.ts`, `pdf.ts`, `verseTags.ts`, ... | 81, 129, 105, 43, ... | thin handlers over services | remove (services become direct calls) |
| `ipc/archaicVocab*.ts` | 511 total | archaic-word variant tables for AI retrieval | keep as data; port |
| `ollama.ts`, `embeddings.ts`, `embeddingQuantize.ts`, `rrf.ts`, `tokenBudget.ts`, `modelGateway.ts` | 276, 144, 57, 43, 126, 46 | local LLM client, embedding retrieval, rank fusion, context budget | replace; Ollama is an external local server at `localhost:11434` |
| `db/` | `berean.ts` 153, `bible.ts` 59, `lexicon.ts` 34, `embeddingsDb.ts` 74, adapters | DB open/close, adapters | replace |
| `sync/` | `host.ts` 259, `fsSyncStore.ts` 171, `macContainer.ts` 60 | Mac sync host over plain files | replace |
| `secrets/` | `providerKeys.ts` 56, `providerSettings.ts` 52 | `safeStorage` key store | replace with Keychain |
| `liquidGlass.ts` | 184 | glass IPC | remove |
| `ttsModelProtocol.ts`, `ttsModelManifest.ts`, `ipc/ttsModel.ts`, `ipc/ttsAudioCache.ts`, `downloads/modelDownloader.ts` | 88, 86, 218, 100, 122 | Kokoro model download/serve/cache | replace |
| `mac/folderAccess.ts` | 65 | MAS security-scoped bookmarks | replace (`URL` bookmarks in Swift; same semantics) |
| `powerAwareness.ts`, `csp.ts`, `externalLinks.ts`, `devTools.ts`, `appIdentity.ts`, `atomicWrite.ts`, `servicesHost.ts`, `services.ts`, `youtube-key*.ts` | 62, 44, 41, 14, 37, 17, 126, 36, 3/15 | support | replace/remove |
| `__tests__`, `ipc/__tests__`, ... | 16 + 17 + 3 + 2 + 1 test files | main-process tests | port selectively |

### 2.4 Large or central files (non-test lines)

| File | Lines | Role | Depends on it | Disposition |
|---|---:|---|---|---|
| `src/components/bible/BiblePanel.tsx` | 4,382 | main scripture panel; also embedded in iPhone | `ActivePanel`, `MobileApp` | replace |
| `electron/ipc/aiLookup.ts` | 4,156 | Ask Berean engine | `registerAiLookupHandlers` | replace |
| `src/store/index.ts` | 3,808 | global store (`AppState`) | most of `src/` | replace |
| `src/components/youtube/YouTubeTab.tsx` | 2,763 | YouTube tab | ActivePanel, MobileApp | replace |
| `src/components/notes/NotesPanel.tsx` | 2,753 | notes panel + autosave | ActivePanel | replace |
| `src/components/studyTrail/MapView.tsx` | 2,625 | trail map (also in mobile) | StudyTrailApp, mobile trail | replace |
| `src/components/bible/BibleRightPanel.tsx` | 2,222 | inspector panel | BiblePanel | replace |
| `electron/main.ts` | 2,201 | main process | electron-vite entry | replace |
| `src/components/bible/VerseRow.tsx` | 2,155 | verse rendering/interaction | ChapterView | replace |
| `src/components/bible/ScriptureSearchView.tsx` | 2,090 | advanced search | BiblePanel, mobile | replace |
| `src/components/settings/SettingsModal.tsx` | 1,836 | settings | App | replace |
| `src/components/shell/FloatingSearch.tsx` | 1,678 | command/search palette | App | replace |
| `src/components/lexicon/LexiconPanel.tsx` | 1,631 | lexicon | ActivePanel, mobile | replace |
| `src/components/notes/pm/NoteEditorPM.tsx` | 1,587 | ProseMirror editor host | NotesPanel, mobile editor | replace (hard) |
| `electron/ipc/vault.ts` | 1,449 | vault | main.ts | replace |
| `src/components/bible/ChapterView.tsx` | 1,431 | chapter data loading | BiblePanel, mobile | replace |
| `electron/ipc/youtube.ts` | 1,428 | YouTube network layer | main.ts | replace |
| `src/platform/sync/engine.ts` | 1,404 | sync engine | host(s) | replace (preserve format) |
| `src/components/shell/Onboarding.tsx` | 1,365 | onboarding | App | replace |
| `src/platform/db/bereanMigrations.ts` | 1,344 | 49 table definitions, v49 | both service hosts | port SQL |
| `src/platform/services/studyTrailService.ts` | 1,223 | trail domain | both | port |
| `src/types/electron.d.ts` | 1,111 | window API contract | whole renderer | keep as spec |
| `src/lib/parseRef.ts` | 1,054 | Scripture reference parser (book aliases, ranges, Hermas variants) | ~everything | port; high-value, pure |
| `src/platform/services/notesService.ts` | 769 | notes domain + FTS | both | port |
| `src/lib/notePreviewRender.ts` | 887 | note to HTML for preview/print | print/preview | replace |
| `electron/preload.ts` | 755 | bridge | renderer | remove |
| `src/lib/tts/kokoro/kokoroBackend.ts` | 535 | Kokoro playback/caching | `ttsEngine` | replace |

### 2.5 Swift and Objective-C inventory (`ios/`, `native/`)

| File | Lines | Role | Disposition |
|---|---:|---|---|
| `ios/App/App/AppDelegate.swift` | 44 | UIKit delegate stub | replace with SwiftUI `App` |
| `ios/App/App/SceneDelegate.swift` | 30 | scene wiring | replace |
| `ios/App/App/BereanBridgeViewController.swift` | 42 | registers 14 plugins | remove |
| `ios/App/App/BereanIntents.swift` | 103 | 5 App Intents + shortcuts provider | keep (already native) |
| `BereanNative/.../BereanSQLitePlugin.swift` + `SQLiteConnection.swift` | 270 + 233 | SQLite connection layer (`sqlite3_open_v2`, serial queue) | keep (reuse `SQLiteConnection` directly; drop the Capacitor wrapper) |
| `BereanCloudPlugin.swift` | 346 | iCloud container with `NSFileCoordinator` and `NSMetadataQuery` | keep (strip Capacitor shell); central to sync transport |
| `BereanGlassPlugin.swift` | 492 | native Liquid Glass controls | keep/replace by SwiftUI |
| `BereanVoicePackPlugin.swift` | 318 | Kokoro download + ONNX inference | keep |
| `BereanWebViewPlugin.swift` | 132 | native WKWebView for YouTube | keep during transition (YouTube embeds need a web view) |
| `BereanSpeechPlugin.swift`, `BereanAudioPlugin.swift`, `BereanDownloadsPlugin.swift`, `BereanLocationPlugin.swift`, `BereanPrintPlugin.swift`, `BereanSpotlightPlugin.swift`, `BereanShareInboxPlugin.swift`, `BereanPowerPlugin.swift`, `BereanA11yPlugin.swift` | 97, 82, 137, 124, 73, 70, 76, 35, 64 | platform integrations | keep (strip Capacitor shell) |
| `BereanNative/Tests/.../SQLiteConnectionTests.swift` | 65 | only Swift test | keep |
| `ios/App/ShareExtension/ShareViewController.swift` | 96 | Share Extension | keep |
| `ios/App/BereanWidget/BereanChatWidget.swift` | 129 | launcher widget | keep |
| `native/mac-liquid-glass/berean_glass.m` | 345 | NSGlassEffectView bridge | remove (replaced by SwiftUI/AppKit glass APIs; keep as reference for class/availability gating) |
| `native/mac-icloud/berean_icloud.m` | 106 | MAS iCloud container resolution | remove (native app calls `URLForUbiquityContainerIdentifier` directly) |
| `ios/App/*.xcconfig`, `Info.plist`, entitlements, `PrivacyInfo.xcprivacy` | | identity/versions/entitlements | keep (identity mechanism generated by `scripts/ios/identity.mjs`) |

### 2.6 Data model and content files
`data/*.db` (27): sizes MB (VERIFIED, `ls -lL`): kjva 19.4, kjv 8.4, lxx_brenton 16.3, lxx 23.9 (orphan, not bundled in iOS per `bundled-dbs.txt`; `TEXT_FILES` maps `lxx` to `lxx_brenton.db`), enoch 0.5, jubilees 0.6, hermas 0.4, hermas_taylor 0.5, recog_clement 1.6, 2baruch 0.3, t12p 0.4, 1clement 0.2, ep_barnabas 0.2, others <=0.2, strongs_greek 28.1, strongs_hebrew 7.6, cross_references 19.8, tske_refs 45.0, youtube_index 7.0, youtube_seed 187.4, plus `berean.db` placeholder (0 MB). Disposition: keep; they are the product's content. Provenance is in the Python scripts (2.7); several sources are external files not in the repo (see below).

### 2.7 Scripts that remain useful after migration

All paths under `scripts/`. "Keep" means the script generates or validates content or release artifacts independent of Electron/Capacitor.

**Python data generation (54 files, 10,713 lines) - keep as provenance and regeneration tooling**

| Group | Scripts | Purpose (from file headers) |
|---|---|---|
| Strong's and tagging | `seed_strongs.py` (473), `reseed_tagged_from_bbli.py` (247), `augment_nt_articles.py` (524), `test_tagging.js`/`.sh` | tag KJV `text_tagged` and lexicon occurrence tables from STEPBible/bbli/TGNT sources |
| LXX | `build_lxx_greek.py`, `build_lxx_brenton_strongs.py` (407), `build_lxx_ibm_aligner.py`, `train_ibm_model1.py`, `build_lxx_occurrences.py`, `seed_lxx_missing.py`, `seed_lxx_lje_man.py`, `audit_lxx_*.py`, `inspect_lxx_*.py`, `preview_lxx_*.py`, `extract_brenton_psalm_prefixes.py` | build Rahlfs Greek LXX DB, align Greek Strong's to Brenton English (heuristic + IBM Model 1), add missing books, audits |
| Cross references | `seed_tske.py` (264; 670,558 references), `add_crossref_reverse_indexes.py` | build `tske_refs.db`, add reverse indexes |
| Pseudepigrapha/apocrypha seeds | `seed_hermas*.py`, `seed_2baruch.py`, `seed_apoc_abraham.py`, `seed_apoc_elijah.py`, `seed_asc_isaiah.py`, `seed_didache_hoole.py`, `seed_ep_barnabas.py`, `seed_recog_clement.py`, `seed_t12p.py`, `seed_t_jacob.py` | create the per-text DBs |
| Corrections | `fix_*.py` (hermas, enoch, 1clement, recog_clement, t12p, t_job, transcripts 429) , `data_merge_detector.py` (+ test), `scripts/DATA_BUG_long_verse_rows.md` | one-off data repairs and a reusable merged-verse detector; keep as an audit trail |
| Other | `extract_psalm_titles.py` (provenance for `src/lib/psalmTitles.ts`) | psalm superscriptions |
| Eval | `scripts/eval/bench/*.py`, `*.jsonl` gold sets | Ask Berean retrieval benchmark data |

Reproducibility caveats (VERIFIED from headers): some scripts read external source files that are not in the repo (e.g. `/Users/roywe/Downloads/kjv+.bbli`, LXX-Rahlfs clone, STEPBible data, ANF text); the LXX Rahlfs source header cites CC-BY-NC-SA 4.0 (license review is UNVERIFIED). Regeneration cannot be confirmed (BLOCKED: no execution).

**Node/shell scripts (65 files, 5,686 lines)**

| Script | Disposition | Reason |
|---|---|---|
| `convert-dbs.js`, `build-embedding-index.js` (195), `export-transcript-seed.js`, `publish-data.js` (143), `data/split-youtube-seed.mjs` (135), `data/publish-transcripts.sh`, `generate-sample-pdfs.mjs`, `test_data.sh` (185), `dump-user-schema.ts` | keep | DB conversion, embeddings, YouTube seed split, data publishing to `data-v1`, schema dump (dump-user-schema imports the TS migrations and would need a replacement once migrations are Swift) |
| `scripts/ios/*` (`check-setup.mjs`, `identity.mjs`, `version.mjs`, `build.sh`, `copy-data.sh`, `bundled-dbs.txt`, `dev-safety-check.sh`, `finalize-info-plist.sh`, `patch-xcodeproj.mjs` 369, `test.sh`, `run.sh`, `fix-framework-minos.sh`, `xcpretty-lite.sh`, `verify-identity.mjs`, `probe-server.mjs`) | keep (partially) | identity/version generation, DB bundling, dev-identity safety check survive; `patch-xcodeproj.mjs` and Capacitor sync steps do not |
| `scripts/mac/*` (`build-native.mjs`, `package-mas.mjs`, `build-mas-dev.mjs`, `verify-mas.mjs` 194, `profileAuthorises.mjs`) | keep (verification logic); build steps replaced | `verify-mas` checks signed artifacts against app identity |
| `tag-release.js`, `audit-production.mjs`, `smoke-electron.mjs`, `check-electron.mjs`, `setup-worktree.sh` | remove or replace | Electron-/npm-specific |
| `scripts/perf/*`, `scripts/eval/*.ts` | replace | CDP/Electron-specific drivers; retrieval fixtures (`retrievalFixtures.ts`) are test data worth keeping |
| `scripts/__tests__/*` | port | identity/setup checks |

---

## 3. Layering rules that the code enforces (VERIFIED)
`src/platform/__tests__/importBoundaries.test.ts` asserts: (1) `src/platform/services|sync|db`, `src/lib`, `src/store` do not import Electron, Node built-ins or better-sqlite3; (2) shared renderer code does not import `src/platform/ios`; (3) `src/mobile` does not import `electron/`; with documented allow-list exceptions (e.g. `TouchYouTubePlayer.tsx`, a dynamic import in `YouTubeTab.tsx`). `electron/__tests__/ipcParity.test.ts` asserts every preload `invoke` channel has a main-process handler. These are the existing seams a native port can follow: the service/sync/db layer is already runtime-neutral TypeScript with no UI.

## 4. Counts summary
- packages declared: 65 (25 + 40); Capacitor packages: 13; Radix: 3; ProseMirror: 12; `@types/*`: 5.
- first-party Swift plugins: 14 (63 methods); preload namespaces: 27; IPC handle channels: 295.
- migrated tables in `berean.db`: 49 distinct names, schema v49; synced entity kinds: 22.
- vitest files: 384; cases about 4,555 (regex, INFERRED); Swift test files: 1.
