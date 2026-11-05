# 11 - Testing and Parity Strategy (proposal)

> **Baseline note.** Investigated at `807c2d9`. The final baseline is `d97fb05`. The only code changes between them are PRs #9, #10 and #11, listed in `01-REPOSITORY-STABILIZATION.md`: fixes for sync defects D1-D4, note table-cell formatting, and audio cache keys. Anything below describing those defects as present is corrected where noted.

Audit of commit `807c2d974b795f95f4c05b8ae4b6796c273b572c`, 2026-11-05. Read-only on the code. Nothing here is authorised; every item is a proposal for a later decision. No build, `npm run dev`, `ollama` or simulator was run for this document. Inputs: docs 02, 03, 04, 05, 08, 10, 14 plus direct reads and counts of the test tree.

**Labels:** VERIFIED (read or counted in this checkout), INFERRED, UNVERIFIED, BLOCKED (cannot be established without running something this audit may not run, or without data it may not open).

**Baseline facts supplied with the task (not re-run here, so UNVERIFIED by this document):** vitest 388 files / 5,763 tests passing; Swift package suite 5 tests passing (`ios:test` was broken before this audit); no Xcode or Swift job in CI; `tests/integration/vault-sync.test.ts` is a tautology; benchmark harness `scripts/eval/bench` scores Ask Berean; simulator automation via `scripts/ios/probe-server.mjs`; Electron launch smoke `scripts/smoke-electron.mjs`. PR 9 (in flight, not in this commit) fixes sync defects D1-D4 of doc 05 and adds `src/platform/sync/__tests__/knownLoss.integration.test.ts`; that file is absent here (VERIFIED), so the sync counts below are pre-PR-9.

---

## 1. Summary

1. The TypeScript suite is large (387 test files in this checkout, VERIFIED by `find`; the supplied 388 differs by one, not reconciled) but it is weighted toward pure logic and React component behaviour. It is strong on sync merge, migrations, the notes editor and services. It is weak or empty on: sync hash/op fixtures against a second implementation, real-data text sweeps, the vault path on Mac, PDF, workspaces/layout, Study Trail service, every native bridge, and anything visual.
2. There is zero snapshot testing and zero accessibility testing (VERIFIED: no `toMatchSnapshot`, `toMatchInlineSnapshot`, `axe` hits under `src` or `electron`). There is no XCUITest target and no UI test of any kind on iPhone beyond the manual probe server (VERIFIED by file search).
3. The native suite is one XCTest file with 5 tests (`SQLiteConnectionTests.swift`, VERIFIED).
4. The migration risk concentrates where tests are thinnest relative to data-loss consequence: sync interop (05), markdown round trip against real notes (BLOCKED, no vault access), highlight offsets against real rows (BLOCKED), and the 586 MB production database import (04).
5. The strategy proposed: freeze the TypeScript implementation as the oracle, export golden JSON from it, assert in Swift, run cross-implementation sync interop on the in-memory store before any real iCloud run, and keep a short list of device-only checks that cannot be automated.

---

## 2. What the existing tests cover (counted by reading)

Method: `find` for `*.test.*` under `src`, `electron`, `tests`, `scripts`; case count is a regex over lines beginning `it(`/`test(` (also `.each(`). It undercounts parameterised cases and miscounts nothing it cannot see, so treat per-area figures as lower bounds. Sum of the rows below is about 4,950 literal cases against the supplied 5,763 vitest tests; the difference is `it.each` expansion and nested helpers (INFERRED).

