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

On iPhone, selecting or clearing a verse at the end of a chapter keeps the scroll position anchored to the chapter ending as the floating toolbar changes height. The iOS 27 Simulator verified selecting Jonah 1:16 from the bottom with the full verse and dashed outline visible above both bars, without another swipe. The iPhone Dev build passed. Mac chapter-end and narrow split-pane checks remain open.

Mac reader verification uncovered that the explicit TextKit view did not resize vertically, preventing scroll to the chapter ending. The document now grows vertically with the chapter. The Mac Dev build passed, and the running app scrolled to the end of Jonah 1 LXX. Selecting verse 16 at the scroll limit kept both lines and the dashed outline fully above the floating toolbar. Narrow split panes and repeated Find navigation remain to check.

Compare now scrolls to the active verse when opened from a verse or when the destination changes. Verse numbers in Compare are buttons with pointer feedback and an accessible selected state. Selecting a row updates the study panel target without adding a Back entry. Both Dev builds passed. In the running Mac and iPhone apps, open Compare This Verse near the end of a long chapter, then select another row and check the study panel and return to the reader.

Compare now stacks translations under each verse when the side-by-side columns cannot each fit a readable width. Wide panes keep aligned columns. Both layouts use the same verse buttons, translation close controls and rendering. Both Dev builds passed. Verify the stacked layout on iPhone portrait and a narrow Mac split, rotate or widen to check the transition, and confirm the active verse and Strong’s links work in both layouts.

Selecting a verse inside Compare now updates the study target in place. Navigating to a verse from outside Compare still scrolls to the destination. iPhone verse and close-translation controls use 44-point touch targets. Both Dev builds passed. Runtime check: choose a verse near the bottom of the viewport, confirm the row stays put, then navigate to another verse through Go and confirm that jump scrolls.

iPhone Simulator verified stacked Compare opens at Jonah 1:14 LXX and tapping 15 updates the selected number without moving the row. The final KJVA line initially sat under the dock. Compare now reserves dock clearance, and the rebuilt Simulator showed the entire final verse above the dock. The iPhone Dev build passed. Verse-level cross-edition mapping remains a parity gap. Jonah 1:17 is currently present only in the KJVA column because Compare aligns by verse number within the mapped chapters.

Compare aligns the KJV and Brenton LXX across the Jonah chapter boundary. KJV Jonah 1:17 pairs with LXX Jonah 2:1. The remaining Jonah 2 verses use their one-verse offset, and cells with shifted numbering show their original references. Closing Compare on a mapped verse opens its counterpart in the remaining edition. Verified corresponding text and chapter counts against both bundled SQLite corpora and built both Dev targets. Runtime checks remain for both directions across the chapter boundary, plus other books with numbering differences.

Closing Compare on Jonah now maps the start and end independently, including when the start keeps its original numbering. A range that crosses a chapter boundary in the remaining edition opens at its first verse. Both Dev builds passed. Check KJV 1:16–17 → LXX opens 1:16, and LXX 2:2–3 → KJV opens 2:1–2.

Compare's toolbar now offers Open in Reader for each displayed translation, so leaving Compare does not require returning to the column header. The iOS 27 Simulator verified opening KJV + Apocrypha from a scrolled LXX/KJVA Compare and returning to the reader with Jonah 1:15 selected. Duplicate and unavailable saved column IDs are ignored when rendering. Compare This Verse clears the previous range endpoint. Both Dev builds passed. Mac toolbar interaction, the single-verse entry from a prior range, and the Jonah chapter-boundary scenarios above remain to verify.

## Independent Compare passages

Compare restores each saved column's edition, book, and chapter, including multiple passages in the same edition. Change Column Passage reuses the passage picker at chapter granularity. Same-passage columns retain the aligned layout. Mixed passages render as labeled sections in one scroller. The main chapter controls move columns aligned with the previous anchor and retain independently positioned columns. Add and close operations preserve untouched column records, including legacy scroll metadata. Native does not yet restore independent scroll positions.

Both Dev builds passed. On the iOS 27 Simulator, opened Compare from Jonah 1 KJVA, changed the LXX column to Jonah 2, verified both labeled passages, and opened Jonah 2 LXX in the reader. Still to verify on Mac and across relaunch: same-edition columns with different books, global chapter navigation in a mixed comparison, and Back/Forward after opening an independent chapter. Follow-up parity includes side-by-side independent scrolling, verse actions in independent sections, and presenter integration.

Mixed Compare now shows separately scrollable panes when each has at least 260 points, and retains labeled sections at narrower widths. Pane headers open the chapter picker. Verse numbers open the exact verse in the reader. Compare mode and ordered column destinations participate in Back/Forward history, excluding scroll metadata. History restores its saved comparison without remapping the columns.

Both Dev builds passed. The iOS 27 Simulator verified tapping Jonah 2:1 LXX in a mixed comparison, then using Back to restore Jonah 2 LXX alongside Jonah 1 KJVA. Wide Mac scrolling, scroll restoration after relaunch, and explicit pinning when the main passage reaches a previously independent column's destination remain open.

Compare's Column Navigation menu pins a passage or returns it to Follow Main Passage. Independently positioned legacy columns become pinned on the first main passage move, so they remain fixed even after the main passage briefly coincides. The pin lives in the existing column record. Both Dev builds passed. The iOS 27 Simulator restored Jonah 2 LXX beside Jonah 1 KJVA after relaunch, stepped the main passage through Jonah 1 to Obadiah 1, verified KJVA stayed at Jonah 1, then used Follow Main Passage to align both columns at Obadiah 1. Mac interaction and cross-client preservation of the pin still need verification.

Compare column headers now offer a compact actions menu for Change Passage, Pin or Follow Main Passage, Open in Reader, and Close Column. The toolbar can swap two columns or reverse the order of three or more, preserving each column's saved record. Both Dev builds passed. The iOS 27 Simulator verified the per-column menu entries and swapped Obadiah 1 from LXX/KJVA to KJVA/LXX. Mac pointer and keyboard interaction and three-column reversal remain to verify.

