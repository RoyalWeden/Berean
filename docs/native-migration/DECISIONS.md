# Berean Native Migration — Durable Architecture & Owner Decisions

> Do not invent approval. **PROPOSED** is not **ACCEPTED**. Audit 15 IDs remain open until explicitly resolved.

## ADR template
### ADR-XXXX — Title
- Date/time and author:
- Status: PROPOSED / ACCEPTED / REJECTED / SUPERSEDED
- Decision type: engineering / owner / external
- Problem and exact source evidence:
- Alternatives, including reversible fallback:
- Result and rationale:
- Compatibility/data/privacy/release consequences:
- Required tests and revisit trigger:
- Owner approval reference (when needed):
- Supersedes / superseded by:

## Recorded decisions

### ADR-0001 — Native project location and file format
- Date/author: 2026-11-07, Claude (engineering)
- Status: ACCEPTED (engineering, reversible)
- Problem: spec §3 asks for one Xcode build graph plus `Packages/BereanKit`. Xcode 27.2's New Project writes the
  new text `project.xcproj` format, which the GitHub `macos-latest` runner's Xcode cannot read.
- Result: `apple/Berean.xcodeproj` in the classic `project.pbxproj` format (objectVersion 77, file-system-synchronized
  folders `apple/BereanMac`, `apple/BereanIOS`, `apple/Shared`), build settings in `apple/Config/*.xcconfig`,
  local package reference `../Packages/BereanKit`. `Packages/BereanKit` is a SwiftPM package (tools 6.0, Swift 6
  language mode) so its tests run with plain `swift test` on any Mac.
- Alternatives: Xcode 27 `project.xcproj` (revisit once CI runners ship Xcode 27); XcodeGen/Tuist (not installed,
  extra dependency).
- Consequences: Electron `native/` (Liquid Glass bridge) and Capacitor `ios/` are untouched.

### ADR-0002 — Native development identities (M1–M3)
- Date/author: 2026-11-07, Claude (engineering)
- Status: ACCEPTED for M1–M3; the M4 part is PROPOSED (owner)
- Problem: native dev builds must never open production data or collide with the Capacitor/Electron
  "Berean Dev" (`com.berean.app.dev`, `iCloud.com.berean.app.dev`, `group.com.berean.app.dev`).
- Result: `com.berean.native.mac.dev` (sandboxed, hardened runtime, ad-hoc "Sign to Run Locally") and
  `com.berean.native.ios.dev` (automatic signing, no team committed). No iCloud container, no App Group, no URL
  scheme. `scripts/native/build.sh` fails the build if the built bundle id differs.
- PROPOSED for M4: interop tests need the native Dev apps to read/write the **Dev** container
  `iCloud.com.berean.app.dev` (never production). That needs the team's Dev entitlement on the new bundle ids —
  an owner decision, asked in the M4 batch.
- Production identity (`com.berean.app`, `iCloud.com.berean.app`, `group.com.berean.app`) is untouched; any change is
  a release decision (D-5, R-12).

### ADR-0003 — Trial deployment floor
- Date/author: 2026-11-07, Claude (engineering default from spec C2)
- Status: ACCEPTED as a trial; owner decision C-2 still OPEN
- Result: macOS 15.0 / iOS 18.0 in `apple/Config` and `Package.swift`; newer visual APIs behind availability checks.
- Revisit: install-base data (D-7), SQLite/TextKit evidence (B-1, B-3, B-15).

### ADR-0004 — Native build outputs stay inside the checkout
- Date/author: 2026-11-07, Claude (engineering)
- Status: ACCEPTED
- Problem: `~/Berean-dev-builds` contents disappeared twice (F-03); outputs outside the repo are unaccounted for.
- Result: `scripts/native/build.sh` uses `-derivedDataPath build/apple/DerivedData` and `--scratch-path build/apple/swiftpm`
  (gitignored). Nothing is written to `~/Library/Developer/Xcode/DerivedData` or the home folder by the scripts.

### ADR-0005 — JavaScript-compatibility model and the golden oracle
- Date/author: 2026-11-07, Claude (engineering)
- Status: ACCEPTED
- Problem: sync hashes are FNV-1a over the UTF-16 code units of `JSON.stringify` output (`engine.ts` `hashFields`,
  `merge.ts` `fieldHashes`). Swift `String` cannot hold unpaired surrogates, Swift string `<` is not JS `<`, and Swift
  dictionaries do not keep JS property order (array-index keys first).
- Result: `BereanCore` models JS values exactly: `JSString` = UTF-16 code units, `JSObject` = JS property order,
  `JSON.parse`/`JSON.stringify` per ECMA-262 (well-formed stringify, `Number::toString` layout over Swift's shortest
  round-trip digits). The TypeScript code is the oracle: `scripts/golden/corpus.ts` exports seeded fixtures with the
  sha256 of every source they pin; `tests/unit/goldenCorpus.test.ts` fails when TypeScript behaviour drifts from the
  committed fixtures; `BereanConformanceTests` must reproduce 100% of them.
- Revisit: any change to `src/platform/sync/*` → re-export, rerun `npm run native:test`.

