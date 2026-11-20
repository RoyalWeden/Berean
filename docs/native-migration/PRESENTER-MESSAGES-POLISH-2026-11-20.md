# Presenter, Messages and iPhone navigation polish — 2026-11-20

Owner request: improve the quality and appearance of Claude's new work, especially Presenter and Messages; extend iPhone Scripture beneath floating controls; make all installed texts easier to choose; improve Go and tab previews. **Work must pause by 16:50 Pacific on Nov20 for Claude's return.** HANDOFF and CURRENT-STATE are the startup documents. OWNER-UX-2026-11-20 contains the continuous investigation, including failed attempts.

## Focused source commits

| Commit | Result |
| --- | --- |
| ebd7f913 | Messages layout, rich bubbles, per-conversation drafts, search, explicit destination, save-error retention, conversation-scoped message identities; Mac study/auxiliary command ownership and a single native Close command. |
| b816ec41 | Presenter retains rendered content when paused; rich note presentation; quieter Scripture/lexicon hierarchy, grouped size controls and explicit Live/Paused status. |
| 1c8004b1 | iPhone reader underlap, fixed glass Go/picker headers, a full-height searchable text chooser, stale chapter-preview protection, richer tab previews and a separate pinned section. |
| e5816a96 | One-time public native inspector-width restoration after visible geometry exists, with obsolete/hidden callback guards and user-resize cancellation. |

These commits follow Claude's 5f9b0c45. They preserve his new PDFs, transcripts, Ask, images, Word Replacer, history and onboarding work. Those features have not all received a new interaction audit in this pass.

## Verified behavior

### Presenter and window commands

- Pause Genesis1, navigate the main window to Psalm23: Presenter retains Genesis. Resume shows Psalm23.
- Present an owned note with a heading, bold phrase and table. The audience view renders actual structure. Pause, edit the main note, and resume: the edit appears only after resuming.
- Psalm23 supplied-word filtering is reflected in Presenter: “Yehovah my shepherd” matches the filtered main reader. Render requests retain annotation/replacement settings, and paused snapshots keep their previous rendered words.
- Chapter headings remain visible when following verse1. Live/Paused is explicit. Smaller keyboard shortcut and Larger control were exercised, returning the isolated setting to160%. The larger keyboard shortcut was not established by the CUA key variants; keep that check open.
- Main ⌘W closes its current tab. Presenter and Chat ⌘W close only their own window. Repeated auxiliary open/close leaves the main document and tab count intact. Main ⌘T and ⌘L work; an owned Jonah1 tab changed to G5463 with the same tab ID and count. ⇧⌘W is the explicit Close Window command; its physical-key coverage remains open.

The initial command fix left two competing Close shortcuts. The final implementation replaces SwiftUI's `saveItem` command group, rather than adding another ⌘W. [Apple documents this group as including Close](https://developer.apple.com/documentation/swiftui/commandgroupplacement/saveitem).

### Messages

- Mac and iPhone render emphasis without Markdown delimiters. Short bubbles fit their content; the composer is one inset rounded glass group with a Reduce Transparency fallback. Mac empty search results are centered above the composer. Final glass layout was visually checked on both platforms.
- iPhone draft survives returning to the conversation list and reopening. Mac draft survives closing and reopening the Chat window. Test drafts were cleared.
- iPhone send, reply context, search/no-results and All Messages destination selection were exercised. Read-only store inspection confirms messages were saved to the selected conversation. Mac send, message search, draft and repeated window close/reopen were exercised.
- Message addresses combine chat ID and message ID for selection, edit, reply and scrolling. A regression uses the same legacy ID in two conversations and proves replying/editing the second leaves the first unchanged. Stored/raw message IDs and the legacy table shape are unchanged.
- Save/edit failures retain the draft or open edit and show a local error. Failure-injection UI coverage remains open.

Opening Mac Chat initially exposed an NSToolbar insertion crash: both columns registered `.searchable` toolbar items. The final Mac sidebar has an inline glass conversation field; only the thread owns native toolbar search, and explicit Chat toolbar item IDs are used. Actual repeated open/close passes supersede the failed build/runtime attempts. Crash reports and precise process handling are recorded in OWNER-UX.

### iPhone reader, picker, Go and tabs