Scripture's floating selection bar now has a third layout for very narrow panes: Verse Actions and Clear. It retains Copy, Highlight, Tag, Note, Cross References and Share in the menu, and compact iPhone single-verse selection keeps access to the full verse sheet. Menu icons carry pointer or hover feedback. Both Dev builds passed. Live acceptance remains open for the two-control fallback and nested Highlight in a narrow Mac split pane.

Whole-verse color pickers on Mac and iPhone now apply a color consistently across the selection. Applying an existing color leaves it in place, and recoloring preserves partial highlights and the existing whole-verse ID. Explicit Remove Highlights and the existing character-range toggle are still available. `npm run native:check` passed, including 88 Swift Testing tests, four XCTest cases and both Dev builds. Live acceptance remains open for mixed selections and recoloring on both platforms.

Reader taps now retain a continuous verse range in the existing verse/endVerse destination fields on both platforms, without adding a Back entry. Disjoint selections still use local state and store only the active verse as their destination. The selection toolbar opens Cross References at the stored selection start and retains the outline. Both Dev builds passed. The iOS 27 Simulator verified one dashed outline around Obadiah 1:1–2 and confirmed both verses remained selected after opening and dismissing Cross References. Tab switching, relaunch restoration, and the equivalent Mac interaction still need live verification.

Disjoint selections now restore from device-local tab state. The stored chapter, edition and active verse must match before the reader restores the set. Navigating to another destination clears the local selection, and Back retains the prior snapshot. The focused workspace test verifies the set stays out of sync payloads. Native conformance and both Dev builds passed. iOS 27 Simulator verified Obadiah 1:1 and 4 remained selected after terminating and relaunching the Dev app. Mac relaunch, tab switching and the Notes round trip remain to verify.

iPhone TextKit now clears a native text selection containing only a verse number and suppresses the system edit menu for that marker. Real text selections can still cross verse numbers. The iPhone Dev build passed. In the iOS 27 Simulator, a rapid double tap on Obadiah 1:5 produced the grouped verse outline without text handles. Double-tapping a word then showed normal text handles and Copy Text / Copy with Reference. Cross-verse handle dragging and physical-device checks remain open.

The iPhone Scripture scroll view now reserves bottom-dock clearance even with no selected verses and uses matching scroll indicator insets. Selecting the final verse still expands clearance while staying anchored to the chapter ending. Both Dev builds passed. In the iOS 27 Simulator, Obadiah 1:21 was fully visible at the scroll limit above the dock, and tapping its number kept the entire dashed outline and text above both floating bars. This preserves scroll-under while reading mid-chapter.

When a selection first opens the floating toolbar, the Mac and iPhone readers reveal the selected verse if its last line would sit behind the controls. The existing chapter-end anchoring still takes precedence at the scroll limit. Both Dev builds passed. On the iOS 27 Simulator, tapping Obadiah 1:18 from beside the bottom controls revealed its full text and outline without an extra swipe. Mac split-pane interaction still needs a live check.

Mac now applies the floating-toolbar clearance to newly added verses during range extension and constrains navigation jumps to the actual clip bounds. The Mac Dev build passed. Simulator testing exposed an unexpected iPhone scroll jump when trying the same extension behavior, so iPhone retains the verified first-selection behavior. Mac live acceptance and iPhone range-extension debugging remain open.

iPhone now updates verse marker color and the dashed outline in place when a selection changes. The chapter text no longer gets replaced for each verse tap. The reader can therefore reveal newly added verses without the scroll jump seen in the first range-extension attempt. The iPhone Dev build passed. In the iOS 27 Simulator, removing Obadiah 1:20 kept the viewport stable, and adding it back moved the chapter just enough to show all of 1:18–20 above the floating toolbar. Mac split-pane interaction and iPhone hardware checks remain open.

Mac now updates verse marker colors and the grouped outline in place, matching the iPhone reader. Selection changes no longer rebuild the chapter's attributed text. Marker width stays stable and hidden verse numbers remain hidden. Mac Dev build passed. Live Mac range extension, chapter-end clearance and text selection still need verification with this build.

Mac Dev live verification for in-place selection: with the study inspector open, Shift-click extended Jonah 1:16 LXX to 1:15–16. Both verses shared one rounded dashed outline, and the final line stayed above the floating toolbar. Double-clicking a word in verse 16 selected ordinary text while retaining the two-verse outline. Extremely narrow pane overflow and pointer behavior still need live checks.

The selection toolbar now supports Copy Reference for multi-verse ranges and disjoint selections. Mac has a direct number icon in the full toolbar and a selection-reference item in the verse context menu. Compact layouts and iPhone multi-selection offer it in More. Both Dev builds passed. iOS 27 Simulator verified Copy Reference on Obadiah 1:18–20 and pasted the exact reference-only string `Obadiah 1:18-20 LXX` into Go. Mac interaction and copying a disjoint selection still need live checks.

The verse toolbar now briefly replaces the pressed copy icon with a checkmark and posts an accessibility announcement for Copy Verses and Copy Reference. The feedback clears when selection changes or the toolbar closes. Both Dev builds passed. Runtime timing, repeated-copy behavior and VoiceOver announcements remain to verify.

Add Note from the floating selection toolbar uses the full selected reference as the note title and links to the first selected verse, matching the legacy note contract. Both Dev builds passed. The iOS 27 Simulator created a Dev note titled Obadiah 1:18-20 and its Obadiah 1:18 LXX link opened the correct verse and edition. Mac interaction and disjoint selection note titles still need live checks.

New multi-verse notes include editable Scripture links in the body, one per consecutive run, while the existing note anchor still points to the first verse for legacy lookup and counts. Links use the current edition and are omitted for passages the current deep-link resolver cannot handle, including chapter zero. Both Dev builds passed. Live acceptance remains open for clicking a generated range or disjoint link in each native editor.

Native verse links now accept chapter 0 for Sirach and 1 Clement, the two prologue books listed by the legacy reader. New multi-verse notes can therefore generate links to their prologues. Focused DeepLink tests passed for prologue chapters and ranges, with Genesis chapter 0, fractional chapters, and negative chapters still rejected. Both Dev builds passed. Live opening of a generated prologue note link remains to verify.

