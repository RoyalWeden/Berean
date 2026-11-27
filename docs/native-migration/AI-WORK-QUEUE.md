# Shared Codex and Claude Code work queue

Owner instruction, November 26: continuously prepare and delegate independent tasks for Claude Code and keep separate tasks for Codex. Codex may take a Claude-assigned task only when its current work, verification and handoff are covered and usage is sufficient to finish the task. An active goal is not a reason to silently take over Claude’s files.

## How both AIs use this queue

Start with HANDOFF, CURRENT-STATE, OWNER-PRINCIPLES and AI-CONTINUITY. Verify live Git, dirty work, actual processes and branch before choosing work. Claim exactly one ready task, record worker/session/worktree and start state here, then update after meaningful progress. Keep at least one concrete next Claude task ready; split fresh parity gaps or owner requests into bounded briefs while Codex works. Never call a prepared brief running or complete without actual dispatch/result evidence. A stopped worker label is not a live process.

Use isolated branches/worktrees for parallel code work. Do not edit another worker’s reserved files, stage their changes, reset work, share build output directories or run concurrent UI tests. Codex coordinates integration and final UI verification. Claude must return exact changed files, commit if authorized, commands/results, unverified cases, and a concise handoff. Preserve production stores/sync/identities, canonical source/verse identities and legacy contracts. No merges, retargets, force pushes, physical phone installs, signing/provisioning changes or Apple voices. Only owner reviews/merges the guarded stack.

## Assignment board

| ID | Owner | State | Result / scope |
|---|---|---|---|
| DX-01 | Codex | Partial verified, wider cases open | Mac reader width-aware restoration; prove measured same-verse crop across width changes and same-width exact points. Temporary QA traces must be removed before final builds. |
| DX-02 | Codex | Mac core cases verified; wider matrix open | Committed precise aligned/stacked older visits and cold crops; iPhone aligned olderA/cold row3 crop63 is verified; stacked-iPhone, reflow, interruption, empty and duplicate cases remain. |
| DX-03 | Codex | Implemented Mac slice; wider checks open | Improve verse note/cross-reference/tag indicators, hover preview alignment and fluid native appearance without interrupting reading. Owner reaffirmed Nov26. |
| CC-01 | Claude Code | **Integrated** (Nov26) | Branch `native/claude-search-order-20261126` @ `a90d788c`: four-way Order picker, reverse = groups then verses mirrored; iPhone (E8B) + Mac QA verified, both builds PASS. [Report](CLAUDE-CC-01-REPORT.md) is on that branch. |
| CC-02 | Claude Code | **Integrated** (Nov26) | `native/claude-search-groups-20261126` @ `932f9db3` (on top of CC-01 `a90d788c`): whole-row disclosure headers with counts; per-tab SceneStorage scoped to one query+options fingerprint (survives result round trip, never leaks); pending result return keeps its group open; collapsing the saved row falls back to the header. Both builds PASS; iPhone E8B + Mac QA verified. Integrated after CC-01 through `90171b62`. Report on that branch. |
| CC-03 | Claude Code | **Audit complete; integrated** (Nov26) | [Report](CLAUDE-CC-03-REPORT.md): three issues — Messages folder rename/delete missing (+ silent `try?`), reply quote not a jump to the original, Presenter note does not follow main-window scroll. Side panel left out (already open in U07); "Laser" in U07 looks stale (original has none). |
| CC-04 | Claude Code | **Integrated** (Nov26) | `native/claude-chat-folders-20261126` @ `d778c4b2`: transactional `ChatsService.renameFolder` (+test), Rename/Delete Folder (header menu on Mac; conversation Folder submenu on both), sidebar errors reported instead of `try?`, reply quote jumps to and tints the original. 391 package tests + both builds PASS; iPhone E8B real taps and Mac QA AX verified; fixtures removed. Report `docs/native-migration/CLAUDE-CC-04-REPORT.md` on that branch. |
| CC-05 | Claude Code | **Deferred until Codex releases AppModel** | Presenter note follow may use one lightweight ephemeral note viewport field in AppModel once separately assigned. Search-option persistence is a local-only research question. Keep sync and existing key contracts unless research proves a change is needed and Codex agrees. |
| CC-06 | Claude Code | **Ready, undispatched** | A32 iPhone Study Trail title and control insets. Own StudyTrailView.swift plus a focused report. |
| CC-07 | Claude Code | **Ready, undispatched** | A15 iPhone Trash visible Restore and removal of Trash compose. Own NotesHome.swift plus a focused report. |

## Reserved files during current parallel work

