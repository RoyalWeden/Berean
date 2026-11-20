# Native automatic reference blocks — precise parity checkpoint

2026-11-19, source567b9861/52516683/66d37947. Use latest HANDOFF for runtime, Git and CI.

## Original behavior, verified from source

- `src/components/notes/pm/autocomplete.ts`: typed Strong’s ID or verse reference near the caret offers insertion; verse scanner supports multiword names and LXX. Suggestions are governed separately by noteStrongsBlockSuggest/noteVerseBlockSuggest.
- `src/components/notes/pm/blockDecorations.ts`: existing or newly pasted text gets presentation without source conversion. Two-line lexicon blocks are independent of noteScriptureBlock. Scripture detection recognizes single-line reference+body and multiline numbered verses; canonical-text verification uses noteScriptureBlockThreshold.
- `src/lib/noteTextBlocks.ts`: original defaults/scanners/verification; `src/store/index.ts` defaults noteScriptureBlock=false and threshold0.9.
- Word Replacer original settings section supports master and per-rule switches. Persisted wordReplacerRules is an array; hydration merges missing default IDs while preserving existing rules/order (multiword defaults prepended, single-word defaults appended). Native currently uses static defaults across many consumers. A rule browser alone is not parity.

## Native result

| Area | Current evidence | Remaining |
| --- | --- | --- |
| Typed reference suggestion and explicit acceptance | Mac G5485→Return, Undo/Redo; John3:16→Return; existing unit grammar checks pass | iPhone typing/IME/hardware full matrix; trailing-space parity |
| Automatic lexicon block presentation | New pure NoteLexiconBlock scanner; both native editors render source-preserving rounded cards. Actual Mac inserted G5485 card; iPhone pasted Greek/Hebrew cards and exact stored-source check | Rich/imported markup combinations, all editor sizes/accessibility, read-only version/print parity |
| Table cell safety | Completion suppressed in real table cells; unit and Mac actual caret check | Keep ordinary inline links working; no multiline expansion into serialized table rows |
| Psalm reference expansion | Uses same prepared reader rows, title stays with opening verse, displayed labels in ranges. Actual final Mac Psalm3:1LXX contains title and O Lord… | Partial Psalm115:4–5 combined record is deliberately not offered as one verse; broader combined/multirange UI matrix |
| Scripture block presentation | **Implemented7e8142f9**: canonical selection/verification, original settings, source-preserving cards in both editors; actual Mac+Simulator exact paste/Undo/table/duplicate/rejection checks | Rich-import/read-only/print, physical phone, IME/large notes and full reference-index grammar remain open |
| Backlinks | Existing native Scripture/Strong’s links and revision-aware My Notes index retained | Do not equate block styling with complete automatic reference grammar/index parity |
| Word Replacer Settings | Searchable bundled rules grouped by type, master toggle; Mac number/no-results/Done tested; both builds pass | Load/retain custom rules and unknown fields; test persistence/merge order; pass one revision-scoped set through every reader/search/result/previews/copy/export consumer before per-rule editing |

## Safe next implementation sequence

1. Add pure Scripture-block candidate ranges excluding code/links/tables/other structures. Preserve UTF16 source and annotation identities.
2. Verify candidates against the resolved text using a bounded async cache, with exact stale-result guards and original threshold semantics. Reader Psalm mapping must also be used for canonical note blocks.
3. Apply presentation only; keep normal note fonts, editable source, one-step edits and existing reference tracking. Native read-only history/print must share recognition, not guess from any leading reference.
4. Test false-positive prose, single/multiline/disjoint/LXX/multiword references, malformed/partial data, table boundaries, code, links, settings changes, return/restart and undo before marking parity.

Full274tests and both final builds pass. Actual evidence and cleanup IDs in HANDOFF. Continuous physical hover/new margin preview, iPhone rule browser, accessibility/compact/read-only combinations remain unverified.

## 2026-11-19 — Aligned cited-passage previews

Owner hover/indicator steering took priority and is implemented/tested as1f4e7361; see STUDY-PREVIEW-ALIGNMENT.md. Before that interruption a pure candidate/ratio draft was started. It is preserved at prototypes/NoteScriptureBlocks.swift.txt, explicitly UNTESTED, not compiled into either app. It handles source-range projection and single/multiline candidates, but has no canonical lookup, settings/editor integration or test proof. Add Hermas/edition support and the safety/verification gates above before use; do not mark Scripture block parity done.

## 2026-11-19 — Live implementation supersedes the draft

Source7e8142f9 promotes/reworks the candidate idea into compiled/tested NoteScriptureBlocks and NoteScriptureSelection, canonical async verification and both native editors/settings. The former prototype is historical; do not copy it over current code. Full290tests/finalMac+iOSbuilds pass. See SCRIPTURE-BLOCKS-2026-11-19 for actual UI/source/cleanup and remaining scope. Steps1–3 in the earlier safe sequence are now implemented for editable plain/inline-format blocks; step4 remains a broader matrix, not a completed all-parity claim. Continue rich/imported/read-only/index coverage and newly reproduced dock/attachment issues rather than starting the port again.
