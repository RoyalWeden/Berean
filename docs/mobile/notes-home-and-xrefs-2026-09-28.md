# iPhone Cross References + Notes Home redesign — 2026-09-28

Branch `feature/ios-app`. This covers two connected changes: (1) one cross-reference presentation
used everywhere on the iPhone, and (2) a folder-first Notes Home modelled on Apple Notes.

The brief said screenshots were attached, but none reached this session. The design follows the
brief's written description plus Apple Notes on iOS 26.

## 1. Cross references

### Data (XREF-001) — `src/lib/crossRefs/xrefModel.ts`
Every iPhone surface renders one structured result, `XRefResult { sections[], mentions[], total }`.
Each `XRefItem` carries the following:
- the target: a single verse, a range, or `verse: 0` for a whole chapter;
- the full passage text;
- its source: `tske`, `classic`, `notes` or `taylor`;
- its heading and `fromVerses`;
- the note title and role, for My Notes;
- `isCurrent`.

**Verse context: `normalizeVerseXRefs`.**
- It de-duplicates across a selection. Each target is listed once, at its first occurrence, with every
  selected verse it belongs to (meta "v. 3, 4").
- With several verses selected, each verse gets its own "v. N" section.
- Ranges drop the source's first-verse-only text so the whole passage can be resolved.

**Chapter context (no selection): `chapterXRefsFromNotes` + `loadChapterXRefs`.**
- "From notes on this chapter": the references made by notes attached to the chapter.
- "Notes that cite this chapter": each citing note's verse.
- "Taylor's footnotes": only when reading Hermas (Taylor).

The bundled TSK/e and Classic databases have **no chapter-level rows** (they are keyed per source
verse; this was verified). "Chapter-level cross references" therefore come from My Notes and Taylor.
This is a data limitation, not a UI one. With a verse selected, TSK/e and Classic apply as before.

**Text: `resolveXRefTexts`.**
- It makes one `bible.queryVerses` call per text (KJVA, plus LXX for LXX-marked references).
- Results are cached for the session and read offline from the bundled databases.
- Ranges are capped at 40 verses.

### Presentation (XREF-002) — `src/mobile/study/XRefList.tsx`, `xrefs.css`
`XRefCard` shows **Romans 5:8 — full text** as one flowing paragraph. Long passages and ranges are
clamped and expand in place. There is no "Show full verse" link.

| Gesture | Result |
|---|---|
| Tap the reference | Opens it in **this** tab (`openDestination(…, 'current-tab')`) |
| Tap the text or the chevron | Expands or collapses the card |
| Long press | The existing action sheet: Open · Open in New Tab · Copy Reference · Copy Verse |

A reference to a selected verse stays in the list, marked with a subtle accent edge and the meta
"This verse". Variants: `compact` (caret) and `regular` (sheets). Nothing scrolls inside the list;
the sheet scrolls.

### Surfaces (XREF-003)
All of these go through `CrossRefList` → `useXRefs` → `XRefList`:
- the verse sheet;
- the selection sheet;
- the multi-verse sheet;
- the study view;
- the caret's My Notes;
- the new caret **Cross References** section.

The caret uses a new command kind, `{ kind: 'content', render }`. It sits in a collapsible section
that is collapsed by default, with the summary "Chapter", "v. 5" or "2 verses". It renders inline in
the caret's own scroll, and the source picker moved inside it.

**My Notes with no selection** now shows the chapter's notes and then the chapter's cross references.
There is still no top-of-reader indicator.

### Reference formatting (NOTES-REF-001) — `src/lib/noteTitle.ts`
Vault verse-note titles use a period, as in "Matthew 5.3": the file-name form, because a colon can't
be used in a file name. `displayNoteTitle` shows them as "Matthew 5:3". The stored title never
changes.

Only a title that *is* a reference (a known book plus chapter.verse) is rewritten. "Version 1.2
notes" and "Chapter 3.4" stay as typed.

