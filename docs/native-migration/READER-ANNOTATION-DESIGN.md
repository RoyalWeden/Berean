# Reader annotations: keep the passage calm

## Direction — 2026-11-19

The user reports that tags interrupt reading and welcomes a different workflow from Electron. Keep organization and study details outside the running Scripture text. Personal material earns a quiet indicator; ubiquitous built-in cross references do not need a marker beside every verse.

## Implemented on the review branch

- Mac and iPhone continuous readers replace trailing colored verse-tag labels and trailing note counts with one neutral margin dot when a verse has an attached note or tag. It opens the existing Notes study tool for that verse. The verse number remains a separate selection target. Dot characters are marked as non-body content and excluded from copying/highlight offsets.
- Chapter tag names become one neutral caption, `Chapter tags · count`, opening chapter-scope study details. No tag names/colors interrupt the passage.
- Study Notes separates Tags, Chapter Tags and Notes. Tags can be searched, added with the existing picker, and removed through the existing membership operation in the chip context menu. Multi-verse selection unions tags by stable tag ID. Chapter scope includes the chapter’s verse tags while keeping whole-chapter tags separately labeled.
- Compare removes the tag rows below every verse. A quiet study dot opens the exact column’s edition/passage in Reader with Notes, retaining the prior one-click note workflow. iPhone retains its normal verse actions menu.
- No annotation, verse identity, tag color, note body, tag schema, sync or highlight-offset migration. Labels use the actual edition; legacy tag coverage remains translation-agnostic.

## Cross-reference distinction and remaining design

Built-in TSK/TSKe references remain in Cross Refs and the selected-verse actions; adding an indicator to most verses would add noise without helping discovery. Personal note citations are different from attached verse notes. Their existing ↗ marker and My Notes source remain unchanged in this increment. Audit a unified personal-study affordance that can reveal Attached Notes, Tags and Mentions in Notes as distinct destinations, without silently opening attached notes when only a citation exists. Preserve one-click access, source choice, raw/display verse mappings and range coverage. Do not add another permanent icon to every verse.

## Verified interactions

Mac QA: Genesis1 verse1 dot opens QA First Verse and QA Creation in study details; chapter caption opens chapter scope; Tag Selected Verses opens the existing picker, Cancel leaves tags unchanged. Shift-click verse2 retains the grouped range; Copy→Go paste contains exactly Genesis1:1–2 plus the two verses, no dot/tag/caption. Compare has study dots and no tag labels in its text cells; the LXX dot opens Genesis1 LXX with Notes. Final rebuilt panel explicitly separates Notes from tag sections. Original Genesis1:1 KJVA/CompareOFF/Strong’sOFF/CrossRefs restored, original note tab restored.

iPhone18Pro/iOS27: passage picker search John7:2 opens the already-tagged passage. A touch on its margin dot opens the existing John7:2 note and Dev Chapter Parity tag. Dismiss→tap verse3 body extends selection to2–3 with one dashed group and floating actions. More→Back restores original Psalm3 LXX unselected/Strong’sOFF/inspectorclosed. Capture KeyboardOFF at cleanup. No note/tag edits submitted.

Both SDK27.2 builds pass: `/tmp/berean-study-tags-final-{mac,ios}.log`. This is app-view code; package sources/tests unchanged from the prior253-test pass. Do not call that a new253-test run. All7Mac/17iPhone original note content hashes and timestamps match existing baselines; exact37Mac/47iPhone active tab IDs retained; all3iPhone tag tables match `/tmp/berean-study-tags-ios-baseline.json`.

## Open acceptance

Physical-phone/VoiceOver/pointer target checks, huge tag lists, long names, mixed/range removals, hidden verse numbers, large type, dark/high-contrast and Reduce Transparency, note-only markers and multi-column/stacked Compare matrix. Search/remove commands retain existing implementations but were not submitted in this UI pass. Chapter caption placement under floating chrome needs a width/scroll audit. Compare dots currently open Reader, not an in-place popover. General pane splits and finer Compare Strong’s word anchoring remain separate unfinished work.