| Subsystem | Files | Literal cases | Notes (VERIFIED unless marked) |
|---|---|---|---|
| `src/lib/__tests__` (reference, text, search helpers, display, history) | 76 | 1,096 | `parseRef` 59 here + 13 in `tests/unit` = 72; `scriptureSearch` 16; `strongsSearch` 18; `scriptureHighlight` 11; `verseTagRanges` 11; `taggedTokenCharPos` 4 |
| `src/lib/research` (Ask Berean policy, routing, guards) | 20 | 126 | Model output is not asserted; network transport excluded |
| `src/lib/tts` | 9 | 103 | Chunking, alignment, spoken text; no audio |
| `src/lib/search`, `navigation`, `studyTrail`, `notes`, `crossRefs` | 10 | 118 | |
| `src/components/notes` (editor, markdown, print, board) | 58 | 1,583 | `pm/__tests__` 41 files, about 250 cases; `roundtrip.test.ts` 29 cases. The remaining 17 files in `notes/__tests__` carry most of the 1,583 |
| `src/components/ailookup` | 22 | 219 | |
| `src/components/bible`, `shell`, `lexicon`, `tags`, `settings`, `ui` | 21 | 119 | Bible panel has 9 files, 65 cases |
| `src/mobile` (iPhone React UI) | 50 | 339 | against 17,014 non-test LOC (02) |
| `src/platform/services` (contract tests over in-memory DB) | 22 | 169 | 14 `*.contract.test.ts`; 3 `*.realdata.test.ts` need local DBs |
| `src/platform/sync` | 13 | 127 | `dataSafety` 32, `engine.integration` 26, `lifecycle` 11, `aiChatSyncRich` 11, `merge` 11, `hlc` 6, `fractional` 6, `tabFields` 6, `liveSync` 6, `journal` 4, `hostCore` 3, `chaos.fuzz` 1 (one fuzz test with many iterations, INFERRED) |
| `src/platform/ios`, `db` and `__tests__` | 11 | 50 | `bereanMigrations.test.ts` covers the 48 migration entries (1,344 lines of SQL) |
| `src/store` | 19 | 118 | tab, history, workspace-restore, persistence |
| `electron/ipc`, `electron/__tests__`, `electron/sync`, `secrets`, `downloads` | 36 | 261 | `ipcParity.test.ts`, `packagedAssets.test.ts`, `entitlements.test.ts`, CSP; vault has 3 files |
| `tests/` | 7 | 68 | includes the tautology |
| `scripts`, `styles`, `hooks`, `liquidGlass` | 10 | 52 | iOS identity and setup checks; MAS profile checks |
| Swift | 1 | 5 | XCTest only (supplied) |
| Eval | `scripts/eval/bench` | 355 lines in `cases.jsonl` (supplied figure: 338), 105 + 40 + 30 holdout lines | needs a local Ollama; outside default vitest |

### 2.1 Gaps, measured

Each gap states what is missing, evidence, and why it matters for migration.

| # | Gap | Evidence | Migration consequence |
|---|---|---|---|
| G1 | `hashFields` (the sync record hash, `engine.ts:1375`) has no dedicated golden test. `hash` appears in 2 lines of `engine.integration.test.ts` and 1 of `merge.test.ts`; none in `journal.test.ts` | VERIFIED by grep | Doc 05 test 1 (hash parity across unicode, emoji, floats, null, nested) has nothing to port. A Swift hash that differs by one byte makes every record look changed and re-publishes everything. High |
| G2 | Op encode/decode and `isValidOp` have 4 cases (`journal.test.ts`) | VERIFIED | Wire-format parity rests on goldens that do not yet exist |
| G3 | No test of the real vault code path on Mac. `tests/integration/vault-sync.test.ts` is a tautology (182 lines, comments for GIVEN/WHEN/THEN, no call into app code, supplied and VERIFIED by reading the header). `electron/ipc` has 3 vault tests, all about image extraction and single-file import | VERIFIED | D4 and D5 (doc 05) live exactly here. Reconcile, watch, mtime handling, export-all have no automated coverage. High |
| G4 | No PDF service or PDF highlight test (no `*pdf*test*` file anywhere) | VERIFIED by `find` | `pdfService`, `pdf_highlights`, bookmarks and file-by-hash storage have no oracle. Medium |
| G5 | `studyTrailService` has no contract test; workspaces and youtube have one each | VERIFIED: 22 service files, `studyTrail` absent from the list | Doc 08 says absence of a contract test blocks porting that service |
| G6 | No fixture of a database at any historical schema version other than "empty then migrate" | `bereanMigrations.test.ts` builds from empty; doc 04 test 4 requires v43, v47, v48, v49 fixtures | Upgrade-in-place from old data is the real user path. INFERRED that no historical fixture exists; none found under `tests/` |
| G7 | Real-data sweeps run only where DBs are present (`*.realdata.test.ts`, 3 files). Tagged-token offsets have 4 cases in `taggedTokenCharPos.test.ts` | VERIFIED | Highlight offsets (`start_word`/`end_word` and character offsets, doc 08 5.2) are not verified over the 19 text DBs. BLOCKED here (DBs not opened) |
| G8 | No test of any native bridge behaviour except `cloudPluginMainThread`, `cloudSyncStore`, `bridgeSurface` (7 files, 18 cases in `platform/ios`) | VERIFIED | `BereanCloudPlugin.swift`, speech, share extension, widget, App Intents have no automated tests |
| G9 | No snapshot, visual-regression or accessibility test | VERIFIED | Parity of look and VoiceOver behaviour is currently unchecked everywhere |
| G10 | No UI automation in CI; iPhone UI verified by hand and by `probe-server.mjs` (manual) | VERIFIED | Every iPhone UI parity claim is manual today |
| G11 | CI has no Xcode job (supplied; doc 02 section 16 and 08 section 10.1) and `ios:test` was broken until this audit | VERIFIED by reading `ci.yml` description in 02 | The Swift side can regress unnoticed |
| G12 | Notes markdown round trip is tested on 29 hand-written cases plus 41 `pm` files; no corpus of real notes | VERIFIED; real corpus BLOCKED (3,375 notes per doc 10, vault not opened) | Highest product risk (doc 08 5.8) |
| G13 | `chaos.fuzz` is one test; no property-based library in the repo (no `fast-check` hit) | VERIFIED (grep returned no file) | Native fuzz parity has no seed corpus |
| G14 | Sync tests run only on the in-memory store and `icloudDriveSim.ts`; real iCloud timing is untested (doc 05, 02) | VERIFIED | |
| G15 | Settings migration `persistedSettings` and `localStorage` extraction (doc 04 11.4) have 1 store test, no export test | VERIFIED (`persistedSettings.test.ts` only) | Settings can silently reset on first native run |
| G16 | Performance is measured only by manual CDP scripts (`scripts/perf/*`); no budget is asserted anywhere | VERIFIED | Doc 10 section 8 proposes the suite, not yet built |