It applies on every surface that shows a note title:
- Notes Home rows, cards and the long-press preview;
- tab cards and tab previews;
- the verse and multi-verse note sheets;
- My Notes;
- the trail;
- search results and result actions;
- the note finder;
- Trash;
- the editor title and print;
- cross-reference note meta.

Editor title fields use `storedNoteTitle`. When the reference itself is unchanged, the period form is
written back, so typing in the title never renames the vault file.

## 2. Notes Home

### Structure
The location is stored in tab state (`listFolderId`), so back and forward, tab cards and relaunch all
restore it:
- `null` → the Folders home;
- `'all'` → All Notes;
- `'sys:daily'`, `'sys:verse'`, `'sys:esword'`, `'sys:biblegateway'` → the desktop's system folders;
- a folder id → that user folder.

Files:
- `notesHomeModel.ts`: pure logic and tests.
- `NoteListItems.tsx`: the row, gallery card, folder row and SwipeRow.
- `NotePeek.tsx`: the long-press preview.
- `NotesHomePage.tsx`: the page.
- `notesHome.css`: styles.

### APPLE PRINCIPLE → BEREAN EQUIVALENT → IMPLEMENTATION

| Apple Notes principle | Berean equivalent | Implementation |
|---|---|---|
| Folders is the home; large title | "Folders" large title; the small bar title appears once it scrolls away | `.m-notes-large` + IntersectionObserver |
| New Folder + Edit in the nav bar | Folder-plus + Edit (Today / calendar kept on the left) | Header `right` / `left` |
| An undeletable "All iCloud" folder | **All Notes**: no rename, delete or actions, even in Edit | `FolderRow kind="all"` with no long press |
| Smart / system folders | Daily Notes · Verse Notes · e-Sword · BibleGateway (the desktop's virtual folders; shown only when non-empty) | `SYSTEM_FOLDERS`, `notesAt('sys:…')` |
| Nested folders with disclosure | Folder tree with recursive counts; expansion remembered on the device | `buildFolderTree`, `visibleFolderRows`, `notesHomePrefs.expandedFolders` |
| Recently Deleted in the list | Trash with its count | `FolderRow kind="trash"` → `TrashPage` |
| Folder view: back, title, counts | ‹ parent · large title · "N Notes · M Folders" | `parentLocation`, `.m-notes-large-sub` |
| Subfolders first | Collapsible "Folders" section | `SectionHeader id="folders"` |
| Pinned on top | Pinned section, not repeated below | `folderViewSections` |
| Today / Previous 7 Days / Previous 30 Days / months | The same, by local calendar day; the current year shows the month only, earlier years add the year; collapsible, expanded by default | `lib/noteRecency.ts`, `sectionCollapse` |
| Sort options | Last edited / Date created / Title; kept and persisted | `noteGrouping.noteHomeView` (localStorage) |
| List ⇄ Gallery | Gallery in the tab-preview card language (`.mobile-tab-preview is-note`); persisted | `NoteGalleryCard`, `notesHomePrefs.layout` |
| Row: title · date + preview · folder · thumbnail | The same. Date: a time today, a weekday this week, a short date otherwise. Folder shown where the location doesn't already say it | `NoteListRow`, `rowDateLabel`, `firstImageSrc` |
| Bottom search field | Floating "Search Notes" capsule above the bottom controls | `.m-notes-float` |
| Compose button | Square-with-pencil; files the note into the current folder | `.m-notes-compose`, `create()` |
| Search covers everything | One field: folders (by name/path) + notes (FTS), across **all** notes, not just the open folder | `matchFolders` + `notes.searchNotes` |
| Edit → select → toolbar | Edit → selection circles → Move · Pin · (count) · Share · Delete | `.m-notes-editbar` |
| Swipe actions | Right: Pin. Left: Delete (full swipe) · Move. Axis-locked; one open row | `SwipeRow` |
| Context menu with preview | Blurred backdrop, floating note preview; Open · Open in New Tab · Pin · Move · Duplicate · Share · Print · Delete | `NotePeek` |
| Folder actions | Rename · New Subfolder · Move (not into itself or a descendant) · Delete (confirm when not empty; notes go to Trash) | `folderActionList`, `FolderPicker exclude` |
| Controls avoid the keyboard and home indicator | Above `--m-nav-h`; drops to the safe area when the bottom controls hide on scroll; above the keyboard | `notesHome.css` |
| Dynamic Type / Reduce Motion / Reduce Transparency | `--m-type-scale` on all text; transitions off; opaque fills | `notesHome.css` |

### Decisions
- **Search scope is global.** Inside a folder it still searches every note and folder, as Apple
  Notes does, and each row names its folder.
- **Folder rows don't swipe.** They use long press (and Edit's "…"), because nested-folder
  indentation and the disclosure control conflict with a horizontal swipe.
