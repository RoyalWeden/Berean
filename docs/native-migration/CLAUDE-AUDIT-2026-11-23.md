# Claude change audit — 2026-11-23

Owner asks Codex to audit all Claude changes, fix poor behavior/quality and ensure Claude/Codex continuously leave usable notes. Previous goal turn produced source analysis only before a delegated turn hit a usage limit; no Compare persistence implementation was made. This audit supersedes that planned slice while preserving it in the queue.

## Authoritative baseline

- Codex checkout was clean1b58c644. Fetched verified github remote; safely fast-forwarded to Claude published50732392 (34 commits,30 changed files,1184 additions/135 deletions). Other checkout `/Users/roywe/Berean-native` was clean50732392, read-only inspected and not modified.
- Draft24 live50732392, OPEN/draft/base native/m6-navigation, all three checks SUCCESS (native/legacyCI45195098164). Green checks do not prove every UI edge case.
- Claude appended28 lines to HANDOFF historical log and updated several feature documents, but left top current checkpoint and CURRENT-STATE at Codex's older source/runtime. This is a real continuity defect; do not claim no notes were written.
- Historical owner “Stop for now” and deferred Dev-iCloud decision are preserved as dated evidence. Current direct owner audit/continue request resumes authorized work. Dev-iCloud/signing/production data restrictions remain; no permission assumed from the resume.
- Runtime/QA fixture values from Nov22 are historical until reverified. Do not restart another app, use physical phone, or write production data as an audit fallback.

## Audit coverage / ownership

Read-only independent slices; primary worker verifies findings and implements focused fixes. No universal “audited clean” claim from a build or delegated report.

| Changed file | Review owner | Status |
|---|---|---|
| `Packages/BereanKit/Sources/BereanNotes/NoteSlashCompletion.swift` | Notes reviewer | Source reviewed; evidence and remaining runtime checks below |
| `Packages/BereanKit/Sources/BereanNotes/PdfService.swift` | Data/services reviewer | Source reviewed; evidence and remaining runtime checks below |
| `Packages/BereanKit/Sources/BereanSQLite/SQLite.swift` | Data/services reviewer | Source reviewed; evidence and remaining runtime checks below |
| `Packages/BereanKit/Sources/BereanStore/StudyTrailService.swift` | Data/services reviewer | Source reviewed; evidence and remaining runtime checks below |
| `Packages/BereanKit/Tests/BereanConformanceTests/NoteSlashCompletionTests.swift` | Notes reviewer | Source reviewed; evidence and remaining runtime checks below |
| `Packages/BereanKit/Tests/BereanConformanceTests/PdfServiceTests.swift` | Data/services reviewer | Source reviewed; evidence and remaining runtime checks below |
| `Packages/BereanKit/Tests/BereanConformanceTests/StudyTrailServiceTests.swift` | Data/services reviewer | Source reviewed; evidence and remaining runtime checks below |
| `apple/BereanIOS/BereanIOSApp.swift` | Parent: app shell / UI actions | Source reviewed; evidence and remaining runtime checks below |
| `apple/BereanIOS/IOSChapterTextView.swift` | Reader/navigation reviewer | Source reviewed; evidence and remaining runtime checks below |
| `apple/BereanIOS/RichNoteEditorIOS.swift` | Notes reviewer | Source reviewed; evidence and remaining runtime checks below |
| `apple/BereanIOS/SpotlightIndex.swift` | Reader/navigation reviewer | Source reviewed; evidence and remaining runtime checks below |
| `apple/BereanMac/RichNoteEditor.swift` | Notes reviewer | Source reviewed; evidence and remaining runtime checks below |
| `apple/Shared/BdbSelectableText.swift` | Reader/navigation reviewer | Source reviewed; evidence and remaining runtime checks below |
| `apple/Shared/ChatViews.swift` | Data/services reviewer | Source reviewed; evidence and remaining runtime checks below |
| `apple/Shared/NoteTableLayout.swift` | Notes reviewer | Source reviewed; evidence and remaining runtime checks below |
| `apple/Shared/NotesHome.swift` | Notes reviewer | Source reviewed; evidence and remaining runtime checks below |
| `apple/Shared/NotesViews.swift` | Notes reviewer | Source reviewed; evidence and remaining runtime checks below |
| `apple/Shared/PassagePicker.swift` | Reader/navigation reviewer | Source reviewed; evidence and remaining runtime checks below |
| `apple/Shared/PdfViews.swift` | Parent: app shell / UI actions | Source reviewed; evidence and remaining runtime checks below |
| `apple/Shared/ScriptureView.swift` | Reader/navigation reviewer | Source reviewed; evidence and remaining runtime checks below |
| `apple/Shared/StudyTrailView.swift` | Parent: app shell / UI actions | Source reviewed; evidence and remaining runtime checks below |
| `apple/Shared/StudyViews.swift` | Reader/navigation reviewer | Source reviewed; evidence and remaining runtime checks below |
| `docs/native-migration/APP-INTENTS-2026-11-20.md` | Parent: documentation / evidence claims | Source reviewed; evidence and remaining runtime checks below |
| `docs/native-migration/CHANGELOG.md` | Parent: documentation / evidence claims | Source reviewed; evidence and remaining runtime checks below |
| `docs/native-migration/FULL-FEATURE-PARITY.md` | Parent: documentation / evidence claims | Source reviewed; evidence and remaining runtime checks below |
| `docs/native-migration/HANDOFF.md` | Parent: documentation / evidence claims | Source reviewed; evidence and remaining runtime checks below |
| `docs/native-migration/OWNER-DECISIONS-BRIEF-2026-11-22.md` | Parent: documentation / evidence claims | Source reviewed; evidence and remaining runtime checks below |
| `docs/native-migration/S14-PSALM-119-TIMING-2026-11-20.md` | Parent: documentation / evidence claims | Source reviewed; evidence and remaining runtime checks below |
| `docs/native-migration/STATUS.md` | Parent: documentation / evidence claims | Source reviewed; evidence and remaining runtime checks below |
| `docs/native-migration/YOUTUBE-TAB-2026-11-20.md` | Parent: documentation / evidence claims | Source reviewed; evidence and remaining runtime checks below |

