# Berean Native Migration — Live Status

> Initialized 2026-11-07 from verified Git, CI and test evidence. Every claim here was checked in the
> session that wrote it; re-verify against live Git before relying on it after a gap.

## Current review branch — 2026-11-12

- Isolated clone: `/Users/roywe/Documents/ChatGPT/Berean/repo`, branch `native/reader-notes`, based on #23 at `670f5b6`. See HANDOFF for latest checks and merge order.
- Implemented: full native Scripture bundles, iPhone continuous chapter reader, Notes search filters on both platforms, Mac and iPhone daily-note Calendar, and iPhone Tabs / Go / More with tab reuse.
- User priority: SHARED-UX-020, reduce accumulation and improve finding unnamed workspaces and tabs on both platforms. See TASKS.
- Supplied specification read from `/Users/roywe/Documents/ChatGPT/Berean/Berean Native Migration Master Specification.docx`.

## 2026-11-13 parity batch

- Draft PR #24 includes Mac workspace tab filtering, a larger Mac verse click area, Strong’s hover glosses and search match marking, shared Hermas edition settings, and sunrise-aware Today.
- Mac runtime verified title filtering and Shift-click range selection. See HANDOFF for the targeted iPhone and settings checks still open.

## 2026-11-14 tab management

- iPhone Tabs, Workspaces, and Archived Tabs expose search on entry. Verified a mixed Scripture reference in all three, including archive and restore with the full selection preserved. See HANDOFF for remaining large-list and cross-workspace checks.

## Initial snapshot
- Updated at: 2026-11-07 18:45 PST
- Master specification: `/Users/roywe/Downloads/Berean Native Migration Master Specification.docx`
  (51,616 bytes, 2026-11-05 14:19, sha256 prefix `be647ccd4c941d69`). Text copy committed as
  `docs/native-migration/MASTER-SPECIFICATION.md` (161 paragraphs, read in full).
- Canonical repo: `/Users/roywe/Berean` (main, clean except the untracked install copy of `docs/native-migration/`)
- `origin/main` at start: `ceaaa73` (CI `success`, 2026-11-05)
- Active worktree / branch: `/Users/roywe/Berean-native` / `native/m0-execution-records` (from `ceaaa73`)
- Legacy suite on this branch: `npx vitest run` → 390 files, 5,771 tests passed (2026-11-07)
- Native Mac boot: VERIFIED — `npm run native:build:mac`, app launched, window "Berean" rendered the core view
  (record hash `c33dc73245`, identical to TypeScript `hashFields` for the same fields)
- Native iPhone: builds and launches in the iOS Simulator (iPhone 17 Pro), shows the core view and a live reference parser
- Active milestone: M2 (pure core + read-only data) — PR #15 open; M1 slice merged (PR #14, `ce37379`)
- Last accepted gate: none formally accepted (G0 evidence below; G1 pending CI)

## Current task
- Task ID: M1-01 … M1-04 (first slice) + M0-02/M0-03 records
- What exists now (verified): `apple/Berean.xcodeproj` (BereanMac, BereanIOS), `Packages/BereanKit`
  (BereanCore, BereanSync), golden exporter `scripts/golden/`, drift guard `tests/unit/goldenCorpus.test.ts`,
  CI job `native` in `.github/workflows/ci.yml`
- Acceptance commands: `npm run native:check` (swift test + both builds + identity check), `npx vitest run`

## Recently verified changes
| Date | Task | Branch / SHA / PR | Evidence | Notes |
|---|---|---|---|---|
| 2026-11-07 | M0-02 cleanup | (no code) | worktrees/branches listed below; backup bundle verified (`SHA256SUMS` 17 OK) | Group A + B removed; agent branch kept (not merged) |
| 2026-11-07 | M1-01 | native/m0-execution-records | Mac + iOS Simulator builds; Mac launch screenshot | identities `com.berean.native.mac.dev` / `.ios.dev` |
| 2026-11-07 | M1-03/04 | native/m0-execution-records | `swift test`: 23 tests (19 conformance over 5 golden files) pass; mutation checks fail as expected | |

