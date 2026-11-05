# 08 - Shared Swift architecture (proposal)

> **Baseline note.** Investigated at `807c2d9`. The final baseline is `d97fb05`. The only code changes between them are PRs #9, #10 and #11, listed in `01-REPOSITORY-STABILIZATION.md`: fixes for sync defects D1-D4, note table-cell formatting, and audio cache keys. Anything below describing those defects as present is corrected where noted.

Audit of commit `807c2d974b795f95f4c05b8ae4b6796c273b572c` (package.json 0.8.1), `/Users/roywe/Berean-audit`, read-only, 2026-11-05. Proposes the project structure, module boundaries, concurrency model and porting strategy shared by a native macOS app (06) and a native iOS app (07). It does not authorise implementation. See also 02 (architecture), 03 (feature inventory), 04 (database), 05 (sync), 14 (dependency map).

Evidence labels: **VERIFIED** (read in code, measured with `wc`/`grep`, or returned by Apple documentation during this audit), **INFERRED**, **UNVERIFIED**, **BLOCKED** (not checkable under the audit rules: no builds, no test runs, no database reads, no device).

Design stance: the existing TypeScript already has the seams a Swift port needs (a runtime-neutral service/sync/db layer enforced by `src/platform/__tests__/importBoundaries.test.ts`, 14 section 3). The target architecture below keeps those seams, names them as Swift modules, and spends complexity only where the product has real divergence (UI, text rendering, platform integrations).

---

## 1. Summary of recommendations