Codex owns apple/BereanMac/ChapterTextView.swift, apple/Shared/AppModel.swift, apple/Shared/CompareView.swift, Packages/BereanKit/Sources/BereanWorkspace/CompareViewport.swift and its tests. Do not edit these from Claude’s tasks. Codex will also own ScriptureView/IOSChapterTextView and shared reader indicator/preview rendering when DX-03 begins. Claude’s Search work owns ScriptureSearchView.swift and, only if necessary, SearchViewport.swift and its tests. Shared checkpoint/queue integration is coordinated by Codex; Claude writes a task-specific report in its worktree.

## CC-01 — Search order directions

Problem: the original desktop Search supports forward/reverse Scripture order and best match first/last; native Search offers only Scripture order and Best match first. References: src/components/bible/ScriptureSearchView.tsx around873–895 and1290–1297; native apple/Shared/ScriptureSearchView.swift order picker and shown/groups. Verify actual code rather than relying on old line numbers.

Implement a minimal native control offering both directions while preserving current defaults, filters, counts, text/book/no grouping and result actions. Use the existing local Search state and compatible fields; do not change schema, sync allowlists, canonical IDs, source data, or introduce settings that leak private configuration. The configuration/render fingerprint must distinguish all order choices so position/history does not reuse the wrong list. Reset Options should restore the existing default. Keep reading hits and copied text unmodified. Preserve scoped book filtering and the fixed scope callback (never read computed model state inside an exclusive app.update mutation).

Ownership: ScriptureSearchView.swift only to start; SearchViewport.swift/tests if a real contract change is necessary. No AppModel, Compare, reader, Notes, Presenter or Messages edits. Use an isolated worktree. Do not alter owner folder or running apps.

Acceptance: compare known multi-text query voice of joy in all order/group combinations; reverse has opposite first/last results and group order where applicable, best match last reverses the available relevance sequence, counts remain identical, changing order does not reuse an incompatible anchor, Back/Forward preserves each visit, Reset restores default. Both platform builds and actual UI remain required; if tools cannot run, report pending explicitly. Do not fabricate test passes or create a mirrored test of private view code.

Deliver a focused patch and docs/native-migration/CLAUDE-CC-01-REPORT.md with changed files, reasoning, checks and remaining cases. No commit/push unless the dispatch explicitly authorizes it; Codex will review and integrate.

## CC-02 — Collapsible result groups

Problem: original Search can collapse result groups while retaining headers/counts; native headings are static. Inspect original ScriptureSearchView.tsx around934–945/1837 and native grouped results. Implement whole-row header disclosure with native hover/tap feedback; preserve counts, text/book grouping, keyboard/result actions, group jump and all editions. Collapse state must be scoped to the right query/options and remain device-local. Do not overwrite opaque filter fields. A saved result inside a collapsed group must restore via an explicit sensible header fallback or expand that group for a deliberate result return; never silently scroll to an unrelated row. Empty and ungrouped results should stay clean.

Run only after CC-01’s files are released/integrated. Acceptance includes collapsing the first group, navigating to another group, result→Back into a collapsed group, manual scroll replacement, order/filter changes and Mac/iPhone accessibility. Create a focused report and keep unverified cases open.

## CC-03 — Presenter and Messages follow-through

Read original Electron Presenter/window and messaging workflows plus current native implementation and focused Presenter/Messages docs. Audit discoverability, text size/spacing, keyboard/focus, rich reference click/selection/copy behavior, accessibility labels and existing sync contracts. No app/data edits in this task. Return at most three source-supported issues with a concrete reproduction, affected files and a bounded implementation/verification packet. Avoid repeating already-fixed or already-owned reader/Compare issues. Promote the strongest independent fix to a new ready Claude implementation task after Codex checks ownership.

## Scheduling and usage

Codex continuously replenishes the Claude-ready queue and records dispatch outcomes. Do not restart a live worker after a timeout; inspect its exact handle/process. Do not reset limits or switch credentials. If Claude is unavailable, leave the assignment ready and record the actual reason. Codex taking over requires an explicit queue ownership change, a clear usage/readiness judgment and no other worker still editing those files. Before any final handoff, verify install-ready owner-folder Mac and signed iPhone builds and provide the owner’s simple commands.

## November 26 dispatch evidence

CC-01 isolated worktree created at `/Users/roywe/Documents/ChatGPT/Berean/claude-worktrees/search-order`, branch `native/claude-search-order-20261126`, base b4db91b8. Restricted file-tools-only Claude Sonnet launch attempted; session `89306171-0a74-4173-9ed5-f801336db4e9` ended immediately with **Not logged in · Please run /login**, zero model tokens and no file edits. No live Claude task. CC-01 stays assigned to Claude, awaiting its normal login; no reset or credential change attempted. CC-02/03 remain prepared. Codex continues DX-01/02/03.


