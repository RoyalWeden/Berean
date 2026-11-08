# Berean Native Migration — Last Resumable Session State

> LIVE RECOVERY CAPSULE — overwrite on each checkpoint, after a merge, and immediately before context compaction.

## Mandatory start-of-session recovery
1. Read `CLAUDE.md` and `docs/native-migration/EXECUTION-PLAYBOOK.md`.
2. Read `STATUS.md`, `TASKS.md`, `DECISIONS.md`, this file, latest `CHANGELOG.md` entries.
3. Verify exact Git state, compare recorded completion to code/tests, then resume next ready task.

## Recovery state
- Updated: 2026-11-08 08:40 PST (session ended at the usage limit)
- `main` = `origin/main` = `d86a6fe` (PRs #13–#18 merged)
- Active worktree: `/Users/roywe/Berean-native`, branch `native/m6-shell` → PR #19 (open): WorkspacesService, tab history, Compare mode,
  renderTokens fix. Merge after CI green + local `npm run native:build:mac` (ADR-0007; comment on the PR).
- Tests last run: `swift test -c release` all suites; drift guard 20/20; Mac + iOS builds OK.
- Next exact tasks: (1) merge PR #19; (2) [done on native/m6-layouts — merge it]; (3) note version history +
  vault Markdown goldens (M7-01, src/lib/noteMarkdownFile.ts); (4) verse tags + Study Trail services; (5) M4 sync engine port
  (src/platform/sync/merge.ts, engine.ts) then the Dev container (OD-5); (6) iPhone verse sheet + gestures.
- Visual QA: move window to {100,60}, `screencapture -R100,60,1200,760` only; sidebar clicks with `cliclick dd:x,y du:x,y`.
- Owner decisions held: OD-1…OD-5. Optional: self-hosted runner with Xcode 27. Dangerous operations pending: none.

## Important constraints
Never reset/delete an unknown dirty worktree, access production data without authorization, or assume a merged PR means
functional parity. No `--force` (worktree remove, push), no `branch -D`, no `reset --hard`. Keep log and task state in Git.
