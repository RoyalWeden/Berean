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


## Messages reference and composition follow-up — 15:25 Pacific

Plain Scripture and Strong’s references now become native internal links in the rendered message. Existing explicit links keep their destinations; code, image sources, comments, URLs and unfinished Markdown constructs are excluded. Generated links are an ephemeral rendering copy: saved source, personal-note citation indexing and raw message IDs are unchanged. Clicking a reference reveals the main document and uses ordinary destination navigation/reuse. AI verse buttons use the same behavior.

Messages uses composite stable targets in a declarative scroll layout, with a bottom anchor for the initial offset only. This fixes the actual iPhone reopening case where the latest message was below the viewport without forcing subsequent viewport size changes to jump to the bottom.

The iPhone composer is a compact native multiline text view that grows to eight lines. Return inserts a line break; Send and Command-Return send. Smart quotes and dashes are disabled so Markdown tables and code are preserved. Mac retains its existing text-field interaction.

Verification:

- **344 shared tests pass:**340 Swift Testing /89 suites plus4 core XCTest. Five new reference tests cover UTF-16 ranges, repeated references, explicit editions, canonical Strong’s IDs, protected Markdown, idempotence, table structure and nonbreaking spaces. Existing eight Strong’s tests pass unchanged. `/private/tmp/berean-chat-reference-full-tests.log`.
- Actual Mac: plain Scripture/Strong’s and explicit Scripture links open correctly, close Chat and show the main document. Back returns the selected verse. A longer message renders heading, bold, real table, list and code; search finds table text; close/reopen shows its ending fully above the composer.
- Actual iPhone: plain Scripture/Strong’s links open correctly and dismiss Chat. Initial opening shows the latest message; touch drag reaches older messages. The final native input accepts multiple lines, grows and scrolls within its limit, sends with Command-Return, shrinks after send, and retains an unsent two-line draft across conversation-list navigation. Search finds the formatted message. Heading, bold, table and code render correctly. Read-only source inspection confirms the literal `| --- | --- |` separator and complete final paragraph were saved.
- Rejected experiments are recorded in OWNER-UX: TextField Return submitted/dismissed; an unconstrained TextEditor expanded excessively; smart punctuation invalidated a table; a FocusState binding was unsuitable for the UIKit input. These versions are not delivered behavior.
- Final iPhone build `/private/tmp/berean-chat-native-final-ios-build.log` passes. Final Mac build `/private/tmp/berean-chat-native-final-mac-build.log` passes. No further shared parser logic changed after the full test run.
- Both apps restored to original reading tabs; iPhone Capture Keyboard OFF, no sheets/draft. All original notes/tags/folders and exact37/47 active tab IDs match the baselines. Local Chat fixtures remain: Mac Unfiled3, iPhone Unfiled6 plus4 in the owned conversation; no Chat Trash exists.

Remaining: physical phone/software keyboard, Dynamic Type/VoiceOver/Reduce Transparency, iPad/rotation, external-link handoff, AI verse-button runtime and save/edit failure injection. Shorthand “Jude5” is not recognized by the existing note auto-link parser; typed navigation separately supports it. No legacy golden parser was changed. Broad Presenter zoom/focus and inspector first-presentation/resize gates remain open.

## Presenter zoom shortcuts — root cause and fix (Claude Code, 2026-11-20)

- **Root cause of the unproven "larger" shortcut:** the View menu's text-size items (⌘= / ⌘- / ⌘0, "Scripture Text Size") sit in a group with `.disabled(isStudyWindow != true)`. In the Presenter window those menu items were present but disabled, owning the key equivalents ahead of the toolbar buttons' own `.keyboardShortcut`s.
- **Fix:** the Presenter publishes a `presenterZoom` focused scene value; while it is key, View shows **Larger Presenter Text (⌘=) / Smaller Presenter Text (⌘-) / Reset Presenter Text Size (⌘0)** outside the study-window-only group (main window keeps the Scripture items). The toolbar buttons no longer declare duplicate shortcuts. The menu writes through the `$scale` binding — a captured view copy and a raw UserDefaults write both failed to update the view (tried, recorded).
- **Verified (Mac QA instance, menu by PID, screenshots of the Presenter window):** with Presenter key the menu lists the three Presenter items, all enabled; Larger 180→200 %, Smaller ×2 → 160 %, Reset → 160 % (left at the 160 % default). With the main window key, View still shows the Scripture text-size items.
- Not exercised: physical key presses — another process cannot reliably activate the QA app (cooperative activation), so synthesized keystrokes may land in another app; the shortcuts are the enabled menu items' key equivalents.

