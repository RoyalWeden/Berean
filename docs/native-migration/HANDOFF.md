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
