# Berean Native Migration — Resumable Session State

## 2026-11-12 checkpoint

- Isolated clone: `/Users/roywe/Documents/ChatGPT/Berean/repo`, branch `native/reader-notes`; implementation through `87fd228`. The existing `/Users/roywe/Berean-native` worktree was left in place.
- Review stack at the time of work: #22 (`26a3835`) → main, green; #23 (`670f5b6`) → `native/m7-export`, native CI green and legacy CI running when checked. Draft PR [#24](https://github.com/RoyalWeden/Berean/pull/24) is based on #23. Recheck GitHub before acting. Owner merges #22, waits for #23 to target main, then reviews/merges #23 when green. Apply the same retarget check before merging the follow-up. ADR-0007 requires a local Mac build check with Xcode 27.
- No production store, iCloud, signing, schema, bundle IDs or legacy source modified. Only explicit immutable corpora linked into this checkout. Native Dev libraries used for UI checks.

## Delivered

| Commit | Change |
|---|---|
| `793a525` | Full catalog in both native app bundles, including 14 previously missing corpora. |
| `22da4aa` | Calendar on both apps, using legacy month/date state and existing daily-note identity. |
| `83c2e96` | Continuous selectable iPhone chapter with inline Strong’s and verse actions, cleaned copy, and mapped character highlights. |
| `65c96d5` | Both Notes homes gain scope, type/status, match modes, snippets and revision-aware refresh. |
| `4946b16`, `5ca6b6f` | Compact iPhone Tabs / Go / More dock, no Scripture link underlines, compatible-tab reuse and explicit New Tab. Inline note title chrome. |
| `87fd228` | Workspace previews and title/contained-tab search, plus selectable bulk archive of inactive unpinned tabs. |

## Verification

- Xcode 27.2: `npm run native:check` at `5ca6b6f` passed, including Swift Testing 80 tests / 31 suites plus 4 XCTest cases, and Mac and iOS Simulator Debug builds with Dev identity assertions.
- At `87fd228`, `npm run native:build:mac` and `npm run native:build:ios` passed with Dev identity assertions.
- `vitest run tests/unit/goldenCorpus.test.ts`: 22 passed. Full legacy suite and physical iPhone install were outside this run.
- Mac Dev UI: ⌘K → Didache rendered chapter text. ⌘K → Calendar → previous month → current month → existing Nov 12 daily note opened.
- iPhone 18 Pro Simulator (iOS 27.0, D0CC2F4C…): inline Obadiah 1 H2377 opened Lexicon. Long press selected a word and displayed copy actions. Tabs, More, Notes search options, Calendar date-to-note creation and Go were exercised. Go → recent Jonah reused an existing reader and preserved the nine-tab count.
- Still verify: cross-verse touch drag, copied contents, persisted partial highlights, swipe arbitration, iPhone hardware and accessibility. Run bulk archive → restore and lookup by contained title on both platforms using multiple same-named workspaces. Screenshot-based handle drag did not establish a cross-verse selection.

## Next executable task

1. Use isolated Dev fixtures with duplicate names such as “Session 8,” two similarly named passages, and pinned tabs. Verify Mac ⌘K and iPhone Workspaces search identify the workspace by a contained passage. Preview archive, exclude a tab, archive, reopen the workspace and restore the archive group. Check selection and pinned tabs.
2. Continue reducing tab creation in routine Mac navigation while retaining explicit New Tab. Consider direct passage results across workspaces, exact-destination reuse and duplicate review. Use the owner’s screenshot as the reproduction shape: similarly named sessions and repeated Scripture tabs.
3. Complete iPhone touch QA, then continue Study Trail U14 service/goldens, sunrise-aware Today, remaining Settings and gated M4.

## Scripture follow-up

PR #24 also includes the icon-only iPhone dock, one-row passage toolbar, direct verse-number action sheet and automatic exit from Compare when closing the final extra column. Xcode 27.2 Dev builds passed for both platforms. iPhone 18 Pro Simulator verified verse tint and action presentation, Copy Verse dismissal, recovery from a saved single-column comparison, and preserving the Septuagint when closing KJV in a two-column Jonah comparison. Clipboard contents, Mac runtime, and physical iPhone are still pending for this follow-up.

