# Branch, PR and worktree audit — 2026-11-05

Starting state (2026-11-04): `main` and `origin/main` at `1b18826`, one remote (`origin`, RoyalWeden/Berean, public), no branch protection, no rulesets, no PRs ever opened, CI only on release tags. Full starting refs: `~/Berean-backups/ai-integration-2026-11-04/start-state.txt`.

## Merged into main

| PR | Source | Head | Content |
|---|---|---|---|
| #1 | `ci/pr-checks` | `18bf7a1` | CI workflow, ESLint config |
| #2 | `integration/chat-rename` | `e03c4af` | iPhone conversation rename |
| #3 | `integration/quick-open` | `5ad6252` | iPhone Quick Open and tab list |
| #4 | `integration/ai-upgrade` | `22dc937` | The AI upgrade, including lanes `ai/models` `8cbe638`, `ai/compare` `24d21a9`, `ai/ios` `edb9f81` and `357aeef` |

Each passed CI on its exact head. Merge commits. `main` after #4: `0986b45`, tree identical to `22dc937`.

## Branches

| Branch | Where | Tip | Disposition | Evidence |
|---|---|---|---|---|
| `feature/design-refresh-round2` | remote | `dc75638` | Deleted | Ancestor of main, no PR, no worktree |
| `feature/notes-search-fixes` | remote | `ffd839e` | Deleted | Same |
| `feature/trail-and-tabs` | remote | `e2aa917` | Deleted | Same |
| `ci/pr-checks`, `integration/chat-rename`, `integration/quick-open` | both | above | Deleted | Merged |
| `ai/models`, `ai/ios`, `ai/compare` | local | above | Deleted | Merged; worktrees were clean |
| `integration/ai-upgrade` | local kept, remote deleted | `22dc937` | Local retained | Its worktree holds the final benchmark outputs |
| `feature/ai-upgrade` | local | `1b18826` | Retained | Dirty checkout, frozen sweep source and outputs. Work is on main |
| `feature/chat-rename` | local | `1b18826` | Retained | Dirty checkout. Work is on main; removal would need discarding changes |
| `feature/quick-open-tabs` | local | `1b18826` | Retained | Same |
| `eval/ai-benchmark` | local | `1b18826` | Retained | Worktree holds the original benchmark artifacts |
| `feature/octarine-vault-integration` | local | `db074d1` | Retained, decision needed | 2 commits not patch-equal to main, 787 behind, from June. Unclear if superseded |
| `worktree-agent-a0acb949f0128b5e6` | local | `12afc11` | Retained | Patch-equivalent to main, but `git branch -d` refuses and `-D` is not allowed |

## Worktrees

Removed (clean, tips on main): `Berean-ai-models`, `Berean-ai-ios`, `Berean-ai-compare`, `Berean-merge-check`.
Retained: `Berean-ai-integrate`, `Berean-ai-upgrade`, `Berean-ai-bench`, `Berean-chat-rename`, `Berean-quick-open`, for the reasons above.

## Preserved

- `refs/recovery/2026-11-04/{ai-upgrade,chat-rename,quick-open,ai-bench}`: working-tree snapshots, local only.
- `~/Berean-backups/ai-integration-2026-11-04/`: patches, benchmark output archives, scripts, logs, the 36-case partial run.
- Stashes: `stash@{0}` Xcode re-serialization (kept for Michael), `stash@{1}` Octarine WIP. Untouched.
