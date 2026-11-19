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