## November 26 Codex checkpoint

Desktop picker and shared Compare source are committed in `90e2b88b` and `2bb1670d`. The aligned older-visit iPhone cold replay passed at row 3/crop 63. Keep iPhone stacked precision, reflow/interruption/empty/header/duplicate cases and Compare Edit picker open. Revert the Compare accessibility grouping and label experiment because both variants hid individual verse controls in Device Hub. Owner Mac/signed-iPhone/Simulator builds and artifact checks PASS at2bb1670d. CC-01 remains assigned to Claude, blocked at normal sign-in, with no active Claude worker. [Desktop picker evidence](DESKTOP-PASSAGE-PICKER-2026-11-26.md) [Shared Compare evidence](COMPARE-SHARED-PRECISION-2026-11-26.md)

Read Aloud input parity passed 68 cases each on Mac and iPhone Simulator for fixture tokenization and real voice-style bits. Production tokenizer assets, ONNX inference and audible output remain open. [Read Aloud evidence](READALOUD-INPUTS-2026-11-26.md)

## November 26 Claude Code result — CC-01

Claude Code (session fa975be4, normal login) claimed CC-01, fast-forwarded the prepared worktree to 7b7631b8 and committed `a90d788c` on `native/claude-search-order-20261126` (pushed; no PR, no merge). Only `apple/Shared/ScriptureSearchView.swift` changed. Direction is encoded in the native-only `sort` field (`bookOrder|bookOrderReverse|relevance|relevanceLast`) so SearchViewport fingerprints/history snapshots distinguish orders without a contract change. Verified on Claude's simulator E8B01B22 with real taps and on Claude's Mac QA instance via AX: 19 results in every order; exact first/last and group mirrors under By text and By book; Reset restores the default; result→Back keeps the order. Pre-existing finding for Codex: Search tab options (order, grouping, scope, match, testament, books) are not persisted across relaunch because `TabFields.sync[.search]` keeps only `query`. Details and open cases in the branch's `docs/native-migration/CLAUDE-CC-01-REPORT.md`.

## November 26 Claude Code result — CC-04

Implemented CC-03 #1 + #2 on isolated branch `native/claude-chat-folders-20261126` (`d778c4b2`, pushed; not integrated, no PR). Files: ChatsService.swift (+ChatsServiceTests), ChatViews.swift only. Integration order suggestion: CC-01 (`a90d788c`) and CC-04 (`d778c4b2`) touch disjoint files and can land independently; CC-02 must follow CC-01.

## November 26 Claude Code — integration readiness

Dry merges (git merge-tree, nothing committed) onto `native/reader-notes` @ `8e1b116d`: `native/claude-search-groups-20261126` (CC-01 + CC-02) **clean**; `native/claude-chat-folders-20261126` (CC-04) **clean**; both together **clean**. All Claude-assigned work is complete; the next Claude task (CC-05) waits on Codex's ownership/contract rulings recorded above.

## November 26 evening handoff

Claude CC-01, CC-02, CC-03 and CC-04 are complete and integrated through root revision `90171b62`. Earlier branch reports and the signed-out dispatch remain historical evidence. The owner resumes Claude at 8:00 p.m. PST. Codex is scheduled to pause at 7:55 p.m. PST. CC-06 and CC-07 are ready and undispatched. Verify the latest base and file reservations before assigning either task. Root retains ScriptureView, CompareView and chapter TextKit sources. ChatService quality work has a separate owner. [Integration evidence](INTEGRATION-REVIEW-2026-11-26.md)

## CC-06 — Study Trail iPhone title and controls (A32)

Own only `apple/Shared/StudyTrailView.swift` and a focused report. Diagnose the missing or blurred library and detail titles around the navigation stack and top safe-area material. The detail controls already have 12-point padding, so measure actual insets before changing the owning container. Keep the Mac presentation, routes, list/map, search and trail service callbacks. In isolated E8B QA verify title and alignment from library → live or paused trail → Back, with search, scrolling, list/map and larger text. Use an owned synthetic trail if state changes are needed. Preserve existing trails. Build both platforms and report actual checks and limits.

## CC-07 — Visible iPhone Trash Restore (A15)

Own only `apple/Shared/NotesHome.swift` and a focused report. Hide New Note in iPhone Trash and add a visible, named per-note Restore route using the same error-reporting restore action as the existing swipe or contextual command. Keep normal folder compose, Mac presentation, swipe/context actions and the integrated A14 permanent-delete confirmation. Verify populated and empty Trash, visible and accessible Restore, ordinary compose outside Trash, and canceling permanent-delete confirmation. Exercise only an owned synthetic fixture through recoverable UI. Build both platforms and report actual checks and limits. Do not purge a note.