## G2 gate — ACCEPTED 2026-11-07 (Claude, engineering gate; evidence below)
- Representative Scripture read/search on both native targets: reader (KJVA, italics/red letter, Strong's, chapter navigation,
  reference jump, FTS search) on Mac (owner-tested 2026-11-07) and iOS Simulator.
- Cross-language data contracts: goldens for references, Strong's, verse text, word replacer, Bible/lexicon/cross-reference services —
  100% on macOS (SQLite 3.54.0) and iOS Simulator (SQLite 3.51.0); deterministic search order (ADR-0008).
- No mutable user-database writes anywhere in native code (BereanSQLite opens read-only only).
- Open follow-ups (do not block M3): iOS 18 physical-device SQLite check; deep links (M6).

## G0 evidence (M0)
- Worktrees now: `/Users/roywe/Berean` (main), `/Users/roywe/Berean-ai-bench` (`eval/ai-benchmark`, removal
  pending the docs PR that archives its REPORT.md), `/Users/roywe/Berean-native`.
- Local branches: `main`, `eval/ai-benchmark`, `feature/octarine-vault-integration` (kept — superseded, see
  DECISIONS F-02), `worktree-agent-a0acb949f0128b5e6` (kept — `git branch -d` refused: not merged),
  `native/m0-execution-records`. Stashes: 2 (kept, also exported as `refs/recovery/2026-11-07/stash-*`).
- Group B unique-change check before removal: chat-rename 54/54 and quick-open 1,076/1,076 added lines present
  in main; ai-upgrade 9,733/9,851 present, remainder are later intentional rewrites (spot-checked).
- Backups kept: `~/Berean-backups/{ai-integration-2026-11-04, cleanup-2026-11-07, old-icloud-backup-2026-09-29,
  old-icloud-backup-2026-09-29-final, stabilization-2026-11-05}`, `~/Berean-userdata-backup-2026-09-22`.
  `cleanup-2026-11-07/berean-refs.bundle` holds every branch, tag and recovery ref; restore from the bundle
  alone was proven before deletion.

## Ready next actions (ordered)
1. Merge PR #13 (REPORT.md archive) and the M1 PR once CI (`check` + `native`) is green; then remove `Berean-ai-bench` (normal
   `git worktree remove` after its untracked files are confirmed archived) and `git branch -d eval/ai-benchmark`.
2. M1-02 remainder: shared schemes, `swift format lint` gate, iOS Simulator launch smoke.
3. M1-03 remainder: golden fixtures for reference parsing (`parseRef`), Strong's ids, tagged tokens, merge/conflicts.
4. M2-01: port `src/lib/parseRef.ts` + `src/lib/research/strongsId.ts` to `BereanReference` against goldens.

## Blockers / owner decisions (batched — none block the next actions)
| ID | Owner needed? | Blocks | Question | Safe work remaining |
|---|---|---|---|---|
| C-2 | Yes | release floor | Trial floor macOS 15 / iOS 18 in use (ADR-0003) — confirm or change | all M1–M4 |
| F-02 | Yes | deleting `feature/octarine-vault-integration` | Branch is superseded; keep its hidden `.berean/` sidecar idea or the shipped vault-root sidecars? | everything |
| ADR-0002 | Yes (at M4) | M4-03/M4-05 | Native Dev apps join `iCloud.com.berean.app.dev` for interop tests? | M1–M3 |
| C-1, C-3…C-17 | Yes | later milestones | See DECISIONS.md | M1–M4 |

## Safety status
- Production database accessed/written during migration development: NO
- Production sync journal accessed/written: NO
- Bundle ID / team / entitlements of production apps changed: NO (native apps use new `com.berean.native.*` dev ids,
  sandboxed, no iCloud, no App Group)
- App Store / notarization / TestFlight submission: NO
- Backups verified: YES (see G0 evidence)

