# Berean Native Migration — Last Resumable Session State

> LIVE RECOVERY CAPSULE — overwrite on each checkpoint, after a merge, and immediately before context compaction.

## Mandatory start-of-session recovery
1. Read `CLAUDE.md` and `docs/native-migration/EXECUTION-PLAYBOOK.md`.
2. Read `STATUS.md`, `TASKS.md`, `DECISIONS.md`, this file, latest `CHANGELOG.md` entries.
3. Verify exact Git state, compare recorded completion to code/tests, then resume next ready task.

## Recovery state
- Updated: 2026-11-07 17:55 PST
- `main` = `origin/main` = `ceaaa73` at start of this slice
- Active worktree: `/Users/roywe/Berean-native`, branch `native/m0-execution-records` (first M1 PR)
- Other worktrees: `/Users/roywe/Berean` (main; untracked `docs/native-migration/` install copy — delete only after this PR
  merges and main is pulled), `/Users/roywe/Berean-ai-bench` (remove after this PR merges; its REPORT.md is archived by PR #13 as
  `docs/archive/AI-BENCHMARK-REPORT-2026-10-28.md`)
- Latest verified work: M1 first slice — see CHANGELOG 2026-11-07 17:50
- Tests last run: `npm run native:check` (23 Swift tests pass, Mac + iOS Simulator builds, identity OK); `npx vitest run`
  (5,771 pass); `npm run typecheck` clean
- Known broken: nothing
- Native Mac surfaces: core status view only. Native iPhone: builds; not launched in the Simulator yet
- Next exact task: wait for PR CI → merge (normal merge, no force) → pull main → remove `Berean-ai-bench` → M1-02 remainder
  → M1-03 reference goldens → M2-01 `BereanReference`
- Spec/audit sections to re-read for M2: spec §3 (modules), §4 Stage 1; audits 08, 11, 14; `src/lib/parseRef.ts`
- Owner approvals held: native migration implementation; cleanup Groups A/B; REPORT.md archive PR. Missing: anything
  touching production data, production iCloud, production identities, uploads, releases
- Dangerous pending operations: none
- Rollback: native work is additive; revert the PR

## Important constraints
Never reset/delete an unknown dirty worktree, access production data without authorization, or assume a merged PR means
functional parity. No `--force` (worktree remove, push), no `branch -D`, no `reset --hard`. Keep log and task state in Git.
