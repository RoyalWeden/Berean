# Agent instructions for Berean

For native Swift macOS/iPhone migration work, **start with [docs/native-migration/HANDOFF.md](docs/native-migration/HANDOFF.md)**. The owner uses that as the single entry point for Codex, Claude Code and other AIs. Follow its startup links to current state, owner principles, continuity rules and task-specific evidence before editing.

Keep durable notes continuously during implementation, not only at the end. Record new owner steering, decisions, changed assumptions, commits, tests/failures, current dirty work, safe runtime/data ownership and the next executable step. Before stopping/context or usage handover, update the compact current state, HANDOFF and relevant task/parity/decision/changelog records. Never claim an untested prototype, build-only UI change or old-head CI as complete verification.

The current checkpoint at the top of HANDOFF.md and CURRENT-STATE.md must be updated together. Appending a historical HANDOFF entry alone does not satisfy this requirement. After each substantial implementation or verification result, record the result and next step while the evidence is available. Before every final reply or handover, reconcile these two current summaries with live Git, dirty work, running checks and the remaining queue. Say which required checks remain open; do not declare all remaining work owner-gated without reviewing that queue.

Before every usage handoff, prepare and verify the owner’s native development build in `/Users/roywe/Berean-native`. Follow the [install-ready checklist](docs/native-migration/INSTALL-READY-HANDOFF.md) and end with simple Terminal commands for Mac and iPhone.

Preserve other agents’/owner edits, production data/sync/identities, legacy compatibility and the existing owner-only merge guard. Work autonomously within authorized scope; do not repeatedly ask whether to continue. Follow the current owner principles rather than stale goal quotes/screenshots. Documentation must support substantial actual app improvements.

These project instructions supplement, and do not replace, higher-priority system/developer/user instructions or applicable environment/skill requirements. For legacy Electron/Capacitor setup and compatibility, also consult [CLAUDE.md](CLAUDE.md), while using the native HANDOFF’s verified checkout/runtime guidance for migration work.