### 2.2 What is strong (so it is not re-invented)

- Sync merge, HLC, fractional indexing, tab fields: unit tests plus `engine.integration`, `dataSafety` (32), `lifecycle` (11), and a simulated iCloud store. VERIFIED present. These are the best oracle in the repository.
- Migrations: one shared runner tested for table set, v18 gap, damaged DB, and `hasColumn` guards (VERIFIED by reading the first 25 lines and case count; the full assertions were not read, INFERRED adequate).
- Services: 14 contract suites over a seeded in-memory DB define the operation lists to record.
- Markdown and the editor: 41 `pm` files plus 17 note-level files.
- Architecture rules: `importBoundaries`, `ipcParity`, `packagedAssets` tests guard structure that the native app will have its own equivalents of.

---

## 3. What ports, what becomes golden data, what is discarded

| Existing asset | Disposition | Reason |
|---|---|---|
| `parseRef` (72 cases), `deepLinks`, `deepLinkDedupe`, `hermasMap`, `translationChapterMap`, `chapterNumbering` | Golden JSON plus Swift parameterised tests | Pure functions |
| `searchIntent`, `unifiedSearch`, `scriptureSearch` (16), `strongsSearch` (18), `multiBookSearch`, `scriptureSearchFilters` | Golden: input query plus context to ordered result keys | Pure; ranking is order-sensitive, record full ordering for fixed DB fixtures |
| `taggedTokenCharPos`, `verseDisplayTokens`, `verseStudyTokens`, `scriptureHighlight`, `verseTagRanges`, `wordReplacer`, `supplyBrackets` | Golden JSON, plus a real-DB sweep once DBs may be read | Offset contract |
| `merge`, `hlc`, `fractional`, `journal`, `tabFields` | Golden vectors plus direct test port | Wire compatibility |
| `engine.integration`, `dataSafety`, `lifecycle`, `chaos.fuzz`, `aiChatSync*` | Port as scenario scripts (operation list plus expected final tables), run against both engines | Interop |
| `*.contract.test.ts` (14) | Record operation list and table dump from TS; replay in Swift | DB-level golden |
| `pm/__tests__`, `roundtrip`, `markdownCombinations`, `noteFormats` | Golden: markdown in, canonical markdown out and document-model outline | Format preservation, not editor behaviour |
| `bereanMigrations` | Golden: `sqlite_master` dump per version; expected table list | |
| Store tests (19) | Convert to recorded action sequences (doc 08 11.3) | Zustand-coupled; reducer must be extracted |
| `tts` tests (9) | Port chunking and alignment as golden | Audio not golden |
| React component tests (`src/components/**`, `src/mobile`, about 2,400 cases) | Discard as code, mine as a behaviour list | They test DOM; the assertions describe expected behaviour and become the XCUITest checklist (section 7) |
| `electron/ipc`, `electron/__tests__` | Discard except `packagedAssets`, `entitlements`, `aiNoLogging`, `ipcParity` intents (re-express as native equivalents) | Electron-shaped |
| `tests/integration/vault-sync.test.ts` | Delete and replace; it asserts nothing about app code | Tautology |
| `scripts/eval/bench` | Keep as-is, outside migration CI | Model-dependent; see section 11 |

---

## 4. Golden data generated from the TypeScript implementation

Mechanism follows doc 08 section 11.2: a script under `scripts/native/` run with the existing vitest/ts toolchain writes `Tests/Fixtures/golden/<module>/<name>.json` with `{source: <git sha>, cases: [{input, context, output}]}`. Committed, so Swift CI needs no Node. The TS sha is recorded in every file. UNVERIFIED: no such script exists yet.

Rules for a trustworthy golden set (proposal):

