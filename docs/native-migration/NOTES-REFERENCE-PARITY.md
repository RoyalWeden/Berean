# Notes reference parity — 2026-11-19

Keep this audit separate from a blanket “all parity complete” claim. Source files remain authoritative; no note-content/sync/schema rewrite is authorized by a presentation preference.

| Behavior | Electron evidence | Native state and proof | Remaining work |
| --- | --- | --- | --- |
| Automatic Scripture links | SettingsModal and mobile NotesSettingsPage: noteVerseRefsEnabled | Existing native shared key; both editors use NoteVerseRefs.linkSpans. Mac existing false preserved; iPhone default true preserved | Full alias/range/punctuation/edition/single-book matrix |
| Automatic Strong’s links | Same settings pages + settingsBridge: noteLexiconRefsEnabled, default true | NOW loaded/saved using original key and applied independently by both rich editors; live restyle on preference change | Imported false fixture outside isolated UI profile and multi-window matrix |
| Explicit links | Markdown/wiki source routes | Mac automatic H430 disappeared OFF while explicit Manual→G26 remained; ON restored H430 without source changes | Explicit rich/table/wiki/escaped URL matrix |
| Persistence | settingsBridge shared key | iPhone OFF survived terminate/relaunch; setting remained OFF and links plain. ON restored links. Final Mac/iPhone stored JSON true; Mac Scripture detection false unchanged | Other settings/legacy bridge full audit |
| Block expansion suggestions | noteVerseBlockSuggest/noteStrongsBlockSuggest independent toggles | Existing guarded NoteReferenceCompletion and prepared block insertion, independent of auto-link flags. Suggestion excerpt now readable | Full typed range/alias/markup/table/Undo/settings interaction matrix |
| Personal outgoing/reverse passage links | notesCrossRefs.ts + crossRefIndex.ts | Existing direct/reverse/whole-chapter/range/edition APIs retained | Full library, aliases, old imported attachments, all19texts and multi-note dedup |
| Ordinary-note mentions | Legacy My Notes canonical-name search has80 cap; global reciprocal index documents alias-search failure | NOW indexed exact chapter-number candidates across all live note types; parser owns actual book/range/edition validation. No80 cap. Actual Mac Jn3:17 ordinary note appears via verse dot→Related Passages→My Notes even with Scripture auto-links OFF | Large-library parsing latency; wider grammar/edition matrix. Do not reinstate a page cap for performance |
| Strong’s backlink tracking | Chapter cross-reference index extracts Scripture references, not bare Strong’s IDs | Shared full/compact Lexicon now exposes collapsed My Notes with normalized bare and explicit lexicon destinations; native blocks included by their source, wiki titles excluded. Mac normalized/explicit/edit invalidation and iPhone existing-note/top-Back verified. No arbitrary verse associations | Compact inspector, all grammar/link forms, large-library/race/source-closure/forward matrix |

## Regression coverage

NotesConformanceTests ordinaryCitationsIncludeAliasesAndAreNotLimitedToSearchPageSize creates90canonical citations, an abbreviated range and a whole-chapter alias. It checks exact verse/chapter indicators, excludes a different chapter, then verifies edit/move-to-Trash/restore immediately refresh the result. Targeted33tests/8suites pass in0.081s; full256tests pass. No golden fixtures edited. Package tests validate service behavior; native link styling/persistence is proven by the Mac and iPhone interactions in HANDOFF.

## Important boundaries

Detection toggles change automatic styling/navigation, not saved text or the existence of user references. Explicit links remain links. Suggestion settings are separate. Existing native chapter/range/edition parser behavior is retained; this increment does not claim every legacy reference grammar, superscription, imported attachment or Strong’s backlink workflow is finished. Candidate lookup uses the parsed display chapter number as an indexed token, then validates through the real parser. Profile copies only were used for UI writes.

## Strong’s index validation

New NoteStrongsIndex tests exceed the default 200-note page, deduplicate repeated mentions, distinguish H43/H430/G430, retain source, and refresh after edit/Trash/restore. Explicit code/image/comment/wiki/URL exclusions are covered. One off-main ephemeral index per app note revision, no saved identity change. Full 258 tests pass; latest HANDOFF names logs, exact safe fixtures and the initial HTML-comment and note-Back bugs found and corrected. Detection OFF does not erase relationships. Imported Markdown reference-style destinations and unusual embed/HTML grammars still require a broader rendering/link compatibility audit.
