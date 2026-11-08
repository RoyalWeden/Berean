# Berean Native Migration — Last Resumable Session State

> LIVE RECOVERY CAPSULE — overwrite on each checkpoint, after a merge, and immediately before context compaction.

## Mandatory start-of-session recovery
1. Read `CLAUDE.md` and `docs/native-migration/EXECUTION-PLAYBOOK.md`.
2. Read `STATUS.md`, `TASKS.md`, `DECISIONS.md`, this file, latest `CHANGELOG.md` entries.
3. Verify exact Git state, compare recorded completion to code/tests, then resume next ready task.

## Recovery state
- Updated: 2026-11-08 00:45 PST
- `main` = `origin/main` = `09f538d` (PRs #13–#17 merged); `/Users/roywe/Berean` clean
- Active worktree: `/Users/roywe/Berean-native`, branch `native/m3-store` (BereanStore migrations, BereanWorkspace, app shells) → PR #18
- Kept branches: `worktree-agent-a0acb949f0128b5e6` (unmerged). Octarine archived as tag `archive/octarine-vault-integration`.
- Tests last run: `swift test -c release` (all suites), iOS Simulator suite (37 + store/workspace), drift guard 17/17, Mac + iOS builds OK
- CI note: hosted runners have no Xcode 27 → BereanMac build is a local pre-merge check (ADR-0007); comment it on each PR
- Golden export: `npx -y node@22 node_modules/vite-node/vite-node.mjs scripts/golden/export.ts` (any Node works now; output is version-independent)
- Done since: BereanNotes (reads + writes) and the Notes Space UI. Next exact tasks (in order): highlights service + rendering in Scripture; settings service + Settings window/sheet (display: font, theme, word replacer toggle);
  tab back/forward history; layout presets / multi-pane compare on Mac; then sync M4 (Dev container per OD-5) and editor M7
- Files to look at next: src/platform/services/notesService.ts, highlightsService.ts, settingsService.ts; apple/Shared/AppModel.swift
- Owner decisions held: OD-1…OD-5 (DECISIONS). Optional owner action: self-hosted runner with Xcode 27 for Mac CI builds.
- Dangerous pending operations: none. Production data never opened.

## Important constraints
Never reset/delete an unknown dirty worktree, access production data without authorization, or assume a merged PR means
functional parity. No `--force` (worktree remove, push), no `branch -D`, no `reset --hard`. Keep log and task state in Git.