- Resolve known duplicated logic first (`numberWords`, `safeFtsQuery` x2 with different behaviour, `TEXT_FILES` x2; doc 08 11.3) so the corpus records the intended behaviour, and write the chosen behaviour in the file header.
- Do not golden-encode known defects. D1-D4 are fixed in PR 9; regenerate sync fixtures only from a commit that contains `knownLoss.integration.test.ts` passing. D5-D7 remain open and must be classed "intended" or "defect" per fixture before export.
- Each file states whether it is exhaustive (enumerated), generated (seeded PRNG, seed stored), or recorded (from real data, then anonymised).
- Real-data fixtures never contain Michael's notes or credentials. Anonymise or generate synthetic equivalents; the sync and markdown corpora must be hand-reviewed before commit.

| Domain | Inputs | Output recorded | Size target (proposal) | Status |
|---|---|---|---|---|
| Reference parsing | the 72 literal cases; every book name/abbreviation/alias in `bdbAbbreviations`, `bookLabels`; generated ranges, comma lists, chapter-only, psalm superscriptions, number words; fuzzed garbage strings | normalised reference object, or "not a reference" | about 5,000 | INFERRED feasible; fuzz generator not written |
| Search intent and ranking | queries listed in `navigation-contract.md` section 3 ("Matthew 10 LXX", "H430", "lxx love", "enoch: watchers") plus 500 sampled queries; a frozen small DB fixture | intent classification; ordered result keys with scores rounded | about 600 queries | UNVERIFIED |
| Strong's | all tagged tokens parsed from the text DB `text_tagged` rows; lexicon lookups for a sample of ids across H/G ranges; Hebrew/Greek FTS queries with diacritics | token list per verse; lexicon row; search result ids | every verse (needs DB read, BLOCKED here) | BLOCKED |
| Highlight offsets | highlight rows (word and character offsets) against `text_tagged`, display-rule on and off, supplied-word brackets, Strong's inline on and off | rendered string, plain-text offsets, round trip of selection to offset and back | anonymised real rows, plus synthetic | BLOCKED for real rows |
| Markdown round trip | corpus of every markdown construct (headings, nested lists, tables, blockquote indent, code, wikilinks, verse refs, images, frontmatter, YAML edge cases, CRLF, tabs, emoji); then real notes | canonical markdown out; block-tree outline; verse-ref and wikilink extraction | corpus of at least 300 hand-built plus all notes in a private local corpus (3,375 per doc 10) | real corpus BLOCKED; synthetic INFERRED feasible |
| Sync hash and journal | `hashFields` over records of each entity kind and a stress set (surrogate pairs, NFC vs NFD, floats such as 0.1 and 1e21, `-0`, null vs missing, key order, 9 MB strings); ops of every kind; manifests; HLC strings; device id fork cases | hash string; encoded op line bytes; `isValidOp` result; merge outcome | about 1,000 vectors | UNVERIFIED (gap G1, G2) |
| Sync scenarios | operation lists from `engine.integration`, `dataSafety`, `lifecycle` | final table dumps for both devices | one per existing test, about 80 | INFERRED feasible |
| Schema snapshots | `sqlite_master` after running migrations from empty; after each historical fixture version to current | normalised DDL, index list, trigger list, `PRAGMA table_info`, user_version equivalent | one per schema version in {v43, v47, v48, v49}, plus empty | UNVERIFIED |
| Service contracts | operation lists of the 14 `*.contract.test.ts` | table dumps | one per service | INFERRED |
| Search snippets and Scripture find | `scriptureFind`, `scriptureSearchSnippetRanges` | snippet strings and ranges | existing cases | INFERRED |
| Speech chunking | `kokoroChunking`, `timestampAlignment`, `extractSpokenText`, `textPrep` | chunk boundaries and spoken text | existing cases | INFERRED |

Precision caveats: floating point output in ranking must be compared with a stated tolerance; JavaScript number-to-string and Swift `Double` description differ, so fixtures store numbers as strings produced by the TS side and the hash tests compare byte output, not parsed numbers. Regex semantics differ between V8 and Swift `Regex` (doc 08 5.1); the fuzzed reference corpus exists to expose that.

Alternative oracle: a `JSContext` running the bundled `src/lib` inside Swift tests (doc 08 11.4) gives a live oracle for pure modules on a macOS runner. Test-only; never shipped. Not recommended as primary because JSON goldens are simpler and run on any runner.

---

## 5. Data migration test matrix

Derived from doc 04 section 13 (27 tests) and doc 05 section 14. Fixtures are generated databases only; production data and the production iCloud container are never used for any test that writes (VERIFIED requirement from CLAUDE.md; Berean Dev identity is the test identity).

