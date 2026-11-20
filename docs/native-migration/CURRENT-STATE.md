# Current native migration checkpoint

Snapshot: **2026-11-20 15:25 Pacific**, Codex. Broad goal **ACTIVE**. **Pause by16:50 Pacific today / Nov21 00:50UTC**, and prepare final cleanup/handover by16:40. Claude resumes then. Do not work past the cutoff without a new owner instruction.

## Source and publication

- Checkout `/Users/roywe/Documents/ChatGPT/Berean/repo`, branch `native/reader-notes`. Fast-forwarded Claude's5f9b0c45 after preserving/reapplying Codex width work. Other checkout and owner process untouched.
- Focused commits: **ebd7f913** Messages/commands, **b816ec41** Presenter, **1c8004b1** iPhone reader/picker/Go/tabs, **e5816a96** inspector return. Published through **b8882e06**. Messages follow-up **1ec16c13** committed locally; documentation/publication next. [Delivered behavior, actual checks and open gates](PRESENTER-MESSAGES-POLISH-2026-11-20.md). [Continuous investigation](OWNER-UX-2026-11-20.md).
- PR24 verified OPEN/DRAFT/base`native/m6-navigation`, headb8882e06; its CI44831691582 is SUCCESS. Verify exact live head/checks after the next normal push.
- Owner-only merge order22→23 after correct retarget/checks→draft24. Push **github**, never local **origin**. No merge, ready, retarget, force, production/sync/schema/raw-identity changes. No Apple voices, quota resets or exhausted-agent retries.

## Verified and remaining

- **Latest344 shared tests pass** (340 Swift Testing /89 suites plus4 core XCTest), including five new Chat reference tests; `/private/tmp/berean-chat-reference-full-tests.log`. The prior **339** run:335 Swift Testing /88 suites plus4 core XCTest, including cross-conversation duplicate-ID reply/edit isolation. `/private/tmp/berean-polish-final-regression-tests.log`.
- Latest source Mac+iPhone builds pass: `/private/tmp/berean-chat-native-final-{mac,ios}-build.log`. Prior **exact committed development builds pass**: `/private/tmp/berean-polish-committed-{mac,ios}-build.log`. Development bundle identities verified. Existing AppKit background/tooltip, chapter-pull/reflow, reader-tap/Compare-selection/outline regressions pass: `/private/tmp/berean-polish-{reader-backgrounds,chapter-pull,reader-taps}.log`.
- Actual Mac: Presenter pause holds Scripture across navigation and rich note content across edits; resume updates; rendered heading/bold/table; reader annotation filtering matches. Main⌘T/⌘L cross-type same-ID replacement and main/Presenter/Chat⌘W routing pass. Repeated Chat open, rich message send, search, draft close/reopen, centered empty state and final rounded glass composer/content-sized bubbles pass.
- Actual iPhone: full-height Scripture and safe actions with dock shown/hidden, body-tap grouped verses3+4, clear/dock return; all-text picker search→Apocalypse of Elijah→chapters/verse grid; glass Go/autofocus; pinned separation and Scripture/lexicon previews; Messages rich rendering, draft back/return, send/reply/search/destination and final glass design pass.
- Corrected failures retained in evidence: unsafe direct underlap, competing Close commands, duplicate Mac search-toolbar crash, mistaken annotation property during compile. No failed experimental version is presented as delivered.
- Inspector native one-time restore: custom380pt return passed twice; settled Notes/Search/Compare/hide-show retain width and reading position. **First constrained presentation/window growth and actual manual/physical resizing remain open.** Old rejected SwiftUI-only attempts are not accepted fixes.
- Also open: physical phone/software keyboard, rotation/landscape, Dynamic Type/VoiceOver/Reduce Transparency, Compare underlap, rapid picker transitions, very long/wide-table message stress, save/edit failure injection, complete Presenter zoom/focus matrix. Larger keyboard shortcut was not established by CUA variants. Broader migration remains in TASKS.

## Safe runtime and data

- Mac only `/private/tmp/berean-codex-controls-qa/BereanMac.app --qa-library --qa-profile codex-controls-20261119`; scroll build running from the same QA path, PID28044/log`/private/tmp/berean-chat-scroll-mac-runtime.log`/shell99532; recheck arguments. Owner's separate PID11064 was left untouched. Recheck arguments before lifecycle/UI actions, especially after a crash: CUA getApp can auto-launch without QA flags. A default-profile library-lock alert was encountered after a crash; no edits followed, and only that verified copy was stopped.
- Mac restored Genesis1KJVA/selected1/Notes inspector, sidebar239, divider1200, reader scroll0.4182415776499589. Window now1540pt after fresh-window recovery; former1488pt geometry was not restored. Persisted anchor remainsGEN1verse11/offset509. **21 original notes, all original tags/folders and exact37 active IDs unchanged**. Owned Presenter note bb0ee673-5af1-4219-a78a-2a706829a473 recoverably trashed; all temporary tabs closed.
- iPhone only D0CC2F4C-AC47-4648-AC5C-0DC128CFCE7D /com.berean.native.ios.dev; final native-input buildPID29643 (recheck). Container path `/private/tmp/berean-note-keyboard-ios-container.txt` (re-query after each install). Restored Psalm3LXX/no selection/dock visible/CaptureKeyboardOFF/ZoomToFit, no sheets. **26 original notes, all original tags/3folders and exact47 active IDs unchanged**.
- Local owned Chat fixtures remain (no Chat Trash): Mac Unfiled3messages; iPhone Unfiled6messages and conversation92312603-3f00-418a-98c0-dbdc89b1b79d4messages. Exact snapshots `/private/tmp/berean-messages-polish-{mac,ios}-fixtures.json`. Drafts cleared. Do not silently hard-delete these fixtures.
- Baselines `/private/tmp/berean-claude-polish-{mac,ios}-baseline.json`; original-row hashes use sorted-key JSON with ensure_ascii=False. All original rows and exact active-ID sets were rechecked after final UI cleanup. All reference/composition CUA phases complete; both apps restored. Latest exact source builds and344 shared tests pass; focused evidence has the logs and actual limits.
- Established build cache `/private/tmp/berean-scripture-block-final-dd`; Swift scratch `/private/tmp/berean-study-block-tests`. Avoid cloud-offloaded repository DerivedData. Ollama removal is complete; do not retry admin commands.

## Next executable work

1. Finish documentation/publish1ec16c13 normally, then verify PR24 draft/base/exact head and its own CI. Reference links, initial message position and iPhone composing have actual bounded UI proof; both builds and344 shared tests pass. Continue Presenter keyboard/focus checks next. Do not restart/cancel live jobs on a timeout.
2. Continue the ready quality gates, especially Messages internal reference routing and Presenter keyboard/focus behavior, then wider physical/large-type/picker/resize matrices where tools permit. Preserve the restored runtime and original-row invariants.
3. Keep HANDOFF/CURRENT-STATE and focused evidence up to date during changes. Before the hard handover, commit/push tested work, record exact remaining dirty/unverified work, verify live state, and **pause** the broad goal rather than completing it.

HANDOFF is the single entry point. AI-CONTINUITY, OWNER-PRINCIPLES and DOCUMENTATION-MAP explain the continuing requirements. Historical checkpoints are archived in CHECKPOINT-HISTORY-2026-11-20; they are not current runtime instructions.