## Floating Scripture controls and legacy comparison

- See [Implementation backlog](IMPLEMENTATION-BACKLOG.md) for prioritized Electron and Capacitor features and acceptance scenarios.
- iPhone Scripture now uses a floating passage control and glass dock. Tap verse numbers to toggle several verses and use the selection panel above the dock. Tap the panel ellipsis for single-verse actions.
- iPhone 18 Pro Simulator showed Jonah 1:2 and 1:4 selected together. Simulator clipboard contained exactly those two verses and the nonconsecutive LXX reference. Applying yellow highlighted both verses, and Tag opened with the correct two-verse reference.
- The Swift run passed 80 Swift Testing tests and 4 XCTest cases. Both native Dev builds passed. The iPhone Simulator build also passed after adding UIKit Find in Chapter.
- Simulator verified Find in Chapter by moving from match 1 to 2 of 12 for “Lord” in Jonah 1. Go returned and opened the existing daily note by title. Exact iPhone note tab reuse was added after that run.
- Mac Dev verified ⌘K and ⌘L reuse, ⌘T explicit creation, opening a passage already in another workspace, and repeated Scripture searches and Strong’s lookups without extra tabs. Pinned and filtered-search safeguards need separate runtime coverage.
- Next acceptance work includes physical iPhone text handles and swipes, archive/restore across duplicate workspace names, and Study Trail service parity.

- Archive restore now keeps the active tab and skips IDs already open in any workspace. Mac and iOS Simulator builds passed. On the iPhone 18 Pro Simulator, archiving Genesis 1 reduced the workspace from 10 tabs to 9. Restoring it brought the count back to 10 and kept Jonah 1 LXX selected. On Mac, bulk archive excluded Ruth and archived Genesis and Jonah. Both returned in archive order and Jude stayed selected. Bulk restore on iPhone remains open.

- Study Trail now has a read-only browser on Mac (Go → Study Trail) and iPhone (More → Study Trail). It reads legacy trail order, recaps, and stops with their saved translations. The migrated SQLite fixture passed. The next slice is connections and recording lifecycle.

- Study Trail supports named trails, manual recording of the current Scripture chapter, pause, resume, and finish. Saved Scripture, lexicon, and note connections appear with their reasons. The legacy-schema tests cover ordered connections, revisits, closed pauses, and completion. Mac Dev UI verified creation, reopening the trail after relaunch, recording Jude, pausing, resuming, and finishing with one saved stop. Map, automatic recording, and connection editing remain open.

## Verse selection and Compare polish

- Mac Scripture uses a material action panel with the selected reference, count, Clear Selection and spaced native buttons. At narrow pane widths it switches to icons with accessible labels. The passage picker no longer displays a caret.
- Native Scripture marks selected verse numbers in the gutter on both platforms. The text keeps its existing saved highlights and normal character selection. Mac keyboard copy uses the exact selected reference, including gaps.
- Compare follows the Scripture font and verse-number settings. Passage changes clear stale results while new columns load, and column close controls have larger targets.
- Both Xcode Dev builds and `git diff --check` passed. Mac Dev showed the labeled action panel and caret-free picker, and Escape dismissed the panel. Repeat Shift-click with visible verses and inspect the clipboard. Verify the new gutter marker on the Simulator and check Compare preferences and the narrow Mac panel interactively.

The one-row floating verse toolbar supersedes the two-row selection panel. Both native readers use bold accent verse numbers with no filled badge. Both Dev builds passed. Mac Dev confirmed the toolbar, accessible action names, single-verse selection and Escape. Mac range selection and iPhone runtime appearance remain to verify.

## Parity batch after the compact verse toolbar