### ADR-0006 — SQLite access: system SQLite first, GRDB prototype deferred to the user store
- Date/author: 2026-11-07, Claude (engineering)
- Status: ACCEPTED for read-only corpora; GRDB prototype still required before M3 (spec §3)
- Result: `BereanSQLite` is a thin wrapper over the system `libsqlite3` (no third-party dependency): read-only
  open (`SQLITE_OPEN_READONLY`), prepared statements, bound parameters, column cache. `BereanBible` ports
  `bibleService.ts` with identical SQL. GRDB is evaluated for the mutable store (WAL, migrations, observation)
  in M3-01, with this wrapper as the fallback.
- Evidence: bible.json golden — all 20 bundled texts' books, 3 chapters per book, verses and 316 searches match the
  TypeScript service, except equal-rank ordering (F-05).

## Findings resolved from code (audit 15 A-items and M0 investigations)

### F-01 — A-4 synced entity kinds (24 vs 22)
`src/platform/sync/entities.ts` registers 24 adapters, but `SYNCED_ENTITY_KINDS` (live change capture) lists 22:
`study_profile` and `ai_saved_context` are adapters without live capture (defect D6). Audit 05's "24" and audits
08/14's "22" are both right about different sets. The native registry must carry 24 adapters and fix D6 deliberately
(owner-visible behaviour change, tracked under M4-01).

### F-02 — Octarine branch `feature/octarine-vault-integration` (`f6b1b66`, `db074d1`)
The branch is superseded by the vault integration that shipped on main; its unmatched commits put the vault sidecar
data in a hidden `.berean/` folder, whereas main writes sidecars at the vault root. Branch KEPT (also in the cleanup
bundle). Owner question: keep the shipped vault-root layout (default) or revisit the hidden-folder idea? Deleting the
branch waits for that answer.

### F-03 — `~/Berean-dev-builds` disappearance
Evidence: `mac/` and `obsolete/` vanished 2026-10-25 16:41 (the same minute `dist/Electron.app` vanished), `ios/`
vanished 2026-11-06 21:27. DiskFox was first configured 2026-10-27, so it cannot explain 10-25 but is a candidate for
11-06; CleanupBuddy (a keyboard lock) is excluded; no Claude session, launchd or cron job in the records touched the
folder. Cause not proven — no blame assigned. Mitigation: ADR-0004.

## Open owner decisions (do not treat as approved)
| ID | Decision | Authority | Status | Refer to |
|---|---|---|---|---|
| C-1 | Windows support and Electron retirement | Owner | OPEN | Audit 15 C-1 |
| C-2 | Minimum iOS/macOS versions | Owner | OPEN (trial macOS 15 / iOS 18, ADR-0003) | 15 C-2 |
| C-3 | Native Mac MAS vs Developer ID vs both | Owner | OPEN | 15 C-3 |
| C-4 | Ask Berean iPhone parity scope | Owner | OPEN | 15 C-4 |
| C-5 | Keyboard shortcut conflicts | Owner | OPEN | 15 C-5 |
| C-6 | YouTube hosted WebKit exception | Owner | OPEN | 15 C-6 |
| C-7 | Privacy wording/labels | Owner | OPEN | 15 C-7 |
| C-8 | YouTube API key provisioning | Owner | OPEN | 15 C-8 |
| C-9 | Spoken-name pronunciation tuning | Owner | OPEN | 15 C-9 |
| C-10 | Legacy lossy Markdown behavior | Owner | OPEN | 15 C-10 |
| C-11 | Sync port strategy | Owner informed by tests | OPEN | 15 C-11 |
| C-12 | Schema freeze/coexistence | Owner | OPEN | 15 C-12 |
| C-13 | Native editor architecture/limits | Owner after spike | OPEN | 15 C-13 |
| C-14 | Vault/custom sync folder scope | Owner | OPEN | 15 C-14 |
| C-15 | Mac updater approach | Owner | OPEN | 15 C-15 |
| C-16 | Floating windows/rail scope | Owner | OPEN | 15 C-16 |
| C-17 | Voices minimum-device floor | Owner | OPEN | 15 C-17 |

Use the live table in audit 15 to identify the engineering A, experimental B and external D prerequisites; group owner questions rather than blocking all engineering work.

### F-04 — Number-word search expansion drops "twenty", "sixty", "eighty"
`src/lib/numberWords.ts` (and the main-process copy) set 20/60/80 to "score"/"threescore"/"fourscore" after the
regular tens, so "twenty" is never expanded to "20" and "20" expands to "score". Reproduced exactly in Swift
(`BibleText.numberTokenAlternates`). Candidate for the owner's lossy-behaviour decision C-10 (fix in both or keep).

### F-05 — FTS result order among equal ranks depends on the SQLite version (B-15 evidence)
`searchText` orders by `rank` only. For `love` scoped to JHN+1JN, Node's SQLite 3.51.2 and macOS's 3.54.0 return the
same 65 rows but order equal-rank ties differently (verified with the raw SQL in both). Electron's better-sqlite3 has its
own SQLite build, so the desktop order is already version-dependent. Conformance tests therefore require exact order
except within equal-rank ties, where the identical row set is required and reported. PROPOSED (engineering, needs no
data change): add a deterministic tie-breaker (`ORDER BY rank, v.id`) to both implementations in one change.
