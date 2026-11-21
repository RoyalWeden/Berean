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

### 2026-11-18 — Read Aloud foundation
Shared Kokoro latency/alignment planner now matches48 original TypeScript oracle cases.177sharedRelease tests/51suites pass; TypeScript/scopedlint/drift guard and both native builds pass. This is preparation for M05: no native synthesis/voice loading/playback is delivered, Apple voices excluded. See HANDOFF for next pipeline/engine tasks.

### 2026-11-18 — Spoken preparation parity
Native spoken-only preparation/word alignment implemented and checked against282number/518token/36verse oracle cases. Original plain fallback corrected to return prepared speech with matching spaces/offsets.179sharedRelease tests,104originalTTS tests, both native builds, speech drift/typecheck/explicit scopedlint pass. M05 synthesis/playback stillunfinished; existing legacy iPhone native ONNX bridge located for reuse.

### 2026-11-18 — Reader follow-up
Late Mac Strong’s tooltips update in-place rather than replacing the chapter. Actual-helper regression passes (no character edits, correct repeated/fallback metadata), as do background/gesture checks and both app builds. iPhone pulls also evaluate direct travel/final release; successful211pttop pull traced, repeated zero-input simulator bottom drags remain inconclusive. Detailed Scripture viewport persistence is missing across relaunch (memory-only), now prioritized in TASKS. Native phonemizer probe builds but lacks compiled phoneme data; no new app dependency or playback claim.

### 2026-11-18 — Reading position survives relaunch
Native Scripture now persists bounded validated local per-edition viewport checkpoints. Mac QA and iPhone27 simulator both restored a deep viewport after process relaunch; Mac tab switch also checked.182 shared tests,17 original persistence tests, oracle/lint/typecheck and both builds pass. CI at747aafe0 success for both jobs; newer checkpoint commit requires its own CI. Other tab types, full history/flip matrix and physical-device timing remain open. See latest HANDOFF.


ReadAloud native research18Nov: official eSpeak resource compilation resolved; US/British raw IPA32case comparison passes Mac and iPhone simulator probe. No app dependency or audible engine shipped. iPhone final UI showed one grouped outline for Mark12:37–39; an earlier inconsistent number-tap sequence remains to reproduce.

18Nov note discovery: Mac floating search and iPhone Go now show current-query note matches despite stale cache. Actual rapid replacement and opening passed both platforms; both final builds pass. FTS/helper/schema unchanged. See HANDOFF for QA signing/container distinction and remaining matrices.


18Nov Notes polish: shared editor title wraps (1…5lines), verified full iPhone title and both-platform Return-to-body. Both builds pass. Daily identity and stored title format preserved.


18Nov speech checkpoint:184sharedtests pass, both apps build; native full Kokoro English preprocessing/phonemizer104comparisons per platform pass on Mac/iPhone simulator with original data+trace API. No native playback shipped. New owner priority is smooth Scripture scrolling, no chapter loading flash, and short-chapter pull gestures.

### 2026-11-18 — Reader gesture checkpoint
iPhone short-page pulls now use passive raw touch travel; deliberate chapter turns have explicit start/end arrival. Mac scroll checkpoints reuse one idle timer; short pages allow elasticity. Both builds and intent checks pass; simulator boundary cycle and Mac checkpoint/relaunch verified. Loading flash and physical gesture feel remain open. See HANDOFF latest checkpoint for evidence and continuation.

### 2026-11-18 — Prepared chapter-turn checkpoint
Added16chapter read-only preparation cache, shared in-flight loads, actual-neighbor prefetch, outgoing viewport capture and atomic destination rows/annotations/selection for explicit turns. Both native builds pass; Mac history/selection and iPhone short-page cycle checked. Removed iPhone empty system glass circle when chrome tucks. Other navigation paths can still show loading; global frame pacing remains open. See latest HANDOFF for scope, exact evidence and queued CI status.

### 2026-11-18 — Direct warm Scripture presentation
Cached chapters and revision-scoped annotations now render directly for warm navigation; location-scoped selection/scroll targets prevent stale state. Native view reuse captures outgoing viewport;16entry cache protects visible chapter and coalesced waiters publish before returning. Both final native builds pass; Mac34step boundary/history test, local selection/highlight refresh, phone mapped Psalm return and tab restoration checked. Cold misses/frame pacing remain open. Prior-head CI cancelled before runner assignment due hosted macOS capacity; see HANDOFF for exact evidence and next work.

### 2026-11-18 — Working tabs first on iPhone
Tab overview now opens expanded and shows current tabs before creation/cleanup/archive controls and recent duplicates. Existing actions and optional compact detent remain. Simulator existing119→G5463→119 navigation preserves viewport; nine tabs unchanged. Final iOS build passes. See HANDOFF for exact evidence, remaining large-workspace/accessibility checks and hosted CI capacity cancellation.

### 2026-11-18 — Passage preview prepares the reader
Shared previews now reuse a bounded prepared chapter with separately retained raw rows, warming both Mac palette/CmdL and iPhoneGo destinations without changing excerpts or navigation semantics. Both builds and raw LXXPsalm 3 heading→bodyverse2 UI checks pass; current-tab reuse leaves13MacQA/9phone tabs unchanged. Fast submit before preview is ready can still be cold. See HANDOFF for oracle/evidence and remaining selection/performance work.


### 2026-11-18 — Reader selection gesture checkpoint
iPhone rapid cross-verse body taps now arbitrate against native word double-tap; numbers remain controls. Native intentional word selection clears whole-verse mode while retaining handles/menu. Both apps build; final iOS marker refinement also builds and runtime rapid2–4/body,2+3/number,single-toggle,Strong's and normal scrolling pass on isolated simulator. Hardware/VoiceOver/full timing matrix remain open. See latest HANDOFF; no migration-completion claim.


### 2026-11-18 — Reader release and sidebar restoration
Both apps build after independent annotation revision reuse. Final-source simulator short-page backward/forward pulls now arrive at the correct edge after UIKit releases tracking; Mac sidebar navigation restored to its original sidebar placement and history/selection cycle checked. Pin resting at the far right verified; physical hover animation remains open. See latest HANDOFF for exact logs, synthetic cleanup and runner-capacity CI failures.

### 2026-11-18 checkpoint
Published68f70642 CI passed native+legacy. Current uncommitted reader/menu/pull/LXXbadge/Brenton body-first numbering changes are undergoing final builds/tests; see HANDOFF latest override and /tmp/berean-body-first-psalms-* logs. Earlier separately numbered title UI is superseded by user's explicit request. Generic all-tab splitting and native cursor-policy replacement remain audit/design only. No merges or production data changes.

Latest verification: full Swift suite192tests/55suites PASS; focused Psalm suite8 PASS; slow-pull harness PASS. Both final ancillary-label builds PASS (/tmp/berean-psalm-label-consistency-{mac,ios}.log). Mac/simulator reader UI checks described in HANDOFF. Scope is body-first Brenton presentation with unchanged storage IDs, plus LXXbadge/native-menu/pull refinements; generic splits/cursor replacement and notes-generated reference-link semantics audit remain open.


## 2026-11-18 — location input, native cursor ownership and iPhone verse taps

