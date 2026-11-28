# Native migration documentation map

[HANDOFF](HANDOFF.md) is the owner-designated entry point. Read the current checkpoint and verify live state; then select relevant documents here. Historical implementation records are evidence, not current runtime instructions. Links below are repository-relative.

Latest focused work: [Verse-copy parity on Mac and iPhone](VERSE-COPY-PARITY-2026-11-21.md) covers the clipboard contract, builds, exact pasteboard evidence and remaining cases. Earlier: [Resumed Presenter and Claude UI refinement](PRESENTER-REFINEMENT-2026-11-21.md); [Presenter/Messages/iPhone polish and remaining gates](PRESENTER-MESSAGES-POLISH-2026-11-20.md); [continuous owner-request investigation](OWNER-UX-2026-11-20.md).

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

- [Simulator clipboard QA](SIMULATOR-CLIPBOARD-QA.md): exact paste through native DeviceHub Send Clipboard, source checks, ownership and cleanup.

- [Verified Scripture blocks](SCRIPTURE-BLOCKS-2026-11-19.md): source7e8142f9, tests/builds, actual Mac/Simulator evidence, owned cleanup and precise remaining scope.
- [Working checkpoint archive](CHECKPOINT-HISTORY-2026-11-20.md): historical implementation/interruption notes; CURRENT-STATE supersedes its temporary labels.


## 2026-11-20 — Reader-aligned note labels and iPhone editor removal

Source334eafbb: native LXX Psalm attachments use reader labels/ranges while raw IDs/legacy golden formatter remain unchanged. Owner-scoped editor teardown fixes tested iPhone focused-note Trash/dock recovery without restart. Six new regressions;296shared tests/both builds PASS; real Mac+iPhone label/link checks and iPhone accessory-keyboard workflow PASS. All20/25prior notes,37/47active IDs/alltags preserved, owned fixtures recoverablytrashed. Physical/software-keyboard/multiple-editor UI matrix and Mac right-divider return drift remainOPEN. See [evidence](NOTE-LABELS-EDITOR-LIFECYCLE-2026-11-20.md) and CURRENT-STATE for live review/CI/runtime. Owner completed final Ollama shortcut removal; verified absent. Broad migrationACTIVE.

- [Picker and toolbar evidence](PICKER-CHROME-2026-11-21.md): irregular iPhone verse rows, Mac toolbar ownership, mapped Compare Presenter checks and remaining input coverage.
- [Compare history evidence](COMPARE-HISTORY-2026-11-21.md): session-local per-visit selection, Mac and iPhone Simulator routes, and the open narrow viewport-transfer audit.
- [iPhone Find evidence](IOS-FIND-VISIBILITY-2026-11-23.md) — iPhone top Find bar, isolated keyboard and selection checks, and open accessibility/device cases.
- [Integration review](INTEGRATION-REVIEW-2026-11-26.md) — integrated Claude work, reader and menu runtime, and remaining evening checks.
- [Search book filters](SEARCH-BOOK-FILTERS-2026-11-23.md) — scoped bulk filters, scope-crash retest and sampled cold-position seed.
- [Search viewport evidence](SEARCH-VIEWPORT-2026-11-23.md) — local result anchors and active visits, Mac and iPhone Simulator coverage, and open viewport cases.
- [Compare active-visit evidence](COMPARE-ACTIVE-VISIT-2026-11-23.md) — independent older-visit cold restore, explicit picker jump and aligned opening headers.
- [Same-chapter history viewport restoration](HISTORY-VIEWPORT-RESTORATION-2026-11-21.md): current Back/Forward fix, ownership, required UI matrix and evidence.

- [iPhone watchdog investigation](IOS-WATCHDOG-2026-11-21.md): supplied physical report, matched symbols, diagnostic fixes, clear top edge and unresolved hardware gates.

- [Tab lifecycle and inspector continuity, Nov 21](TAB-LIFECYCLE-2026-11-21.md): same-ID live inspector callback guard, corrected interpretation of AX divider geometry, final AppKit offset-only drift and active native trace/correction evidence.

