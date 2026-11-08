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
- Next exact tasks: (1) merge PR #19; (2) [done on native/m6-layouts — PR #20, awaiting Michael's merge: auto-merge was blocked by the permission classifier]; (3) [note versions + Markdown files done on native/m7-markdown — PR stacked on #20]; (3b) note version history +
  vault Markdown goldens (M7-01, src/lib/noteMarkdownFile.ts); (4) verse tags + Study Trail services; (5) M4 sync engine port
  (src/platform/sync/merge.ts, engine.ts) then the Dev container (OD-5); (6) iPhone verse sheet + gestures.
- Visual QA: move window to {100,60}, `screencapture -R100,60,1200,760` only; sidebar clicks with `cliclick dd:x,y du:x,y`.
- Owner decisions held: OD-1…OD-5. Optional: self-hosted runner with Xcode 27. Dangerous operations pending: none.

## Important constraints
Never reset/delete an unknown dirty worktree, access production data without authorization, or assume a merged PR means
functional parity. No `--force` (worktree remove, push), no `branch -D`, no `reset --hard`. Keep log and task state in Git.

## Merge requirements (2026-11-08)
- `gh pr merge` by Claude is blocked by the auto-mode classifier ("Merge Without Review"); Michael merges native PRs.
- Merge in the order listed; for stacked PRs merge the lower one first and **wait until GitHub retargets the next PR to main before
  merging it** — #21 was merged into its already-merged base branch and missed main (re-landed via `native/m7-export`).
- Before merging: CI green (both jobs) + the local Mac check comment (ADR-0007: `npm run native:build:mac`, Xcode 27).

## Session end 2026-11-08 (afternoon) — state
- **Open PRs, merge in this order:**
  1. **#22** `native/m7-export` → main: re-lands #21 (note Markdown + version history, missed main) + the Export fix.
  2. **#23** `native/m6-navigation` (stacked on #22), containing:
     - the ADR-0010 sidebar, sessions and workspaces redesign, tab archive, passage pill and history toolbar;
     - ⌃Tab over the unified list;
     - the iPhone tab sheet and Sessions page;
     - verse tags;
     - verse-number actions.
     After #22 merges, wait for GitHub to retarget #23 to main, then merge.
- Checks at 8eec766:
  - `swift test -c release`: 62 tests / 25 suites PASS;
  - golden drift guard: 22/22 PASS;
  - `npm run native:build:mac` and `native:build:ios`: PASS;
  - `npm run native:ui:smoke`: PASS (at 26a3835).
- UI evidence: `VISUAL-UX-PARITY.md` verification log and CHANGELOG entries for today.
- Next executable tasks:
  1. Study Trail: port `src/platform/services/studyTrailService.ts` (1223 lines) with goldens, then the trail map UI.
  2. Tab multi-select (⌘/⇧-click) with bulk archive/move/close; session icons.
  3. Unified grouped search (`unifiedSearch.ts`).
  4. iPhone verse sheet and verse-number actions on iOS (the verse menu exists; check touch).
  5. M4 sync engine port.
- Visual QA harness notes:
  - Context menus opened with synthetic clicks can leave the app in a menu-tracking loop (it looks hung; `sample` shows
    NSMenuTrackingSession). Prefer keyboard navigation + Return, and `pkill` if it sticks.
  - `ccusage` is blocked by the permission classifier, so the usage window cannot be checked from here.