- Mac ⌘L now owns keyboard focus before its field mounts, preserves early keys/paste, selects the current destination once, and replaces the current tab across Scripture, Search, Lexicon and Notes. QA verified the original tab identity, 13-tab count and unchanged note content/update time. Explicit Shift-Return creates a tab; closing it currently selects its neighbor, not necessarily its origin.
- Removed global cursor swizzles/private toolbar hooks and forced hands. Native controls, text, links and dividers own their cursors. Source audit and builds passed; physical pointer-motion/flicker coverage remains open.
- iPhone body taps use a passive touch observer: rapid verse1/2/5 accumulation, targeted deselection, native word double-tap, 400ms taps, 900ms long-press, scroll cancellation, chapter pull and inline Strong’s were exercised in the Simulator. The new pure reader-taps harness joins CI. Physical iPhone/VoiceOver and handle dragging remain unverified.
- Added a 44pt accessible Close Study Panel control; final fresh-launch Simulator check dismissed the G2962 inspector. Restored Psalm 3 LXX, Strong’s OFF, no verse selection, 9 tabs. Both final local builds PASS: `/tmp/berean-study-close-final-mac.log` and `/tmp/berean-study-close-final-ios.log`.
- Online rendering verified again: [Brenton Psalm 3](https://biblehub.com/sep/psalms/3.htm) combines the title and first body line as verse1. [Brenton Psalm51 / LXX50](https://biblehub.com/sep/psalms/51.htm) does the same for its longer title. Preserve Septuagint chapter numbering and raw stored IDs; display/copy/accessibility numbering follows the reader. Do not reinterpret persisted links or rewrite production data.
- Next: per-edition Compare selection and whole-block dragging; generic all-tab split previews; physical cursor motion and Mac scroll/pull feel; note reference formatting/preferences; M05 Kokoro playback. These remain unfinished. Owner-only merge order #22 → #23 → draft #24 remains unchanged.


## 2026-11-18 — corpus-wide Brenton rendering and combined verse compatibility

The actual 151-Psalm corpus check found that stored LXX 115:4 contains both the cup and vows sentences, with no stored verse 5. The reader now labels that record 4–5, preserves all its words/annotation identity, resolves human-entered verse 5 to stored4, and maps KJV 116:14 to that existing record in Compare/flip. Verse6 and following keep their numbers. Labels, selected references, chapter export, partial copy and accessibility use the range. Raw persisted links, tag spans and note/highlight keys are not rewritten.

Online witnesses: [Bible Hub Psalm 3](https://biblehub.com/sep/psalms/3.htm) and [MT51/LXX50](https://biblehub.com/sep/psalms/51.htm) combine superscription and first body as verse1. [eBible Brenton115](https://ebible.org/eng-Brenton/PSA115.htm) calls the second sentence4a; [Bible Hub MT116](https://biblehub.com/sep/psalms/116.htm) separates the two sentences at13–14. Reader 4–5 is the numeric presentation of that combined record, consistent with the chosen body-first convention, rather than a claim that every online edition uses identical labels. Keep actual LXX chapter numbering; do not substitute a site's MT chapter headings.

Verification: all 195 shared tests/57 suites PASS in139.323 s from a temporary native-build source snapshot; all 120 package source/test/fixture SHA256 values were checked against the repository with zero mismatches. Log `/tmp/berean-online-brenton-final-suite.log`; manifest `/tmp/berean-online-psalter-source/source-sha256.json`. Initial corpus test correctly failed on115's gap and motivated the range fix. Direct checkout test attempts were interrupted only after diagnosing cloud-backed Git/build database waits; no caches or usage were reset.

First range builds BOTH PASS: `/tmp/berean-brenton-range-final-{mac,ios}.log`. Fresh iPhone PID32126 verified Go 115:5→115:4–5, readable gutter label, both sentences selected, verse 6 unchanged and9 tabs. Selecting6 then exposed separate outlines at the missing stored5. Final source fixes drawing/reveal grouping by actual row order while still breaking at unselected rows or real rows without layout; persistence stays unchanged. Reader tap + adjacency harness PASS with immutable inputs `/tmp/berean-final-range-selection-checks` (explicit temporary module-cache path after a sandbox cache-write failure). Final grouping builds and Mac/iPhone UI checks subsequently PASS; see verified publication checkpoint below. Reference labels also coalesce adjacent displayed ranges without changing saved raw groups.

The single4–6 outline, copy/reference labels and fixture restoration are now verified on both apps. Publish only the tested source and its checkpoint. Audit combined-record cross-reference aggregation and newly generated Markdown/link display vs raw IDs; original legacy links must keep their meaning. Generic all-tab split previews, per-edition Compare selection/whole-block drag, physical pointer/flicker, Mac scroll/pull feel and M05 playback remain open.


### Verified publication checkpoint — source `8492a161`

Both final grouping builds PASS (`/tmp/berean-brenton-group-final-mac.log`, `/tmp/berean-brenton-group-final-ios.log`). iPhone fresh PID33697 showed one outline around 4–5 + 6, correct targeted deselect/reselect and native Copy→Paste containing `Psalms 115:4-6 LXX`, range label4–5 and verse 6, without extra text/rows. Restored Psalm 3 LXX, no selection, Strong’s OFF, inspector closed,9 tabs. Mac fresh QA launch verified ⌘L115:5→115:4–5, Shift-click 6→one4–6 outline, Copy Reference→immediate ⌘L paste exactly `Psalms 115:4-6 LXX`, then restored Psalm 50:1 LXX (raw 3),13 tabs. Readonly DB confirms original tabID0456641d-da15-49d2-8620-cdf2b9d1f0bd/typeBible retained and GalleryQA07 content SHA256 AND updated_at unchanged.

Full 195 shared tests/57 suites passed; after adding corpus-version coherence assertions, the 3 focused tests passed again (`/tmp/berean-brenton-corpus-coherence-final.log`). All120 package snapshot hashes matched repo. Tap + visual-adjacency harness passed. No application code changed after final builds/UI checks. Physical iPhone/VoiceOver, physical cursor-motion/flicker, full Mac scrolling performance and combined-record cross-reference aggregation remain open.

Commits: faf8589d location focus/input;3c38eb5c native cursor ownership;819f9954 iPhone body taps/CI;59bbd436 accessible inspector close;8492a161 combined Brenton records/visual adjacency. The next docs commit records this checkpoint. Publish the complete checkpoint to **github**/native/reader-notes, existing draft24; compare remote head with local HEAD and read CI for that exact PR head. Prior74aeb6c5/CI44391471644 is historical evidence only. PR22/23/24 were rechecked OPEN,24draft/base native/m6-navigation; owner-only merge order unchanged. Do not merge or inherit old green checks.


## 2026-11-19 — Psalm openings and quiet edition metadata

Source739c5e41 implements one numbered superscription/body group in both native readers and short LXX/KJV metadata with on-demand native explanations. Both final app builds pass; actual Mac and Simulator title/group selection verified. All197 shared tests pass (4+193 in separate native test bundles);13 focused tests pass after the final Joel metadata addition. See HANDOFF for exact logs, distinct QA fixture paths, restored state and verification limits. Online witnesses/editorial conventions are recorded in ONLINE-BRENTON.md. No merge or production writes. Native cross-reference source numbering is the next confirmed correctness issue; Compare selection/dragging and the broader migration remain unfinished.


## 2026-11-19 — native references, toolbar responsiveness and Strong’s continuity

- 42d34bbe: additive native cross-reference APIs map verified stored LXX rows to canonical sources; correct chapter grouping and combined-record aggregation. Legacy service entry points/goldens remain intact. Classic/TSKe selected and chapter UI checked on both apps; structural unverified alignments remain open.
- fce2b88e: native navigation ControlGroup replaces fixed-size HStack; measured Mac toolbar CPU loop resolved while retaining sidebar titlebar placement. Baseline99.5% CPU/AX20–40s → idle0–3.3%/AX0.1–0.4s. This supersedes prior automation-latency diagnosis; broader physical interaction checks remain.
- 3bbecdea: native readers retain the visible body line when Strong’s toggles, preferring a visible selected verse and excluding inline metadata from anchor offsets. Mac selected/unselected and iPhone mid-chapter on/off verified; physical phone and full edge/width matrix pending.
- Validation: full202 shared tests; final6 focused cross-reference checks include all151 Psalms source bounds. Fresh reader intent/reflow harness passes Unicode/metadata mapping and prior tap/adjacency checks. Both final native builds pass. See current HANDOFF for exact logs, QA restoration and remaining tasks; source corpus/production/sync/identities unchanged.


## 2026-11-19 — Compare selection and floating actions (d6f7cced)

Each edition now owns its selectable verse numbers and action target. Additive taps/Mac Shift use actual stored row order; selection itself does not change the anchor passage or history. Adjacent visible selected rows share one faint/dashed outline; stacked interleaved editions remain outside each other’s outlines. Reduced Motion pauses animation. The adaptive glass action bar reuses reader control styling and supports copy/highlight/tag/note/reference/reader/share/clear operations. iPhone dock safe-area clearance was verified after an initial hidden-bar failure. Mac Command-C was verified after fixing a focus-routing failure. Clearing and exiting Compare does not restore an old selection. Shared title rendering uses the Scripture font and folds source title newlines.

Both local Dev builds and the expanded native reader harness pass. Mac LXX50/KJV51 copy and action destinations, Mac Shift group/Escape, and iPhone stacked selection/copy feedback/reader transfer/final dock gap/clear-exit passed. See HANDOFF for exact logs and QA restoration. No note contents/timestamps changed;4 Mac/9 iPhone tabs preserved. Prior baselinecce95bf0 CI44493859591 is green, including203 shared tests; this is not evidence for the new source’s pending CI.

Remaining before full Compare parity: view-state retention across tabs/relaunch, independent/pinned/cross-chapter/duplicate/4-column/width/accessibility matrix, actual mutation-and-undo action checks, native word-copy precedence, body-tap selection, selected-line reveal, and whole-block drag previews/grab-anywhere. Generic arbitrary-tab splitting and Kokoro playback remain separate open work.


## 2026-11-19 — Compare tab return and explicit location intent (3090db5c)

A bounded local snapshot per open tab now restores the selected Compare column/edition/chapter, selected stored rows, focus and original Shift anchor across tab switches. Close/explicit Compare arrival clear the cache. It is observation-ignored memory, with no new persisted/synced fields; restart retention remains open. Incoming explicit references override old local selection, including same-chapter and repeated identical commands. A fresh jump revision also restores the requested scroll position. Ordinary Go deduplication still uses the original one-argument isShown match, which excludes Compare.

Final Mac/iOS builds pass (`/tmp/berean-compare-intent-complete-{mac,ios}.log`), and expanded native harness passes retained-anchor and unavailable-row cases. Mac UI verified LXXGenesis12 → Notes → return retaining selection; new/repeated Go to KJVGenesis11 replaces it, and repeat Go moves from near-end offset back to verse11. iPhone verified KJVPsalm3v1 → existing G5463 → return retaining that edition/selection.4 Mac/9 iPhone tabs preserved; original QA passages restored and all7 Mac QA note contents/timestamps unchanged. Earlier repeated-command failure and intermediate method-reference compile errors were corrected, not counted as passes. Full independent/pinned/history/restart/4-column/accessibility coverage, native word-copy precedence and whole-block dragging remain open.


## 2026-11-19 — Compare passage lift and selection-preserving reorder (7d365304)

Mac Compare now offers native dragging from headers and verse-cell whitespace, plus the independent-pane surface. The source fades while lifted; valid destinations receive a subtle wash. The native rounded glass preview contains a readable passage excerpt beginning at the recorded reading anchor (up to18 rows), with edition/font/Strong’s/highlights. It is a reconstructed excerpt, not a pixel-identical full-column snapshot. Native drag-session lifecycle clears the source on completion/cancellation; payload validation remains scoped to this view and current column destinations. Reordering remaps the selected column’s local snapshot and scroll caches to the new index. Removing the selected column clears that snapshot; opening the selected surviving column transfers its selection to Reader. No new persisted fields/schema/sync behavior.

Verified on the final Mac implementation: aligned Genesis1 KJVA/LXX reordered in both directions, selected KJV1 remained with KJV, mid-chapter scroll bar stayed exactly0.3813155386081983 after reorder, and Escape cancellation restored full source opacity without moving columns. Native double-click/Command-C → Go paste returned a word (`And`) rather than the whole selected verse. Earlier native text-range drag/copy also worked, but that range check preceded the final Transferable lifecycle change and should be repeated. Mac build `/tmp/berean-compare-column-lift-lifecycle-mac.log` PASS; iOS active source build `/tmp/berean-compare-column-lift-final-ios.log` PASS (later lifecycle edits are Mac-only). Final QA: original Untitled note selected; readerGenesis1:1KJVA selected1/Strong’sOFF/CompareOFF;4 tabs; all7 note content SHA256 and updated_at values unchanged. Default column order restored. Pin/follow test metadata was restored; the explicit default column records remain stored after the successful reorder, using existing legacy format.

Important verification correction: CUA drag() returned while the native drag session was still active. A final click at the destination completed the actual drop; Escape cancelled it. The earlier apparently stuck drag is not a confirmed app failure. App screenshots showed source fade and target wash but omitted the system-owned floating drag image, so preview pixels/physical drag feel remain unverified. Attempts in pinned independent layout did not demonstrate a successful drop and once opened the passage picker; no independent drag pass is claimed. Full pinned/independent/4-column/duplicate/narrow/VoiceOver/hardware matrix and remaining selected-column removal/action mutation-and-undo checks remain open. Generic arbitrary-tab split previews are still only planned in TAB-SPLIT-DESIGN.md.

Published ec27ff5f CI44500763894 completed SUCCESS for both jobs: legacy checks/build/launch and native conformance/reader harness/iOS simulator build; hosted Mac build skipped for absentSDK27, localSDK27.2 passed. This green result predates7d365304 and must not be inherited for its new CI. Owner-only #22→#23→draft#24 merge guard unchanged. Strong’s visible-word continuity from3bbecdea remains implemented and runtime-checked on Mac and Simulator; physical edge/width/long-verse matrix remains open.


## 2026-11-19 — Compare Strong’s reflow continuity (f0b8752e)

Compare’s aligned/stacked shared scroll previously retained a pixel offset through Strong’s reflow. Native Compare now captures the visible verse before reflow and restores that row after layout; aligned view prefers the selected focus only when it was visible, otherwise the first visible row. The chapter-start guard avoids replacing the shared view’s top position. Independent panes each retain their visible verse, while stacked independent passages use the first visible column/verse target. This is verse-level continuity; the main native reader separately retains a more precise body-word/line anchor. No persisted/synced fields were added. Deferred restoration checks Compare mode, current tab/passage, current Strong’s state and the captured explicit-jump revision so a newer location command wins.

Mac QA: aligned Genesis1 KJVA/LXX scrolled to verse8 (scrollbar0.3813155386081983), Strong’sON retained verse8 as the first visible row instead of following the previous pixel offset. Selecting visibleKJV11 then Strong’sOFF made verse11 first visible with selection retained (the earlier selectedKJV1 also remained in the nonconsecutive selection, as expected). These runtime checks used `/tmp/berean-compare-strongs-continuity-mac.log` build; subsequent navigation guards compile in final `/tmp/berean-compare-strongs-guarded-{mac,ios}.log`, both PASS. Final guarded race behavior, independent/stacked/native iPhone runtime, long rows/rapid toggles/narrow widths/hardware remain unverified. Current Mac process is the pre-guard runtime; the on-disk Dev bundle is the final guarded build for the next launch.

Pinned-drag investigation: removing nested drag modifiers compiled but did not demonstrate a successful pinned drop through CUA. The experiment was fully reverted; no drag-handler simplification is retained or claimed as a fix. Pinned native drag remains open. Published7d365304 passage-preview/reorder behavior remains intact. CUA tests restored KJVGenesis1:1 selected1/CompareOFF/Strong’sOFF and original Untitled note active. All7 QA content hashes and timestamps unchanged;4 tabs retained. iPhone runtime unchanged (9tabs), physical phone and production untouched. CUA completion summary emitted. CI44504274656 for previous published614e26d0 was in_progress when checked; recheck it and the new pushed-head run, do not inherit earlier green results. Owner-only #22→#23→draft#24 guard unchanged; goal active.


## 2026-11-19 — Source-preserving table formatting and compact note actions

**347cf74a** adds BereanNotes.NoteInlineFormat and routes the existing shared noteFormatEdit adapter through it, so Mac shortcuts and iPhone inline commands use the same edit. Confirmed table rows are formatted within selected cell text; pipes, alignment rules, padding, escaped pipes and line endings stay outside the mark. Mixed cells become uniformly formatted and the selected source region survives for a second toggle; one edit supports native undo. Whole-row, cross-cell, multiple-table and prose/table selections are supported, and separator-only/empty-cell structural selections do not create malformed rows. Existing code, links, images and other marks keep their own source/rendering while surrounding plain segments are formatted. This preserves those constructs; it does not implement arbitrary nested marks inside them. Negative/out-of-bounds ranges are rejected. Normal prose typing/wrapping keeps its existing path. No note migration, automatic repair, database/schema/sync changes.

Nine focused Swift tests PASS `/tmp/berean-table-format-tests.log`; full actual-repo package suite PASS **212 tests** (4 core plus208 conformance/60 suites), `/tmp/berean-note-table-full-suite.log`, conformance128.785s. Initial manifest build could not write the default module cache; explicit temporary cache paths plus --disable-sandbox allowed the real source to compile. A stronger readable-text invariant then exposed literal underline tags around code; protected inline runs fixed this and the final9 tests pass. Cases cover exact table round trips, mixed marks, partial cells, CRLF/multiple tables, Unicode/RTL, escaped pipes/code, link destinations and invalid selections. No golden JSON changed. Both native builds PASS `/tmp/berean-note-table-format-{mac,ios}.log`.

Mac --qa-library UI: created synthetic note5d336e95-9848-49a6-b96b-d9e3e015676d, pasted Topic/Verse table, selected all and Command-B. Read-only DB confirmed exact per-cell bold Markdown with the alignment rule untouched; screenshot retained a grid, not exposed delimiters. Undo restored the exact original table, Redo restored bold, a second whole-selection Command-B removed it. Synthetic note moved to recoverable Trash through UI. Original note d29d2127-6b3c-46ad-ab56-deabf74061ab restored in original note tab ba9073bf-c44d-40c4-bee5-de08d805dddd; all7 original hashes/updated_at unchanged, workspace still4 tabs. QA settings explicitly contain notesFontFamily=mono, explaining the monospaced QA screenshot; default remains System and no preference was overwritten. AX text includes Markdown generated from attributed font runs, so do not infer the saved source solely from its added asterisks.

**04079bdf** reduces the fixed iPhone long-press preview from360 to240points and groups Share/Print/Export into one Share submenu (same grouped actions on Mac). Previous simulator context menu clipped Move to Trash below the screen; rebuilt iPhone screenshot shows the complete primary menu including Trash, and Trash was successfully invoked. Final both-platform builds PASS `/tmp/berean-note-menu-compact-{mac,ios}.log`. Long titles/Dynamic Type/landscape/physical devices and Mac context-menu interaction remain open; the preview still has a fixed cap, not content-derived sizing.

Simulator D0CC2F4C-AC47-4648-AC5C-0DC128CFCE7D dev build PID26804. Native Topic/Verse table grid rendered after clipboard transfer, but hardware-keyboard Select All/type/paste through Device Hub changed text unexpectedly; **iPhone formatting/undo is not passed**. No app root cause was established. CUA connection expired during a TextEdit discovery call; reconnected via getState, no usage reset. Known fixture was copied through an unsaved TextEdit document, then saved only to `/private/tmp/berean-table-clipboard-qa.rtf`; no user document changed. Device Hub Edit→Send Clipboard helped transfer the fixture; capture-keyboard and asynchronous remote UI remain unreliable. A multiline Mac Go staging attempt executed a temporary Search tab; that tab was closed immediately and original4-tab state restored. Always obtain a separate settled screenshot for remote sheets: first animation frames had different card positions; dismiss note editing before tapping the dock. Do not label those input failures as confirmed app regressions.

Synthetic simulator note0df6fe56-4c60-4f8a-82b2-2b1fd32ee0cc is in recoverable Trash. All17 original note hashes/updated_at unchanged; active notes17; all47 original active tab identities retained, current Study workspace9tabs. Restored Psalm3LXX unselected/Strong’sOFF/inspectorclosed, Capture KeyboardOFF. Baselines `/tmp/berean-table-format-ios-{note,tab}-baseline.json`. Reinstall changes the simulator data-container UUID: latest962896DE-DD49-4222-BFC8-01BD2867BE7F (rediscover with simctl get_app_container next time). Final Mac baseline7 unchanged/active7, synthetic test only in Trash. All CUA parts complete/summaries emitted. Other Dev process/production/physical phone untouched.

Published e55cd3c4 CI44505678015 completed SUCCESS while this work ran;614e26d0 run44504274656 was cancelled by workflow concurrency, not a failing test. New source needs its own pushed-head checks. Draft24 remains owner-merge-only, #22→#23→#24, no retarget/merge. Remaining Notes work: reliable iPhone full-table formatting/undo, colored multi-cell highlight behavior (separate old adapter), nested/mixed rich marks, responsive/multiline tables, font/accessibility/toolbar polish. Compare pinned dragging and guarded Strong’s independent/stacked/runtime matrix remain open; general tab-to-page splits and Kokoro playback remain unfinished. Goal active.


## 2026-11-19 — Shared multi-cell/multiline note highlights (8adef50b)

Both native note adapters now use BereanNotes.NoteInlineFormat.highlightEdit for Default/color/Remove Highlight. The old line-only wrapper and separate removal regex are replaced by one source edit. Confirmed table cells and each paragraph receive their own marks; table pipes, alignment rules, line endings, heading/list/quote prefixes and code/link/other inline constructs are preserved. Existing code/links/other marks remain protected, not newly combined with the chosen color; arbitrary nested rich marks remain open. Applying a color is idempotent, mixed colors recolor without nested wrappers, default yellow toggles across eligible text, and explicit Remove handles many cells/paragraphs at once. Partial recolor/removal splits existing runs, retains outside colors/visible words and maps the selected body offsets. Removing at a caret inside a mark clears that run; caret attempts inside code/links/other marks do nothing. Invalid ranges and malformed color identifiers are rejected. No saved-note migration, automatic repair or schema/sync changes.

An escaped-pipe regression initially failed the readable-text invariant: treating its hidden backslash as unrelated markup split it from the pipe and could create a column. Fixed by keeping the escape atom together, including partial boundary selections. The same boundary correction applies to ordinary inline table formatting. Final20 focused tests (10inline+10highlight) PASS `/tmp/berean-note-highlight-tests.log`; includes table/paragraph round trips, partial recolor, mixed colors, idempotence, Unicode/RTL, CRLF, structural prefixes, code/link preservation, invalid ranges and escaped-pipe partial selections. Full actual-repo package suite PASS **223 tests** (4core +219conformance/61suites), `/tmp/berean-note-highlight-full-suite.log`,140.220s. No golden JSON changed. Both actual-repo Dev builds PASS `/tmp/berean-note-highlight-{mac,ios}.log`.

Mac --qa-library runtime: synthetic notef7424120-da38-4748-bf09-c97c70aea366 (`QA multi-cell highlight 2026-11-19`) had a Topic/Verse table and two following paragraphs. SelectAll→Format→Highlight→Blue applied6 marks while keeping the grid/rule; one Undo restored the original text and Redo restored blue. Green recolored all6 without nesting (read-only DB confirmed exact complete markup despite transient stale AX Value). Remove Highlight restored and persisted the **exact original table/prose source**; screenshot showed the retained grid. Idempotence/partial/escape/other-marker cases are pure-test evidence, not full UI passes. CUA twice reported a changed app state; refreshed AX and observed before retrying, no source/identity changes inferred. Synthetic note recoverably trashed; original d29d2127 note restored in ba9073bf tab. All7 original note SHA256 and updated_at values unchanged;4workspace tabs. CUA part complete/summary emitted. Other Dev process and production untouched.

No iPhone runtime claimed for8adef50b; simulator remains on the prior compact-menu buildPID26804 with Psalm3LXX/9workspace tabs, Capture KeyboardOFF. Its previous remote keyboard reliability problem remains unresolved. Check the new color commands through actual touch after a verified input path; physical devices, partial selection/native undo matrix, arbitrary nested styles and responsive multiline table layout remain open. Published prior6f080f02 CI44552525386 was still in_progress at the last check. New pushed head requires its own CI; do not inherit e55green. Owner-only #22→#23→draft#24 merge guard unchanged, goal active.


## 2026-11-19 — Combined note styles, bounded parsing and visible-only backgrounds

**09eb7d84** uses Foundation Markdown source-position attributes for strong/emphasis ranges in the original UTF-16 storage. It handles shared/partial delimiter boundaries (`***word***`, `***word** rest*`, `**rest *word***`), while Berean keeps underline/highlight/wiki/image syntax and raw link destinations. Extended outer marks may enclose parsed code/links/other styles without reusing their delimiters; literal code remains literal. A legacy fallback preserves the native writer’s punctuation-only marks such as `A**\|**B`, which strict CommonMark leaves literal. No serialization or saved content is changed by rendering. Design source: [Apple Markdown source positions](https://developer.apple.com/documentation/foundation/attributescopes/foundationattributes/markdownsourceposition). Installed SDK interfaces and `/tmp/berean-markdown-source-position-probe.swift` confirmed exact source ranges for emoji/combining/Hebrew, code and links.

Parsing-only release benchmark, 100-line mixed note parsed100times: old0.157235s; initial uncached implementation0.719633s; bounded cached implementation0.156760s (160000spans versus old150000). These are local synthetic parser measurements, not whole-editor typing latency. Cache is process-only, lock-protected, at most512bodies/65536UTF16 units, bypasses individual bodies>4096units and reapplies local offsets for each block. No disk/settings/sync state. Concurrent-note and body-reuse/offset tests pass. Benchmark sources/executables under `/tmp/berean-note-combined-benchmark-{old,new}`; final `/tmp/berean-note-combined-benchmark-cached.log`.

The initial6 new renderer tests failed31 assertions, demonstrating the gap. The first implementation then failed a partial escaped-pipe compatibility invariant; preserving the native punctuation-mark fallback fixed it. Another test fixture put an unescaped wiki-alias pipe into a GFM table, making its body column count invalid; corrected that fixture by testing the alias in a separate paragraph. **Do not count that invalid fixture as an app regression.** Separately queue actual legacy GFM escaped-alias metadata normalization: serializer escapes table-cell pipes and the native wiki regex may retain the escape in the target. Verify actual exported fixtures and literal-backslash titles before changing identity resolution.

Partial highlight recolor/removal through nested code/link/other style syntax could insert tags inside literal markup. Guarded those edits: a complete visible highlighted run includes its hidden delimiters and can be cleared safely; unsupported partial protected runs remain unchanged. This is not arbitrary nested rich-mark editing parity. Ordinary partial plain-highlight edits remain supported.9new combined-style/cache/safety tests; final46 focused tests/5suites PASS `/tmp/berean-note-combined-tests.log`. Full actual-repo package suite PASS **232 tests** (4core +228conformance/62suites), `/tmp/berean-note-combined-full-suite.log`,110.292s. No golden JSON changed. Both actual-repo builds PASS `/tmp/berean-note-combined-{mac,ios}.log`.

**6555fd0e** removes background-color attributes from hidden markup/destinations/table padding after styling on both native editors. Null glyphs still contributed to TextKit background geometry: real Mac fixture had a full-width blue empty strip above highlighted bold/italic text. Same saved note after rebuild paints blue behind visible words only. Final both-platform builds PASS `/tmp/berean-note-visible-background-{mac,ios}.log`. No font preference or note content rewritten. Mac QA still explicitly uses Monospace; default remains System.

Mac --qa-library fixture31e7ffac-63f1-4329-8f4d-1453c9ecf818 (`QA combined styles 2026-11-19`): screenshot shows bold+italic, trailing partial emphasis, bold+underline, highlighted bold+italic, styled link, literal code with outer bold and a retained formatted table. AX exposes the Styled link destination example.com; no external link opened. Selected first phrase→Copy as Plain Text→Go paste gave exactly `Bold and italic together`, no markers; Escape without executing. Command-B twice over that phrase removed/restored bold within italic; read-only DB confirms the entire exact original synthetic source after round trip. Background strip disappeared on the same saved source after6555 rebuild. Synthetic note recoverably trashed; original d29d2127 note in ba9073bf tab restored, workspace4tabs. All7 original note SHA/updated_at unchanged. CUA complete/summary emitted. iPhone new-source runtime not exercised; still priorPID26804/compact-menu build with Psalm3LXX/9workspace tabs and Capture KeyboardOFF. Physical/VoiceOver/large-note/editor-latency/cross-device rendering and arbitrary nested editing remain open.

Prior published9eef1630 CI44554790507 completed SUCCESS;6f080f02 run44552525386 cancelled by workflow concurrency. New source needs its own exact-head CI. Owner-only #22→#23→draft#24 merge guard unchanged, production/sync/schema/identities untouched, goal active.

## 2026-11-19 — iPhone formatting target survives Undo/Redo

All iPhone programmatic note formatting uses the existing literal-source undo path with validated text/selection bounds. This fixes Redo collapsing selection and a subsequent format button inserting empty marks at the caret. Real simulator touch Bold→Undo→Redo→Bold and Highlight→Undo→Redo→Highlight restore the exact whole original table fixture; selected Prayer retains visible handles. iOS build passes (`/tmp/berean-note-selection-undo-ios.log`). Original17 notes unchanged,47active tabs retained, synthetic notes recoverably trashed. Mac/package unchanged; previous232tests/Mac build are baseline, not fresh checks. Broader multi-cell/combined-style/color/typing/IME/accessibility parity remains open. See HANDOFF for IDs and clipboard method.

## 2026-11-19 — Combined formatting of visible note text

Shared native formatting now adds styles to existing styled text and toggles exact marked runs independently, including bold+italic shared boundaries. It verifies plain text and prior style coverage before accepting the source edit. Mac and iPhone actual UI passed a selected table word through Bold→Italic, independent Bold removal, Undo and independent Italic removal; exact saved source confirmed.236tests and both SDK27.2 builds pass (HANDOFF has logs). Partial removal inside a larger mark, whole-table combined editing and broader rich-editor parity remain open. Table wiki-link normalization is deferred because actual legacy serialization proves an identity collision; see NOTE-TABLE-LINK-COMPATIBILITY.md.

## 2026-11-19 — Remove note styles from part of a passage

Native Notes now removes a style only from selected visible text while retaining surrounding formatting, including nested emphasis. Global visible-character/semantic validation protects neighbouring styles and link/code identities. Mac and iPhone live checks passed sequential Bold/Italic removal from Bravo inside a formatted table phrase, plus exact Undo/Redo and selection retention.240tests and both final SDK27.2 builds pass; HANDOFF contains logs, initial failures and cleanup evidence. Whole-cell/table mixed hidden-syntax edits and broader rich-editor parity remain open.

## 2026-11-19 — Generic tab-split model groundwork

Added process-local pane-tree edits/geometry, atomic layout undo and scoped/versioned tab-drag payload validation.8focused tests include484ordered tab-family/edge cases. Full248tests and both SDK27.2 builds pass (`/tmp/berean-pane-layout-*` logs). No split UI, drag target/type, app command routing or persistence is enabled; TAB-SPLIT-DESIGN.md specifies the next extraction and remaining gates. Separately, actual Mac Compare independent KJV10/LXX5 reading positions survived Strong’sON/OFF; exact intra-row position and broader matrices remain open. Original notes unchanged; HANDOFF has precise evidence.

## 2026-11-19 — Explicit Mac tab content host

MacRootView now delegates its current single document to MacTabContentHost(tabID:), preserving identity/toolbar/inspector behavior and handling a stale tab explicitly. Mac build and real Scripture/Notes/Calendar/History/Tags/Lexicon/Search checks pass; exact37original tabs and7original notes preserved. Shared248tests/iOS model-build baseline unchanged. Background-pane command/focus/toolbar/editor coordination and actual drag previews/splits remain unfinished; see TAB-SPLIT-DESIGN/HANDOFF.

## 2026-11-19 — Pane selection and compact command-scope model

Added focused-document replacement, visible-tab reuse, scoped/stale command-target checks and compact focused projection retaining the full split tree.13focused model tests pass (including484family/edge cases); full253tests and both SDK27.2 builds pass (`/tmp/berean-pane-focus-*` logs). Minimums now key on TAB ID so replacements use their own document constraints. AppModel command routing, pane environment, compact picker and visible splits remain unimplemented; this is model groundwork only. HANDOFF/TAB-SPLIT-DESIGN record the exact next bridge and validation.

## 2026-11-19 — Reader annotation workflow

Calmer reader annotations implemented and live-checked on Mac/iPhone: neutral verse study dots, chapter-tag count, Tags/Chapter Tags/Notes sections; Compare tag rows removed. Both builds pass; no package changes since253-test checkpoint. Personal-note citation markers and accessibility/width matrices remain open. See READER-ANNOTATION-DESIGN.md and HANDOFF.

## 2026-11-19 — Personal references and follow-up queue

Unified personal references now implemented: ordinary-note verse index, one margin marker, Related Passages→My Notes scoped routing, chapter study entry and Compare reference-only markers.254tests and both builds pass; Mac/iPhone UI routes verified. Current shared Mac QA is used concurrently; preserve newer note/tab changes and isolate subsequent tests. New user queue: FOLLOWUP-2026-11-19.md.

## 2026-11-19 — Automation QA isolation

Debug-only named QA library/preferences now implemented; regular behavior/identities unchanged. Live named-suite writes and parser safety checked; full255tests/both builds pass. Use only the separate app path/profile in QA-PROFILES.md; preserve concurrent shared-QA user edits. Notes controls/viewport follow-up is validated in the worktree.

## 2026-11-19 — Study controls and viewport lifecycle

Notes search-inline options, flat menu and Notes-first hierarchy implemented; key study/filter/ellipsis/compact Lexicon controls gain hover feedback. Mac zero-size restoration bug fixed and exact Notes/Search tab return verified. Release eager saves removed, but physical trackpad feel unverified. Final255tests/both builds and Mac/iPhone checks pass. Remaining full user queue in FOLLOWUP-2026-11-19.md.

### 2026-11-19 Notes preview/table follow-up

Study-note rows now use semantic readable previews (iPhone wiki-bracket regression verified). Both editors publish retained-selection table context; Table menu adapts between insertion and row/column/delete operations. Mac contextual insertion, original-source undo and prose reset verified; iPhone context interactions/full Markdown edge cases remain open. Both builds pass. See HANDOFF dated entry for logs, disposable fixture cleanup and unchanged original note/tab/tag invariants. Remaining share/version/RTL/match/auto-reference audits are not marked complete.

### 2026-11-19 sharing, BDB and navigation increment

Mac Notes sharing now uses a stable native toolbar anchor (repeated open/cancel verified); ordinary editor/list/bulk note sharing uses readable text, explicit Markdown copy/export retained. Version history spacing/preview polished (Mac preview verified). Native BDB selectable prose uses an explicit English paragraph base; Mac mixed Hebrew/English logical copy and iPhone word handles verified. Search substring marks and Lexicon bold+faint match backgrounds verified. Found/fixed iPhone New Tab sheet intent loss: explicit H1 created a separate tab, ordinary Go reused G5463; cleanup restored exact47IDs. Final builds pass; detailed limits/paths in HANDOFF and SHARING-AUDIT.md. New Compare→Reader viewport shift is OPEN; no all-scroll/no-Markdown/all-share/all-parity completion claim.

Final validation for this increment:255tests (4core Swift Testing+251conformance/64suites),127.356s conformance, PASS; bothSDK27.2 builds PASS. Source commits d143a8b4,2db51379,3022880e. Published preceding0c78c205 CI44633851335 succeeded; recheck new head after push.

### 2026-11-19 reader layout and reference tracking

8f680362 fixes repeated Compare→Reader width-reflow shifts by retaining the immediate restoration intent through initial layout changes, yielding to input. Final no-trace UI roundtrips retain0.5418427726120034; physical smoothness/full races still open.03697661 restores original Strong’s detection preference on both apps; Mac explicit-link independence and iPhone OFF persistence/ON restoration verified. c8fbfe2e removes canonical-name/80-result loss of ordinary-note citations; real Jn3:17 MyNotes UI and90+note/edit/Trash/restore tests pass. Full256tests/both builds pass, original13/17notes/38/47IDs/tags unchanged. HANDOFF and NOTES-REFERENCE-PARITY.md provide precise remaining matrices; broader goal remains active.

## 2026-11-19 — Personal lexicon Notes and simpler iPhone commands

Implemented shared Lexicon My Notes backlinks using normalized bare IDs and actual lexicon destinations, preserving note-title wiki identities and excluding code/images/comments/unrelated URLs. Ephemeral off-main, revision-aware index has no result cap or schema change. Mac normalized/explicit-link/edit invalidation and iPhone existing-note/open/top-Back return verified. iPhone More now groups reading/chapter/tab/study commands with Settings directly reachable; tab previews use readable excerpts. Full 258 tests and both return-fix builds passed; final disclosure polish build logs and full evidence/limits are in HANDOFF. Physical scroll/hover, compact/history/performance/reference grammar, rich tables/all sharing/live panes/Kokoro remain open. Production data/identities untouched; review guard and active goal unchanged.

## 2026-11-19 — Search/study/Compare/window follow-through

Seven focused source commits now deliver the Mac chapter share anchor (actual open/cancel twice), aligned inline search controls and grouped Options (Exact phrase/reset checked), grouped Notes inspector with compact desktop chapter scope, searchable Shortcuts (action/modifier/no-results/clear checked), iPhone Compare body selection (LXX/KJVA/number-clear checked), persistent window inspector with settled native width retention and explicit sidebar240/panel320/window1000 minimums, and local cursor-region yielding at native dividers. Both apps build; latest Mac-only limits/cursor builds pass. Physical cursor/drag/first constrained Compare reflow/all-tab history/toolbar matrices remain open. See latest HANDOFF for exact evidence, failed width experiments, source commits and safe NEW controls QA profile. All16 fresh Mac notes/37IDs and17 iPhone notes/47IDs/tags unchanged. Do not restore the now-stale prior study QA baseline.

## 2026-11-19 — Native Compare lift and divider follow-through

5658bcfe adds narrow stable divider cursor ownership with native glass-underlay geometry; standalone AppKit geometry fixtures pass.6c351503 snapshots rendered Compare columns into native offset-preserving move sessions; actual independent reorder/cancel/passage-click/verse-actions checks pass. Both app builds pass. Sustained key-window cursor hover/right resize,2x and remaining Compare modes remain unverified. No full package rerun; previous258 baseline retained. Full checkpoint/limits in HANDOFF and NATIVE-COMPARE-DRAG.md; migration remains active.

## 2026-11-19 — Repeated Compare drag correctness

Source bbca520f fixes stale recognizer source identity after reorder, finishes the native gesture lifetime and masks stacked drag images to the actual source fragments. Real aligned/pinned consecutive moves, invalid-drop recovery, rendered Strong’s link and temporary three-column stacked reorder/return verified; both builds pass. Temporary column removed and reading states restored;16notes/37IDs/alltags unchanged. Blue verse-control image fidelity,2x/selected/text-selection/4column/race/physical cursor matrices remain open. Exact evidence in HANDOFF/NATIVE-COMPARE-DRAG.md. Previous718d9e2e CI44665586360 is green; new head’s checks are separate.

## 2026-11-19 — Table-safe Notes and minimal iPhone keyboard controls

713bd02e protects real note tables from paragraph/list/callout/nested-table edits and disables corresponding native controls.1b9a4074 groups the iPhone accessory into6prose/5table controls, keeps formatting in a native menu, provides contextual table operations/live cell navigation, direct keyboard dismissal, Undo/Redo availability and haptics preference support. Both final builds and265tests pass. Actual Mac shortcut/table/prose/Undo and iPhone row/column/format/Undo/Redo/navigation/heading checks passed. Original16Mac/17iPhone notes,37/47IDs/tags unchanged; disposable notes trashed/tabs closed. See HANDOFF/NOTES-KEYBOARD-AND-TABLES.md for exact scopes and open device/rich-edit matrices. d6422697 adds opt-in raw Compare diagnostics; direct pixels supersede the earlier missing-number preview interpretation. Latest owner marker/hover/replacer/auto-block requests remain OPEN in FOLLOWUP.

## 2026-11-19 — Study markers and automatic dictionary blocks

Native study/Notes checkpoint567b9861/52516683/66d37947: automatic dictionary cards on both editors, table-safe expansion, fixed LXX Psalm note expansion, clearer study markers/chapter icon, filter hover ownership and searchable Settings rule browser. Full274tests/both builds pass; actual Mac and simulator checks/cleanup in HANDOFF. Canonical Scripture cards, full custom/per-rule replacement and physical hover remain open.

## 2026-11-19 — Aligned cited-passage previews

Source1f4e7361 corrects marker preview alignment/content and chapter symbol semantics. Final both builds and actual Mac preview/scroll/routing checks pass; all existing test-library notes/IDs/tags preserved. Previous de4c37f4 exact CI44678258734 SUCCESS both jobs. Physical hover remains open; see HANDOFF/STUDY-PREVIEW-ALIGNMENT.md. Goal active.

## 2026-11-19 — Owner-required continuous AI handover documentation

Owner explicitly requires durable notes for Codex, Claude Code and any successor throughout work, with HANDOFF as the one entry point. Added AI-CONTINUITY (startup/checkpoint/coordination/safety), OWNER-PRINCIPLES (current decisions and supersessions), CURRENT-STATE (verified source/runtime/evidence/next steps) and DOCUMENTATION-MAP (task-oriented links). Root AGENTS.md and CLAUDE.md route native work to HANDOFF. Replaced the mixed current block with one concise checkpoint; archived the former block verbatim with SHA256 and retained the entire committed historical log. Continuous updates are an ongoing requirement, not a one-time completed migration feature. Preserve dirty work, identities, original data, review guards, actual test scope and the distinction between prototypes/QA entries and delivered parity. Latest snapshot preparation UTC2026-11-20T05:57:54+00:00.

## 2026-11-19 — Verified Scripture blocks and iPhone Settings (7e8142f9)

Both native editors now canonically verify and style copied Scripture without changing source, with original false/0.9 settings, cancellable/debounced bounded verification and complete LXX/range selection. iPhone Settings gains six native category routes. Full290sharedtests/finalMac+iOSbuilds PASS; actual Mac/Simulator source/Undo/settings/table/duplicate/rejection checks PASS. All owned fixtures trashed/extra tabs closed; existing19/24note-row hashes,37/47activeIDs/alltags preserved. See SCRIPTURE-BLOCKS-2026-11-19 and CURRENT-STATE for precise proof, runtime and limits. Full rich-import/read-only/index parity remainsOPEN. Next fix LXX attachment display, iPhone dock after editor removal and Mac viewport drift; no Apple voices/merge action. Broad migration remainsACTIVE.


## 2026-11-20 — Reader-aligned note labels and iPhone editor removal

Source334eafbb: native LXX Psalm attachments use reader labels/ranges while raw IDs/legacy golden formatter remain unchanged. Owner-scoped editor teardown fixes tested iPhone focused-note Trash/dock recovery without restart. Six new regressions;296shared tests/both builds PASS; real Mac+iPhone label/link checks and iPhone accessory-keyboard workflow PASS. All20/25prior notes,37/47active IDs/alltags preserved, owned fixtures recoverablytrashed. Physical/software-keyboard/multiple-editor UI matrix and Mac right-divider return drift remainOPEN. See [evidence](NOTE-LABELS-EDITOR-LIFECYCLE-2026-11-20.md) and CURRENT-STATE for live review/CI/runtime. Owner completed final Ollama shortcut removal; verified absent. Broad migrationACTIVE.


## 2026-11-20 — Presenter, Messages and iPhone polish

Focused source ebd7f913/b816ec41/1c8004b1/e5816a96 follows Claude5f9b0c45. Delivered real paused Presenter snapshots/rich note presentation, calmer native controls, safer Messages identities/drafts/search/destinations and glass layout, scene-scoped Mac commands, full-height iPhone reading, a roomier all-text picker, glass Go and richer/pinned-first tab cards. Full339 shared tests and both visual-pass builds pass; real Mac and simulator interactions are recorded in [focused evidence](PRESENTER-MESSAGES-POLISH-2026-11-20.md). Exact committed build/check status is in CURRENT-STATE. Original21/26 notes, tags/folders and37/47 active IDs preserved; owned note trashed and temporary tabs closed; clearly identified local Chat fixtures remain.

Inspector width restoration passed the custom380pt case twice and settled Notes/Search/Compare/hide-show returns. First constrained geometry and physical/manual resize remain open. Likewise physical phone, accessibility/rotation, failure injection, larger Presenter keyboard shortcut and wider rich-message/reference matrices remain open. This does not complete migration parity. **Owner requires pausing by16:50Pacific today for Claude's handover.**


## 2026-11-20 15:25 Pacific — Messages reference and composing follow-up

Commit **1ec16c13** restores plain Scripture/Strong’s internal links without rewriting saved messages, uses normal destination navigation and reveals the main document. Stable declarative targets plus an initial-only bottom anchor fix reopening at older content. The iPhone native multiline composer grows to eight lines, preserves Markdown punctuation, and sends with Send/Command-Return. Actual Mac+iPhone reference, rich table/list/code, search, reopen and iPhone draft-return checks pass. Both Dev builds and344 shared tests pass. Original notes/tags/folders and exact37/47 active tab IDs unchanged. Rejected input/layout/focus attempts and remaining physical/accessibility/failure gates remain explicit in [focused evidence](PRESENTER-MESSAGES-POLISH-2026-11-20.md). No production/sync/schema/raw identity changes or merges. Publication of this follow-up is next; prior b8882e06 CI44831691582 is green.


## 2026-11-21 — Presenter and Claude follow-through

Local sourcea4fcc429/16067d57/da8aecce/81938ff0 improves Presenter typography/appearance/focus, image preview preservation, custom print fractions/theme accessibility and clean Messages excerpts/replies.346shared tests pass; both integrated builds pass. Actual Mac follow/pause/theme/font/numbers/image/reply/search and iPhone named-theme/fraction controls checked; scoped limitations remain in PRESENTER-REFINEMENT-2026-11-21.md. Original QA records preserved, effective print defaults restored, exact active-ID recheck pending final publication. Broad goal ACTIVE after owner resumed; previous Nov20 cutoff superseded. Draft24 remains open; publication/exact-head checks in CURRENT-STATE. No production/sync/identity/merge changes.


### Nov21 Presenter follow-up — source1e9eeed7+6a50adc6
Settled reopen now uses the retained reader viewport; live observation remains subscribed and grouped zoom controls expose distinct names/actions. Mac build and actual reopened13→19/livefollow/zoom actions pass. Cold startup with restored audience still starts at top before reader settles: explicitly OPEN; source seeding alone did not fix it. Compare active-secondary projection and explicit same-chapter jump matrix remainOPEN. Detailed next implementation packet in PRESENTER-REFINEMENT-2026-11-21.md. Original QA rows and exact37/47activeIDs preserved. Broad goalACTIVE.


### Nov21 startup correction — ada385b1
Supersedes reproduced startup selection-overwrite above: transient highlight snapshots no longer request focus; deliberate verse selection/clear/destination still does. Both builds PASS; actual fresh startup stays at savedverse7/selected1, explicitverse8 focuses8; original state restored. No persisted format/schema changes. Wider multi-window/paused/edition/history matrix remainsOPEN. Focused evidence has exact scope and next steps.

## 2026-11-21 — Native reader and diagnostics

Local source through `7118fff8` includes Scripture history viewport restoration, complete local crash diagnostics and save timing, iPhone reader insets and a clear top edge, and immediate Mac floating search. Both final Dev builds passed and 349 shared tests passed. Same-chapter history passed live on Mac and iPhone Simulator. Mac cross-chapter and Scripture–Lexicon Back/Forward pass after the initial-layout correction. Final iPhone body-tap selection and Mac palette immediate typing/Actions/outside dismissal pass within the focused scope. Missing-viewport, broader width/type matrices and instrumented first-frame timing remain open. Physical iPhone watchdog cause remains open. CI 44894290052 passed at the prior published `ec6138cd`. See [CURRENT-STATE](CURRENT-STATE.md).


2026-11-21 follow-up — `7118fff8`: rebuilt Mac actual Scripture → G5485 → Back, then Forward/Back, restores the exact 446-point viewport through first native layout. User scrolling remains free. Cross-chapter Back also passed. See the focused history record for scope; missing-viewport/rapid/edition and first-frame matrices remain open. No desktop margin change.


### 2026-11-21 — Compare focused-column audience (8ae5e4a6)

Mac Presenter now uses a validated, atomic transient projection of the selected comparison column, including its actual edition/chapter, highlights and reading focus. Both platforms build; actual LXX Exodus 32:2 audience wording and pause → switch tab → resume pass. Shared layout/anchor decisions are consistent across available columns and widths. No persistence/schema changes. Mapped/availability/reorder/removal/clear/scroll matrices and full multi-column mirroring remain open. A separate tab-switch/pane-reflow drift remains open; do not claim all tab transitions preserve first-frame geometry. See PRESENTER-REFINEMENT-2026-11-21.md and CURRENT-STATE for exact QA state/evidence.


### 2026-11-21 — Inspector lifetime and final history settling

8252c91c validates the live inspector target across same-ID tab replacement and updates only its open state. Mac actual Lexicon/Search replacements retain the UUID and contain no leaked Scripture fields; inspector toggle works. 852a4767 corrects the final AppKit origin-only shift during newly mounted history restoration: repeated actual Search round trips preserve446 points, immediate user scrolling wins, and its new position survives history. Final Mac build passes; temporary diagnostics removed. Later changes are Mac-only; shared package unchanged since349-test pass. See TAB-LIFECYCLE-2026-11-21.md for trace, bounded evidence, current QA geometry and remaining accessibility/first-frame/history/Compare matrix. Earlier geometry readings were affected by AX divider adjustment; controlled no-write tab switching was stable. Do not close the broad reflow requirement from that narrow check.


## 2026-11-21 — Passage picker and Mac toolbar

Local source `d9da6c36` includes the iPhone prepared-row verse grid and Mac active-reader toolbar ownership. Both final Dev builds passed. Simulator verified four irregular LXX chapter grids and the expanded dismiss target. Mac verified the Compare → Genesis and Scripture → Strong’s → Back toolbar routes, plus bounded pinned and mapped Presenter behavior. Software-keyboard dismissal, Mac mouse row activation, and the wider Compare matrix remain open. Previous published `f6865f54` passed all three checks in CI 44940784658. Publication and CI for the new source are pending. [Picker and toolbar evidence](PICKER-CHROME-2026-11-21.md)


## 2026-11-21 — Compare selection history

Local source `50f00c76` preserves Compare selections per Back/Forward visit during the current session. Both Dev builds and the actual reader selection regression passed. Mac and iPhone Simulator verified the targeted routes. The narrow-layout viewport mismatch remains audited and open, alongside persisted Compare viewport and broader interaction coverage. All three checks passed at the previous published `e39b48a0` in CI 44943410767. Publication and CI for the new source are pending. [Compare history evidence](COMPARE-HISTORY-2026-11-21.md)
