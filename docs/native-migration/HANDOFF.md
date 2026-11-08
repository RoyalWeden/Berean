# Berean Native Migration — Last Resumable Session State

> LIVE RECOVERY CAPSULE — overwrite on each checkpoint, after a merge, and immediately before context compaction.

## Mandatory start-of-session recovery
1. Read `CLAUDE.md` and `docs/native-migration/EXECUTION-PLAYBOOK.md`.
2. Read `STATUS.md`, `TASKS.md`, `DECISIONS.md`, this file, latest `CHANGELOG.md` entries.
3. Verify exact Git state, compare recorded completion to code/tests, then resume next ready task.

## Recovery state
- Updated: 2026-11-07 18:45 PST
- `main` = `origin/main` = `ce37379` (PR #13 docs archive and PR #14 M1 slice merged); `/Users/roywe/Berean` clean
- Active worktree: `/Users/roywe/Berean-native`, branch `native/m2-reference` → PR #15 (CI running)
- Other worktrees: none (`Berean-ai-bench`, `Berean-docs-archive` removed). Kept branches: `feature/octarine-vault-integration` (F-02),
  `worktree-agent-a0acb949f0128b5e6` (unmerged)
- Latest verified work: BereanReference, StrongsId, findReferences, BereanSQLite, BereanBible — see CHANGELOG 18:40
- Tests last run: `npm run native:check` (4 + 26 Swift tests, both builds, identities OK); `npx vitest run` 5,775 pass; typecheck clean
- Known broken: nothing. Known reported difference: FTS equal-rank order (F-05)
- Native surfaces: core status view + live reference parser (Mac launched, iOS Simulator launched)
- Next exact task: PR #15 green → merge → M2-02 tagged tokens / DisplayMap (src/lib text transforms), lexicon read service
  (strongs_*.db), cross-references; then the first real reader view (G2: "representative Scripture read/search on both targets")
- Owner approvals held: native migration; cleanup; docs archive. Missing: production data / iCloud / identities / uploads / releases;
  decisions C-1…C-17, F-02, F-04, F-05 tie-breaker, ADR-0002 M4 Dev container
- Dangerous pending operations: none
- Rollback: native work is additive; revert the PR

## Important constraints
Never reset/delete an unknown dirty worktree, access production data without authorization, or assume a merged PR means
functional parity. No `--force` (worktree remove, push), no `branch -D`, no `reset --hard`. Keep log and task state in Git.