## Rollback / known test exceptions
- Native work is additive (`apple/`, `Packages/`, `scripts/golden`, `scripts/native`); reverting the PR removes it.
- No known test exceptions.

## 2026-11-08 snapshot
- Native Mac:
  - sidebar, sessions and workspaces redesigned against the existing app (ADR-0010);
  - Scripture toolbar parity (history + passage picker);
  - notes export/import working;
  - verse tags working.
- Native iPhone: tab sheet, Sessions and saved workspaces (real-tap verified).
- Open PRs: #22, then #23 (see HANDOFF for merge order).

## 2026-11-17 Notes editor typography

- Both native editors render a grid for complete Markdown tables and use the Notes body font in cells. Format now includes Inline Code. Dev builds, Mac visual and editing QA, and iPhone Simulator insertion and undo/redo passed. See HANDOFF for legacy separator recovery and wide-table checks.

## 2026-11-17 current-location verification

- Both Dev targets build after search replacement and history corrections. Mac scratch QA verified Command-L replacing a filtered Search tab, Back restoring filters, Forward restoring the broad search, and pinned Compare passage replacement with Back. See the latest HANDOFF entry for exact cases and outstanding UI checks.

## 2026-11-17 Notes browse parity

- Notes offers adaptive Gallery and List on Mac and iPhone. Runtime QA covered Mac selection/search/Back and simulator card opening/return. Both apps restored Gallery and All Notes across relaunch after the local-folder persistence fix. Both Dev builds and 148 Swift tests passed. Remaining Notes checks are in the latest HANDOFF entry.

## 2026-11-17 Notes section and history verification

- Both native builds include collapsible Notes sections, selection feedback for hidden cards and the corrected gallery return anchor. Mac runtime verified repeated Back/Forward at the gallery end and persisted disclosure by grouping. Simulator verified heading taps and hidden selection counts. The latest HANDOFF lists remaining touch, custom-folder and accessibility checks.

## 2026-11-17 Notes surface and cursor checkpoint

- Mac Notes folder groups use native glass, and both platforms have larger leading-aligned row targets. Mac and simulator verified opening from blank row space. Shared cursor handling has direct Debug samples for disclosure/toolbar movement and disabled Back. See HANDOFF for remaining coverage.
- Owner requires original-quality Read Aloud voices. M05 remains open with the Kokoro/Berean Voices path.

## 2026-11-17 home return checkpoint

- Both native builds pass after the floating-action cursor hit correction and Notes editor return labels. Mac Notes home retained its lower recent-note viewport across repeated history and tab switches in runtime QA. The home viewport implementation is Mac-only. See HANDOFF for current simulator version and remaining coverage.

## 2026-11-17 iPhone home and native switch checkpoint

Both native builds pass. Mac switch movement retained the hand in live QA. iPhone recent-note return restored the lower Notes home with final-row dock clearance. Stationary enabled-state refresh is implemented but unverified; ordinary touch-scroll saving, missing-recent fallback and inactive-window hover remain open. Notes title autocomplete is the next ready editor parity gap.

## 2026-11-17 cross-type Cmd+L checkpoint

Explicit location replacement now retains the current ID/pin/order across types. Live mixed-type Back/Forward, pinned Compare, existing destinations, New Tab override and normal Cmd+K reuse passed; peer records stayed unchanged. Native builds pass and the current working-tree shared suite passed 154 tests. Empty sidebar arrow is verified. See HANDOFF for remaining routing/scroll checks and the pending editor completion checkpoint.

## 2026-11-17 native note completion checkpoint

