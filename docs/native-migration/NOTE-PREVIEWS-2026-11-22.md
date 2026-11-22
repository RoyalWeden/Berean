# Rich note previews — 2026-11-22

Owner asks that note previews show rich content rather than Markdown. Apply both Mac and iPhone; preserve note source/editor/storage compatibility and intentional code styling. Rich preview links inside parent row/card buttons must not steal the normal open-note tap. Keep snippets bounded and cards readable; no nested interactive scroll view inside each compact list row.

## Original parity / newer owner direction

Original mobile NotePeek.tsx uses stripMarkdownFormatting +700character text and first image; mobile/tabs/TabPreview.tsx strips Markdown and uses260characters. Original desktop TabSwitcher.tsx NotePreview is a skeleton rather than actual note. Original version history uses renderPreviewContent. The new owner direction intentionally asks for richer native previews than these original stripped-text/skeleton surfaces. Do not use original plain output as a reason to keep visible markup or lose semantic formatting.

## In-progress scope

Audit NotesHome noteCard/row/longpress notePeek, NotesViews NoteRowView/wiki preview/version history MarkdownText, iPhone tab preview and daily note preview. Existing notePeek already uses MarkdownText(prefix4000); investigate renderer and excerpts separately. Truncating Markdown before parsing can expose delimiters or destroy tables/fences. Preserve links/references, code, highlights, headings, list/quote structure and formatted tables in appropriate bounded previews. Parent owns app builds/UI/docs/publication; bounded agent owns rendering source. No note/data mutation or editor rewrite authorized by this narrow slice.

Verification/results will be appended continuously. Do not claim a render fix from source inspection or a build alone. Current exact source and runtime ownership are in CURRENT-STATE.

## Baseline UI and focused follow-up

Actual owned Mac QA: Notes→All Notes→Filter→Layout→Gallery shows eight existing notes as flat plain excerpts (sparse mostly empty cards in cases with leading whitespace/structured content). Existing Thursday, February1,2024 / TimelineQA fixture contains heading, Scripture, highlight/code, nested tasks and callouts; use it without creating/editing notes. `nativeNotesHomeLayout` is device-local AppStorage; restore List and original Notes root after final check. MainGEN1selected1/Notes and originalEXO32Compare remain preserved in their tabs. No note opened for editing during baseline.

Parent re-ran the dormant Compare probe independently; PASS `compare-reentry-parent-review.log`. This is separate from note preview validation.

## Implemented candidate and verification underway

Changed NotesViews.swift, NotesHome.swift and IOSRootView.swift only. Shared full renderer and compact attributed excerpts hide valid Markdown syntax while retaining emphasis, underlines, highlights, wiki aliases and image captions; code remains literal. Gallery/iPhone tab cards use bounded noninteractive block layout with actual table grid. No nested interactive link/scroll control inside card; remote URLs in noninteractive thumbnails show caption instead of fetching. Peek parses complete first blocks instead of raw prefix4000; bounded code lines/table rows and leading spacer handling prevent oversized/blank thumbnails. Full history/Presenter renderer retains unbounded mode and heading navigation.

Ten isolated Swift parser/attributed checks pass (agent); parent compiles/reruns saved probe `build/apple/qa-evidence/20261121/note-preview-probe.swift`. This combines extracted renderer/excerpt + MarkdownLiveSpans/NoteImages and app-only stubs for Color.highlight, DeepLink and clickableCursor. It does not test actual UI or real palette colors. Saved probe predates final accessibility-role guards; final app builds verify those.

Mac actual first candidate: gallery displays blue links, highlighted words and table grid; clicking TimelineQA card opens its existing note. Version History shows heading/verse link, colored highlight, literal code `==literal==`, nested checklist and callouts without markup. No Restore/SaveVersion pressed, no note edited. Returned AllNotes→List→Notesroot→GEN1selected1/Notes.

iPhone actual first candidate: WikiQA peek and tabcard display rich link. The saved malformed literal `Preview [[` is unmatched text in that existing QA note, not a valid link delimiter to silently discard. Search table finds existing SundayNov15,2026 note. Long-press peek shows Item/Value header and Testrow/42 cells in grid; Open→Tabs shows same grid in thumbnail; tapping table opens note. Returned Back to Notes, cleared temporary search, selected prior Matthew5:12 reader (selection12/visible11), nine tabs. No new notes/tabs or intentional content edit.

Found actual thumbnail accessibility role regression: nested heading/table traits made table-containing tab card appear as heading instead of button. Final source gates those traits for noninteractive cards only; full previews retain headings. Both apps rebuilding final correction; native VoiceOver/hardware, large type and broader content/performance matrices remain open. Do not claim final corrected role from earlier candidate screenshot.

## Final reviewed source and actual result

Source **7ccbc3ca**. Final Mac and iOS development builds PASS (`mac-rich-note-previews-accessibility-build.log`, `ios-rich-note-previews-accessibility-build.log`). Parent independently compiled saved isolated probe and ran it: 10 checks PASS in `note-preview-parent-probe.log`. Exact compile: `xcrun swiftc -suppress-warnings -module-cache-path /tmp/berean-preview-attribute-module-cache build/apple/qa-evidence/20261121/note-preview-probe.swift -o /tmp/berean-note-preview-parent-probe`; then execute that binary. This captured probe is local ignored evidence, includes the leading-space correction and predates only the three accessibility guards.

Actual rebuilt final iPhone: searched existing table fixture, opened it without editing, opened Tabs; card now reports **button (selected)** with TableQA/Table content, instead of heading. Full VoiceOver not tested. Returned Back to original Notesroot, cleared search and selected prior Matthew5:12/selection12/visible11/nine tabs. Mac running previous visual candidate before final trait guards; final Mac build passes those guards, while visual gallery/history results remain applicable.

Final original-data verification `rich-note-previews-final-data-check.json`: all original note/settings/chat/tag row hashes retained, exact37Mac/47iPhone active tab IDs,22/26notes. No notes/tabs created or content edited. Mac Notes layout restored List and Notesroot before selecting GEN1selected1/Notes/offset0. Other checkout/owner app, physical device, schemas, sync and identities untouched.

Remaining: physical phone/VoiceOver and large type, broad imported Markdown dialects/very large documents, deeper wiki-link interactions in full previews. Invalid unmatched literal markup remains text; no source data is silently repaired. Already-stranded Compare records and viewport/read-aloud/Presenter parity remain separate open work.

Final callsite refinement after7ccbc3ca: expose a readable rich-derived excerpt on noninteractive gallery/tab thumbnails rather than repeated generic Table accessibility labels, retaining the parent button. No visible layout or data change. Both builds/runtime scope to be recorded after completion. Published4dd0331b CI45055062507 completed SUCCESS for native+legacy; this validates earlier copy/Compare source, not rich-preview changes.

## Final label source26dfced7

Both final label builds pass (`mac/ios-rich-note-preview-labels-build.log`). Actual installed final iPhone table thumbnail reports **button(selected)** with readable description “Table QA / Item · Value / Test row · 42”, replacing repeated generic Table labels; this is AX inspection, not a VoiceOver session. Returned Notesroot/clearedsearch and prior Matthew5:12selected12/visible11/nine tabs/no sheet. Final source26dfced7 follows7ccbc3ca; Mac runtime remains visual candidate before trait/label-only refinements while final Mac build covers them. Earlier original-row data check covers identical no-edit fixtures; no new note/tab or content edit during final label check.