The note header now presents its Scripture anchor with a book icon, pointer or hover feedback, and an explicit accessibility label. Header and wikilink navigation flush pending edits before leaving. Canonical chapter anchors treat verse 0 as a chapter. Both Dev builds passed. The iOS 27 Simulator created an Obadiah 1:18–20 LXX note, confirmed its generated range Markdown and verified that the header opens verse 18. Activating the body link and live Mac verification remain open.

Note Preview now renders standalone Scripture links with a book icon and explicit accessible destination. Both Dev builds passed. iOS 27 Simulator verified Add Note from Obadiah 1:18–20 LXX → Preview → Open in Scripture, restoring all three verses. Direct activation in the editable body, Mac Preview and prologue links remain to verify. The tab switcher also surfaced an Untitled Notes entry when looking for a prior test note. Its origin was not established.

Opening or saving a note now refreshes the titles of every open tab for that note in the active workspace. This also repairs stale titles when an existing tab is reopened, and a failed save surfaces an error before changing tab labels. Both Dev builds passed. The earlier Untitled row was not proven to be a stale title; verify duplicate note tabs, rename, and tab switching live.

The iPhone tab switcher now filters by Space. Mac and iPhone tab search both match separate terms against the displayed title and Space name. In the iOS 27 Simulator, filtering a 13-tab workspace to Notes surfaced the existing Obadiah range note and reopened it. The Untitled row remained visible alongside the correctly named note. Both Dev builds passed. Mac text filtering and reordering while filtered remain to verify.

The iPhone Workspaces search now offers exact open-tab results with workspace and Space names. Selecting a result switches to its live workspace, selects the existing tab by ID and closes the switcher. Saved snapshots still appear in workspace search. Both Dev builds passed. Live cross-workspace selection and a corresponding Mac entry point remain open.

Mac Workspace → Find Open Tab opens a keyboard-focused search across live workspaces. Results show the workspace and Space, and Return opens the first match. The Mac Dev build passed. Live Mac verification searched “Sirach Study” from Workspace 5, pressed Return, and confirmed the existing Sirach 0 tab was selected in Study with its tab count still at 26. The iPhone cross-workspace flow remains to verify live.

iPhone dock → Tabs search now shows current-workspace matches first, followed by matching tabs in other live workspaces. The Space filter applies to both, and the Workspaces screen reuses the same result rows. iPhone Dev build passed. The Simulator verified local matching by Space name. A matching tab in a second Simulator workspace was not observed, so cross-workspace selection remains open for live verification.

Archived groups now support restoring one tab. iPhone lists searchable archived titles, and Mac exposes Restore One Tab in the group context menu. The remaining archive records retain their state and order. If the tab is already live, the command opens it in its existing workspace without creating a duplicate. Both Dev builds passed. Live acceptance remains open for restoring one of several tabs and verifying the remainder survives relaunch.

iPhone Archive search now shows the Space under each result and distinguishes an empty archive from a search with no matches. Restoring an archived tab that is already open now selects the live tab's current Space. Both Dev builds passed. Live archive restore and relaunch remain open.

Single-tab archive restoration now uses a tested BereanWorkspace operation for removing the restored record. The regression test verifies that the group's identity and date remain intact, untouched records including an unrecognized future Space survive in order, a missing ID changes nothing, and restoring the last tab removes the group. Both Dev builds passed. Live restoration and relaunch remain to verify.

Restore All now removes only archive records for tabs it successfully reopened. Unrecognized records and already-open tabs keep their archive copies. The regression test verifies that a bulk restore retains an unknown Space record even if its ID is passed in the removal set. Both Dev builds passed. Live mixed-group restoration and relaunch still need verification.

The Mac Archived sidebar section now offers Browse Archived Tabs. The sheet searches archived tab titles and Space names, shows the matching tabs under their original group, and restores one tab on click. The Mac Dev build passed. Live search, restore and relaunch still need verification.

Mac Archive search now has an explicit, keyboard-focused field in its sheet and separate empty states for no restorable tabs and no search matches. The Mac Dev build passed. In the running Dev app, the Archive Inactive Tabs sheet exposed the selectable candidates and Escape left the workspace at 26 tabs. Individual archive search, restore, and relaunch still need a live check using disposable tabs.

Archive Inactive Tabs now starts with no tabs selected. Filter by title and Space, select individual tabs or all matches, and clear the selection without leaving the sheet. Both Dev builds passed. Live Mac Dev verified a 26-tab workspace opened with Archive 0 disabled, “Didache scripture” narrowed the list to one row, selecting it enabled Archive 1, and Cancel preserved all 26 tabs. Confirmed no archive mutation in this run. Bulk restore and relaunch acceptance remain open.

Mac Dev archive round trip verified in disposable Workspace 6. Archived inactive Genesis 1 and Jonah 2 while Ruth 1 stayed open. Browse Archived Tabs opened with keyboard focus and showed both records. Searching “Jonah scripture” and activating the row restored only Jonah 2 and selected it. Relaunch retained the restored tab and the remaining Genesis 1 archive. Clicking the remaining group restored Genesis 1, removed that archive group and kept Jonah 2 selected. Workspace 6 remains in the Dev library with the three test tabs. The iPhone equivalent is still pending.

iOS 27 Simulator archive round trip verified in disposable Workspace 3. Archived inactive Genesis 1 and Obadiah 1 while Jonah 1 stayed open. Restoring only Obadiah reopened LXX with 1:18–20 selected and two tabs open. After termination and relaunch, that selection and the remaining Genesis archive were intact. Restoring Genesis returned the workspace to three open tabs. Workspace 3 remains in the Dev Simulator library with the test tabs. The archive toolbar confirmation was visible and tappable but absent from Device Hub's accessibility snapshot.

Native tab switching now remembers recently left tabs during the current run. Mac Workspace offers Return to the previous open tab, and iPhone Tabs shows up to three recent open tabs when unfiltered. Cross-workspace jumps record the actual source tab without recording a briefly selected destination tab. Both Dev builds passed. Live same-workspace and cross-workspace switching remain to verify. The list resets on relaunch.