Both apps build with note-title suggestions after [[. Mac keyboard/pointer insertion and iPhone touch insertion are runtime verified; exact Markdown storage was read-only checked. iPhone Undo/Redo boundaries passed. Mac completion may coalesce with immediately following typing; see HANDOFF. Five focused completion tests pass after the earlier full 154-test suite. N06 remains partial for book/Scripture autocomplete and broader interaction QA.

## 2026-11-17 search context and CI checkpoint

Notes/Lexicon query replacement and history refinements are implemented and live checked on Mac. Simulator verified Lexicon query/language after relaunch. Mac completion Undo/Redo separation now passes. Both apps build; optimized simulator conformance passed all 156 tests in 46 suites. The five-case legacy test implicated in CI also passes after a test-only clock fix. Remote CI remains pending a push/rerun; numeric full-title palette note lookup remains under investigation.

## 2026-11-17 Lexicon result navigation checkpoint

Both Debug app builds and 19 focused Workspace tests pass. Simulator verified deep results restoration via Search and relaunch, plus rapid Return and Clear recovery. Mac runtime, broader history coverage, the full updated simulator suite, and remote native CI remain open. See [HANDOFF](HANDOFF.md) for exact reproduction and current Git state.

### 2026-11-17 — Notes completion preview

Selected-note passage/excerpt preview is implemented on both platforms. iPhone Simulator insertion/Undo and five-row bounds passed; both Debug builds pass. Keep the goal active and continue deeper navigation, original block suggestions, remaining parity and accessibility QA from HANDOFF.

Full shared Swift Release suite now passes157 tests/46 suites; see /tmp/berean-current-shared-release-tests.log. This is a host SwiftPM run, not an updated iOS platform-SQLite run.

Final host Swift Release regression including snapshot fallback passes159 tests/47 suites. Both final app builds pass. Remote CI and optimized platform-SQLite rerun remain pending.

### 2026-11-17 — Note reference and Strong’s block suggestions

Native editors offer previews and literal block insertion for plain Scripture references and Strong’s IDs. Both Debug builds and full host SwiftPM Release (166 tests, 48 suites) pass. Simulator hardware-keyboard verification covered insertion, Undo, LXX, invalid input, formatting guards and dismissal. Mac runtime and iPhone software keyboard checks remain open. See [HANDOFF](HANDOFF.md).

## 2026-11-18 Notes and native controls

Verified iPhone contextual Scripture/daily creation, centered empty folder, nested collapsed-by-default folders and large Notes title. Mac verified unpin/repin, grouped navigation without overflow at tested width and passive-space arrow versus active-row hand after concrete window-bound cursor filtering. Both apps build;173shared Release tests pass. Original-quality Read Aloud, Compare and native character-selection fixes remain active.

### 2026-11-18 — Compare validity and selection rendering
Compare now offers only editions with real mapped chapters and provides repair controls for unavailable saved columns. Mac QA verified repair to an independent LXX chapter, close-last exit and Back/Forward restoration. Mac verse numbers sit beside text with repeated per-verse ellipses removed. Shared reader background drawing is text-only across wrapped lines; Mac native selection and saved partial highlight checked live, plus offscreen AppKit regression. Both platforms build;175 shared Release tests pass. Final tiny all-unavailable removal guard rebuild pending. iPhone selection handles/Compare, physical-device behavior, gesture tuning, tab-switch performance and original-quality Kokoro remain open.

Final Compare removal-guard rebuild passed on both Mac and iOS (/tmp/berean-compare-reader-final-{mac,ios}.log), superseding its pending note above.

### 2026-11-18 — Notes follow-up
Daily-folder month grid/marked days and direct Mac Checklist/Table actions implemented. Mac new-day creation/reuse and iPhone marked-date reuse checked; counts stable. Mac formatting Undo now preserves immediately preceding typing; Undo/Redo and later typing separation checked. Explicit iPhone large heading fixes blank reserved navigation title area. Both native targets build (final logs in HANDOFF). Kokoro synthesis, chapter gestures and measured tab switching still open.

### 2026-11-18 — Chapter pull guard
Fresh-edge intent and release hysteresis implemented for both native readers, deterministic shared-code regressions and both builds pass. iPhone Mark13→12 end and12→13 start checked. Activation from a later Mark13end viewport was not established; settled edge/dock-inset sensitivity, intermediate feedback, real trackpad and physical phone remain open.
