# Berean Native Migration — Last Resumable Session State

> LIVE RECOVERY CAPSULE — overwrite on each checkpoint, after a merge, and immediately before context compaction.

## Mandatory start-of-session recovery
1. Read `CLAUDE.md` and `docs/native-migration/EXECUTION-PLAYBOOK.md`.
2. Read `STATUS.md`, `TASKS.md`, `DECISIONS.md`, this file, latest `CHANGELOG.md` entries.
3. Verify exact Git state, compare recorded completion to code/tests, then resume next ready task.

## Recovery state
- Updated: 2026-11-07 18:58 PST
- `main` = `origin/main` = `c6531fd` (PR #15 merged: M2 reference/Strong's/Bible+Lexicon services/BereanText/first reader); `/Users/roywe/Berean` clean
- Active worktree: `/Users/roywe/Berean-native`, branch `native/m2-continued` (from `c6531fd`, nothing new yet)
- Other worktrees: none (`Berean-ai-bench`, `Berean-docs-archive` removed). Kept branches: `feature/octarine-vault-integration` (F-02),
  `worktree-agent-a0acb949f0128b5e6` (unmerged)
- Latest verified work: BereanReference, StrongsId, findReferences, BereanSQLite, BereanBible (Bible + Lexicon services), BereanText — CHANGELOG 18:20/18:35
- Tests last run: `npm run native:test` 4 + 30 Swift tests (~60 s, text suite dominates); drift guard 11/11 on Node 22 and 24; full vitest 5,775 pass (before BereanText); typecheck clean.
- Golden export rule: export with Node 22 (`npx -y node@22 node_modules/vite-node/vite-node.mjs scripts/golden/export.ts`) so bible.json carries CI's SQLite 3.53.4
- Known broken: nothing. Known reported difference: FTS equal-rank order (F-05)
- Native surfaces: core status view + live reference parser (Mac launched, iOS Simulator launched)
- Next exact task: M2 remainder → word replacer (`src/lib/wordReplacer.ts`) + `buildVerseDisplayText/Tokens` goldens; lexicon
  `getOccurrences`; cross-references (`crossrefsService.ts`, tske_refs/cross_references DBs); drive reader search/navigation with UI
  automation; iOS SQLite/FTS5 version check (B-15); then accept gate G2 and start M3 (GRDB prototype, migrations on synthetic copies)
- Owner approvals held: native migration; cleanup; docs archive. Missing: production data / iCloud / identities / uploads / releases;
  decisions C-1…C-17, F-02, F-04, F-05 tie-breaker, ADR-0002 M4 Dev container
- Dangerous pending operations: none
- Rollback: native work is additive; revert the PR

## Important constraints
Never reset/delete an unknown dirty worktree, access production data without authorization, or assume a merged PR means
functional parity. No `--force` (worktree remove, push), no `branch -D`, no `reset --hard`. Keep log and task state in Git.