- [iPhone controls/top spacing](IOS-READER-CONTROLS-2026-11-21.md): direct Strong’s, long-title/arrows/LXX refinements, measured gap investigation and exact runtime evidence. [Checkpoint history Nov21](CHECKPOINT-HISTORY-2026-11-21.md) archives superseded current-state text.

- [Compare reentry](COMPARE-REENTRY-2026-11-22.md): dormant follower alignment, preserved pins/legacy independence, red/green probe and actual Mac+iPhone history checks.

- [Rich note previews](NOTE-PREVIEWS-2026-11-22.md): latest owner direction, original preview comparison, native rendering work and verification.

- [Claude change audit, Nov23](CLAUDE-AUDIT-2026-11-23.md): full34commit/30file coverage, continuity corrections, concrete findings/fixes and verification.

- [Compare durable-position next packet](COMPARE-PERSISTENCE-NEXT-2026-11-23.md): unfinished storage/identity plan, per-visit priority rules, both-platform tests and exact intra-row requirement after d349bf41.

- [Durable Compare bookmarks](COMPARE-DURABLE-2026-11-23.md): implemented local semantic anchors, stable metadata/legacy compatibility, exact test failures/reruns, actual Mac+iPhone cold/history/reorder checks and remaining precision/UI gates.

- [Notes slash runtime checks](NOTES-SLASH-RUNTIME-2026-11-23.md): actual Mac/iPhone heading/table/keyboard/Undo evidence, recoverable owned fixtures and remaining editor scope.

- [Install-ready usage handoff](INSTALL-READY-HANDOFF.md): required owner checkout preparation, fresh Mac/device build evidence and final Terminal commands for every AI.

- [Independent Compare precision](COMPARE-PRECISION-2026-11-23.md): optional rowcrop model, measured lazy-layout correction, Mac/iPhone runtime evidence and required activevisit persistence follow-up.
- [Readable lexicon excerpts](LEXICON-EXCERPTS-2026-11-23.md): owner regression, bounded wrapping context and platform verification.

- [Shared Codex and Claude work queue](AI-WORK-QUEUE.md): owner-mandated continuous delegation, ownership, ready briefs and dispatch evidence.

- [Shared Compare precision](COMPARE-SHARED-PRECISION-2026-11-26.md): older active visits vs latest destinations, crop wire compatibility, actual Mac aligned/stacked proof, simulator touch limit, remaining matrix and fixture cleanup.
- [Desktop passage picker](DESKTOP-PASSAGE-PICKER-2026-11-26.md): platform separation, book visibility, Mac Notes verse-grid flow and scoped UI acceptance.

- [Daily note retention](DAILY-NOTE-RETENTION-2026-11-26.md): original cleanup exemptions and why empty daily identities/metadata must remain.
- [All-visible Find](FIND-MATCHES-2026-11-26.md): additive drawing, final compiler/runtime verification and saved-highlight preservation.

- [November27 integration and UI evidence](INTEGRATION-REVIEW-2026-11-27.md): reviewed Claude work, fixes, tests, actual Mac/iPhone interactions, cache-build limitation and fixture preservation. [Superseded current checkpoints](CHECKPOINT-HISTORY-2026-11-27.md) are historical only.

- [Search context and Full verse](SEARCH-CONTEXT-2026-11-27.md): exact source, review corrections,418-test/build/signature receipts, actual Mac/iPhone UI, state preservation and approval-service publication interruption.

- [Complete Psalm Search openings](PSALM-SEARCH-OPENING-2026-11-27.md): raw-segment design, long-heading review correction,424-test/build/signature results, actual Mac/iPhone acceptance and fresh preservation receipts.

## November27 — Workspace persistence and lifecycle
[Canonical workspace writer/lifecycle](WORKSPACE-WRITER-2026-11-27.md) is the verified current persistence checkpoint. [DX05 window evidence](DX05-WINDOW-PARITY-EVIDENCE-2026-11-27.md) contains the source inventory, acceptance matrix and dated experiments; final clarifications supersede earlier provisional root-cause claims.