- Branch `native/reader-notes`, draft PR #24. Commits `134595e` (daily note sunrise), `b46abfb` (Mac reader/sidebar and Hermas edition), and `9a774f9` (Strong’s search snippets).
- Calendar and Today share a sunrise boundary when local coordinates are supplied through Calendar. No location or no local sunrise uses midnight. Daily note identities and date keys stay compatible.
- Both apps have an edition preference for unqualified Shepherd of Hermas references. Existing tabs and explicit results retain their text IDs. Mac inline Strong’s tooltips include the lemma, transliteration and gloss. Scripture search carries matched words into snippets and applies book scope to Strong’s searches.
- In the running Mac Dev app, Filter Tabs narrowed four open tabs to Jonah. Verse link clicks with Shift selected Jude 1:2–4, and Cross References opened the inspector. The runtime pass did not establish the inspector's exact reference or verify hover content.
- Next checks: open a Taylor and a Roberts–Donaldson reference from Settings/Go on both platforms, test Calendar Sunrise Settings and a Strong’s result on the iPhone Simulator, and hover an inline Strong’s number on Mac. Continue with note previews, deep links, Study Trail arrival capture, and the original-app parity inventory.

The next batch adds a read-only Notes preview with aligned Markdown tables and fenced code, shared with version history. It also adds a pure parser for the 12 legacy deep-link route types. URL registration, delivery and destination dispatch remain pending. Swift conformance tests and both Dev builds passed. The final parser fixtures were checked separately (37 cases). On iPhone 18 Pro Simulator, the expanded verse gutter and compact toolbar were exercised and the clipboard contained exactly Jonah 1:1, 2, 4 LXX and those three verses. Still run physical touch selection and inspect the Notes preview in both apps.

## Dashed Scripture selection and floating actions

Both native readers draw a rounded dashed border per consecutive selected verse range. The floating action row reserves scroll clearance at the chapter end. Mac sidebar and verse actions have pointing cursors, and iPhone verse actions have a hover cue for pointing devices. Continue the clickable-control audit in the passage picker, search results, notes, and workspace sheets. Check focus, disabled states, keyboard navigation, and touch targets.

iOS 27 Simulator showed one border around Jonah 1:1–2 and a separate border around 1:4, with saved highlights visible. Scrolling to the end exposed the final verse above both floating bars. Mac Dev showed the border and action row and combined clicks on Jude 1:2 and 1:3. The Shift-click to verse 4 did not extend in this pass. Recheck this using physical input, check Mac end-of-chapter scroll clearance, and run the original-app workflows against the parity ledger.

Plain buttons across the reader, picker, search, study views, calendar, notes, sidebar and iPhone dock now share press feedback and a platform pointer cue. The Mac verse gutter uses the same hit region for hover and selection. Continue auditing menus, custom gestures, toolbar buttons and drag handles. Check pointer feedback with hardware input and iPhone touch feedback separately.

The iPhone verse toolbar keeps More available for a multi-verse selection. Its note and cross-reference commands target the active verse. Mac Add Note follows the same rule. Removing a selected verse moves the range anchor to a verse still selected, or clears it when the selection is empty. The iPhone dock’s More control now has a pointing-device hover cue. Both Dev builds passed. Runtime acceptance still needs a multi-verse More menu check and Shift-click after deselecting an anchor.

Copy Verse from the Mac context menu and iPhone verse sheet now honors the Word Replacer setting, matching the whole-verse toolbar copy. Single-verse LXX copies identify the translation in the reference. Both Dev builds passed. Check clipboard output from each entry point with Word Replacer on and off, using a KJV verse containing LORD and an LXX verse.

Native note links using the legacy Berean schemes now route to Scripture, Notes, Lexicon, Search and Today inside both Dev apps. The dispatch uses the existing parser and tab reuse. Both Dev builds passed. Exercise linked destinations from a synthetic note on both platforms. External launch, verse ranges and playback, and the other parsed destination types remain open.

## Linked verse ranges

Native Notes now passes both endpoints into Scripture, where a linked range selects the existing verses and uses the reader’s grouped dashed outline. Range state follows the legacy `endVerse` key. Typed link references preserve an LXX suffix and honor an explicit text override. Notes flushes edits before internal deep-link navigation and only updates the matching note tab title.

`npm run native:check` passed with 87 Swift Testing tests, four XCTest cases and both Dev builds. The updated focused DeepLink suite also passed all 39 argument cases. Runtime acceptance remains open. In a Dev note, click a Markdown link to `berean://verse/Jonah/1/1-2?text=lxx`, verify the grouped outline and copied reference, toggle a verse, navigate Back, and reopen the range on Mac and iPhone. Also check an explicit translation override, a missing note, and an ordinary web link. External URL registration and playback remain separate parity gaps.

