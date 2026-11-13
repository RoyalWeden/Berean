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

## Session end 2026-11-08 (evening) — state
- Branch `native/m6-navigation` (PR #23, stacked on #22). Neither PR is merged; neither branch is in main (checked by ancestry).
- **Merge order (Michael):** #22 → wait until GitHub retargets #23 to main → #23. Both need green CI plus the local Mac check comment.
- Done this session (see CHANGELOG 13:30 → 16:30): continuous TextKit reader; passage navigator; text list + lxx→Brenton fix; system
  Scripture font; Back/Forward placement; Share caret; unified Workspaces (ADR-0011); Yab-style sidebar + live drag + window drag
  (ADR-0012); iPhone New sheet + three-job bar (ADR-0013); physical iPhone deploy (`npm run native:ios:device`, installed on the iPhone 16e);
  formatted notes editor + Copy as Plain Text (ADR-0014).
- Checks at the last commit: Swift 68/26 PASS; golden drift 22/22 PASS; Mac + iOS builds PASS.
- Next executable tasks:
  1. iPhone reader: continuous selection (UITextView) and tappable Strong's / verse numbers (UI-03/11 iOS).
  2. Sidebar: drop line and auto-scroll while dragging, pinned grid, density setting (UI-07/08 rest).
  3. Unified grouped search (notes in ⌘K results — found during the editor test: ⌘K "Rich editor test" searched Scripture only).
  4. Study Trail service port with goldens.
  5. M4 sync engine.

## Session end 2026-11-12 — state (read this first)
- Worktree `/Users/roywe/Berean-native`, branch `native/m6-navigation` (PR #23, stacked on #22). Both PRs OPEN; neither branch is in
  origin/main (checked with `git merge-base --is-ancestor`).
- **Merge order (Michael):** #22 → wait for GitHub to retarget #23 to main → #23 CI green → merge #23.
- Durable records:
  - `FULL-FEATURE-PARITY.md`: 104 features; Mac ✅31 🟡24 ❌36 (−) before this session's later fixes;
  - `UX-AND-FUNCTIONAL-ISSUES.md`: open P1s are Study Trail, sync, and iPhone swipe / edge chapter change;
  - `SCREEN-INVENTORY.md`.
- Verified this session (running Mac app; iPhone Simulator where noted):
  - single-chapter books and prologues;
  - verse-number selection (+ iPhone);
  - sidebar nav group;
  - multi-text search (+ iPhone);
  - Notes home (+ iPhone);
  - find bar;
  - ⌘K with notes;
  - partial-selection highlight;
  - New sheet closes (iPhone).
- Checks: Swift 78/30 PASS; Mac + iOS builds PASS.
- **Next tasks in priority order:**
  1. (done) IOS-FUNC-001 swipe chapter change.
  2. IOS-FUNC-002 — iPhone continuous reader (UITextView port of ChapterTextView) for cross-verse selection, partial highlights and
     tappable Strong's.
  3. U14 — Study Trail: port `src/platform/services/studyTrailService.ts` with goldens (scripts/golden pattern), then the map UI.
  4. SHARED-FUNC-012 — History screen; MAC-FUNC-013 — Daily Note command + calendar.
  5. SHARED-FUNC-016 — Tag manager; SHARED-FUNC-014 — Settings sections.
  6. M4 sync engine (OD-5 gates).
- Harness notes:
  - synthetic context-menu clicks can leave AppKit in menu tracking: use keyboard navigation, `pkill` if stuck;
  - region captures beyond the app window can include other windows: keep captures inside the window;
  - the iPhone Simulator Xcode MCP only drives iOS 27 runtimes (iPhone 18 Pro D0CC2F4C…).