Recent-tab navigation passed live checks on both Dev apps. Mac returned from Jonah 2 to Ruth 1 within Workspace 6, then used Find Open Tab to jump from Ruth 1 to Sirach 0 in Study and Return to Ruth 1 to reopen the original tab in Workspace 6. iOS 27 Simulator returned from Obadiah to Genesis within Workspace 3, switched to Study Phone, and reopened Genesis from Recent Tabs without increasing Workspace 3's three-tab count. This verifies recent cross-workspace jumps; direct search results from another iPhone workspace still need a separate tap check.

Recent Tabs now survives relaunch through device-local preferences. The list keeps up to 20 tab IDs and continues to display only open matches. Creating a workspace or opening a saved snapshot records the tab just left. Switching to a workspace with no active tab in the current Space selects an available tab. Both Dev builds passed. Live relaunch and an empty-Space switch still need verification.

Open-tab search on Mac and iPhone now matches Scripture edition names and passage ranges. Search results and the iPhone tab list show the range and edition so similarly named chapters can be distinguished. The original stored tab title still participates in search. Both Dev builds passed. Live edition-qualified cross-workspace lookup and selecting matching ranges remain to verify.

iOS 27 Simulator verified edition-qualified cross-workspace search through Tabs → Workspaces. From Workspace 3, “Study Phone Obadiah LXX” showed Obadiah 1:18–20 with the workspace, Space and LXX subtitle. Tapping it opened the existing tab with all three verses selected and Study Phone still at 13 tabs. Direct dock search and Mac edition-qualified search remain open.

Archive browsing and inactive-tab cleanup now use the same Scripture range and edition labels as open-tab search on Mac and iPhone. They match title, range, edition and Space, including hyphen or en dash in ranges. Both Dev builds passed. Live search and selection with two archived editions of the same chapter remain to verify.

Mac sidebar Scripture rows now show the selected verse or range and a compact edition label, plus Compare when active. The row has a pointing-hand cursor and an accessibility label that includes the edition. Both Dev builds passed. Live Mac verified that the Jonah 2 KJVA row exposed its edition and still opened the correct chapter. Pointer appearance, range truncation in a narrow sidebar, and drag reorder remain to verify.

Mac Scripture sidebar rows use a split icon for Compare, cap edition label width, and reserve the close/pin slot so hovering does not move the passage label. The tooltip exposes the full passage and edition. Both Dev builds passed. Narrow-width clipping, tooltips and drag behavior still need live checks.

Workspace switchers now preview up to two distinct tab labels, with Scripture ranges and editions, for live workspaces and saved snapshots. Live previews prioritize active tabs and keep the stored workspace name. Snapshot counts use stored tab records. Both Dev builds passed. Narrow iPhone preview truncation and saved-snapshot labels still need live checks.

iPhone Workspace search now matches combined terms from the workspace name and a contained tab, including saved snapshots and hyphen/en-dash verse ranges. Matching tab previews appear on separate lines so a long first preview cannot consume the second preview's line. Both Dev builds passed. Live saved snapshot search and narrow-width previews remain to verify.

Saved workspace previews now prioritize the snapshot's active tabs. Opening a live or saved workspace with no active tab in the current Space prefers a previously active tab in the destination before falling back to list order. Both Dev builds passed. Live saved snapshot preview and switch checks remain open.

Duplicated workspaces and opened snapshots now remap origin links between copied tabs, so a copied Lexicon tab remains associated with the copied Scripture tab when both are present. External origins stay as stored. Duplicating also uses the normal workspace switch and recent-tab path. The focused origin regression and both Dev builds passed. Live verification remains open for opening a copied Lexicon destination from its copied reader.

Snapshot reopening now allocates unique tab IDs even if a saved snapshot contains duplicate IDs or a generated ID is already taken. The first matching tab in each Space keeps the saved selection, sidebar order is reconciled with all restored tabs, and internal origins point at the first restored copy. The focused regression and both Dev builds passed. Live snapshot reopening with ordinary saved tabs still needs verification.

Snapshot origin remapping now uses the stored origin Space when duplicate legacy tab IDs occur across Spaces. A regression verifies that a Lexicon tab linked to a Notes tab keeps that link even when a Scripture tab has the same original ID. Both focused snapshot restore tests passed. Live snapshot opening remains to verify.

New native workspace snapshots record the current Space when it has tabs. First opening the snapshot activates that Space and its saved tab; older snapshots use the existing fallback. The optional field leaves the legacy v2 shape readable. The focused snapshot tests and both Dev builds passed. Live opening of a snapshot saved from Notes or Lexicon remains to verify.

Live workspaces now remember their last active Space per device and restore it when switching back or relaunching. The selected tab still comes from the existing per-Space workspace state. Snapshot preferred Space takes priority on its first open. Deleted workspace preferences are removed. Both Dev builds passed. Live Notes-to-Scripture workspace switching and relaunch remain to verify.

Mac Dev verified live workspace Space persistence. Selected Daily Notes in Study, switched to the Scripture-only Workspace 6, then returned to Study and confirmed Daily Notes was selected. Quitting and reopening Mac Dev restored the same Notes tab in Study. The iPhone equivalent and saved snapshot first-open check remain pending.

iOS 27 Simulator verified live workspace Space persistence. Opened Notes Home in Study Phone, switched to the Scripture-only Workspace 3, then returned and confirmed Notes Home was active. Terminating and relaunching the isolated Dev app restored Notes Home again. Go → Notes opened a Notes Home tab for the test, leaving Study Phone at 14 Dev tabs. Saved snapshot first-open remains to verify live.

Global Notes shortcuts now reopen an existing Notes Home tab in the current workspace while leaving note editors and their folder return paths intact. Explicit New Tab still creates a separate Notes Home. Both Dev builds passed. On the iOS 27 Simulator, switched from Notes Home to Scripture and back via Go → Notes, returning to the existing Notes Home with the workspace still at 14 tabs. Mac command palette and explicit New Tab remain to verify live.

