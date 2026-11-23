# Passage picker labels, reference cursors, and result hover

November 23, 2026

## Passage picker

The shared picker shows **Book 1** through **Book 10** for Recognitions of Clement (`recog_clement`, `RCL1` through `RCL10`). Both Shepherd of Hermas editions (`hermas` and `hermas_taylor`) show **Visions**, **Mandates**, and **Similitudes**. Book search recognizes the displayed names alongside the existing corpus names. Canonical references, storage IDs, and full accessibility names stayed intact. All 19 helper assertions passed against 16 actual corpus rows and three fallback cases. See `picker-short-names-check.py` and `picker-short-names-check.log` in the November 23 QA evidence. Source commit `7e69e745`.

- **Mac runtime passed.** Searching for “Book 3” and using the Books button opened the full Recognitions list. Searching for “Mandates” opened the three Hermas sections. Screenshots showed the concise labels, while accessibility exposed the full names. Escape returned to Jeremiah 33 with no chapter selected. Direct automation clicks on list rows dismissed the popover without choosing a text, so the verified path used search and the Books button.
- **iPhone runtime passed.** The installed build on the owned D0CC simulator (cold launch PID 45758) showed **Book 1** through **Book 10** as compact tiles and the three Hermas sections in one row. The Taylor edition exposed full accessibility names and chapter counts. Done returned to Matthew 5 with verse 12 selected and nine tabs. No chapter was selected in the picker.

## Reference cursors and Mac interaction

`MacReferenceCursorTextView` registers cursor regions from rendered glyphs. The rich note editor excludes image resize handles. `ReferenceLinkText` keeps TextKit layout, selection, and URL routing together for interactive Markdown in Notes, Messages, Calendar, Trail, and Presenter. Link-free and noninteractive library cards retain their existing renderer. Message citation buttons have scoped hover feedback. Source commit `c6d2267d`.

The new view passed SDK type checking and nine TextKit alignment and width cases. Review corrected finite-width measurement. An offscreen AppKit probe caught a wrapped link whose hand-cursor region extended past its glyphs to the blank right edge at x=190. The subsequent fix uses per-line, per-run glyph bounds clamped to the used extent. The probe passed for linked glyph centers on every wrapped line, ordinary text with an I-beam, blank space to the right and below the last line, image handles, and an unselectable view. macOS 27 type checking and whitespace checks passed. See `reference-cursor-probe/check.zsh` and its log. The fix leaves source content and metadata serialization intact.

- **Messages runtime passed on Mac.** An existing formatted QA message rendered its heading, Psalm 23:1 and G5485 links, linked Scripture table, bullets, and literal code. The heading selected as plain text. Right-clicking inside the linked paragraph still showed Reply, Copy, Edit, and Delete. G5485 opened the correct Lexicon entry, and closing the extra tab returned the count to seven. Psalm 23:1 reused the main reader at seven tabs, and Back restored Jeremiah 33. The Messages window was closed without executing a message action or writing content.
- **Notes runtime passed on Mac.** The owned fixture `fbfefd6b-3ad6-46c2-87df-c382142f4b9c`, “Codex link cursor audit Nov23,” rendered explicit Psalm 23:1 and G5485 Markdown links as rich links and exposed them to accessibility. Ordinary text was selectable. G5485 opened the correct entry, and closing the extra tab restored the count to seven. The first automation click left focus in the title and put part of the fixture text there. The audit corrected the title and body of that fixture after verifying body selection. The fixture then moved to recoverable Trash through the normal confirmation flow.

## Search result hover

The shared result button style adds neutral hover and press feedback to advanced search hits, tagged passages, recent queries, and Lexicon results. Edition filter chips also use the existing option hover treatment. Match highlights, menu actions, and native button focus are preserved. The change introduces no keyboard handler or forced cursor. Source commit `07e8a99b`.

## Build and cleanup status

Earlier Mac trace build 67284 and iOS build 4321 succeeded. The picker was then verified on the installed iPhone simulator build as described above. Those early builds preceded the completed glyph clamp. Mac build 66510 and the iOS retry both passed with the glyph clamp and Lexicon bridge included.

The Mac audit restored the Thursday November 19 note tab and the Search “voicejoy” return target. Jeremiah 33 and the LXX-left/KJV-right Compare fixture were preserved for the separate geometry follow-up. Original IDs and content hashes were unchanged. Two owned Mac fixtures, including the earlier slash-command fixture, and one owned iPhone fixture are in recoverable Trash.

Continuous pointer movement and flicker, VoiceOver operation, the hover/focus/disabled matrix in light and dark appearance, and Lexicon Command-click still require runtime verification.
