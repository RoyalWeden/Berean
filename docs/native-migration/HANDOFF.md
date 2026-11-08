# Berean Native Migration — Last Resumable Session State

> LIVE RECOVERY CAPSULE — overwrite on each checkpoint, after a merge, and immediately before context compaction.

## Mandatory start-of-session recovery
1. Read `CLAUDE.md` and `docs/native-migration/EXECUTION-PLAYBOOK.md`.
2. Read `STATUS.md`, `TASKS.md`, `DECISIONS.md`, this file, latest `CHANGELOG.md` entries.
3. Verify exact Git state, compare recorded completion to code/tests, then resume next ready task.

## Recovery state
- Updated: 2026-11-08 02:40 PST
- `main` = `origin/main` = `09f538d` (PRs #13–#17 merged); `/Users/roywe/Berean` clean
- Active worktree: `/Users/roywe/Berean-native`, branch `native/m3-store` → PR #18 (open; CI running on `b7158b6`). Contains: BereanStore
  (Migrator ADR-0009, upgrade floor v42, UserDatabase, SettingsService), BereanWorkspace (tabs/sessions), BereanNotes (notes reads+writes,
  highlights), Mac + iPhone app shells (sidebar Spaces/vertical tabs/sessions, Scripture + inspector Notes/Lexicon/Cross Refs, Lexicon,
  Search, Notes home/detail, highlights, Settings). Merge it after CI is green + local `npm run native:build:mac` (ADR-0007 comment).
- Kept branches: `worktree-agent-a0acb949f0128b5e6` (unmerged). Octarine archived as tag `archive/octarine-vault-integration`.
- Tests last run: `swift test -c release` all suites pass (≈30 s; core-json, sync-hash, hlc, journal, fractional, reference, strongs,
  bible, text, display, lexicon, crossrefs, schema, tabs, notes, highlights, settings); drift guard 19/19; Mac + iOS builds OK.
- Visual QA notes: native dev library at ~/Library/Containers/com.berean.native.mac.dev/…/BereanNative/berean.db (synthetic; safe to
  seed); for sidebar clicks use `cliclick dd:x,y du:x,y` (plain `c:` can leave SwiftUI in a drag-tracking loop); capture with
  `screencapture -R<window rect>` after moving the window to {100,60} (never full-screen captures).
- Next exact tasks: (1) merge PR #18; (2) note version history + vault-compatible Markdown (M7-01 goldens from noteMarkdownFile.ts);
  (3) workspaces service + layout presets / multi-pane Scripture on Mac (M6-02); (4) tab back/forward history; (5) verse tags + Study
  Trail services; (6) M4 sync: BereanSync engine port (merge.ts, engine.ts) against goldens, then Dev container (OD-5);
  (7) iPhone verse sheet + gestures (M5-02/M6-03).
- Files to look at next: src/lib/noteMarkdownFile.ts, src/platform/services/workspacesService.ts, src/platform/sync/merge.ts, engine.ts
- Owner decisions held: OD-1…OD-5. Optional owner action: a self-hosted runner with Xcode 27 so CI builds BereanMac.
- Dangerous pending operations: none. Production data never opened.

## Important constraints
Never reset/delete an unknown dirty worktree, access production data without authorization, or assume a merged PR means
functional parity. No `--force` (worktree remove, push), no `branch -D`, no `reset --hard`. Keep log and task state in Git.