History, Tags, and Calendar now share the same tab reuse rules. Normal navigation prefers the selected matching tab so filters and context are preserved. Explicit New Tab opens a fresh instance where those shortcuts are available. Both Dev builds passed. Live checks remain for independent filters and reuse on both platforms.

History category and Study Only now use the existing per-tab state fields shared with the legacy apps. Scripture includes Compare entries; Lexicon includes Strong's clicks. Study Only hides chapter-only visits. Show Older remains available while filtering so matches beyond the initial page can be reached. Both Dev builds passed. Live independent-tab filtering and older-page searches remain to verify. Free-text filter still lives in the view.

History now searches the full native retention window of 5,000 entries and displays matches in batches of 300. Category and text filters reset the visible limit, and an empty library has a different message from an unsuccessful search. Both Dev builds passed. Live search against a Dev history with more than 300 entries and filter performance near the retention limit remain to verify.

Scripture Strong's links now record device-local History entries on both platforms. History reopens existing Strong's click rows in Lexicon and displays entries without a supported destination without a button or Open command. Both Dev builds passed. Live Strong's click → History → Lexicon and Compare history recording remain open.

Compare Strong's links now use the same inspector and History action as the reader. Each Compare entry records the clicked column's actual book, chapter, and verse, including shifted versification, while preserving the selected row and Back history. Both Dev builds passed. Live Compare Strong's → History remains open.

Native History now records entering Compare and changing its passage or column destinations. Reopening a native Compare visit restores the anchor edition and range, the column order and passages, and explicit passage pins. An exact open comparison is reused. A different comparison opens separately to preserve ongoing study. Legacy Compare rows with a book and chapter reopen with the device's default edition and default pair. Both Dev builds passed. Live round trips and exact-tab reuse remain to verify.

On Mac Dev, opened Compare for 2 Samuel 22, switched to History, and reopened the entry. KJVA and LXX were both visible in the original comparison and the workspace stayed at 26 tabs. Compare entries now also show the passages and editions in column order and match those labels when filtering History. Both Dev builds passed with the labels. Live checks remain for filtering, restoring a modified comparison, and the iPhone round trip.

Cross References now tracks the actively selected verse independently of the persisted range on Mac and iPhone. Opening the panel preserves the selection and shows a verse heading, then loads TSKe and Classic results for that verse. Links pass through the full range in KJV + Apocrypha, the edition used by the native reference previews and their canonical numbering. Both Dev builds passed. Mac Dev opened John 3:3 from the floating toolbar and displayed its heading and TSKe results. Live range extension, following a reference range, and the iPhone sheet still need verification.

The floating verse actions now reserve their actual SwiftUI height below the reading viewport on Mac and iPhone. The glass capsule keeps its icon-only controls, and the chapter no longer draws underneath it. This replaces the fixed TextKit bottom insets for selection. The iPhone dock continues to reserve its own space through the root safe-area inset. Both Dev builds passed. A Mac Dev screenshot with John 3:3 selected and the Cross References inspector open showed the text clipped above the capsule. Verify chapter-end anchoring when toggling selection and the dock spacing on the iPhone simulator.

iOS 27 Simulator showed that the first shared safe-area implementation concealed the selection controls behind the iPhone dock. The reader now reserves the action row and dock clearance explicitly when verses are selected. A simulator screenshot showed separate glass capsules for verse actions and the dock, with the selected Obadiah 1:18–20 outline above them. Both final Dev builds passed. Confirm tapping and clearing the selection, scrolling to the final line, and narrow-width fallback with the final build.

The iPhone reader now reserves dock clearance even with an empty selection, and range navigation accounts for the final selected line when the entire range fits. In the iOS 27 Simulator, Go → Obadiah 1:18–20 LXX displayed all three verses inside one dashed outline above both glass bars. Scrolling farther reached the last line of verse 21 while the action bar stayed visible. Tapping Clear removed the selection. Both Dev builds passed. Extending selection to verse 21 and the narrow-width action fallback still need live verification.

iOS 27 Simulator verified tap-to-extend at chapter end. With Obadiah 1:18–20 LXX already selected, scrolled to verse 21, tapped its number, and confirmed the selection became Obadiah 1:18–21. Mac navigation now also accounts for the final selected line when opening a range that fits in the reader pane. Mac Dev built successfully. A live Mac check in a shallow split pane remains open.

Scripture verse numbers use the accent color on Mac and iPhone so the selection targets read as controls. Mac Strong's links use the same accent. The selected number keeps a stronger accent and the grouped dashed outline remains the selection indicator. Cross-reference results now show accented references, a disclosure chevron, and a full-row hit area. Both Dev builds passed. Live dark appearance, custom accent contrast, and cross-reference row hit testing remain open.

Scripture search results now use an accented passage label, a disclosure chevron, and the edition's own reference naming. Opening a result records the edition and verse in passage recents and History. The context menu offers Copy Reference and Copy Verse with the edition abbreviation, plus explicit Open in New Tab. Both Dev builds passed. In the iOS 27 Simulator, searching for grace and tapping Genesis 6:8 KJVA selected verse 8 without growing the 14-tab workspace. Go then displayed Genesis 6:8 in recent passages. Mac interaction, non-KJVA History reopening, and context-menu copy remain to verify.

Opening a Strong's occurrence or cross-reference now records the exact passage in History and Go recents on both platforms. Strong's occurrences show the edition and a disclosure chevron, with the whole row available to click or tap. Cross-references preserve their canonical KJVA destination and range. Search results use the same visit method. Both Dev builds passed. Live checks remain for following a Strong's occurrence and reopening a cross-reference range from History.

Native Lexicon now shows its definition while occurrences load, offers an edition filter for mixed results, and reveals loaded occurrences in batches of 40. The compact inspector links to the full Lexicon to access the larger query. The existing corpus scan limits still apply. Both Dev builds passed. Live checks remain for Greek edition filtering, paging and changing entries while results load.

Native Lexicon occurrences now filter by book within the selected edition, show the loaded match count, and open a Scripture search for the Strong's number from either the full entry or inspector. Changing edition resets the book and page size. Both Dev builds passed. Live book filtering and search-tab reuse remain to verify. Legacy rendering-form filters and sort by match count remain parity gaps.