| Axis | Values |
|---|---|
| Source schema | v43, v47, v48, v49 (current `BEREAN_SCHEMA_VERSION` to be read at test time), empty, and a database one version newer than the native build |
| Source distribution | Electron DMG (non-sandbox), Electron MAS (sandbox container), Capacitor iPhone (App Group/iCloud container), both DMG and MAS present on one Mac |
| Destination | native Mac (sandboxed), native iPhone, in place vs copy |
| Sync | off, on with empty outbox, on with pending outbox rows, on with failed rows parked, on with a dataless remote journal |
| Content shape | normal; 9 MB note; unicode and emoji titles; trashed and tombstoned; orphan rows; 167 tabs; 300 chats; pdfs with missing file; highlights at word boundaries; vault path set and unset |
| Environment | low disk (586 MB source plus copy plus backup, doc 04), WAL active, old app still running, kill at each step, security-scoped bookmark lost |
| Outcome checks | row counts per table equal; `PRAGMA integrity_check` and `foreign_key_check` clean; `notes_fts` rebuilt and equal on a fixed query set; schema equals TS-produced schema (`sqlite_master` diff empty); settings and localStorage keys carried; API keys not exported and re-entry works; vault path preserved; PDFs present by hash; device id not duplicated after restore; rollback to old app works on an untouched backup |

Acceptance for any one row: the old app still opens the original data unchanged (the import is a copy, per doc 04 11.1) and the native app's table dump equals the golden transform of the source. A test that cannot show the old app still works does not pass.

Mandatory negative tests: import refuses when the old app is running; a half-written destination never looks complete; disk-full stops cleanly; a newer-than-known database is refused with a message.

---

## 6. Sync interoperability tests

Order matters: logic parity first, then simulated interop, then real iCloud. Each stage must pass before the next is attempted.

**Stage A - vector parity (no devices).** Golden hash, op, manifest, HLC, merge vectors (section 4). Pass criterion: 100% byte equality.

**Stage B - two engines on one memory store.** A TS engine (existing `Sim` harness, `icloudDriveSim.ts`, `memorySyncStore.ts`) and a Swift engine share one simulated store. The harness already exists on the TS side (VERIFIED); the Swift engine and a way to drive it (JSON scenario file in, table dump out, via a small CLI test tool) are new and UNVERIFIED. Run:

1. Every scenario in doc 05 section 16 that does not need a device: tests 6-10, 12-14, 16 (kill at each step via fault injection in the store), 28, 29, 30.
2. Each scenario in both directions (TS authors, Swift reads; Swift authors, TS reads) and with random interleavings of writes, delays, evictions, truncated files, and duplicate delivery. Seeds stored; failures replay.
3. Three devices, one offline for over 64 saves of one note (doc 05 test 8).
4. D1 regression: type continuously during a push; D2: fresh device from a snapshot with tag edges; D3: failed op must stay retryable; D4: external vault edit captured. These use the tests PR 9 introduces (`knownLoss.integration.test.ts`) as the scenario source once merged. UNVERIFIED until PR 9 lands.
5. Convergence assertion: after quiescence, table dumps equal on all devices and equal to the TS-only expected result for the same ops.

**Stage C - real iCloud (devices, Berean Dev container only).** Doc 05 tests 6, 7, 11, 17-27. Cannot be automated reliably (iCloud timing, eviction, account changes). Run on a Mac and a physical iPhone against `iCloud.com.berean.app.dev`. Each run records: device models, OS builds, container, start state, steps, convergence time, final dumps. Pass criterion: no loss, no duplicate, no divergence after a quiescence wait of a stated duration; any unexplained difference is a failure, not a retry.

**Stage D - mixed-version fleet.** Electron Mac + native iPhone, native Mac + Capacitor iPhone, native + native, and an old Capacitor build against a native-touched journal (doc 05 test 12, doc 04 test 26). Schema gate message read by a person.

Sync safety invariants asserted in every stage (proposal): an empty database with sync on publishes nothing and deletes nothing; Dev and production cannot cross containers; a failed op is never pruned by `applied`; the status badge never says "synced" while the outbox is non-empty or a record is parked.

---

## 7. UI parity checklists and how to automate them

**Sources for checklists.** Doc 03 lists each feature with an ID (S01-S16 Scripture, Q01-Q10 search, N01-N15 notes, H01-H06 highlights, U01-U07 and later groups for shell, media, AI, sync, platform). For each feature, the checklist row is: ID, platform (Mac, iPhone, both), expected behaviour (taken from the implemented component tests and doc 03 text), automation class, owner of the oracle. The 2,400 component test cases are the best available statement of expected behaviour; mine them rather than writing from memory.

Automation classes:

