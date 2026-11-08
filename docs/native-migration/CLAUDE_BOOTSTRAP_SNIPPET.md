# Snippet to append to the existing `CLAUDE.md` (do not replace file)

## Native Swift migration — persistent execution protocol

When working on the Berean native migration, always read `docs/native-migration/EXECUTION-PLAYBOOK.md` and the live files `STATUS.md`, `TASKS.md`, `DECISIONS.md`, `HANDOFF.md` and recent `CHANGELOG.md` entries under the same directory. Read the separately supplied Berean Native Migration Master Specification and relevant `docs/native-migration-audit/` sources. After context compaction, verify live Git state and recover from these files rather than relying on remembered conversation. Work autonomously through successive safe tasks, test/commit/log and continue to the next unblocked task. Do not request routine continuation approval. Never cross production/destructive/release/legal gates without the owner's explicit authorization. Before ending, update `HANDOFF.md` with current branch/SHA, exact checks, blockers and next executable action.
