# Berean Native Migration — Live Status

> Initialized 2026-11-07 from verified Git, CI and test evidence. Every claim here was checked in the
> session that wrote it; re-verify against live Git before relying on it after a gap.

## Snapshot
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