| Class | Tool | Used for | Limit |
|---|---|---|---|
| Logic | Swift Testing | view models, reducers, formatters | no rendering |
| Interaction | XCUITest | navigation, tab and panel behaviour, search flow, note create/edit/delete, settings, onboarding, deep links | needs accessibility identifiers designed in from the start; flaky on animation without waits |
| Rendering | snapshot testing (a third-party library such as swift-snapshot-testing, or `XCTAttachment` screenshots compared with a stored image; library choice UNVERIFIED, not evaluated) | chapter layout, verse rows with notes dots, highlights, Strong's chips, themes (light, dark, each preset), dynamic type, narrow and wide sizes | pixel diffs depend on OS build and font rendering; pin the runner and simulator OS, store reference images per OS; use tolerance and review diffs by a person |
| Accessibility | `performAccessibilityAudit()` in XCUITest (named in doc 08; availability on the minimum OS not queried), plus manual VoiceOver passes | contrast, labels, hit regions, dynamic type clipping | does not prove a sensible reading order |
| Contrast and tokens | Swift unit tests over the theme tokens (port of `customTheme.test.ts`, contrast helpers) | every preset legible | |
| Text-selection hit testing | AppKit/UIKit unit tests on `NSTextView`/`UITextView` offsets | the offset contract, selection to highlight | |
| Performance | `XCTMetric` (`XCTClockMetric`, `XCTMemoryMetric`, `XCTOSSignpostMetric`) | see section 8 | simulators are not representative |

Feature checklist (what must be demonstrably equal; each is a group of rows):

- Scripture: open any of the 19 text DBs' chapters; Strong's inline, tooltip and lexicon open; interlinear remains absent (deferred); selection, copy with reference, verse menu; translations and Hermas/LXX numbering differences; continuous scroll; find in chapter; word replacer (divine-name display rules, Yeshua/Yehovah usage per CLAUDE.md section 21); psalm superscriptions; very long chapters (PSA 119, 2ES 7).
- Search: reference, keyword, Strong's, lexicon, notes, transcripts, unified search with the same ranking on a fixed DB; filters; floating search behaviour.
- Notes: create, edit, autosave, undo, version history, tables, images, wikilinks, verse-ref detection, folders, trash, pin, daily notes with the sunrise day boundary, print, export, vault round trip (Mac).
- Highlights: create, merge, delete, colours, offsets across text-display modes, sync.
- Shell: spaces, vertical tabs, sessions, archive, workspaces and layouts, multi-window and presenter (Mac only), deep links and URL grammar frozen (doc 08).
- Research/AI: routing and safety behaviours are policy tests (not model output); output quality is checked by the benchmark (section 11).
- Speech: voices download, chunking, playback controls, background audio on iPhone.
- Settings and onboarding, hints, About/reset.

Each row ends in one of: automated pass, automated with human review of diffs, manual Mac, manual iPhone simulator, manual physical device. Rows that remain "manual" at the end of a stage block the stage.

Automating the existing simulator probe: `scripts/ios/probe-server.mjs` drives the web view through JS and will not work against SwiftUI. Replace by XCUITest for flows and the Xcode MCP DeviceInteraction tools for exploratory runs (documented as available in project memory; not exercised here, UNVERIFIED).

---

## 8. Performance baselines and budgets (tied to doc 10)

Doc 10 section 8 defines 14 baseline measurements and a result format, all PROPOSED and not yet run; no baseline number from it is claimed here. This document adds only the gating rule.

1. Before any stage is declared done, the baseline suite from doc 10 section 8 must have been run on the Electron app (DMG and MAS separately) on the same synthetic dataset, 10+ launches, median and max recorded, thermal state recorded. Without it, no budget below has a denominator (BLOCKED today).
2. Budgets are expressed relative to the Electron baseline (for example "median first-Scripture-visible no worse than baseline", "peak footprint after the standard workload at most baseline") plus absolute floor values for interactions a person feels (key-to-paint in notes, chapter open, scroll frame times). Concrete numbers are not proposed here because no baseline exists; do not invent them. Doc 10 3.1 lists directions that are probable, 3.2-3.3 those that are not established; budgets in the second group must be measured, not assumed.
3. Tooling: `XCTMetric` for repeatable automated runs on a pinned runner (non-blocking at first, as in doc 08 10.1 item 7); Instruments (Time Profiler, Allocations, Energy Log) on physical devices for iPhone launch, PSA 119 scroll, and note typing (doc 10 item 13); `footprint` and `ps` on Mac; signposts added to the Swift app that mirror `perfMarks.ts` mark names so definitions are identical.
4. Regressions found by the baseline in the existing app (doc 10 section 4 risk list, including the PDF memory growth R2) become test cases that the native app must beat or at least not repeat.
5. Search budgets use the real bundled DBs opened read-only, same PRAGMAs, SQLite library version recorded per runtime (doc 04 section 4-5 on tokenisers and compile options).
6. Simulator numbers are never used for acceptance (doc 10 item 13).

---

## 9. Cross-platform parity, Mac vs iPhone