## Confirmed continuity correction

HANDOFF, AGENTS, CLAUDE and AI-CONTINUITY now explicitly require synchronizing BOTH current summaries after meaningful code/test milestones and before every final reply/handover; historical-only appends are insufficient. Reconcile source/docs/published head, dirty work, live checks, app/data ownership, failures and next steps. Reconcile the complete queue before claiming remaining work is owner-gated. This is required support for actual source fixes, not a substitute for them.

## Findings / fixes / verification

Source review covered all 30 changed files. See the dated integration and verification entries below; a source review does not establish every runtime interaction.

## Incoming owner steering / active fixes

- Lexicon sidepanel excerpts must center/truncate around highlighted words; reader reviewer owns StudyViews/helper fix and tests, full CopyVerse preserved.
- Study Trail and Messages must be easy to find on both apps. Parent adds visible Mac sidebar utility shortcuts, direct iPhone More items, Go/palette entries and Messages/chat aliases. Stable window IDs/data routes retained; no forced tab creation.
- KJVA picker should open at BOOKS rather than currentbook chapters; current book highlighted; add quick OT/NT/Apoc reach. Reader reviewer owns PassagePicker. Preserve single-book directchapter/prologue behavior; existing three-column iPhone grid confirmed in source, installed user build not assumed.

### Confirmed source findings and corrections underway