## Presenter chapter / focus / scale matrix (Claude Code, 2026-11-20)

Mac QA instance, driven only by AXPress (sidebar tabs, Pause/Resume) and View menu items by PID; Presenter-window screenshots for each step.

| Step | Result |
|---|---|
| John 1 at 200 % | Live, verse 1 focused, larger type |
| Main window → Exodus 31 (saved verse 13) | Presenter follows, verse 13 focused at 200 %, Word Replacer applied (Yehovah) |
| Pause, then main → John 1 | Presenter stays on Exodus 31 v13, title "Presenter — Paused" |
| Resume | Jumps to John 1 v1 |
| Smaller ×6 | 80 % floor, Smaller disabled |
| Larger ×17 | 400 % ceiling; menu reports Larger disabled, Smaller/Reset enabled |
| Reset | 160 % |
| Note document (QA Image Note) | **Bug found:** inline image shown as `Cave 4 fragment|w360` text → fixed: `MarkdownText` now renders `data:` image lines (saved width, caption) — also improves every other Markdown preview. Re-verified: image + caption shown |

Not covered: selecting a verse in the main reader while live (needs a pointer click in the reader); physical keyboard presses (see above).

### Live verse selection + Mac reader accessibility actions (later, 2026-11-20)

- Gap found: verse selection in the Mac reader was pointer-only (no per-verse accessibility path for VoiceOver). Added `accessibilityCustomActions` on `ReaderTextView`: **Select or Deselect Verse** (= click, toggles the verse at the text cursor) and **Select Through Verse** (= Shift-click range).
- Verified click-free with AX (cursor via AXSelectedTextRange, action via its `Name:` action string): toggling verse 5 → tab "John 1:1, 5" and the live Presenter highlights both; deselect 1 + Select Through 8 → "John 1:5–8", Presenter scrolls to verse 5 and highlights 5–8. Selection restored to verse 1 afterwards.
- Presenter matrix now covered except physical keyboard presses.

### iPhone reader VoiceOver verses (later, 2026-11-20)

- Same gap on iPhone: the chapter was one text element for VoiceOver. `ReaderTextView` now exposes one `VerseAccessibilityElement` per verse — label "Verse N", value = verse text, Button trait (+ Selected when selected), double-tap = the normal verse tap (select/deselect), custom action **Verse Actions**; frames come from TextKit glyph rects so VoiceOver scrolls and focuses the right lines.
- Verified on sim E8B01B22 via the accessibility hierarchy: 15 visible verse elements for John 1 with frames matching the drawn verses (Verse 2 at y 128–152); a real tap on verse 3 → element reports Selected and "Selected John 1:3"; deselected afterwards. VoiceOver gestures themselves (double-tap, rotor actions) need a device/VoiceOver pass.
- Trade-off: Strong's links and word-level text inside a verse are not separate VoiceOver stops (they were not reachable as links before either).

### Real key presses (later, 2026-11-20) — CLOSED

Key events delivered with `CGEvent.postToPid` to the QA instance only (no global keystrokes, so nothing can land in another app):
- Presenter key: ⌘= 160→180, ⌘= →200, ⌘- →180, ⌘0 →160 (screenshots of the zoom label).
- Main window key: View shows "Increase Scripture Text Size"; ⌘= changed the Scripture `fontSize` 16→17 (QA DB) while the Presenter stayed at 160 %; ⌘- restored 16.
The Presenter zoom/focus matrix is now complete on Mac. (Harness `keypid.swift`: Command+keycode to one PID — use this instead of System Events keystrokes for Mac QA.)
