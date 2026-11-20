# Native migration documentation map

[HANDOFF](HANDOFF.md) is the owner-designated entry point. Read the current checkpoint and verify live state; then select relevant documents here. Historical implementation records are evidence, not current runtime instructions. Links below are repository-relative.

## Required continuity and project state

| Document | Purpose |
| --- | --- |
| [AI-CONTINUITY](AI-CONTINUITY.md) | Startup/resume, continuous notes, checkpoint requirements, data/review safeguards and multi-AI handover |
| [OWNER-PRINCIPLES](OWNER-PRINCIPLES.md) | Curated current owner UX/workflow/safety decisions and explicit supersessions |
| [CURRENT-STATE](CURRENT-STATE.md) | Small last-verified source/CI/runtime/data checkpoint and ordered next work |
| [STATUS](STATUS.md) | Wider migration status; older entries are dated snapshots |
| [TASKS](TASKS.md) | Implementation queue, dependencies and acceptance gates |
| [FOLLOWUP](FOLLOWUP-2026-11-19.md) | Incoming owner requests and unresolved scope; latest entries refine older ones |
| [DECISIONS](DECISIONS.md) | Design/engineering reasons, rejected approaches and supersessions |
| [CHANGELOG](CHANGELOG.md) | User-visible implemented changes |
| [EXECUTION-PLAYBOOK](EXECUTION-PLAYBOOK.md) | Detailed migration operational reference and safety gates; startup protocol explains its required sections |

## Specification, scope and parity

| Document | Read when |
| --- | --- |
| [MASTER-SPECIFICATION](MASTER-SPECIFICATION.md) | Establishing architecture/requirements and the supplied specification location; never claim unread contents |
| [Original migration audits](../native-migration-audit/) | Data/schema/sync/security/performance/architecture work; the playbook maps00–17 |
| [FULL-FEATURE-PARITY](FULL-FEATURE-PARITY.md) | Selecting/closing functional parity; distinguish implemented, tested, replaced and missing |
| [IMPLEMENTATION-BACKLOG](IMPLEMENTATION-BACKLOG.md) | Broader backlog and dependencies; reconcile with latest TASKS/owner steering |
| [AUDIT-2026-11-14](AUDIT-2026-11-14.md) | Claude’s prioritized gap audit; historical conclusions need current-code verification |
| [UX-AND-FUNCTIONAL-ISSUES](UX-AND-FUNCTIONAL-ISSUES.md) | User-visible defects, acceptance limits and newer reports |
| [SCREEN-INVENTORY](SCREEN-INVENTORY.md) | Original/native screen and feature inventory |
| [VISUAL-UX-PARITY](VISUAL-UX-PARITY.md) | Visual/workflow parity; apply the current owner principles instead of stale screenshots |

## Reader, references, layout and interaction

| Document | Purpose |
| --- | --- |
| [QA-PROFILES](QA-PROFILES.md) | Development library/profile isolation and test ownership; recheck live runtime |
| [READER-VIEWPORT-RESTORATION](READER-VIEWPORT-RESTORATION.md) | Reading position, tab/edition return and reflow acceptance |
| [READER-ANNOTATION-DESIGN](READER-ANNOTATION-DESIGN.md) | Annotation reading-clutter rationale; latest categorical symbols/counts in the preview document supersede a generic-dot-only interpretation |
| [STUDY-PREVIEW-ALIGNMENT](STUDY-PREVIEW-ALIGNMENT.md) | Actual cited verse content, native hover-card anchor, count semantics, QA evidence and open hover/display matrix |
| [ONLINE-BRENTON](ONLINE-BRENTON.md) | LXX Psalm rendering sources/mapping; raw storage identities stay unchanged |
| [CURSOR-AUDIT-2026-11-18](CURSOR-AUDIT-2026-11-18.md) | Cursor ownership/divider tests and remaining physical behavior |
| [NATIVE-COMPARE-DRAG](NATIVE-COMPARE-DRAG.md) | Actual rendered-column drag images, pickup offset, masking/lifecycle evidence and remaining matrices |
| [TAB-SPLIT-DESIGN](TAB-SPLIT-DESIGN.md) | Generic tab-to-content splits; separate model tests from unimplemented live hosts/routing/persistence |
| [SHARING-AUDIT](SHARING-AUDIT.md) | Native share-anchor and per-surface parity |

## Notes and text compatibility

| Document | Purpose |
| --- | --- |
| [NOTES-REFERENCE-PARITY](NOTES-REFERENCE-PARITY.md) | Scripture/Strong’s linking/indexing grammar, identity and lookup behavior |
| [NOTES-KEYBOARD-AND-TABLES](NOTES-KEYBOARD-AND-TABLES.md) | Tested native table edit safety, keyboard groups, undo/redo and device limits |
| [NOTE-TABLE-LINK-COMPATIBILITY](NOTE-TABLE-LINK-COMPATIBILITY.md) | Serialized table/link/wiki cases; do not normalize legacy ambiguities blindly |
| [NOTES-AUTOMATIC-BLOCKS](NOTES-AUTOMATIC-BLOCKS.md) | Original automatic expansion versus visual recognition/settings/tracking, implementation state and next safety gates |
| [Untested Scripture-block draft](prototypes/NoteScriptureBlocks.swift.txt) | Preserved design work only; not part of the apps/package and not test evidence |

## Historical/bootstrap material

[CHECKPOINT-HISTORY-2026-11-19](CHECKPOINT-HISTORY-2026-11-19.md) preserves the former mixed current-summary block verbatim; [archive integrity](CONTINUITY-ARCHIVE-INTEGRITY.txt) records its SHA256. The detailed older log remains inside HANDOFF below the historical-log heading. Use it to investigate a specific decision/commit, not to restore obsolete PIDs, app state or tasks.

[CLAUDE-START-PROMPT](CLAUDE_START_PROMPT.md), [CLAUDE bootstrap snippet](CLAUDE_BOOTSTRAP_SNIPPET.md) and [README-INSTALL](README-INSTALL.md) are earlier setup/bootstrap references. The owner now wants a single entry point: HANDOFF and its linked current continuity documents. Do not restart the migration or follow stale pre-implementation assumptions from an old prompt.

The root [CLAUDE.md](../../CLAUDE.md) retains legacy Electron/Capacitor compatibility/setup information and now routes native work to HANDOFF. Root [AGENTS.md](../../AGENTS.md) makes the same continuity requirement discoverable to other agents. Follow applicable higher-priority/current environment instructions.

When adding a new focused document, link it here and in the relevant HANDOFF/TASKS entry. Keep this map task-oriented and the current checkpoint concise.

- [Ollama cleanup](OLLAMA-REMOVAL-2026-11-19.md): owner-requested local model/app removal, recoverable paths, remaining admin shortcut and interrupted native work.