Lexicon occurrences now support multiple translated-word filters and sorting by most matched positions. Word counts are scoped to the chosen edition and book, and ties preserve the original result order. Filtering uses the words shown in native occurrence previews and resets paging to the first 40. Both Dev builds passed. Live checks remain for combining word filters, sort ties, and the legacy word-replacer display difference.

Lexicon occurrence previews now use the same Strong's snippet renderer as Scripture Search. Translated-word filters use the rendered match positions and clear when word replacement is toggled, so a hidden spelling cannot leave the list filtered. Both Dev builds passed. Live verification remains for H3068 with replacement on and off and for Greek matches in LXX.

Lexicon occurrences now prepare their rendered preview and translated-word matches when the entry loads or word replacement changes. Paging, filtering and sorting reuse those results instead of rerendering the corpus on every interaction. Both Dev builds passed. Live timing with common Strong's numbers remains to measure.

On iOS 27 Simulator, G5485 narrowed from 284 loaded occurrences to 139 in LXX, 14 in Genesis, and six for “favour.” Opening the first filtered result selected Genesis 33:15 in LXX. Search Scripture and Open Full Lexicon now sit above the occurrence rows, and rows retain their passage identity across filter and sort changes. Both Dev builds passed. Live checks remain for the relocated actions, Most Matches ordering, and Mac.

Native Lexicon has Previous Entry and Next Entry controls backed by the actual installed lexicon IDs. Related entries also navigate in place. Standalone Lexicon navigation updates the tab title and supports Back and Forward. Inspector navigation keeps the Scripture passage and selection in view. Both Dev builds passed. Live checks remain for boundary IDs, inspector navigation, and Back.

Lexicon adjacency has a regression test using the bundled corpora for the first and last Greek entries, Hebrew numeric order across H9/H10, case normalization, and invalid language. The focused Lexicon suite passed. On the iOS 27 Simulator, G1 disabled Previous, Next opened G2, and More → Back restored G1 without growing the 15-tab workspace. Live Mac and Scripture inspector navigation remain open.

Switching Strong's entries now resets the Lexicon scroll view to the new definition. Related entries have full-width hit areas, accent-colored numbers and a disclosure chevron. On iPhone, the adjacent-entry buttons use 44-point targets. Both Dev builds passed. Live checks remain for related-entry navigation from deep in the list and in the compact inspector.

Cross References now shows chapter-wide results when no verse is selected. Classic results can expand by verse and TSKe results by verse and heading. The panel loads the chosen source and distinguishes missing source data from an empty result. Both Dev builds passed. Live checks remain for expansion, source switching, and clearing a verse selection back to chapter scope.

Mac Dev verified chapter Cross References in John 3. Clear Selection returned the open inspector to chapter scope. Expanded the first TSKe group, switched to Classic, expanded verse 1, and opened John 7:47–50. History recorded the full KJVA range and reopened it with all four verses selected. The Study workspace stayed at 26 tabs. iPhone chapter expansion and source switching remain open.

iOS 27 Simulator verified chapter-wide TSKe Cross References from More → Cross References on John 3. Expanded Verse 1 · Reciprocal and followed John 1:24, which exposed that the sheet stayed over the destination. The iPhone sheet now closes when following a reference. Verified the rebuilt app opened John 3:1 from John 1:24 and showed the selected verse in the reader. Both Dev builds passed. Classic switching on iPhone remains to verify.

Notes for This Chapter now lists attached notes without requiring a verse selection, using the existing edition-aware chapter query. Opening a note or successfully creating one from the iPhone study sheet reveals the editor. The compact iPhone Lexicon also closes when following an occurrence, opening Search, or opening the full Lexicon. Both Dev builds passed. Live sheet dismissal for those actions and chapter Notes interaction remain to verify.

The native Notes inspector can create a note for the whole chapter when no verse is selected. It uses the legacy dotted chapter reference (such as GEN.1), preserves the edition, and names the note from the displayed passage. The editor's linked reference now records the Scripture visit in History and recents. Both Dev builds passed. Live chapter-note creation and reopening remain to verify.

The native note editor now opens the full same-chapter range from legacy dotted attachments. Comma-separated attachments expose each valid destination in a Scripture Attachments menu. Navigation preserves the note's edition, saves pending edits, and records the visit. Both Dev builds passed. Live checks remain for legacy range and multiple attachments.

The verse Notes inspector now includes notes attached to a same-chapter range covering the selected verse. It uses the existing edition-aware chapter lookup and keeps whole-chapter notes in chapter scope. The legacy exact-match API and verse-dot counts retain their existing behavior. The new range regression and all 22 matched Notes conformance tests passed, as did both Dev builds. Live range-note inspector and verse-dot parity remain open.

Reader note markers on Mac and iPhone now count the same range attachments shown by the verse inspector. Counts are bounded by verse numbers loaded for the chapter, so a missing verse or an oversized imported range cannot create extra markers. The legacy chapter-count API remains available for conformance. Both Dev builds and all 22 focused Notes tests passed. Live marker appearance remains to verify.

Inline reader note markers now open Notes for that verse on Mac and iPhone. The inspector focus is shared by Notes and Cross References and stays independent of the dashed Scripture selection. A Mac layout without a Notes panel switches to the standard inspector when a Notes action is invoked. Both Dev builds passed. Live note-marker clicks, iPhone taps, and Mac layout fallback remain to verify.

iOS 27 Simulator verified that tapping the inline note marker on Obadiah 1:18 LXX opened its three Dev notes. Dismissing the sheet returned to the unchanged Obadiah 1:18–20 selection. More → Notes for This Chapter now explicitly opens chapter scope even when verses are selected. Both Dev builds passed. The explicit chapter command and Mac marker fallback remain to verify live.

Add Note from the floating verse actions now stores a continuous selection as a same-chapter attachment range (for example OBA.1.18-20). This makes the note appear on every covered verse in the native reader and inspector. Disjoint selections still attach to the first verse and include individual passage links in the body. Both Dev builds passed. Live range-note creation and legacy exact-verse lookup behavior for newly created range notes remain to verify.