- **The filter chips are gone.** They became "Show" in the caret and the "…" menu. The folder chips
  became the Folders home.
- **Folder deletion.** An empty folder is deleted directly. A non-empty one asks for confirmation;
  its notes go to Trash.
- **VoiceOver.** The web has no rotor custom actions. Every swipe action is also in the long-press
  preview (double-tap and hold) and in Edit's bar.

## 3. Architectural audit

**Is there one cross-reference component?**
Yes: `XRefCard` / `XRefList`, with variants. There are no per-surface copies.
`shortRefLabel` and `CrossRefSourcePicker` remain as shared helpers.

**Where does the data shaping happen?**
Only in `xrefModel.ts`, which is pure and tested. Components never reshape source data.

**Navigation**
- Every open goes through `openDestination`, with the intent `current-tab` or `new-tab`.
- The verse sheet's `onNavigateRef` threads the intent.
- The callback arity was updated at every caller, so "new tab" is never dropped.

**Persistence**
Everything is device-local:
- layout and expanded folders: `berean.notesHome.v1`;
- sort and grouping: `berean.notesHome.view.v1`;
- location and filter: tab state.
Collapsed date sections last for the session only (Apple Notes behaves the same way).

**Sync**
Nothing new is synced. Folder, pin and move changes go through the existing `window.notes` API,
and iCloud sync already carries those.

**Desktop impact**
- `noteGrouping` sorts by title with the display form.
- `xrefModel` note titles are display-formatted.
- The desktop doesn't import any of the new iPhone components.

**Performance**
- Notes Home loads notes, folders and trash once per change token.
- The tree, sections and counts are memoised.
- Cross-reference texts are batched and cached.
- Thumbnails use `loading="lazy"`.
- No nested scrollers.

**Known limits**
- Vault-relative images can't be thumbnailed from the list; only `data:` and `http(s)` images can.
- 95+ TSK/e cards for a two-verse selection is a long, but single, scroll.

## 4. Needs a physical iPhone
- Swipe feel: axis lock against vertical scroll, full-swipe Delete, rubber-banding.
- The long-press preview timing and haptics; that the blur doesn't stutter.
- The floating search bar moving with the bottom controls on momentum scroll, and above the keyboard.
- Large Dynamic Type sizes on rows, cards and the caret cross references.
- A VoiceOver pass over folder rows, section headers and Edit.
- Reduce Transparency and Reduce Motion.
- Gallery thumbnails from pasted images.
- The caret Cross References section with a long list: scrolling inside the sheet, and tap-vs-scroll.

## 5. Verification
- typecheck: PASS.
- vitest: 252 files, 4648 tests, all PASS. 41 of those tests are new in this change:
  `noteTitle`, `notesHomeModel`, `NotesHomePage`, `xrefModel`, `XRefCard` and
  `caretContentSection`.
- desktop build: PASS.
- iOS build: PASS, and the production bundle has no probe.

Simulator probes checked:
- the Folders home;
- the All Notes sections;
- a folder with a subfolder, in gallery layout;
- the floating bar above the bottom controls (bar bottom 770 vs nav top 776);
- the caret Cross References: collapsed by default; with two verses selected, 95 cards, 0 duplicates,
  current verse marked, full range text, picker inside;
- My Notes chapter mode showing Notes, then Cross References.
