# Testing backlog — 2026-09-26

Source: the developer's `September 26, 2026 – Testing.md` (no screenshots) and the Sept 26 brief.
Continues [testing-backlog-2026-09-25b.md](testing-backlog-2026-09-25b.md); every earlier ledger
stays in force. "Sim" = iOS simulator via the probe harness; **Dev** = physical iPhone.

| ID | Requirement | Implementation | Files | Platform | Tests | Manual | Status |
|---|---|---|---|---|---|---|---|
| SEP26-FIND-001 | "zechariah" in Matthew 23 must keep highlighting past "ze" | **Root cause:** the default word-replacer rule shows KJV "Zacharias" as "Zechariah", but ChapterView handed the find query only to rows whose RAW text matched — "z" matched "Zacharias", "ze" matched nothing, so Matthew 23:35 never got the query. One shared rule now: raw AND displayed text | src/lib/scriptureFind.ts, ChapterView.tsx, VerseRow.tsx, mobile/reader/FindOnPage.tsx | both | scriptureFind (6) | Sim: z / ze / zec / zechariah all highlight | COMPLETE |
| SEP26-FIND-002 | Case-insensitive; text never altered | matching lower-cases the query and haystack only | scriptureFind.ts, lib/highlight.tsx | both | scriptureFind | Sim: ZECHARIAH | COMPLETE |
| SEP26-FIND-003 | Every occurrence, whole chapter | per-word marking of every occurrence (unchanged) now reached for every matching row; `countOccurrences` | scriptureFind.ts, VerseRow.tsx | both | scriptureFind | Sim: "blood" → 4 marks in Matthew 23 | COMPLETE |
| SEP26-FIND-004 | Continuous scroll + no stale state | the query reaches every mounted chapter (ContinuousChapterScroll → ChapterView); iPhone Find on Page searches the whole book through the same rule; find resets on book / text change | ContinuousChapterScroll.tsx, ReaderPage.tsx | both | findOnPage, scriptureFind | Sim (continuous) | COMPLETE |
| SEP26-FIND-005 | (found in testing) continuous-scroll chapter headings formed an opaque sticky bar under the floating capsule | phone: headings are in-flow divider labels | ContinuousChapterScroll.tsx (`data-chapter-heading`), readerChrome.css | iPhone | — | Sim | COMPLETE |
| SEP26-SEARCH-001 | No forced capitalization in search fields | removed `autoCapitalize="words"` (floating search, caret go-to, passage pickers, book filter) and `"none"` (Search, Find, tag pickers, shared SearchField): the user's iOS keyboard setting decides | NewTabSheet, CaretGoTo, PassagePicker, ReferencePicker, BooksFilterView, SearchPage, FindOnPage, TagPickerSheet, TrailTagsSheet, components/ui/TextField.tsx | iPhone (+ shared field) | inputCapitalization (2) | Dev: both iOS settings | COMPLETE |
| SEP26-SEARCH-002 | Typed query preserved; Strong's / Greek / Hebrew / references intact | no query transforms; Strong's ids are upper-cased only as a lookup key | destinationQuery.tsx | both | existing parser tests | — | COMPLETE |
| SEP26-SEARCH-003 | URL fields stay uncapitalized | `type="url"` fields keep `autoCapitalize="off"` (iOS convention); guarded by test | NoteInsertButton, PhoneSelectionToolbar, YouTubeSettingsPage | iPhone | inputCapitalization | — | COMPLETE |
| SEP26-TABS-001 | Duplicating a tab duplicates its history | shared store `duplicateTab`: deep copy of the stack with new entry ids, same current index | store/index.ts | both | duplicateTab (4) | Sim | COMPLETE |
| SEP26-TABS-002 | Histories independent after duplication | no shared objects (JSON deep copy of state, entries, tab) | store/index.ts | both | duplicateTab: navigate / back / forward each way | Sim: B → Romans 4 → ‹ Matthew 11, A unchanged | COMPLETE |
| SEP26-TABS-003 | Copy all meaningful state, not transient state | tab state (deep), history, per-tab scroll; not verse selection / sheets; a duplicated Scripture tab starts with clean contextual filters (earlier rule). Mac tab menu + iPhone tab cards call the same action; copy placed right after the original | store, TabBar.tsx, TabCardsSheet.tsx | both | duplicateTab (Search type too) | — | COMPLETE |
| SEP26-NOTES-MAC-001 | Folder note count never overlapped on hover | shared ListRow: hover actions take real space (grow from 0 width) instead of overlaying the right edge with 32 px of reserved padding (3 actions ≈ 66 px covered the count); the title is the flexible, truncating element | components/ui/ListRow.tsx | macOS (shared row) | folderTreeGeometry (ListRow) | Mac pass | COMPLETE |
| SEP26-NOTES-MAC-002 | Notes clearly indented under folders | one tree geometry: every row's ICON at 40 + 18·depth (user folder, system/virtual folder, note each convert to their own padding) — notes were 12 px LEFT of their folder's icon before | components/notes/folderTreeGeometry.ts, NotesFolderView.tsx | macOS | folderTreeGeometry (3) | Mac pass | COMPLETE |
| SEP26-NOTES-MAC-003 | Nested folders: consistent increment | same model for subfolders, virtual Book / Chapter, Year / Month | same | macOS | folderTreeGeometry | Mac pass | COMPLETE |
| SEP26-VERSE-001 | Several-verse sheet in the same family as one verse | same header / row / colours / Strong's mode / expanded list; title = reference ("Matthew 23:3-4, 6") | study/MultiVerseSheet.tsx | iPhone | multiVerseSheet (3) | Sim screenshot | COMPLETE |
| SEP26-VERSE-002 | Copy refs available directly | row slot 2 (Notes slot — a note attaches to one verse); shared reference format | MultiVerseSheet.tsx, SelectionBar.tsx (`versesText`) | iPhone | multiVerseSheet | — | COMPLETE |
| SEP26-VERSE-003 | Read aloud the selection through the one audio pipeline | `startPlaybackFrom(first, …, endVerse=last)` for one chapter; from the first verse otherwise | SelectionBar.tsx | iPhone | — | Dev | COMPLETE |
| SEP26-VERSE-004 | Copy at the far left at the lowest position, one or many verses | single row reordered Copy · Notes · Refs · Strong's; multi Copy · Copy refs · Refs · Strong's | VerseActionSheet.tsx, MultiVerseSheet.tsx | iPhone | multiVerseSheet | Sim | COMPLETE |
| SEP26-VERSE-005 | No Clear; dismissing clears; tapping another verse updates the same sheet | Clear removed; the sheet's onClose clears the selection (unchanged); same sheet id keeps detent | MultiVerseSheet.tsx, reader/verseSheets.tsx | iPhone | multiVerseSheet (update in place) | Sim: 1 sheet after 3 taps | COMPLETE |

## Selection action model

One selection context (the tab's `selectedVersesByTab`) → the same action family:
`useVerseSelectionActions` (copy / copy refs / share / highlight / tag / read aloud) serves the
several-verse sheet and the selection bar; the one-verse sheet uses the verse's own context.
Shared UI pieces: `Action` (row button), the highlight row, `StrongsVerse`. Applicability:
Notes and Compare for one verse; Refs for one chapter; Read aloud as a range within a chapter.

## Search-input capitalization policy

The app never sets capitalization on a text field (no `autoCapitalize="words|characters|sentences"`,
no `"off"/"none"`), so iOS applies the user's own keyboard setting. The only exception is a URL
field (`type="url"`), which iOS itself never capitalizes. Guarded by
`src/mobile/__tests__/inputCapitalization.test.ts`.