Add Note stores nonadjacent selections as comma-separated dotted attachments, using one attachment per selected run and retaining passage links in the note body. Native chapter and verse Notes find these attachments, including in a later chapter of an imported note, and the reader counts each note once per covered verse. The regression checks overlapping runs, a gap between selections, and a later chapter. All 23 focused Notes tests and both Dev builds passed. Live creation and reopening remain open. The original app's exact-match verse lookup still does not expand composite attachments.

The original app's shared Notes service now finds native dotted range and comma-separated attachments in chapter and individual verse lookups, including later chapters. Existing edition mapping and exact lookup for non-verse queries remain available. All 46 Notes service contract tests passed, including the new disjoint-attachment regression. Legacy reader marker counts and live original-app interaction remain to verify.

The original reader's chapter note counts now use its attachment-aware Notes lookup. Range and disjoint notes contribute once per covered verse, including in later chapters and equivalent KJVA/LXX chapters. Whole-chapter notes do not add verse markers. All 47 Notes service contract tests passed, including overlapping runs and gaps. Original-app UI verification remains open.

The original iPhone note editor now renders stored Scripture attachments as individual buttons. Chapter and range destinations open in the note's edition through the existing note-return navigation. The reference parser and phone note editor suites passed (26 tests). Live taps in the original iPhone app and equivalent direct desktop editor links remain open.

The original Mac note editor now opens a single attachment from its header icon or offers a menu for several attachments. It passes the stored verse range and edition through the existing editor link handler and retains the reading tab by opening the destination in a new Scripture tab. The editor module compiled with esbuild and all 73 focused reference, Notes service, and phone editor tests passed. Live interaction in the original Mac editor remains open.

The iPhone floating selection bar uses one More menu for both single- and multi-verse selections. Common actions stay directly available and the single-verse detail sheet remains accessible through All Verse Actions. The More menu label uses the same control dimensions as the neighboring buttons on both platforms. Both Dev builds passed. Verify tap area and overflow at narrow widths on a simulator.

On the iOS 27 iPhone 18 Pro simulator, More opened for Obadiah 1:18–20 and Copy Reference returned to the same selection. Clear removed it. After selecting verse 18 by number, tapping near the upper edge of More opened the menu and All Verse Actions displayed the detail sheet for verse 18. Narrower device fallback remains to verify.

The native floating verse bar now uses a Transferable selection for sharing. It prepares the full formatted text when the share system requests it, and Copy uses the same formatter. The share preview shows the reference. Both Dev builds passed. Live share-sheet presentation and exported text still need verification on Mac and iPhone.

Verified iOS 27 Simulator More → Share Verses for Obadiah 1:18–20 LXX. The system preview showed the reference and Save to Files wrote local text containing the reference and numbered lines for verses 18, 19, and 20, including the end of verse 20. The selection remained active after saving. The simulator-local export was left in On My iPhone as “text.” Mac share output remains to verify.

iPhone Share Chapter now exports the full chapter in the active edition with the same reference and numbered verse format as Share Verses. The chapter loads on demand for sharing. Copy Chapter Reference remains the shortcut for the reference alone. Both Dev builds passed. Live chapter export and Mac access to the chapter share command remain open.

Mac Scripture now has a Chapter Export toolbar menu with Copy Chapter Reference and Share Chapter. Mac and iPhone use the same export actions and edition-aware chapter formatter. Both Dev builds passed. Live Mac verification confirmed the toolbar menu and both commands appear. The Mac system share destinations and exported chapter contents on both platforms remain to verify.

Copy Chapter is now available alongside Copy Chapter Reference and Share Chapter in the Mac and iPhone Scripture commands. It uses the same edition-aware export formatter, announces success for assistive technology, and reports an empty chapter without replacing the clipboard. Both Dev builds passed. Runtime clipboard verification remains open.

Mac Dev verified Chapter Export → Copy Chapter with John 7 KJV + Apocrypha. The clipboard contained the John 7 heading and all 53 numbered verses in order, while the reader retained its existing John 7:47–50 selection. The clipboard was left with the copied Dev chapter. iPhone Copy Chapter and Mac Share Chapter output remain to verify live.

Verified iOS 27 Simulator Copy Chapter for Obadiah 1 LXX. The clipboard contained the edition-bearing heading, numbered verses 1–21, and the final line. Share Chapter opened with the correct preview, but Save to Files offered the same generic name as the earlier range export. The export representations now suggest reference-based .txt names. Both Dev builds passed. Recheck the suggested filename and saved chapter contents on iPhone, plus live Mac Share Chapter.

Chapter Export on Mac and More on iPhone now offer Save Chapter as Text. The command uses the shared chapter formatter and the existing platform save panels, with a reference-based UTF-8 filename. iPhone staging uses a unique temporary directory and removes it after the picker completes or cancels. Both Dev builds passed. Live file saving and the Markdown export regression check remain open.

Verified Mac Dev Chapter Export → Save Chapter as Text. The save panel proposed John 7.txt, and the exported UTF-8 file in a temporary test directory contained the heading and all 53 numbered verses. The reader retained John 7:47–50 as its selection. iPhone save and Markdown export regression checks remain open.

Verified iOS 27 Simulator More → Save Chapter as Text → On My iPhone. The picker proposed Obadiah 1 LXX and wrote Obadiah 1 LXX.txt with its heading, all 21 numbered verses, and the final line. The reader retained the existing 1:18–20 selection. The simulator-local file was left in Files. Markdown export regression and system-share filename behavior remain open.

Floating selection actions now offer Save Verses as Text on Mac and iPhone. Mac uses the existing export icon to open Save and Share. iPhone and narrow Mac layouts expose the commands through More. Saving uses the same UTF-8 formatter and suggested filename as sharing. Both Dev builds passed. Live selection export and filename checks remain open.