| Concern | Today | Test |
|---|---|---|
| Shared logic | one TS code base for both (`src/lib`, `src/platform/services`, sync engine) | one golden corpus, run on both native targets via the shared package; assert identical output on macOS and iOS simulator |
| SQLite build | different (doc 04 section 5 compile options; iOS SQLite version tied to OS) | run the same query and FTS suite on each platform and minimum OS; compare to golden (doc 04 tests 2-3) |
| Feature differences by design | Mac only: vault, presenter/viewer, multi-window, BibleGateway and e-Sword import; iPhone only: share extension, widget, App Intents, Kokoro in-app download | the checklist marks platform; a test asserts the absence is intentional (a feature flag table) so drift is visible |
| Data equality | notes, highlights, tags, tabs sync both ways | Stage B/C interop run with one device of each platform |
| Tab and workspace model | tabs shared; layout is react-mosaic on Mac, a single stack on iPhone (doc 02, 03) | tab fields sync golden (`tabFields`); layout tests Mac-only |
| Settings | shared keys vs per-platform keys | settings registry test: every key flagged shared, Mac, or iPhone |
| Identity | Dev and production identities isolated by `config/app-identity.json` | port `verify-identity` and `verify-mas` as a CI job (doc 08 10.1 item 5) |

Parity failure policy (proposal): a difference between Mac and iPhone output on a shared golden is always a bug, never a platform exception, unless it appears in the feature flag table.

---

## 10. Acceptance criteria per migration stage

The stages follow doc 08 section 14 ordering ("for planning, not authorising"); stage names here are placeholders, not a plan.

| Stage | Entry | Must pass to exit |
|---|---|---|
| 0. Preparation | this audit accepted | Golden exporter exists and TS sha pinned; G1, G2, G4, G5, G6 closed (hash, op, PDF, Study Trail, historical fixtures); tautology test replaced; Swift CI job green on the existing 5 tests; doc 10 baseline run on Electron; PR 9 merged and sync fixtures regenerated |
| 1. Pure logic package (reference, text, search, markdown model, speech chunking) | stage 0 | 100% of golden cases pass on macOS and iOS simulator; fuzz and property suites seeded and green; no import boundary violations; real-DB sweep (offsets, tagged tokens) green once the DBs may be read |
| 2. Store and migrations | stage 1 | Schema snapshot equal for every fixture version; bundled DB queries equal to TS on both platforms and minimum OSes; integrity and FK checks; FTS equality; newer-DB refusal |
| 3. Sync engine | stage 2 | Stage A and B green with zero divergence over a stored number of fuzz seeds (the number to be chosen when the runtime is known, not assumed here); Stage C minimum matrix executed on real devices in the Dev container with signed-off results; D1-D4 scenarios green; mixed-version rule with Capacitor build documented |
| 4. Data import | stage 3 | Full matrix section 5 on fixtures; rollback proven; production-size dataset import within the doc 10 budget; first-run import tested through real tap-through, not only unit tests (project convention: real-tap testing) |
| 5. Mac and iPhone apps feature by feature | stage 4 | Each feature row either automated pass or signed manual pass; accessibility audit has no failures; visual snapshots reviewed; performance within stage budget; physical device checks done |
| 6. Cutover and retirement of Electron/Capacitor | stage 5 | Beta channel soak; telemetry-free crash review via Xcode Organizer reports (availability UNVERIFIED); rollback path rehearsed; old apps still read/sync safely during the overlap |

Each exit is a decision for the owner. Nothing here authorises a stage.

---

## 11. CI design

Today (VERIFIED, doc 02/08): one `ci.yml` on `macos-latest` (typecheck, lint, vitest, build, Electron smoke, iOS web build) and a tag-driven `release.yml`; no Swift or Xcode.

Proposed jobs (doc 08 10.1 extended). Names and runner images are proposals; hosted runner Xcode availability is UNVERIFIED and must be checked before adopting.

| Job | Content | Blocking | Notes |
|---|---|---|---|
| `ts` | existing steps | yes | stays while TS apps ship and as oracle |
| `golden-drift` | re-run `export-golden`, diff against committed fixtures | yes | fails if TS changed without a regenerated fixture |
| `swift-packages` | `swift test` per package with golden JSON; Linux for pure modules if they compile there (INFERRED) | yes | fast, no simulator |
| `mac-app` | `xcodebuild build test` for the Mac scheme, unit and AppKit tests | yes | |
| `ios-app` | `xcodebuild test` on a simulator pinned by OS version (not "latest"), plus build of Share, Widget, Intents | yes | `ios:test` was broken before this audit; the script picks the first available iPhone, which makes runs non-reproducible; pin |
| `ui-smoke` | XCUITest launch, deep link, search, note create, open chapter | yes after a stabilisation period | quarantine tag for flaky tests with an owner and expiry |
| `a11y` | `performAccessibilityAudit` on main screens | non-blocking at first | |
| `snapshots` | image comparisons on a pinned simulator | non-blocking, reviewed | |
| `sync-interop` | Stage B scenarios against the TS engine (needs Node and Swift on one runner) | yes | |
| `identity` | verify xcconfigs and entitlements against `config/app-identity.json`; Dev build safety | yes | port of existing scripts and tests |
| `data-manifest` | bundled DB list present and hashed | yes | analogue of `packagedAssets` |
| `perf` | `XCTMetric` runs | no | trend only; shared runners are noisy |
| `release-dry-run` | archive without upload | on tags | Apple uploads remain human (CLAUDE.md) |