1. **One repository, one Xcode project with two app targets (macOS, iOS) plus extension targets, sharing a single local Swift package (`BereanKit`) that contains many library targets.** Not multiplatform-single-target (the UIs diverge, 06/07), not separate repositories (the domain and data contract is shared). Boundaries are enforced by SwiftPM target dependencies plus a lint script that bans UI imports below the UI layer (the Swift analogue of the existing `importBoundaries.test.ts`).
2. **Port the data and domain layer first, behind a conformance corpus generated from the TypeScript implementation.** The reference-parsing, tagged-token, search-intent, navigation-resolution, research and sync-merge logic is pure and heavily tested (about 4,555 `it`/`test` cases in 384 files, INFERRED from a regex count, not run). Golden JSON, not hand-rewritten tests, defines parity.
3. **Keep the on-disk contract byte-compatible during coexistence:** same SQLite schema (migration ordinal 49 and verbatim SQL), same iCloud journal format, same URL grammar, same `textId`/highlight-id/`sync` entity ids. Both the Electron/Capacitor apps and the native apps must be able to read and write the same `berean.db` and sync folder (03 "C-DATA").
4. **SQLite access through an `actor`-isolated or pool-based `SQLDatabase` abstraction with the same operations as the TypeScript `DatabaseAdapter`** (`all`, `get`, `run`, `exec`, `transaction`, `attach`, `detach`, `close`), so service SQL ports nearly line for line. GRDB is the recommended engine (decision in section 7); SwiftData/Core Data are rejected because the schema, FTS5 triggers and sync metadata already exist.
5. **Swift 6 language mode with strict concurrency in all new packages** (the current iOS target is Swift 5.0 language mode, VERIFIED). Database access is serialised by construction; the sync engine is an `actor`; view models are `@MainActor @Observable`.
6. **Platform seams are protocols defined in shared packages and implemented in the app targets** (iCloud container, haptics, resource mode, now-playing, Spotlight, secrets).
7. **Minimum OS is an open decision with a recommended default** (section 12): iOS 18 / macOS 15 as the shared floor unless install-base data (not available to this audit) supports 26, with `#available` glass paths. iOS 17 (today's floor, VERIFIED) works but adds more `#available` forks for rich text and glass. This is a judgement call, not a verified fact.
8. **Independent platform releases** via per-platform tags, schemes, xcconfig version files (the existing `Version.xcconfig` + `Identity.xcconfig` pattern carries over) and a hard rule that **schema changes are additive and tolerated by older apps** (the sync journal already carries the schema ordinal, 03 X6).

---

## 2. Current assets that determine the shape (VERIFIED measurements)

| Asset | Where | Size / count | Native fate |
|---|---|---|---|
| Shared services (`createServices(ctx)`) | `src/platform/services` | 24 files, 6,315 lines (notes 769, studyTrail 1,223, youtubeFetch 466, aiChats 453, lexicon 432, youtubeService 396, researchService 331, verseTags 299, crossrefs 277, pdf 186, sessions 194, bible 210, ...) | Port to `BereanDomain` (Swift) |
| DB abstraction | `src/platform/db/DatabaseAdapter.ts` (79 lines), `bereanMigrations.ts` (1,344 lines, `version: 49`) | 49 migrations, 49 distinct tables incl. FTS5 | Port SQL verbatim; keep ordinals |
| Sync engine | `src/platform/sync/{engine 1404, entities 363, merge 222, types 200, fractional 160, tabFields 140, hostCore 116, journal 102, hlc 92, trace 41}` | 2,840 lines, 22 entity kinds | Port to `BereanSync` (actor) |
| Reference parsing | `src/lib/parseRef.ts` (1,054 lines), `multiBookSearch`, `strongsSearch`, `hermasMap` (322), `chapterNumbering` (49), `translationChapterMap` (272), `bibleTexts` (173), `deepLinks` (223) | tests: `parseRef.test.ts` has 59 cases in `src/lib/__tests__` plus 13 in `tests/unit` | Port to `BereanReference` |
| Text logic | `taggedTokens` (90), `wordReplacer` (244), `annotationFilters` (56), `verseUtils` (549), `verseSelection` (83), `verseClipboard` (44), `scriptureFind` (51), `scriptureHighlight` (32), `psalmSuperscription`, `scriptureText` | contract with data files and highlight offsets | `BereanText` |
| Search | `src/lib/search/{searchIntent 135, unifiedSearch 136, matchExcerpt 313, typingHistory 53, submittedSearch 24}`, `scriptureSearch*`, `strongsSearch` | deterministic parser | `BereanSearch` |
| Navigation | `src/lib/navigation/{destination 214, tabResolution 131, historyDestination 17}` plus the tab/session/history slice of `src/store/index.ts` (3,808 lines total, `AppState` at line 425) | behavioural contracts documented in `docs/navigation-contract.md` | `BereanNavigation` (pure reducer + model) |
| Research (Ask Berean) shared part | `src/lib/research/*` | 24 files, 2,187 lines, 20 test files (collections, commentaryDepth, compareIntent, conversationState, errors, exclusions, lexicalIntent, modelCatalog, modelChoice, modelRouting, modePolicy, noteExclusion, outputGuard, policy, premise, providers, researchWeb, strongsId, taggedText, webResearch) | `BereanResearch` |
| Ask Berean pipeline (Mac only) | `electron/ipc/aiLookup.ts` | **4,156 lines**, 19 raw `.prepare` plus 22 service references, **not** in the shared service layer | Open decision: canonical behaviour (02 section 18); see section 5.9 |
| Speech | `src/lib/tts/{textPrep 258, extractSpokenText 311, kokoro/kokoroChunking 89, kokoro/timestampAlignment 118, ttsEngine, ttsBackend}` | JS G2P stays in `kokoro-js` today | `BereanSpeech` |
| Notes model | `src/components/notes/pm/{schema 407, parser 668, serializer 276, markdownIt 215}` + `src/lib/noteTextBlocks.ts` | custom markdown dialect | `BereanMarkdown` |
| Existing Swift | `ios/App/BereanNative/Sources/BereanNative`: 14 plugins + `SQLiteConnection.swift` (233 lines), App Intents, Share Extension, Widget | 3,095 Swift lines in 23 files; 1 XCTest file (`SQLiteConnectionTests.swift`, 5 test functions) | Salvage `SQLiteConnection`, Share Extension, Widget, Intents; the rest are Capacitor shims that disappear |
| Platform identity | `config/app-identity.json`, generated `Identity.xcconfig`, `Version.xcconfig`, `scripts/ios/*` | production + development (Berean Dev) | Keep, retarget at native project |

Not shared today (Electron-only raw SQL, needs a decision when ported): `electron/ipc/vault.ts` (1,449 lines, 41 `.prepare`), `youtube.ts` (1,428, 30), `lexicon.ts`, `eSwordImport.ts`, `bgImport.ts` (02 section 6).

---

## 3. Project structure: one project vs several

| Option | Description | For | Against | Verdict |
|---|---|---|---|---|
| A. One Xcode project, two app targets, one local SwiftPM package with many library targets (**recommended**) | `Berean.xcodeproj` (or workspace) with `BereanMac`, `BereanIOS`, `BereanShare` (iOS ext), `BereanWidget`, `BereanIntents` (shared App Intents package), `BereanMacDevTools`; `Packages/BereanKit/Package.swift` | One build graph; shared packages resolved locally; refactors across modules in one commit; per-module `swift test`; boundaries enforced by target dependencies | One repo/CI lane runs everything unless filtered; risk of a macOS-only change breaking iOS build (mitigated by per-platform CI jobs) | Recommended |
| B. Multiplatform single app target (SwiftUI multiplatform template) | One target runs on macOS and iOS | Least project config | The UIs are deliberately different (06/07); would push `#if os()` into every view and invite the "replicate the desktop" mistake the brief warns against | Reject |
| C. Separate repos/projects, shared package versioned in its own repo | | Strict isolation | Cross-cutting changes (schema, sync, navigation contract) need coordinated releases; this project has one developer | Reject |
| D. Many separate SwiftPM *packages* (one per module) | | Independent versioning | Overhead of version pins for modules that always ship together; slower iteration | Reject until a module needs independent release (none does) |

Mechanics:

- The existing project is patched by `scripts/ios/patch-xcodeproj.mjs` and `CapApp-SPM` is rewritten by `cap sync` (VERIFIED, 02 section 16, CLAUDE.md section 2). Both disappear. A hand-maintained project with xcconfigs is enough; whether to adopt a generator (XcodeGen/Tuist) is not necessary for two app targets (INFERRED; third-party tooling not evaluated).
- Keep `config/app-identity.json` as the single source for bundle ids, iCloud container ids, App Group ids, URL schemes (production vs Berean Dev), with a script that generates `Identity.xcconfig` (today `scripts/ios/identity.mjs`). Debug builds must keep the "Berean Dev safety check" build phase (project rule, `dev-safety-check.sh`).
- Worktree workflow in CLAUDE.md (`npm run setup:worktree`) exists to link gitignored `data/*.db`, `youtube-key.ts`, `Signing.xcconfig`, `node_modules`. A native checkout still needs the gitignored data files and signing configs; with no `node_modules`, setup shrinks to a script that links `data/*.db` and `Signing.xcconfig`. Provenance of `data/*.db` (Python scripts, downloaded from release `data-v1` in CI) is unchanged and out of scope here.
- Tooling dependencies on Node remain for data publication (`scripts/publish-data.js`) and release tagging until replaced (14 section 2.7).

---

## 4. Proposed module list and dependency rules

Single package `BereanKit` with the following library targets. "L" is a layer number; **a target may depend only on lower layers**. No third-party dependency is allowed in L0-L2.

| Layer | Module | Responsibility (ported from) | Depends on | Platform-free |
|---|---|---|---|---|
| L0 | `BereanCore` | Value types: `TextID`, `BookID`, `VerseRef`, `ParsedRef`, `Verse`, `Highlight`, `Note`, `Tab`, `Session`, `Workspace`, `Destination`, `NavIntent`, `HLC`, ids, `Clock`/`UUIDGenerating` protocols, `AppIdentity`, error base types, `ChangeEvent`/`ChangeFeed` protocol | none | yes |
| L1 | `BereanReference` | `parseRef`, book registry (`ALL_BOOKS`), `chapterNumbering`, `translationChapterMap`, `hermasMap`, `bibleTexts` registry (18-19 editions), deep-link parse/format (`deepLinks.ts`), verse range formatting | Core | yes |
| L1 | `BereanMarkdown` | note markdown model: parser/serializer for the Berean dialect (callouts, columns, threads, underline, colour highlight, NBSP indent, wikilinks, study-trail embed), block AST, `noteTextBlocks` | Core | yes |
| L2 | `BereanText` | `taggedTokens` grammar, `VerseTextModel` + `DisplayMap` (06 section 9.2), word replacer, annotation filters, psalm superscription, copy/clipboard formatting, find pattern builder, selection model (`verseSelection`) | Core, Reference | yes |
| L2 | `BereanSQLite` | thin SQLite engine abstraction: `SQLDatabase` protocol, connection pool, statement cache, migration runner, FTS5 helpers, attach | Core | yes (links system SQLite) |
| L3 | `BereanStore` | the **schema**: migrations v1-v49 (verbatim SQL), row types, `UserDatabase`, `TextDatabases` (read-only), `LexiconDatabases`, `DataDatabases` (cross_refs, tske, hermas_taylor), `ChangeBus` | Core, SQLite | yes |
| L4 | `BereanDomain` | services: bible, notes, highlights, verseTags, tagGraph, lexicon, settings, crossrefs, history, workspaces, playlists, sessions, studyTrail, youtube (data only), pdf (metadata), aiChats, studyProfiles, savedContexts; `modelFreeLookup`; `researchService` payloads | Core, Reference, Text, Markdown, Store | yes |
| L4 | `BereanSearch` | `searchIntent`, `unifiedSearch`, `scriptureSearch`, `strongsSearch`, `matchExcerpt`, FTS query building (resolving the duplicate `safeFtsQuery`, 03 S03), recents | Core, Reference, Text, Store | yes |
| L4 | `BereanNavigation` | pure navigation reducer: `openDestination`, `tabResolution` (reuse identity), per-tab history stacks (`TabNavEntry`, `restoreTabNavEntry`), `transformTab`, `duplicateTab`, `edgeBackAction`, tab MRU/auto-close; fractional order keys | Core, Reference | yes |
| L5 | `BereanSync` | HLC, journal encode/decode, entity adapters (22 kinds), merge, `SyncEngine` actor, `SyncStore` protocol, `hostCore` scheduling policy | Core, Store | yes (Foundation) |
| L5 | `BereanResearch` | `src/lib/research/*` (policy, routing, providers, outputGuard, premise, conversation state...), prompts, citation verification; model transport behind a protocol | Core, Reference, Text, Domain, Search | yes |
| L5 | `BereanSpeech` | spoken-text extraction, chunking, alignment estimate, `SpeechSynthesizing` and `GraphemeToPhoneme` protocols, queue model | Core, Reference, Text | yes |
| L6 | `BereanDesign` | theme tokens, 38 presets + custom themes, contrast, spacing/radius/type tokens | Core | SwiftUI/AppKit/UIKit allowed |
| L6 | `BereanUI` | shared SwiftUI components (06 section 16 / 07 section 16) | Design, Domain, Search, Navigation, Speech, Text | UI frameworks |
| L6 | `BereanScriptureKit` | `ScriptureTextView` (`#if os(macOS) NSTextView / #else UITextView`), shared rendering-attribute layer, hit testing helpers, accessibility children | Text, Design | UI frameworks |
| App | `BereanMac`, `BereanIOS` | composition root, scenes, platform implementations of seam protocols, platform UI | all above | |
| Dev | `BereanDevTools` (macOS executable, **not shipped**) | transcript fetch/clear, data publish helpers, golden-corpus exporters | Domain, Store | macOS |

Dependency rules (to be enforced by a script in CI, modelled on `importBoundaries.test.ts`):

1. L0-L5 modules must not `import SwiftUI`, `UIKit`, `AppKit`, `WebKit`, `PDFKit`, `AVFoundation`'s UI parts or `Combine`-based UI. Allowed: `Foundation`, `os`, `Dispatch`, `CryptoKit`, `SQLite3`, `Synchronization`.
2. No module may import an app target. App targets own all `#if os` UI branches.
3. `BereanSync` must not import `BereanDomain` (it depends on `Store`'s row-level adapters and the `ChangeFeed` protocol in Core). Domain services emit `ChangeEvent`s; Sync consumes them. This mirrors the TS layering where the engine reads records through entity adapters, and avoids a cycle.
4. `BereanResearch` talks to models only through `ModelTransport` protocols; no `URLSession` in L0-L4. (Ollama at `localhost:11434` and Anthropic `https://api.anthropic.com/v1/messages` are implementations in the Mac app target or a `BereanResearchNetwork` target, 02 section 17.4.)
5. `BereanDevTools` may depend on anything but **nothing may depend on it**, and it must be excluded from release archives. This preserves the project rule that production never triggers transcript fetches (project memory; 03 M04: `youtube:fetchTranscripts` returns `unavailable in production` today).
6. Public API surface per module is explicit (`public` only where used); `package`-level access for same-package cross-module helpers (Swift 5.9+; VERIFIED language feature exists, version of toolchain in Xcode 27.2 not queried).
7. Optional but valuable: L0-L5 should build with `swift build` on Linux (Foundation only; system SQLite caveat) so the pure modules can run in cheap CI jobs and golden tests run without Xcode. Whether Foundation `Regex`/`NSRegularExpression` behaves identically on Linux is UNVERIFIED; the benefit is CI speed, not a requirement.

Why this many modules: each corresponds to an existing test cluster or a seam with a different churn rate (`BereanReference` and `BereanText` are data contracts; `BereanNavigation` is the behavioural contract the author spent four testing waves on; `BereanSync` is correctness-critical and must be independently testable). Merging them would mix pure and I/O code; splitting further adds friction without benefit. The list can start coarser (Core+Reference+Text, SQLite+Store, Domain+Search+Navigation) and split when files grow; the dependency rules matter more than the exact count.

---

## 5. Module notes

### 5.1 `BereanReference` - parity-critical, regex-heavy
`parseRef.ts` (1,054 lines) handles abbreviations, ranges, comma lists, chapter-only, Hermas/Recognitions forms, multi-book queries, roman/arabic variants, Strong's refs, canonical ids, emits display/filename/wikilink forms, and has `AMBIGUOUS_PATTERNS` (03 S03). Risks: JavaScript regex semantics versus Swift `Regex` (Swift 5.7+ regex literals and `NSRegularExpression` differ from ECMAScript in lookbehind, Unicode properties, backreference and case-folding behaviour; **UNVERIFIED which constructs the file uses**; needs an inventory of regex features before choosing). Port first, since search, notes, deep links and AI all use it.

### 5.2 `BereanText` - the offset contract
`taggedTokens.ts` is small but is "an implicit contract with the data files" (03 S01 item 5): `word{H7225}`, `word{}`, `*word{}`, `!word{G1063}`, `~{H853}`, `word{H914|H996}`, tolerant of `sup>`/`blu>` fragments. `DisplayMap` (06 section 9.2) lives here because it is pure and must be unit-tested without UI. Existing tests to convert: `taggedTokenCharPos.test.ts`, `scriptureHighlight.test.ts`, `verseDisplayTokens.test.ts`, `supplyBrackets.test.ts`, `wordReplacer.test.ts`.

### 5.3 `BereanSQLite` / `BereanStore`
- Operations mirror `DatabaseAdapter`; positional `?` parameters only (every existing query uses them, VERIFIED); `transaction` with the documented "do not await other work inside a transaction" rule becomes a closure that receives a transaction-scoped handle and is non-suspending except on that handle.
- Migrations: `BEREAN_MIGRATIONS` is an ordered list of `{version, up}` with `hasColumn`-guarded `ALTER TABLE`s; port as `[Migration]` with the same SQL text; a startup `quick_check` exists at `bereanMigrations.ts:1297` (VERIFIED); keep. Detailed schema handling is in 04.
- **Mixed-version safety:** independent platform releases mean an older app may open a database a newer one migrated. The journal tolerates unknown columns (03 X6). Rule: migrations are additive (new tables/columns, never rename or drop) for at least N releases, and the app refuses to *migrate down*. UNVERIFIED whether today's `runMigrations` aborts when it sees a higher `user_version` than it knows; verify in 04.
- Journal modes: `berean.db` WAL (set in `electron/db/berean.ts:116` and `BereanSQLitePlugin.swift:113`, VERIFIED); bundled text DBs ship as DELETE journal (afterPack, 02 section 9), opened read-only.
- Native text DBs: open once, keep prepared statements for `queryChapter`, `queryVerse`, FTS; an ATTACH alias for cross-DB joins exists today and ports as is.

### 5.4 `BereanDomain`
Services become `Sendable` structs (or actors where they cache) holding `SQLDatabase` handles. Events (`ctx.events` `data:changed {entity, id, op, scope, remote}`) become `ChangeBus` emissions (section 6). Contract tests exist for bible, notes, highlights, history, lexicon, crossrefs, playlists, sessions, settings, tagGraph, aiChats, savedContexts, studyProfiles, research (`*.contract.test.ts`); **absent** for `workspacesService`, `studyTrailService` (1,223 lines), `youtubeService`/`youtubeFetchService`, `pdfService` (03 U05, U14, M01, M04). The native port must add them *before* porting those services, not after.

### 5.5 `BereanNavigation`
The behaviours in `docs/navigation-contract.md` are more valuable than the code that implements them. Port as a **pure state machine**: `NavigationState` + `reduce(state, action) -> (state, [Effect])`, with effects (open sheet, scroll) handled by the UI. Test names to carry: `perTabHistory`, `originTabReturn`, `freshBibleTabNav`, `scrollByTabNavReset`, `edgeBack`, `destination`, `tabMRU`, `duplicateTab`, `closeTabPrune`, `archivedGroups`, `tabPersistence*`, `workspaceRestore`, `tabSort`, `tabOrder`, `tabs-reorderDiff` (03 U02, U08). The slice of `src/store/index.ts` involved is not isolated today (3,808-line store, `AppState` at line 425); extracting it is part of the port and the main reason this module is separate.

### 5.6 `BereanSync` (see 05)
`SyncStore` in TypeScript (VERIFIED `src/platform/sync/types.ts`) already is the protocol to port: `deviceId`, `status()`, `listDevices()`, `readManifest(device)`, `readFile(device,name)` (returns null when evicted/not downloaded), `writeOwnFile`, `writeOwnManifest`, `deleteOwnFile`, optional `watch`, optional `pendingUploads`. Journal files are JSON lines named `journal-<9-digit from>-<9-digit to>.jsonl`, snapshots `snapshot-<9-digit seq>.json`, caps `JOURNAL_MAX_OPS = 500`, `JOURNAL_MAX_BYTES = 256 KiB`, compaction after 5,000 ops or 5 MiB, silent device assumed gone after 90 days (`journal.ts`, VERIFIED). Port with **byte-compatible encoding** (key order within JSON objects should not matter to decoders, but number formatting, HLC string encoding and ids must match; verify with the corpus).

Two real native improvements are possible but are *behaviour changes*, not parity: (1) one transport on both platforms (NSFileCoordinator + NSMetadataQuery) instead of Mac `fs`+`fs.watch`+`brctl` and a MAS Node-API addon (02 section 12, `berean_icloud.m`); a signed native app with the iCloud entitlement can use the ubiquity container API directly (INFERRED); (2) capturing outbox rows **inside the same database transaction** as the mutation instead of reacting to `data:changed` after commit (today's flow, 02 section 17.5), which removes a crash window. Both must be proven against the engine's integration/chaos fixtures; neither is required for coexistence.

### 5.7 `BereanSpeech`
Pure parts port cleanly (`extractSpokenText`, `textPrep`, `kokoroChunking`, `timestampAlignment`). Blockers are outside this module: grapheme-to-phoneme for Kokoro (done in JS today) and Mac synthesis (Web Worker + `onnxruntime-web` WASM today; iPhone already native ONNX Runtime, `onnxruntime-swift-package-manager` exact 1.24.2, VERIFIED). A shared `OnnxSynthesizer` implementation would serve both platforms (INFERRED), but macOS availability of the ONNX package and Core ML options were not evaluated.

### 5.8 `BereanMarkdown`
See 07 section 9. The module owns the AST and serialisation so that the editor UI is replaceable. Existing round-trip tests (`roundtrip.test.ts`, `markdownCombinations.test.ts`, `noteFormats.test.ts`, 40 files under `pm/__tests__`) become golden inputs. A third-party GFM parser (e.g. Apple's `swift-markdown`) may help with standard blocks; Berean extensions require custom handling (UNVERIFIED how much of the dialect `swift-markdown` can carry; not evaluated).

### 5.9 `BereanResearch` and the canonical Ask Berean decision
The shared part is small (2,187 lines) and pure. The pipeline (4,156 lines in `electron/ipc/aiLookup.ts`) exists only on the Mac and the iPhone has a different, model-free behaviour (`modelFreeLookup`, 117 lines; 02 section 18; 03 G10). **Open decision:** which behaviour is canonical for the native apps. Options: (1) iPhone stays model-free, Mac gets the full pipeline in a Mac-only target; (2) port the pipeline into `BereanResearch` and make it capability-gated per platform (local model unavailable on iPhone). Not decided here. If (2), the 19 raw `.prepare` statements and 22 service references in that file must first be moved behind `BereanDomain`/`BereanSearch` APIs. Local models run through Ollama (`localhost:11434`), which requires a sandbox network-client entitlement and a user-installed daemon on Mac (INFERRED); on-device Apple Foundation Models were not evaluated (UNVERIFIED availability).

---

## 6. Concurrency model

Goals: no data races, no main-thread database or file I/O, deterministic tests.

- **Language mode:** Swift 6 for all `BereanKit` targets. (Today's iOS target is Swift 5.0, VERIFIED.) Whether Xcode 27.2 offers a default-main-actor-isolation build setting for app targets was not checked (UNVERIFIED); if present it suits the app targets, not the packages.
- **Database:** two acceptable designs.
  - *Pool (recommended):* a writer plus N readers (WAL) behind `SQLDatabase`; reads run concurrently, writes are serialised by the pool. With GRDB this is `DatabasePool`; `ValueObservation`/transaction observers supply change notification (GRDB behaviour is from memory and **UNVERIFIED** here).
  - *Single actor:* `actor UserDatabase` owning one connection; simplest, and matches today's behaviour ("serializes work behind transactions", `SyncSqliteAdapter`, `SQLiteConnection` serial queue). Fine for writes; heavy FTS reads would queue behind writes, so reads should use a second read-only connection actor.
  - Bundled read-only text DBs: one connection each, `SQLITE_OPEN_READONLY`; `actor TextDatabase` or a nonisolated `Sendable` wrapper over a thread-safe (serialised) connection.
  - Transactions: closure-based, synchronous inside the closure, matching the existing "do not await anything else" rule; an accidental `await` is then a compile error rather than a stall.
- **Change notification:** `ChangeBus` (actor) publishes `ChangeEvent {entity, id, op, scope, origin: local|remote}` through `AsyncStream`s; each subscriber gets its own stream (multi-consumer). The UI invalidation map (`src/lib/syncInvalidation.ts`, `INVALIDATES`) becomes a view-model-level subscription. Coalescing: the iPhone coalesces at 60 ms (`makeChangeSubscription`, 02 section 6); keep as an `AsyncAlgorithms`-style debounce or a hand-written one (third-party `swift-async-algorithms` not evaluated).
- **Sync:** `actor SyncEngine`; HLC from an injected `Clock`; `SyncStore` is `Sendable`; remote-apply runs inside one write transaction per batch; `hostCore` policy (local debounce 1.5 s, 60 s fallback, watch debounce 1.5 s, resume on foreground/wake, push on quit; 02 section 11) becomes a `SyncScheduler` actor using `Task.sleep` and cancellation. The engine must be cancellable at suspension points and must never hold a database transaction across a suspension on the cloud store.
- **UI:** `@MainActor @Observable` view models; they depend on actors/services via protocols and call them with `await`; results are value types (`Sendable`). Per-window state objects on macOS (06 section 4.2).
- **Cancellation and priority:** search-as-you-type uses a `Task` per keystroke cancelled by the next; FTS runs at `.userInitiated` on the reader pool; sync at `.utility`; downloads through background `URLSession` (voice pack, transcript packs).
- **Background:** iOS `UIApplication.beginBackgroundTask` for the final journal write on backgrounding; macOS `applicationShouldTerminate` with `.terminateLater` for vault export (06 section 14). `BGAppRefreshTask` for sync is a possible improvement; not parity.
- **Main-actor discipline for file coordination:** `NSFileCoordinator` and `NSMetadataQuery` calls and dataless-file reads (the 2026-09-22 Mac freeze, project memory) must never run on the main actor.
- **Testing concurrency:** inject `Clock` (Swift's `Clock` protocol with a manual test clock) and make schedulers take a clock; stress tests mirror `chaos.fuzz.test.ts`.

---

## 7. Persistence engine decision

| Option | Assessment |
|---|---|
| Raw `sqlite3` + small wrapper (extends existing `SQLiteConnection.swift`, 233 lines, which already does `sqlite3_open_v2`, serial queue, ATTACH, backup) | Fewest dependencies; full control; you own pool, statement cache, observation, migration plumbing |
| **GRDB** (third-party, MIT) | Recommended: mature pool with WAL reader/writer, statement cache, `ValueObservation`, FTS5 support, can use the system SQLite. Costs one dependency in L2-L3. Facts here are from general knowledge: **not fetched in this audit** |
| SwiftData / Core Data | **Rejected.** The schema is owned by 49 SQL migrations, FTS5 virtual tables with triggers (`notes_ai/notes_ad/notes_au`), sync metadata (`sync_outbox`, `sync_record_meta`, ...) and a cross-platform journal that references row ids and HLCs. Letting an ORM own the schema would break coexistence (INFERRED, strong) |
| SQLite.swift / others | no advantage over GRDB identified |

System SQLite on Apple platforms includes FTS5: the iPhone app already depends on it ("system SQLite with FTS5", 03 X2, VERIFIED statement in the audit docs; not independently tested). If a specific SQLite version or extension is ever needed, link a private build via GRDB's alternatives (UNVERIFIED).

Whichever engine is chosen, **the `SQLDatabase` protocol is the boundary**: services and migrations must not import GRDB types. That keeps the engine swappable (and the pure modules Linux-buildable).

---

## 8. Dependency injection and composition

- **Constructor injection, no global singletons.** The TS code has module-level registries (`electron/services.ts`, `iosServices()`); the native port builds one `AppEnvironment` per process in the app target's composition root and passes it down: `UserDatabase`, `TextDatabases`, `Services`, `ChangeBus`, `SyncEngine`, `Clock`, `UUIDGenerating`, `Logger`, and the platform seams (07 section 17: `CloudContainerProviding`, `Haptics`, `SystemAppearanceProviding`, `ResourceModeProviding`, `NowPlayingControlling`, `SpotlightIndexing`, `ShareInboxReading`, `LocationProviding`, `SecretStoring`, `WebPlayerHosting`, `PrintExporting`).
- Views obtain view-model factories through SwiftUI `Environment`; UIKit/AppKit controllers receive them in `init`.
- `ServiceContext` (`context.ts`) already shows the intended shape: `userDb`, `textDb(textId)`, `lexiconDb(H|G)`, `dataDb(name)`, `events`, `now()`, `uuid()`, `isDev`, `log`. Port as `struct ServiceContext: Sendable`.
- Test doubles: in-memory `SQLDatabase` (the TS tests already use an in-memory better-sqlite3 adapter, `memoryAdapter.ts`), fake `Clock`, fake `SyncStore` (the TS `icloudDriveSim.ts` is the model).
- A DI framework (e.g. point-free `swift-dependencies`) is unnecessary for this size; not evaluated.
- App Intents and extensions need access to the same environment: App Intents run in the app process (`openAppWhenRun = true` today) but a future background intent or widget timeline would need a lightweight read-only environment (App Group database access). Design `AppEnvironment` with a `readOnly` factory from the start.

---

## 9. Error handling and observability

- **Typed errors per module** (`enum ReferenceError`, `StoreError`, `SyncError`, `ResearchError` ported from `src/lib/research/errors.ts`, 88 lines), all `Sendable`, `LocalizedError` conformance only in the UI layer. Public API uses `throws`; no `try!`; no `fatalError` outside programmer-error preconditions.
- **Data-safety posture to preserve:** the sync engine records failures (`sync_failed`, `sync_conflicts` tables), holds sync on account/container mismatch or a damaged database rather than doing anything destructive (03 A01 `held` state), and the database runs `PRAGMA quick_check` at open (VERIFIED). Corruption and migration failure must route to a user-visible, non-destructive recovery path; never delete user data automatically. Details in 04/05.
- **Partial failure rule:** line-tolerant journal decoding (a truncated trailing line is retried, an unparsable line is counted and skipped; `decodeJournal`, VERIFIED) is a deliberate pattern; keep the "never let one bad record stop everything else" principle in every batch operation.
- **Logging:** `os.Logger` with one subsystem per module and categories; never log note content, queries or keys (the Electron logger already drops routine `console.info` in packaged builds because of volume and privacy, `main.ts` console-message handler). Replace `perfSpan`/`perfMark` with `OSSignposter`. The crash reporter (`CrashReport.tsx`, next-launch report) maps to MetricKit (`MXCrashDiagnostic`) or stays a custom breadcrumb file (INFERRED).
- **Secrets:** Keychain via `SecretStoring`. Today only Mac has secrets (BYO provider keys in `safeStorage`, 03 A02). The YouTube Data API key is a build-time gitignored constant in `electron/youtube-key.ts` (value never read): a native build needs an xcconfig/Info.plist injection with the same CI secret flow; embedding a key in a shipped binary is extractable (INFERRED, per 03).

---

## 10. Build tooling, CI, releases

### 10.1 Build and CI (today: `ci.yml` 61 lines, `release.yml` 227 lines, VERIFIED)

Current CI: `macos-latest`, Node 22, `npm ci`, download DBs from release `data-v1`, stub `youtube-key.ts`, typecheck, lint, `vitest run`, `npm run build`, rebuild + `smoke:electron`, `ios:build:web`. **No Xcode build or XCTest step** (02 section 16).

Proposed native CI (GitHub Actions on macOS runners; Xcode Cloud is an alternative not evaluated):

1. `packages` job: `swift test` on `BereanKit` (per-target filter), with the golden corpus; fast, no simulator. Optionally also on Linux for L0-L5.
2. `import-boundaries` job: script check of section 4 rules.
3. `mac` job: `xcodebuild build test -scheme BereanMac -destination 'platform=macOS'`, including AppKit unit tests (text view hit testing, DisplayMap integration) and XCUITest smoke if adopted.
4. `ios` job: `xcodebuild test -scheme BereanIOS -destination 'platform=iOS Simulator,name=<current iPhone>'`; plus `build` of Share/Widget targets.
5. `identity` job: verify generated xcconfigs against `config/app-identity.json` (port of `scripts/ios/verify-identity`, `scripts/mac/verify-mas.mjs`).
6. `data` job: confirm bundled DB manifest (`bundled-dbs.txt` equivalent) and that no DB is accidentally missing (`packagedAssets.test.ts` analogue).
7. Performance jobs (non-blocking): XCTest `measure`/`XCTMetric` for chapter layout and FTS latency, replacing the manual `scripts/perf/*` CDP drivers.

### 10.2 Release independence

- Separate tags and schemes: `mac-vX.Y.Z` and `ios-vX.Y.Z` (the current `tag:stable`/`tag:beta` scripts tag the whole repo, `scripts/tag-release.js`, and iOS upload is manual/off-CI). Version files `Version.xcconfig` per platform (the file exists for iOS today, written by `scripts/ios/version.mjs` from package.json; with package.json retired it becomes the source).
- The Mac DMG path needs notarisation and an updater; `electron-updater` has no native analogue in the SDK. Sparkle is the common choice and is third-party (not evaluated). The MAS build and the DMG build have different sandbox and update rules (02 section 3.14 / 03 A15). Existing `build/entitlements.mac*.plist` JIT/unsigned-memory entitlements exist only because of Electron (03 A11) and disappear.
- App Store review exposure carried over unchanged: YouTube scraping, BibleGateway credentialed import, third-party SDK privacy manifests (onnxruntime) (03 A12).
- **Cross-version compatibility is the real constraint on independent releases:** schema additive-only (section 5.3), journal tolerant of unknown fields/entity kinds, URL grammar frozen, `textId` strings frozen (renames would corrupt synced notes/highlights/tabs, 03 S09). Add a compatibility test that opens fixtures produced by the previous N releases.
- Release process documentation (`release-berean` skill, `docs/mobile/testflight.md`) keeps Apple uploads as human checkpoints (CLAUDE.md); nothing in this proposal changes that.

---

## 11. Porting JavaScript domain logic with parity

### 11.1 Principle
The TypeScript implementation stays the **oracle** while the Electron and Capacitor apps still ship. Parity is defined by *recorded outputs*, not by re-reading code.

### 11.2 Golden corpus pipeline (proposal, not authorised)

1. A script in `scripts/native/` (proposed name `export-golden.ts`) runs under the existing Vitest/ts toolchain, imports the pure TS modules, runs them over (a) every input already literal in the existing tests, (b) generated inputs (random permutations of abbreviations/ranges for `parseRef`; every row of `data/*.db` `text_tagged` for the token parser; real highlight rows), and (c) recorded fixtures, then writes `Tests/Fixtures/golden/<module>/<name>.json` with `{ "source": "<git sha of TS>", "cases": [{ "input":..., "context":..., "output":... }] }`.
2. Swift tests (Swift Testing parameterised `@Test(arguments:)`) load the JSON and assert equality. The fixtures are committed so Swift CI needs no Node.
3. When the TS reference changes while both exist, the exporter is re-run and the diff reviewed; this is the mechanism that keeps the two implementations from drifting.
4. For modules with I/O (services), fixtures are **database-level**: seed an in-memory DB from a fixture, run an operation list, dump affected tables to JSON; run the Swift service on the same seed and compare table dumps. The existing `*.contract.test.ts` suites define which operations to record.

### 11.3 Per-module parity strategy

| Module | Oracle inputs | Notes and risks |
|---|---|---|
| Reference (`parseRef`, `deepLinks`, `translationChapterMap`, `hermasMap`, `chapterNumbering`) | existing 72 `parseRef` cases (59 + 13), `deepLinks.test.ts`, `deepLinkDedupe.test.ts`, `hermasMap.test.ts`, `translationChapterMap.test.ts`; plus fuzzed query strings | Regex-semantic differences (5.1). Also three duplicated tables (`numberWords`, `safeFtsQuery` x2 with different behaviour, `TEXT_FILES` x2, 03 S03, 02 section 6): resolve duplicates *before* exporting goldens so the corpus encodes intended behaviour; record the chosen behaviour explicitly |
| Text (`taggedTokens`, offsets) | `taggedTokenCharPos.test.ts` plus every `text_tagged` row from the 19 text DBs | Real-DB sweep is BLOCKED here (DBs not opened). Highlight positions need real highlight rows: gate before writing highlights from Swift |
| Search intent / unified search | `searchIntent.test.ts`, `unifiedSearch.test.ts`, doc examples in `navigation-contract.md` section 3 ("Matthew 10 LXX", "H430", "lxx love", "enoch: watchers") | Pure; easy |
| Navigation | the 19 store tests and `perTabHistory` etc. | Need an extractable reducer; the store couples to Zustand; the first step is recording action sequences from tests as fixtures |
| Research | 20 test files in `lib/research/__tests__` | Pure; `providers.ts` network transport excluded; model-dependent behaviours cannot be golden-tested (non-deterministic) |
| Sync merge/HLC/journal | `merge.test.ts`, `hlc.test.ts`, `journal.test.ts`, `fractional.test.ts`, `tabFields.test.ts`, `engine.integration.test.ts`, `chaos.fuzz.test.ts`, `dataSafety.integration.test.ts`, `lifecycle.integration.test.ts` | Highest data-loss risk of the migration (03 A01). Beyond unit goldens, run **cross-implementation interop tests**: a TS engine and a Swift engine syncing through a shared simulated store (the TS `icloudDriveSim.ts` model), asserting convergence. Real-iCloud device matrix is BLOCKED (docs say pending) |
| Markdown | `pm/__tests__` round-trip fixtures; real notes (3,375 per perf doc; BLOCKED) | Highest *product* risk (07 section 9) |
| Speech chunking/alignment | `kokoroChunking.test.ts`, `timestampAlignment.test.ts`, `extractSpokenText.test.ts`, `textPrep.test.ts` | Pure; audio output not golden-testable |
| Migrations | run all 49 against empty DBs and against fixture DBs from each historical version; compare `sqlite_master` dumps with the TS result | 1,344 lines of SQL; `hasColumn` guards matter |

### 11.4 Alternative oracle: JavaScriptCore
Bundling `src/lib` with the existing bundler and running it in a `JSContext` (not a web view) inside Swift tests would let Swift tests compare against the live TS code instead of stored JSON. Useful during transition on macOS CI, **but it is a test oracle only**: shipping JS inside the product would be a wrapper by the brief's definition, and `JSContext` lacks DOM/Node APIs some modules may assume (`importBoundaries.test.ts` forbids Node/Electron imports in `src/lib`, which helps; browser globals were not scanned). Not recommended as the primary mechanism because JSON goldens are simpler and CI-portable.

### 11.5 What not to port mechanically
The renderer-only logic that is DOM-shaped (selection-to-offset via DOM `Range`, `ContinuousChapterScroll`, react-mosaic layout) is re-designed (06/07), not translated; the `electron/ipc/*` handlers that are thin wrappers over services vanish; `crossWindowSync.ts` (338 lines) vanishes (06 section 4.3); `vault.ts` (1,449 lines) is Mac-only and needs its own plan (04).

---

## 12. Minimum OS decision

Facts: iPhone deployment target is 17.0 (VERIFIED, `project.pbxproj`); `LSMinimumSystemVersion` is set to 12.0 by `afterPack` for the Electron Mac app (VERIFIED, 02 section 16); `berean_glass.m` is built with minimum macOS 12 (VERIFIED); the design docs target macOS 27 aesthetics (`docs/design-system.md`); this machine runs macOS 27.2 with Xcode 27.2 (environment). Apple documentation queried confirms **existence** of `NSGlassEffectView`, `NSGlassEffectContainerView`, `TextEditor(text: AttributedString, selection:)`, `AttributedTextSelection`, `UIFindInteraction` and `PresentationBackgroundInteraction`, but **not** their introduction versions.

| Floor | Gains | Costs / unknowns |
|---|---|---|
| iOS 17 / macOS 14 | Matches today's iOS floor; `@Observable`, `AppIntents` baseline, `NSWindow`/`Window` scenes (INFERRED availability), Swift Testing available in recent Xcode regardless of deployment target | Rich-text editor APIs and glass APIs need `#available` forks; more code paths to test; macOS 12-13 Electron users are dropped from macOS 14 floor (how many exist is UNVERIFIED) |
| **iOS 18 / macOS 15 (recommended default)** | Reduced `#available` forks vs 17/14; still wide install base (UNVERIFIED) | Does not give glass or rich `TextEditor` for free; same forks as above for 26 |
| iOS 26 / macOS 26 | Glass and any 26-only text APIs without forks; one code path; best fit for the design system | Drops users who have not upgraded; **install-base data is not available to this audit** (App Store Connect analytics, update-channel stats) |

Recommendation (a judgement, not a verified fact): choose the floor **after** looking at App Store Connect device/OS distribution and the GitHub Releases update telemetry; absent data, default to iOS 18 / macOS 15 and design `BereanDesign`'s glass modifiers as `if #available` wrappers so raising the floor later deletes code rather than adds it. Everything in L0-L5 is OS-agnostic and compiles at the lowest floor; only L6 and app targets carry the decision.

Also decide: Swift tools version and `swiftLanguageModes: [.v6]` in `Package.swift`; Xcode 27.2 is installed (environment) but its default language mode and available toolchain features were not queried.

---

## 13. Testing strategy per module

| Module | Test types | Targets and tools | Existing assets to convert |
|---|---|---|---|
| Core | Unit | Swift Testing | none (new) |
| Reference | Unit + golden + property (fuzz round-trip display<->parse) | parameterised `@Test`, JSON goldens | `parseRef` (72), `deepLinks`, `hermasMap`, `translationChapterMap` tests |
| Markdown | Golden round-trip; property tests on random block trees | JSON goldens from `pm/__tests__`; real-note corpus when available | 40 `pm` test files |
| Text | Unit + golden + real-data sweep | golden from DB rows (BLOCKED until DB access) | `taggedTokenCharPos`, `supplyBrackets`, `wordReplacer`, `scriptureHighlight` |
| SQLite/Store | Migration tests (empty and historical fixtures), integrity (`quick_check`), journal-mode, FTS trigger tests | in-memory + file DB; fixture DBs per historical version | none directly (TS migrations tested via contract tests) |
| Domain | Contract tests per service over seeded DB + table-dump comparison; add missing contract tests (workspaces, studyTrail, youtube, pdf) first | in-memory `SQLDatabase` | 14 existing `*.contract.test.ts` suites |
| Search | Unit + golden; FTS latency measure | | `searchIntent`, `unifiedSearch`, `scriptureSearch` tests |
| Navigation | State-machine tests from recorded action sequences; property: every history restore returns the same state | | store tests (19 files) |
| Sync | Unit (HLC/merge/journal), integration (two engines + simulated store), chaos/fuzz (random interleavings, truncated files, evicted files), interop with the TS engine, crash-window tests | | 16 sync-related test files (03 A01 list) |
| Research | Unit on policy/routing/guards; no model-dependent assertions in CI; benchmark harness stays separate | | 20 research tests, `scripts/eval/**` |
| Speech | Unit on chunking/alignment; synthesis tested manually | | 4 TTS test files |
| Design | Contrast/theme token tests (every preset legible, WCAG-style ratios); snapshot of token output | | `customTheme.test.ts`, `contrast` helpers |
| UI / ScriptureKit | AppKit/UIKit unit tests for hit testing and DisplayMap integration; XCUITest smoke; accessibility audit (`performAccessibilityAudit()`, not queried here); **performance tests** with `XCTMetric` | | `scripts/perf/*` define scenarios |
| App targets | Launch tests, deep-link tests, intent tests, share-extension handoff tests | | `deepLinks.test.ts` |

Test framework: Swift Testing for new unit tests (supports parameterised tests, tags), XCTest for UI and performance tests (the repo's single existing Swift test file is XCTest, `SQLiteConnectionTests.swift`; whether Xcode 27.2's Swift Testing covers all needs was not queried). Coverage gate: every module has a minimum count of golden cases generated from TS; absence of a contract test blocks porting that service.

---

## 14. Migration order implied by the dependency graph (for planning, not authorising)

1. L0 `BereanCore`, L1 `BereanReference` (+ golden corpus tooling).
2. L2 `BereanText` (offset contract, real-data sweep when DB access is granted), `BereanSQLite`.
3. L3 `BereanStore` with all migrations; open the **existing** `berean.db` read-only, assert schema equivalence.
4. L4 `BereanDomain` read paths, `BereanSearch`, `BereanNavigation`.
5. L4 write paths with contract tests; add the four missing contract suites.
6. L5 `BereanSync` read/apply first, then write; interop with TS engines on a simulated store; only then touch a real iCloud container.
7. `BereanMarkdown` (needs the real-note corpus), `BereanSpeech`, `BereanResearch`.
8. L6 and apps.

Coexistence constraint on step 3-6: while both apps ship, **a native writer must not run against a user's real `berean.db` or sync folder until the conformance and interop suites pass** (data-loss risk; 03 A01 calls sync "highest data-loss risk in the migration"). A read-only native app is a safe early milestone. Different bundle id/identity for early native builds (Berean Dev style isolation) is already supported by `config/app-identity.json`.

---

## 15. Risks and open questions

| # | Item | Status |
|---|---|---|
| S1 | Regex feature inventory of `parseRef.ts` and other pure modules vs Swift `Regex`/`NSRegularExpression` | UNVERIFIED |
| S2 | GRDB vs raw SQLite: dependency tolerance, observation needs | decision |
| S3 | Does `runMigrations` refuse a database with a higher version than the app knows? Needed for independent releases | UNVERIFIED (see 04) |
| S4 | Canonical Ask Berean behaviour per platform (section 5.9) | decision |
| S5 | Native markdown editor fidelity and corpus access | BLOCKED (real notes) |
| S6 | Minimum OS floors | BLOCKED (install-base data) |
| S7 | Mac distribution updater (Sparkle vs MAS-only) | decision |
| S8 | Kokoro G2P and cross-platform ONNX packaging | BLOCKED |
| S9 | Outbox capture inside the transaction (behaviour change, section 5.6) | optional |
| S10 | Linux-buildable pure modules (CI speed) | optional |
| S11 | Where `vault.ts` (1,449 lines, Mac-only, chokidar, trash purge) lives: `BereanVaultMac` target in the Mac app only | decision (04) |
| S12 | Whether any Swift test or CI step can run under the audit rules | BLOCKED: no builds or tests were run for this document |

---

## 16. References

Apple documentation (Xcode documentation index, 2026-11-05; paths under `https://developer.apple.com`): `/documentation/AppKit/NSGlassEffectView`, `/documentation/AppKit/NSGlassEffectContainerView`, `/documentation/AppKit/NSSplitViewController`, `/documentation/AppKit/NSTextLayoutManager`, `/documentation/SwiftUI/TextEditor`, `/documentation/SwiftUI/AttributedTextSelection`, `/documentation/UIKit/UIFindInteraction`, `/documentation/UIKit/UITextSearching-53wjq`, `/documentation/SwiftUI/PresentationBackgroundInteraction`. GRDB, `swift-markdown`, Sparkle, `swift-async-algorithms`, Swift Testing, `OSSignposter`, MetricKit, BGTaskScheduler, `Clock` are named from general knowledge and were **not fetched**.

Repository: `src/platform/db/{DatabaseAdapter,bereanMigrations}.ts`, `src/platform/services/*`, `src/platform/sync/{types,journal,engine,entities,merge,hlc,hostCore,fractional,tabFields}.ts`, `src/platform/__tests__/importBoundaries.test.ts`, `src/lib/{parseRef,taggedTokens,deepLinks,wordReplacer,...}.ts`, `src/lib/search/*`, `src/lib/navigation/*`, `src/lib/research/*`, `src/lib/tts/*`, `src/components/notes/pm/*`, `electron/ipc/aiLookup.ts`, `ios/App/BereanNative/Sources/BereanNative/*`, `ios/App/App/BereanIntents.swift`, `.github/workflows/{ci,release}.yml` (via 02), `config/app-identity.json`, `docs/native-migration-audit/{02,03,04,05,14}-*.md`.