Typed verse ranges now reach the same native reader selection from Mac Go, iPhone Go, the passage picker, and note wikilinks. Go and the picker show the range in the result label. Previous and next chapter clear the range. Both Dev builds passed. Runtime check: type `Jonah 1:1-2 LXX` in Go and in the in-reader picker, verify the grouped border, open `Jonah 1:1 LXX` and check the range clears, then revisit via Back. Include a range in another workspace to confirm matching uses both endpoints.

## Same-chapter verse navigation

Mac Dev Go verified `Jonah 1:1–2 LXX` → `Jonah 1:1 LXX` → Back restores 1–2 → Forward restores 1. The reader keeps the latest destination when a chapter query finishes and hides the old passage and its actions while the new chapter loads. Local selection changes and opening the study inspector do not create navigation history entries. Both Dev builds passed. Repeat the Go and Back sequence in the iPhone Simulator and verify the Notes-link entry point on both platforms.

The iOS 27 iPhone Simulator verified Go → Jonah 1:1–2 LXX → Go → Jonah 1:1 LXX → dock More → Back. The reader restored one dashed outline around both verses. The selection More menu offered Cross References and Add Note. Copy after Back produced the exact range reference and both verses. This pass also found that Recent saved only the first verse.

Recent now stores the range endpoints and distinguishes chapter, single-verse, and range destinations in the same chapter. Mac Go, iPhone Go, and the passage picker reopen the recorded destination. Both Dev builds passed. Runtime acceptance for this change remains open. Check that old saved recents still appear, open a range and its first verse, and reopen each from Recent after relaunch. Notes-link runtime and the broader legacy parity audit are still open.

Native History now reopens the verse range and translation recorded by Go and the passage picker. It stores a Codable passage in the existing query column for Scripture rows. Older rows fall back to their stored book, chapter and verse. Both Dev builds passed. Runtime checks still needed: open the same range in two editions, reopen both from History after relaunch, open an older Scripture entry, and verify search history still matches query text.

History rows now show the recorded Scripture edition next to the reference. The visible edition and the reopened destination use the same validated payload. Older rows display their saved title and use the existing fallback. Both Dev builds passed. Check two editions of the same range side by side and reopen each after relaunch.

The original iPhone reader offers Copy Reference and Share Chapter from its chapter commands. Native iPhone now offers both in the dock More menu, with the LXX suffix when appropriate. The multi-verse More menu also offers Share Verses using the same reference and verse text as Copy. Both Dev builds passed. Exercise the system share sheet in the Simulator, dismiss it, and confirm the reader selection survives.

The iOS 27 Simulator opened Share Verses for Jonah 1:1–2 LXX. The system preview displayed the range reference and dismissing it restored the same grouped dashed outline and floating toolbar. The single-verse actions now include Share Verse using the same text as Copy Verse. Both Dev builds passed. Chapter sharing and the single-verse sheet still need runtime checks.

The Scripture action capsule, iPhone passage control and dock use the interactive Liquid Glass treatment. The Highlight menu also has a pointer cue. Mac Find in Chapter supports Shift–Command–G for the previous match alongside Command–G for the next match. Both Dev builds passed. Verify press feedback and keyboard focus in the running apps, and test both Find directions with repeated text.

Floating selection controls and both native scroll views now share the same clearance calculation. On Mac the pending scroll checks the current passage and target before moving, and a cleared target can be used again in the same chapter. Both Dev builds passed. Runtime checks remain for a narrow Mac reader, the final verse with the selection toolbar visible, and repeating a jump to the same verse after clearing it.

The floating verse toolbar now switches to a compact row when the full row cannot fit. Copy, Highlight and Clear remain visible, with Tag, Add Note, Cross References and Share in More. Mac also offers Share directly in the full row. Both Dev builds passed. Resize a Mac split pane with an active selection and check the overflow commands and chapter-end clearance. Check the iPhone compact row with a narrow width and confirm the full row still offers the single-verse sheet.