1. **Continuity:** historical entries updated, current pair stale. Rules and currentpair corrected; not “no handoff written.”
2. **PDF label failure:** save/rename `try?` discards error and closes prompt. Data reviewer replacing with compact native editor retaining draft/error; remove failure also reported.
3. **Study Trail data:** split leaves chained descendants with old trail; move leaves anchored stickies behind and all-stale moves still bump target. Data reviewer implementing transactional fixes/tests. Merge loses tags/manualrecap; preserve both without timeline invention. Live recording anchor move/split must reject safely until paused; investigate actual service predicate.
4. **Study Trail UI:** bulk move clears selected IDs even when service fails; now clear only on success. Recheck recording source at merge confirmation. Removed false assurance that splitting undoes an interleaved merge. Fold controls enlarged to native touch targets/hover; fold write failures reported instead of faking persisted success. Single preorder scan avoids rebuilding ancestor dictionaries per row and retains disclosure for imported cycle roots. Parent owns StudyTrailView.
5. **Notes:** slash block formatting split into delayed second edit could hit moved cursor; replacing with one validated edit. Board bulk selection/count uses a different row set than visible status cards; restrict to displayed cards. Table `.byClipping` hides cells; content-preserving fallback under review, full wide editable-grid UX remains open. iPhone hardware slash-menu navigation and fence/table detection also under review. Notes reviewer owns these files.

No final app UI/build claim for these dirty changes yet; all require central review and verification.

## Integration checkpoint — source frozen for builds

- Original reader reviewer returned no report or changes after bounded requests; interrupted and did not use its unreturned work as evidence. Primary reviewed the original Strong’s/toolbar/Spotlight/BDB diffs; Notes reviewer took the bounded picker implementation. No discarded source edits.
- Completed source reviews cover every changed source file. Notes reviewer covers slash, both editors/substitution, Board, table layout; data reviewer covers Trail/PDF/SQLite/Chat; primary covers Trail/PDF UI, reader/toolbar/picker, app entry/Spotlight and all changed documentation claims. This does not mean every behavior is runtime verified. Historical physical-device/Shortcuts claims retained as Claude-reported unless independently checked.
- Fixed narrow lexicon rendering with a separate match-centered excerpt, leaving full rendering filters and CopyVerse untouched. Narrow panes begin at first valid match with an ellipsis; full tabs retain bounded leading context. Existing golden search-window behavior unchanged. Six regression cases cover late/short/unsorted/invalid indices, context budgets and bounds.
- Added Spotlight session-content change key (IDs/names/tabtitles) instead of names-only, so tab navigation/rename invalidates indexed titles without scroll-offset refresh churn. System Spotlight UI remains unverified.
- New Chat audit corrections: unavailable delete service reports failure, failed scoped reads preserve scope/content instead of falling back to All Messages, and note-message accessibility includes Edit alongside Reply/Copy/Delete. Missing conversation does not show another conversation.
- Study Trail live-anchor guard additionally covers service merge and requires a real started anchor, so untimed historical rows are not mistaken for the current recording stop. Parent added regression cases. Historical pause intervals remain unchanged; merge prompt explicitly avoids claiming exact timeline/undo reconstruction.
- Initial integrated Mac build PASS20227; initial full package PASS366SwiftTesting/93suites +4coretests. These precede last service merge predicate/regression and Chat read/role corrections. Final Mac11758 and full package19478 now running; do not report initial checks as final-source proof. Pure actual fold/command probe PASS6fold +aliascases (`fold-command-probe.log`).
- Notes isolated45tests/5suites +7compositioncases PASS in focused logs, and data focused5PASS. Duplicate data full run intentionally stopped130 after parent integrated run began; not a failure or a pass. Notes runtime keyboard/Undo/Board drag and full wide editable grid remain open.
- Baselines revalidated freshNov23 under qa-evidence/20261123: Mac37activeIDs/22notes/2trails, iPhone47activeIDs/26notes/0trails. Mac onlyrunningnativePID2506 is othercheckout; leave untouched. CodexD0CCbooted iPhone18Pro/iOS27; ClaudeE8Botherdevicealso booted, untouched. Exact Codex MacQA notrunning yet. Physical phone not accessed.

## Final test correction / verification handles

FinalMac11758 PASS. Fullpackage19478 failed exactly one newly added parent fixture: `untimedHistoricalStop...` attempted aNULL anchor_started_at, but the recorded schema requires NOTNULL. This was a test assumption error, not a discovered runtime failure or a reason to change schema. Removed impossible fixture and redundant nullable-start predicates; retained active-recording source merge guard and its assertion alongside move/split rollback. Prior “untimed legacy stop” hypothesis is SUPERSEDED. No corpus/schema/data changes.