Verified Mac Dev Export Selected Verses → Save Verses as Text. For John 7:47–50 the panel proposed John 7 47-50.txt, and the UTF-8 file had the range heading and exactly verses 47–50. Saving kept the range selected. Live iPhone selection export and nonadjacent export remain open.

Verified nonadjacent verse export on the iOS 27 Simulator. Starting from Obadiah 1:18–20 LXX, tapped verse 19 to remove it, then used More → Save Verses as Text. On My iPhone contained Obadiah 1 18, 20 LXX.txt with the matching heading and only verses 18 and 20. The two-verse selection remained active after export. The simulator-local file was left in Files.

Native selection references now compress adjacent runs within mixed selections, such as John 3:16-18, 21. Copy, export, note titles, tags and accessibility labels share that reference. The dashed outline uses the same grouping as tags and still divides at missing layout ranges. Both Dev builds passed. Live mixed-run copy and reopening the entire comma-list in Go remain open.

Native Go, the Mac command palette, and the reader passage picker now keep all groups in comma-separated references. Go recents and History encode the groups as optional fields so older entries still decode. Reader state uses the existing device-local nativeSelectedVerses field, and in-tab history distinguishes different groups with the same starting verse. Both Dev builds passed. Live copy/paste, History reopening and Back remain to verify.

iOS 27 Simulator verified Go → Obadiah 1:18–19, 21 LXX from an existing Obadiah 1:18, 20 selection. The preview identified the correct edition and the reader selected 18–19 and 21 without adding a tab (15 open). More → Back restored 18 and 20 even though both locations start at verse 18. History reopening and Mac passage-picker behavior remain to verify.

iOS 27 Simulator verified Go → History → Obadiah 1:18–19, 21 reopened all three verses in the Septuagint. Opening History added its utility tab, bringing the workspace from 15 to 16 open tabs. Native note wikilinks now also pass the full resolved selection through the shared Scripture visit path. Both Dev builds passed. Live note wikilinks and Mac passage-picker behavior remain to verify.

Native tab labels and tab search now include every group in a saved mixed Scripture selection. The switcher and reader share saved-selection validation so a stale selection from another chapter or edition cannot label the tab. Both Dev builds passed. Live switcher and archive filter checks remain open.

iPhone Tabs opens with an inline Search tabs field visible at half height. The iOS 27 Simulator found Obadiah 1:18–19, 21 LXX from `18-19, 21`. Opening the result kept all three selected verses and left the workspace at 16 tabs. The iOS Dev build passed. Archive search and cross-workspace filtering with a large fixture remain open.

Workspaces and Archived Tabs now use the same visible inline search as Tabs. In the iOS 27 Simulator, searching Workspaces for `18-19, 21` showed a direct tab result and the containing workspace. Archiving the Dev tab reduced the count to 15. Searching Archived Tabs with the same query and restoring the result brought the count back to 16 and reopened all three selected verses. The iOS Dev build passed. Multi-workspace and large-list runtime scenarios remain open.

Move to Workspace now displays each destination's passage/tab previews on Mac and iPhone. It uses the same labels as the Mac workspace switcher and only lists other live workspaces. The existing move path still receives the original workspace ID. Both Dev builds passed. Verify the menus with two same-named live workspaces and confirm the move lands in the intended one.

iOS 27 Simulator verified Move to Workspace from a new isolated Dev workspace with one Genesis tab. The destination menu showed Study Phone with its Obadiah mixed-selection and Notes previews. After the move Workspace 4 showed 0 tabs and Study Phone showed 17. The fixture remains in the Simulator Dev library. Mac runtime and duplicate-name destination labels still need verification.

Workspace menu labels now share singular/plural counts. Opening a Move to Workspace menu builds its choices from live sessions without decoding saved snapshots. Full `npm run native:check` passed after this change, including 97 Swift Testing cases across 34 suites and both Dev builds. See TASKS and UX-AND-FUNCTIONAL-ISSUES for the remaining workspace scenarios.

Reader selection now reveals the newly selected verse after SwiftUI lays out the shorter reading viewport on both platforms. Explicit passage jumps retain their existing range-aware scroll behavior. A direct verse click cancels a stale jump, and the Mac reader restores the text cursor when leaving an inline link. Full native check passed. The iOS 27 Simulator showed a dashed single-verse outline and separate, floating action and navigation capsules. Interactive verification of the last-verse reveal and a single outline around adjacent verses remains open.

On iOS 27 Simulator, Go → Obadiah 1:20–21 LXX showed one rounded dashed outline enclosing both verses and the final line fully above the floating actions and dock. This verifies the passage-jump route. Direct tap at the viewport edge still needs a gesture check. Native iPhone verse-number link and gutter taps now share one toggle path and request selection haptics, matching the legacy mobile selection feedback pattern. The link action names distinguish selecting from deselecting. iOS Dev build passed. Verify haptics and VoiceOver action names on hardware.

iPhone More → Scripture Display reuses Settings bindings for font size, family, spacing, verse numbers and red letters. Chapter export commands are grouped in a submenu. Settings now respects the iPhone's available width. iOS 27 Simulator verified turning verse numbers off, reopening the sheet to confirm the setting, and restoring them. The selected Obadiah 1:20–21 range and one-tab count remained intact. Both Dev builds passed. Live Mac Settings, iPhone font controls and the relocated export menu remain to verify.

Tag Chapter is now directly available in iPhone Scripture More and the Mac Scripture toolbar, including Compare. It uses the existing whole-chapter member format. iOS 27 Simulator created the synthetic Dev Chapter Parity tag while Obadiah 1:20–21 was selected. The tag appeared at the chapter header and both verses remained selected. Both Dev builds passed. The synthetic tag remains in the Simulator Dev library. Mac and Compare runtime checks remain open.

The shared Scripture tag picker now fits the iPhone sheet, displays an inline chapter or verse title, and exposes picked rows as selected to accessibility. Keyboard submission keeps tags already picked. Load or save failure stays visible instead of dismissing as if it succeeded. Both Dev builds passed. iOS 27 Simulator showed the full Obadiah title, verified the selected accessibility state, and returned to the same two-verse selection on Escape. Multiple-tag submission and compact hardware still need live coverage.
