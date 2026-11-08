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

### ADR-0007 — macOS 27 target and Xcode 27 in CI (implements OD-2)
- Date/author: 2026-11-07, Claude (engineering)
- Status: ACCEPTED (CI image availability verified by the PR's own CI run — see CHANGELOG)
- Result: `apple/Config/BereanMac.xcconfig` MACOSX_DEPLOYMENT_TARGET = 27.0.
- CI evidence (PR #16): GitHub's `macos-26` image offers Xcode 26.0 … 26.6 only — no Xcode 27, so no macOS 27 SDK. The native
  job therefore selects the newest installed Xcode, always runs the BereanKit conformance tests and the iOS Simulator build, and
  builds BereanMac only when an Xcode ≥ 27 is present. Until then the Mac build (`scripts/native/build.sh mac`, Xcode 27.2 locally)
  is a required pre-merge check recorded in each PR. Revisit when GitHub ships Xcode 27 or if the owner adds a self-hosted runner.
- BereanKit's Package.swift floor stays macOS 15 / iOS 18 (pure logic; no reason to restrict).

### ADR-0008 — Deterministic search ordering contract (implements OD-4, resolves F-05)
- Date/author: 2026-11-07, Claude (engineering)
- Status: ACCEPTED
- Contract: relevance stays primary; a unique row id breaks ties.
  Scripture FTS: `ORDER BY rank, v.id` (verse row id = canonical book/chapter/verse insertion order) — bibleService.ts,
  electron/ipc/bible.ts (both copies), BereanBible. YouTube transcripts: `ORDER BY rank, s.id` (electron/ipc/youtube.ts) and
  `ORDER BY cand.rank, cand.rowid` (youtubeService.ts). Notes search (ordered by recency, not rank): `ORDER BY n.updated_at DESC, n.id`
  (notesService.ts ×2, electron/ipc/aiLookup.ts). The relevance function itself is unchanged.
- Evidence: bible.json exported on SQLite 3.51.2 (Node 24) and 3.53.4 (Node 22) is byte-identical (it differed before), and Swift on
  macOS SQLite 3.54.0 matches every one of the 316 searches exactly; the drift guard and Swift suite no longer allow tie-order
  differences. Regression tests: bibleService.contract.test.ts (equal-relevance order + SQL contract on all four FTS paths).
- User-visible effect: only the order of results that were exactly tied, now fixed instead of build-dependent.

### ADR-0009 — Native schema migrations by replaying the recorded TypeScript statements
- Date/author: 2026-11-07, Claude (engineering)
- Status: ACCEPTED
- Problem: berean.db's 48 migrations (v1–v49, v18 deliberately absent) must be identical in the native store. Hand-porting
  ~1,300 lines of SQL invites drift; migrations 1–17 also contain data-dependent JavaScript (backfills, conditional ALTERs).
- Result: `scripts/golden/schema.ts` records every statement the TypeScript runs per version on a NEW database and generates
  `BereanStore/Generated/RecordedMigrations.swift`; `Migrator` replays it. Policy:
  new library → replay all; existing library ≥ v42 → replay pending steps; existing library ≤ v41 →
  `requiresLegacyUpgrade` (open once in the current Berean, which runs the JS logic). CORRECTION 2026-11-08: the first version of this
  ADR said "≥ v18 / pure SQL"; a proper per-version scan showed v42 (and many earlier steps) contain data-dependent JavaScript or
  try/catch ALTERs. v43–v49 are replay-safe (CREATE, SQL backfill, ALTERs behind hasColumn guards that are no-ops only on re-runs). newer than supported → refuse untouched;
  `PRAGMA quick_check` failure → refuse; pre-migration backup failure → STOP (stricter than legacy, per spec §5.1); failing step →
  rolled back, previous version kept. `migrate(to:)` lets a production build freeze at the production level (v48) while
  development uses v49 (spec: keep v48 production and v49 development distinct).
- Evidence: schema.json — Swift replay equals the TypeScript sqlite_master + seeded settings + schema_version at v17, v18, v43, v47,
  v48 and v49; v48→v49 upgrade equals fresh v49; refusal and rollback tests. Connections use WAL + foreign keys like electron/db/berean.ts.
- Drift guard: tests/unit/goldenCorpus.test.ts fails if bereanMigrations.ts changes without regenerating.

## Owner decisions — 2026-11-07 (second authorization message)

### OD-1 — Vault layout (resolves F-02)
- Status: ACCEPTED (owner delegated the choice; criteria: preserve notes/metadata, vault compatibility, sync reliability, minimal migration, maintainability)
- Result: keep the shipped layout (sidecar JSON at the vault root, `Verse Notes/`, `Daily/`, `YouTube/`, `Idioms/`, `.trash/`, `.attachments/`).
  The Octarine branch's only differences from main were moving sidecars into a hidden `.berean/` folder (one-time filesystem move)
  and a one-off `scripts/migrate-to-octarine.js`; its user-facing features (wikilink path normalisation, underline, emoji highlight
  colours) are already on main. Switching would require converting every existing vault and gives no data-safety or sync benefit.
- Branch retired: tagged `archive/octarine-vault-integration` (= `db074d1`, pushed to origin), then the local branch deleted.
  Also preserved in `~/Berean-backups/cleanup-2026-11-07/berean-refs.bundle`.

### OD-2 — Deployment targets (resolves C-2 for the native apps)
- Status: ACCEPTED. Native Mac: latest stable macOS — **macOS 27** (dev machine macOS 27.2, Xcode 27.2, SDK 27.2). Use current
  SwiftUI/AppKit, materials, Liquid Glass, toolbars, window management freely; no macOS 15 support needed.
  Native iOS: iOS 18 minimum for now, latest SDK. Electron/Capacitor targets unchanged. BereanKit (pure logic) keeps a lower floor.
- Consequence: CI must build with Xcode 27 (the default `macos-latest` image ships Xcode 26.6) — see ADR-0007.
- Supersedes ADR-0003 for the Mac app.

### OD-3 — Number-word search (F-04)
- Status: ACCEPTED — keep current behaviour (compatibility). Logged as a possible future search improvement; no migration time spent.

### OD-4 — Deterministic search ordering (F-05)
- Status: ACCEPTED — implement in BOTH legacy and native: keep FTS `rank` as the primary key and add a stable tie-breaker so equal-rank
  results order identically on every SQLite build. Regression tests + golden update. See ADR-0008 for the exact contract.

### OD-5 — Synchronization continuity (completes ADR-0002)
- Status: ACCEPTED. Native apps continue Berean's existing iCloud Documents journal sync — no CloudKit, no new store, no new history.
  Development native builds use `iCloud.com.berean.app.dev`; production native builds will use the existing production identity,
  container, App Group and entitlements at the release transition.
- Authorized now: configure and test native Dev builds against `iCloud.com.berean.app.dev` once the compatibility gates pass
  (hash/journal/tombstone/merge conformance), with controlled test records, separate native dev database copies, single-instance
  database locking, distinct device ids (never shared with the Capacitor/Electron Dev installs), and backups.
- Still prohibited: production sync writes, journal-format changes, resetting sync history.

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
| C-2 | Minimum iOS/macOS versions | Owner | RESOLVED for native apps — OD-2 (macOS 27, iOS 18) | 15 C-2 |
| C-3 | Native Mac MAS vs Developer ID vs both | Owner | OPEN | 15 C-3 |
| C-4 | Ask Berean iPhone parity scope | Owner | OPEN | 15 C-4 |
| C-5 | Keyboard shortcut conflicts | Owner | OPEN | 15 C-5 |
| C-6 | YouTube hosted WebKit exception | Owner | OPEN | 15 C-6 |
| C-7 | Privacy wording/labels | Owner | OPEN | 15 C-7 |
| C-8 | YouTube API key provisioning | Owner | OPEN | 15 C-8 |
| C-9 | Spoken-name pronunciation tuning | Owner | OPEN | 15 C-9 |
| C-10 | Legacy lossy Markdown behavior | Owner | OPEN | 15 C-10 |
| C-11 | Sync port strategy | Owner informed by tests | RESOLVED — OD-5 (continue existing journal sync; Swift port verified against TS) | 15 C-11 |
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
except within equal-rank ties, where the identical row set is required and reported. RESOLVED by OD-4 / ADR-0008.