Verified-source rebuild18768 (`mac-claude-audit-verified-build.log`) and package54455 (`full-package-verified-tests.log`) now running. Firstsource package366+4PASS remains evidence only for its scope; do not conflate failedfixture run with success. Next iOSbuild afterMac, then UI fordirectaccess, KJVABooks/sections, lexiconlate-match/snippet+fullcopy, Noteskeys/Undo/Board wherepossible.

## Verified UI and owner correction — Nov23

- Both verified native builds passed: mac-claude-audit-verified-build.log, ios-claude-audit-verified-build.log. Full-package-verified-tests.log passed366conformance+4Core Swift Testing tests (370total; XCTest wrapper has zero tests). Earlier failed NULL-start fixture is corrected as described above.
- Mac actual UI: Sidebar Study Trail opens existing trails; Messages opens All Messages in the same Berean process; both dismiss without creating tabs (7Study tabs retained). KJVA opens BOOKS; OT/NT/Apocrypha segments expose their books.
- OwnedD0CC iPhone actual UI: Matthew5 opens KJVA BOOKS with Matthew highlighted, all27NTbooks fit one screen; Apocrypha reaches14books; Sirach opens chapters including prologue. Done returns sameMatthew5/selected12;9tabs unchanged. More→StudyTrail and More→Messages both open and dismiss back to same reader. Go→modal routes/aliases still need runtime checks.
- Mac compact Lexicon H776 actual UI: occurrence1Chronicles1:10 showed highlighted“earth” immediately, and CopyVerse pasted into transient command search as the complete single-line“1 Chronicles 1:10 And Cush begat Nimrod: he began to be mighty upon the earth.” Dismissed without navigating, restored Notes inspector.
- **Owner correction:** first excerpt implementation omitted too much preceding context (end matches could show only“… earth.”). Superseded by bounded surrounding phrases: up to7precedingwords within56characters(compact)/72(full), maintaining firstmatch visibility. Added2regressions for final-word context and late-match budget. New source rebuild/test logs are lexicon-context and full-package-context; old GUI excerpt evidence does NOT prove this final revision.
- Still unverified: final revised snippet runtime; iPhone snippet/fullCopy; slashhardware/Undo/Boarddrag and wide-table runtime; PDFsheet failure/focus; Trailmutation failure/VoiceOver; Spotlight UI/AppIntents/physicalphone. Full horizontal editable table grid remains OPEN; wrapping preserves content. Broad Strong’s1.5s dedup race remains source-only concern, not reproduced.

## Final source checkpoint — revised context verified

- Source commits: `ca7d0a8c` Trail/PDF integrity and failure handling; `04febca1` atomic Notes slash/Board/table fixes; `6fc04d7e` KJVA Books, visible tool access, Messages/Spotlight, readable lexicon context. Documentation follows separately.
- Final revised source: both builds PASS (`mac-lexicon-context-build.log`, `ios-lexicon-context-build.log`); full package PASS **368conformance +4Core =372tests**,93conformance suites (`full-package-context-tests.log`). Initial context test attempt failed before compilation because the compiler cache was inaccessible; rerun with authorized cache access passed. The earlier370-test pass remains historical.
- Actual rebuilt Mac H776 UI now shows **“… he began to be mighty upon the earth.”** with “earth” highlighted.1Chronicles1:19 and1:43 also retain context and visible highlights. This supersedes the one-word excerpt and verifies the owner's correction. Restored Notes inspector and original reader. iPhone final excerpt runtime remains unverified; shared source and bothbuilds verified.
- Read-only final original-data check: every watched row hash unchanged on both QA libraries (notes/settings/messages/tags/trails/PDF data), active tab ID sets exactly unchanged: Mac37→37, iPhone47→47. Evidence `original-data-verification.json`; QA presentation/history offsets are intentionally outside this content comparison. No content mutations, no production data access.
- Unverified GUI remains explicit above. Do not treat service tests or builds as proof of full interaction/accessibility coverage. Continue the broader migration queue after publication.