Limits: GitHub-hosted macOS minutes are metered and slower per minute than Linux (rates UNVERIFIED, not looked up); simulators on shared runners are unreliable for timing; no GPU or iCloud on runners, so Stage C and any real iCloud, Keychain-with-iCloud, speech-model and device-only paths cannot run in CI; Developer ID signing and notarisation need secrets, which exist only in `release.yml` today (names only read). The DB download from release `data-v1` in `ci.yml` should stay, with caching.

---

## 12. What must be manual, and on a physical device

Cannot be automated reliably, proposed as a sign-off list:

Physical iPhone (Berean Dev only; production Berean must remain installed and untouched, per CLAUDE.md):
- Doc 05 Stage C items 17-27: airplane mode for days, eviction under storage pressure, iCloud sign-out and account switch, iCloud Drive off for the app, restore from backup, Migration Assistant on Mac, 90-day silent device, real upload delay then app deletion.
- Share extension handoff from Safari/other apps, widget refresh, App Intents and Siri/Shortcuts, Live location prompts (When-In-Use only per project memory), background audio and lock-screen controls, Dynamic Island/notch layouts, haptics, keyboard behaviour and Stage Manager/split view if supported.
- Kokoro voice download and on-device ONNX run; thermal behaviour; Low Power Mode.
- Instruments runs (launch, scroll, typing, energy).
- Real-tap flows from the main screen, relaunch mid-flow, back and swipe (matches the project's real-tap testing convention).
- VoiceOver, Voice Control, Switch Control, Dynamic Type extremes, Reduce Motion, Increase Contrast.

Mac:
- DMG vs MAS install and first-run import, Gatekeeper and notarisation, App Sandbox security-scoped bookmarks for the vault, auto-update path, iCloud entitlement with the real provisioning profile (MAS needs a profile and installer certificate, project memory).
- Octarine editing the same vault while Berean runs (D4, D5), iCloud dataless files and `brctl`/download-request behaviour, Time Machine and Migration Assistant restore.
- Multi-window, presenter/viewer on a second display, Mission Control/Spaces, full-screen, Liquid Glass on the supported macOS builds, menu bar, keyboard shortcuts table (CLAUDE.md section 14), drag and drop of tabs and files, Services, Quick Look, print.
- YouTube webview/PiP replacement behaviour and login persistence; network-dependent, so record the network state.
- Speech quality and voice selection judged by ear.

Cannot be judged by a machine at all: whether the app "feels native", reading comfort of the Scripture typography, and the Ask Berean answer quality beyond the benchmark.

All manual sign-offs record the device model, OS build, app build hash, steps and observed result; a missing record means the item is not done. The Manual Testing Guide convention (CLAUDE.md) remains the format for per-change human testing; it must never claim manual testing happened.

---

## 13. Ask Berean quality gate

`scripts/eval/bench` (355 lines in `cases.jsonl`, 105 + 40 + 30 in three holdout files, locked by `HOLDOUT.lock`; the supplied 338 figure was not reconciled) scores the research pipeline against local models and is run through `run_all.sh`, which needs Ollama and a GPU. It is not part of default vitest and was not run here. Proposal: freeze the cases and gold files as the product-quality oracle, port only the deterministic pre- and post-processing (retrieval, routing, guards: the 20 `lib/research` tests) to golden, and re-run the benchmark against the native pipeline manually on the same models and prompts. Tolerance is a decision for the owner after baseline variance is known (UNVERIFIED: none is documented here). Holdouts must remain unseen during tuning.

---

## 14. Open items and could not verify

- Whole-suite status and counts were not re-run; the supplied totals are accepted as given. Per-area counts are regex counts and exclude `it.each` expansion.
- `knownLoss.integration.test.ts` and the PR #9 fixes landed after this document's investigation commit, at `d97fb05`. They cover D1-D3.
- Real-data sweeps (text DBs, highlight rows, real notes, 586 MB production DB) were not opened: BLOCKED.
- No Xcode, simulator, XCUITest, `performAccessibilityAudit`, snapshot library, or hosted-runner behaviour was examined: UNVERIFIED.
- Whether Swift Testing covers all needs on the minimum OS was not queried (doc 08 13).
- The doc 10 baseline numbers do not exist yet; every budget here is relative until they do.
- The `cases.jsonl` count discrepancy (355 lines vs 338 cases) is unexplained; blank or non-case lines are INFERRED.