- Long Scripture flows beneath the top chrome and to the physical bottom. Body taps on verses3+4 produce one grouped dashed outline with a faint fill. Actions remain above the home indicator with the dock both visible and tucked away, with text continuing behind them. Clear works while the dock is hidden; scrolling back reveals the dock.
- Passage picker opens without forcing the keyboard. Choosing a text opens a full-height searchable sheet with Bible and Other writings sections and roomy rows. Searching “elijah” finds Apocalypse of Elijah; choosing it opens its five chapters directly, then its verse grid. Selection dismisses the text sheet/keyboard. Searching the main picker replaces the stale chapter grid with results.
- Go retains a fixed glass search header, focus for immediate typing, clear/dismiss controls and glass destination shortcuts. Typing “chat” without tapping the field finds Berean Chat.
- Tabs show a separate Pinned section and adaptive card widths. Actual Scripture and lexicon previews were checked. Scripture previews use prepared reader numbering, display filters and the saved reading verse; they do not consume edition-restoration state. Async completions cannot replace a newer preview. Large-type, many-tab and final saved-verse-priority interaction matrices remain open.

## Inspector width evidence and limits

The public NSSplitView restoration passed the original custom380pt Bible→inspector-closed Bible→close→return case twice with exact scroll/divider values. After a fresh-window recovery, settled Notes→reader, Search→reader, Compare→reader and explicit inspector hide/show retained the current340pt pane and reading position. Hide/show differed only by3e-16 in the normalized scroll value.

The fresh constrained window grew during its first native inspector presentations. The final window was1540pt, rather than the former1488pt; do not describe that geometry as restored. Both coordinate-drag attempts failed to establish actual manual resizing. **Constrained first presentation, physical divider drag, resize cancellation, maximum/minimum widths and all layout combinations remain open.** Older failed SwiftUI-only fixes are documented in READER-VIEWPORT-RESTORATION and must not be repeated as though verified.

## Validation and data ownership

- Full shared suite: **339 passed** (335 Swift Testing tests /88 suites plus4 core XCTest cases), including the extended cross-conversation edit/reply regression. `/private/tmp/berean-polish-final-regression-tests.log`.
- Both final visual-pass builds passed. Mac `/private/tmp/berean-mac-glass-composer-build-corrected.log`; iPhone `/private/tmp/berean-ios-glass-composer-final-build.log`. Exact committed builds also pass (`/private/tmp/berean-polish-committed-{mac,ios}-build.log`), with verified Dev identities. Existing AppKit rendering, tooltip, gesture intent, reflow and Compare-selection regressions pass (`/private/tmp/berean-polish-{reader-backgrounds,chapter-pull,reader-taps}.log`).
- Read-only preservation checks: **21 original Mac notes,26 original iPhone notes, every original tag/folder row and exact37/47 active tab IDs unchanged**. The owned Mac note was recoverably trashed; temporary reader/lexicon tabs were closed. No sync/schema/raw annotation identity changes.
- Only the named Mac QA profile and the established iPhone simulator were edited. Original owner Mac process was left untouched. After a crash, CUA auto-reopened the QA-path app without QA arguments; the library lock blocked access, no edits followed, and only that verified process was stopped. **Check the live process and arguments before reacquiring CUA after a crash.**
- Owned local Chat fixtures remain because this feature has no Trash: Mac Unfiled1message; iPhone Unfiled1message and conversation92312603-3f00-418a-98c0-dbdc89b1b79d4messages. Exact fixtures live in `/private/tmp/berean-messages-polish-{mac,ios}-fixtures.json`. Do not silently hard-delete them.

## Next quality gates

Physical iPhone and software-keyboard behavior; landscape/rotation, Dynamic Type, VoiceOver and Reduce Transparency; Compare underlap; rapid picker/text transitions; long/wide rich messages; send/edit failure injection; complete Presenter zoom shortcuts and chapter/focus/scale combinations; inspector constrained/manual resize matrix. Explicit internal links and automatic Scripture/Strong's references in Messages also need an interaction audit. Broader PDFs/Ask/YouTube/read-aloud/splits parity remains in TASKS. No Apple voices, production-data changes or owner-only merge actions are authorized by this polish pass.
