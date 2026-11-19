# Reader annotations: keep the passage calm

## Direction — 2026-11-19

The user reports that tags interrupt reading and welcomes a different workflow from Electron. Keep organization and study details outside the running Scripture text. Personal material earns a quiet indicator; ubiquitous built-in cross references do not need a marker beside every verse.

## Implemented on the review branch

- Mac and iPhone continuous readers replace trailing colored verse-tag labels and trailing note counts with one neutral margin dot when a verse has an attached note or tag. It opens the existing Notes study tool for that verse. The verse number remains a separate selection target. Dot characters are marked as non-body content and excluded from copying/highlight offsets.
- Chapter tag names become one neutral caption, `Chapter tags · count`, opening chapter-scope study details. No tag names/colors interrupt the passage.
- Study Notes separates Tags, Chapter Tags and Notes. Tags can be searched, added with the existing picker, and removed through the existing membership operation in the chip context menu. Multi-verse selection unions tags by stable tag ID. Chapter scope includes the chapter’s verse tags while keeping whole-chapter tags separately labeled.
- Compare removes the tag rows below every verse. A quiet study dot opens the exact column’s edition/passage in Reader with Notes, retaining the prior one-click note workflow. iPhone retains its normal verse actions menu.
- No annotation, verse identity, tag color, note body, tag schema, sync or highlight-offset migration. Labels use the actual edition; legacy tag coverage remains translation-agnostic.

## Cross-reference distinction — implemented follow-up

Built-in TSK/TSKe references remain contextual. One margin dot now covers personal notes, tags and personal note connections, including ordinary notes mentioning the verse. The trailing ↗ has been removed. Study Notes exposes `From My Notes → Related Passages`, which opens Cross Refs with the My Notes source and the current verse/range/chapter scope. Attached Notes remain a separate section. The ordinary-note list is labeled `Notes Mentioning This Passage`. This intentionally replaces direct arrow navigation with one consistent study entry, then a clearly labeled destination.

`NoteCrossReferences.indirectByVerse` preserves the existing indirect-note list and reference grammar while exposing an exact verse index. Ranges and duplicate mentions are deduplicated per note/verse; chapter-only mentions stay at zero in chapter scope and do not create a marker beside every verse. The reader uses its existing revision cache; Compare loads the index once per displayed edition/chapter and Notes revision. A neutral Chapter study entry replaces the separate chapter-citation row when chapter material exists. No persistence or reference identity changes.

## Verified interactions

Mac QA: Genesis1 verse1 dot opens QA First Verse and QA Creation in study details; chapter caption opens chapter scope; Tag Selected Verses opens the existing picker, Cancel leaves tags unchanged. Shift-click verse2 retains the grouped range; Copy→Go paste contains exactly Genesis1:1–2 plus the two verses, no dot/tag/caption. Compare has study dots and no tag labels in its text cells; the LXX dot opens Genesis1 LXX with Notes. Final rebuilt panel explicitly separates Notes from tag sections. Original Genesis1:1 KJVA/CompareOFF/Strong’sOFF/CrossRefs restored, original note tab restored.

iPhone18Pro/iOS27: passage picker search John7:2 opens the already-tagged passage. A touch on its margin dot opens the existing John7:2 note and Dev Chapter Parity tag. Dismiss→tap verse3 body extends selection to2–3 with one dashed group and floating actions. More→Back restores original Psalm3 LXX unselected/Strong’sOFF/inspectorclosed. Capture KeyboardOFF at cleanup. No note/tag edits submitted.

Both SDK27.2 builds pass: `/tmp/berean-study-tags-final-{mac,ios}.log`. This is app-view code; package sources/tests unchanged from the prior253-test pass. Do not call that a new253-test run. All7Mac/17iPhone original note content hashes and timestamps match existing baselines; exact37Mac/47iPhone active tab IDs retained; all3iPhone tag tables match `/tmp/berean-study-tags-ios-baseline.json`.

## Open acceptance

Physical-phone/VoiceOver/pointer target checks, huge tag lists, long names, mixed/range removals, hidden verse numbers, large type, dark/high-contrast and Reduce Transparency, note-only markers and multi-column/stacked Compare matrix. Search/remove commands retain existing implementations but were not submitted in this UI pass. Chapter caption placement under floating chrome needs a width/scroll audit. Compare dots currently open Reader, not an in-place popover. General pane splits and finer Compare Strong’s word anchoring remain separate unfinished work.

## Follow-up verification — unified personal references

All254tests PASS (4core+250conformance/63suites),107.288s conformance, `/tmp/berean-personal-study-full-suite.log`; focused32tests/8suites PASS `/tmp/berean-personal-study-tests.log`. BothSDK27.2 builds PASS `/tmp/berean-personal-study-final-{mac,ios}.log`. Initial new test incorrectly treated a note title as a body citation; corrected the fixture and explicitly retained title-only exclusion, without changing the legacy parser.

Mac: ordinary original note mentioning John3:17 produced a dot; dot→Related Passages→My Notes→Notes Mentioning This Passage→original note; Back returned John3:17 with study source and visible verse restored. Strong’sON kept17 at the same reading area; OFF restored it. Compare also showed reference-only dots for16/17;17’s dot returned its exact Reader/Notes scope. RestoredGEN1:1KJVA/CompareOFF/Strong’sOFF/CrossRefsTSKe/originalnote. iPhone18Pro/iOS27: existing ordinary Wiki iPhone QA note mentioningJohn3:16–17 produced17’s dot; touch→Related Passages→My Notes showed that note. Dismiss→Back restoredPsalm3LXX/unselected/inspectorclosed/CaptureKeyboardOFF. No new notes/tags submitted.

Integrity: all17iPhone original note hashes/timestamps,47exact active IDs and all3tag tables match prior baselines. Mac baseline became stale during concurrent interaction: originalnote d29d2127 content/timestamp changed (including user-entered text), H3069 and Search:end tabs appeared, another prior tab closed; current active total38. Preserve these newer edits. Do not claim all7Mac notes/37IDs unchanged for this follow-up or restore/delete them. Isolate subsequent Mac UI work with a separate QA profile and preference domain before further interaction; no direct repair writes applied.
