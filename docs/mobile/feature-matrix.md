# Berean iPhone — Feature Matrix

The complete user-facing feature set discovered in the repository (`audit/feature-inventory.md`,
`audit/notes-store-media-tests.md`, `audit/data-and-platform.md`), with the iPhone plan for each.
Nothing is dropped silently: features that cannot reach parity carry an explicit *Limitation* and
a reference to `implementation-progress.md` §Known limitations.

Columns — **Desktop**: where it lives today · **iPhone req.**: REQUIRED (core), REQUIRED-ADAPTED
(same capability, iOS presentation), NETWORK (needs internet by nature), DESKTOP-ONLY (documented
reason) · **Shared**: what is reused unchanged · **iPhone impl.**: what is new · **Offline** ·
**iCloud** · **Status** (NOT STARTED / IMPLEMENTING / TESTING / COMPLETE / BLOCKED).

---

## 1. Shell, navigation, tabs, sessions

| Feature | Desktop | iPhone req. | Shared | iPhone impl. | Offline | iCloud | Status | Limitation |
|---|---|---|---|---|---|---|---|---|
| Spaces (Scripture / Notes / Lexicon / YouTube / Search) | `Sidebar.tsx` | REQUIRED-ADAPTED | `SpaceId`, store | `src/mobile/tabs/SpaceBar.tsx` (bottom bar: Scripture, Notes, Search, More → Lexicon/YouTube/Tags/History/PDFs/Settings) | ✔ | — | IMPLEMENTING (Phase 10: bar + More page done) | |
| Tabs per space (open, close, pin, reorder, move between spaces, duplicate, MRU, auto-close) | `TabBar.tsx`, store actions | REQUIRED-ADAPTED (Arc-like) | store, `tabsService` | `TabPill` (tap → grid, swipe → adjacent tab, +), `TabGrid` (cards, ×, long-press actions) | ✔ | ✔ sync fields (R055) | IMPLEMENTING (Phase 10: pill, grid, swipe, close, rename, close others; reorder/move/duplicate: Phase 15) | drag-reorder → long-press-drag in grid |
| Sessions (Arc-style tab groups: create, rename, icon, switch, reorder, archive, tab filter) | `Sidebar.tsx` | REQUIRED-ADAPTED | store, `sessionsService` | `SessionSwitcher` sheet from the tab grid | ✔ | ✔ | IMPLEMENTING (Phase 10: switch/create/rename/delete; icon/reorder/archive/filter: Phase 15) | |
| Archived tab groups | store `archivedGroups` | REQUIRED-ADAPTED | `archived_groups` table | Archive page | ✔ | ✔ | NOT STARTED | |
| Saved Workspaces (layout + tab snapshot) | `WorkspacesSection.tsx` | REQUIRED-ADAPTED | `workspacesService` | Workspaces page (apply tab set) | ✔ | ✔ | NOT STARTED | mosaic layout not applied on phone (documented) |
| Tab back/forward history (`tabNavStacks`, ⌘[ ⌘]) | store | REQUIRED-ADAPTED | store | edge-swipe back pops in-tab history; toolbar back | ✔ | LOCAL | NOT STARTED | |
| Floating search ⌘K/⌘T (refs, Strong's, keywords, notes, YouTube, commands, recent) | `FloatingSearch.tsx` (1514) | REQUIRED-ADAPTED | result providers | `SearchPage` top bar + Spotlight (R093) | ✔ (YouTube part cached) | — | NOT STARTED | |
| History modal (navigation history, grouped by day/session) | `HistoryModal.tsx` | REQUIRED-ADAPTED | `historyService` | History page | ✔ | LOCAL | NOT STARTED | |
| Onboarding wizard | `Onboarding.tsx` | REQUIRED-ADAPTED | store flags | Mobile onboarding pages | ✔ | — | NOT STARTED | |
| Hints / first-use tips | `localStorage` keys | REQUIRED-ADAPTED | — | same keys | ✔ | — | NOT STARTED | |
| Tasks panel (first-steps checklist) | `TasksPanel.tsx` | REQUIRED-ADAPTED | store | Tasks page | ✔ | LOCAL | NOT STARTED | |
| Ribbon / header / floating rail / hover panels | `Ribbon.tsx`, `ShellHeader.tsx`, `FloatingRail.tsx`, `FloatingHoverPanel.tsx` | DESKTOP-ONLY (chrome) | — | replaced by mobile navigation | — | — | N/A | hover-only chrome; the *functions* they expose are all reachable in the mobile shell |
| Multi-window: synced window, independent window, floating tab, presenter/viewer, study-trail window, verse-picker window, cross-window sync | `electron/main.ts`, `crossWindowSync.ts` | DESKTOP-ONLY | — | capability `multiWindow=false` hides "Open in floating tab"/"New window" items | — | — | N/A | iOS has one scene; iPad multi-scene is a future item (R014) |
| Native menu bar / app commands | `buildAppMenu` | DESKTOP-ONLY | `commands.ts` ids reused by the mobile command list | — | — | — | N/A | |
| Custom window chrome / traffic lights | `windowControls` | DESKTOP-ONLY | — | — | — | — | N/A | |
| Keyboard shortcuts (⌘ chords, Ctrl+Tab switcher, roving arrows, type-to-go-to-verse) | `commands.ts`, `App.tsx` | REQUIRED-ADAPTED | `commands.ts` | every command reachable by touch; hardware keyboard shortcuts kept for iPad later | ✔ | — | NOT STARTED | |
| Auto-update | `electron-updater` | DESKTOP-ONLY | — | App Store | — | — | N/A | |
| Crash report on next launch | `CrashReport.tsx` | REQUIRED | same | same | ✔ | — | NOT STARTED | |

## 2. Bible reader

| Feature | Desktop | iPhone req. | Shared | iPhone impl. | Offline | iCloud | Status | Limitation |
|---|---|---|---|---|---|---|---|---|
| All 18 translations / editions + `kjv` | `bibleTexts.ts`, `bible:*` | REQUIRED | `bibleService`, `TRANSLATIONS/EDITIONS` | bundled DBs | ✔ | never | IMPLEMENTING (Phase 10: translation sheet on the reader; edition grouping: Phase 11) | |
| Reference bar parsing (all forms in `parseRef.ts`, RCL/Hermas forms) | `parseRef.ts`, `multiBookSearch.ts` | REQUIRED | same | `ReferencePicker` sheet with typed entry | ✔ | — | IMPLEMENTING (Phase 10: typed reference in the Go-to sheet uses parseRef) | |
| Book/chapter picker (searchable, by testament) | `BookChapterPicker.tsx` | REQUIRED-ADAPTED | book lists | `src/mobile/reader/ReferencePicker.tsx` in a sheet | ✔ | — | IMPLEMENTING (Phase 10: book grid by testament → chapter grid → verse grid) | |
| Prev/next chapter | `BiblePanel.tsx` | REQUIRED | `bibleNav.ts` | `ReaderPage` pager (framer-motion drag, direction lock, 28 % / velocity threshold) | ✔ | — | IMPLEMENTING (Phase 10: horizontal pager with prev/next pages, book boundaries; buttons + continuous mode: Phase 11) | |
| Pull-past-end rubber-band nav | `useChapterPullNav.ts` | REQUIRED-ADAPTED | physics module | kept as vertical over-scroll option alongside swipe | ✔ | — | NOT STARTED | |
| Continuous chapter scroll | `ContinuousChapterScroll.tsx` | REQUIRED | same component | reader mode toggle | ✔ | — | IMPLEMENTING (Phase 11: toggle in the reader options sheet renders the shared component) | |
| Go-to-verse by typing digits | `App.tsx` | REQUIRED-ADAPTED | — | verse number field in reference sheet | ✔ | — | NOT STARTED | |
| 16 scripture layouts (mosaic) | `LayoutPicker.tsx` | REQUIRED-ADAPTED | `scriptureLayout` synced as data | phone shows reader + sheets; iPad later maps layouts to split panes | ✔ | ✔ (tab field) | NOT STARTED | freeform resizable panes have no phone analogue — documented |
| Right panel: Notes / Lexicon / Cross refs (slots A/B, verse filter, expand all, embedded note editor) | `BibleRightPanel.tsx` (2152) | REQUIRED-ADAPTED | panel content components | `StudySheet` (notes/lexicon/crossrefs segments) as a resizable bottom sheet | ✔ | ✔ selection fields | NOT STARTED | slot B (two simultaneous panels) → iPad |
| Compare view (2–4 columns, sync scroll, presenter feed) | `CompareView.tsx` | REQUIRED-ADAPTED | column model | `ComparePage` stacked columns with sync scroll | ✔ | ✔ columns | NOT STARTED | presenter feed desktop-only |
| Verse selection (tap verse numbers, shift-extend) | store `selectedVersesByTab` | REQUIRED | store | tap number toggles; drag on numbers extends | ✔ | LOCAL | IMPLEMENTING (Phase 12: tap toggles; drag-extend Phase 15 polish) | |
| Selection bar actions: Copy verses, Copy refs, Add note, Show notes, Cross refs, Play audio from here, Tag, Highlight, Clear | `VerseSelectionBar.tsx` | REQUIRED | handlers | `src/mobile/study/SelectionBar.tsx` | ✔ | — | IMPLEMENTING (Phase 12: `SelectionBar` above the pill — all actions) | |
| Verse popover (right-click): Copy verse · Copy ref · Add note · Show notes · Cross refs · Play audio · Tag · highlight swatches | `VerseRow.tsx:1539` | REQUIRED | handlers | `verseInteraction.ts` context + `VerseActionSheet` | ✔ | — | IMPLEMENTING (Phase 12: long-press → `VerseActionSheet` with the same actions + swatches) | |
| Text-selection toolbar: highlight swatches · Copy verse · Copy ref · Copy selection · Add note · Open in Advanced Search | `VerseRow.tsx:1838` | REQUIRED | handlers | native selection → floating toolbar (custom, above selection) | ✔ | — | IMPLEMENTING (Phase 12: long-press with a selection → sheet targets the selection: highlight range, copy selection) | |
| Note / cross-ref indicator menus | `VerseRow.tsx:1882` | REQUIRED-ADAPTED | — | tap dot → notes-for-verse sheet; long-press → open in new tab | ✔ | — | NOT STARTED | floating-tab items hidden |
| Idiom word tooltip + menu | `VerseRow.tsx:2017` | REQUIRED-ADAPTED | — | tap idiom word → preview popover; long-press → open note | ✔ | — | NOT STARTED | |
| `VerseCopyMenu` (lists outside reader) | `VerseCopyMenu.tsx` | REQUIRED | — | long-press on any verse row | ✔ | — | NOT STARTED | |
| Highlights (15 colours, word/char ranges, remove, row tint, dot) | `highlights:*`, `VerseRow` | REQUIRED | `highlightsService`, render | same render; sheet/toolbar entry | ✔ | ✔ | IMPLEMENTING (Phase 12: verse + range highlights from the sheet / selection bar) | |
| Verse tags (pick popover, chapter tags, inline pills, manager, graph, edges) | `verseTags:*`, `tagGraph:*`, `src/components/tags` | REQUIRED | services, `TagGraphCanvas` | `TagPickerSheet`, Tags page, graph with pinch/pan | ✔ | ✔ | IMPLEMENTING (Phase 12: `TagPickerSheet`; manager/graph via hosted tags tab) | |
| Strong's inline chips (italic/red-letter/particle styling, phrase grouping), per-tab toggle | `StrongsInline.tsx` | REQUIRED | same | toolbar toggle | ✔ | ✔ (`showStrongs` tab field) | IMPLEMENTING (Phase 10: header toggle writes the tab's `showStrongs`) | |
| Strong's tooltip (hover) | `StrongsTooltip.tsx` | REQUIRED-ADAPTED | gloss fetch | tap chip → collapsed Strong's sheet (gloss) | ✔ | — | IMPLEMENTING (Phase 10: tap chip → `StrongsSheet` collapsed = lemma/transliteration/gloss) | hover → tap |
| Strong's click → lexicon in panel; context menu: Open · Open in new tab · Open floating · Copy Strong's · Copy reference | `StrongsContextMenu.tsx` | REQUIRED-ADAPTED | `LexiconPanel` entry view | sheet drag-up → full entry; long-press chip → actions | ✔ | — | IMPLEMENTING (Phase 10: sheet drag-up → definition, derivation, related, occurrences → navigate; "Open in Lexicon"; long-press actions: Phase 12) | floating hidden |
| Chapter-wide Strong's echo highlight | store `chapterEchoStrongsNum` | REQUIRED | same | same while sheet open | ✔ | — | NOT STARTED | |
| Psalm superscriptions | `psalmSuperscription.ts` | REQUIRED | same | same | ✔ | — | NOT STARTED | |
| LXX supply brackets / annotations hide per text | `annotationFilters.ts` | REQUIRED | same | reader options sheet | ✔ | ✔ (`hiddenAnnotations`) | NOT STARTED | KJV italics still pending data re-seed (pre-existing) |
| Word replacer (divine name rules, text rules, search expansion) | `wordReplacer.ts` | REQUIRED | same | Settings page | ✔ | LOCAL (setting) | NOT STARTED | |
| Cross references: classic, TSKe (headings, reciprocal, chapter view), My Notes | `crossrefs:*`, `BibleRightPanel` views | REQUIRED | `crossrefsService`, views | `CrossRefsSheet` | ✔ | — | NOT STARTED | |
| Hermas traditional numbering + two translations | `hermasMap.ts` | REQUIRED | same | same | ✔ | — | NOT STARTED | |
| Zoom (`appZoom`) / Bible font size / line height / fonts / verse numbers / red letters | store | REQUIRED | store | pinch (R078) + Settings; Dynamic Type | ✔ | LOCAL | NOT STARTED | |
| Reading position per tab | `scrollPosition` | REQUIRED | store | same | ✔ | LOCAL | NOT STARTED | |
| Panel swipe gesture (two-finger trackpad) | `useSwipePanelGesture` | REQUIRED-ADAPTED | — | horizontal edge swipe opens `StudySheet`/slide-over | ✔ | — | NOT STARTED | |

## 3. Search

| Feature | Desktop | iPhone req. | Shared | iPhone impl. | Offline | iCloud | Status | Limitation |
|---|---|---|---|---|---|---|---|---|
| Advanced Scripture Search: all/any/phrase, testament, book multi-select + 10 presets, tag filter AND/OR, sort, edition selector, `lxx:` prefixes, virtualized anchored results | `ScriptureSearchView.tsx` | REQUIRED | search state + row renderer | `SearchPage` + `FilterSheet` | ✔ | ✔ (tab search fields) | NOT STARTED | |
| Strong's number & multi-Strong's queries | `strongsSearch.ts` | REQUIRED | same | same | ✔ | — | NOT STARTED | |
| Space Search tab (simpler, number-word expansion) | `SearchTab.tsx` | REQUIRED | same | merged into `SearchPage` modes | ✔ | — | NOT STARTED | |
| Lexicon search (H/G/all) | `LexiconPanel` SearchView | REQUIRED | same | Lexicon page | ✔ | — | NOT STARTED | |
| Notes search (all/any/phrase, FTS5) | `notes:search` | REQUIRED | `notesService` | Notes page search | ✔ | — | NOT STARTED | |
| YouTube video + transcript search | `youtube:searchVideos/searchTranscripts` | REQUIRED (cached DB) | service | same | ✔ (cached index) | LOCAL | NOT STARTED | |
| Recent queries | store | REQUIRED | store | same | ✔ | LOCAL | NOT STARTED | |
| Open all results in Compare (small sets) | search | REQUIRED-ADAPTED | — | Compare page | ✔ | — | NOT STARTED | |

## 4. Notes

| Feature | Desktop | iPhone req. | Shared | iPhone impl. | Offline | iCloud | Status | Limitation |
|---|---|---|---|---|---|---|---|---|
| ProseMirror editor: schema, marks, plugins, input rules, keymap, slash commands, tables, images (paste/drop/picker/resize), wikilinks, verse blocks, Strong's blocks, heading/thread collapse, focus mode, toolbar, markdown toggle | `src/components/notes/pm/**` | REQUIRED (full editor) | entire editor | `src/mobile/notes/NoteEditorPage.tsx` (edit/view, autosave, idle snapshot, flush on leave) | ✔ | ✔ content | IMPLEMENTING (Phase 13: the shared editor full-screen in `NoteEditorPage`; images from Photos/Files + keyboard toolbar placement: device verification pending) | Focus mode window controls hidden |
| Note types: verse, general, daily (sunrise), idiom | `NotesPanel.tsx`, `dailyNoteUtils.ts` | REQUIRED | same | `@capacitor/geolocation` for sunrise | ✔ | ✔ | IMPLEMENTING (Phase 13: verse notes from the verse sheet, general from +, daily from the calendar button; idiom via the hosted panel) | |
| Notes home: list / folder / board views, filters, statuses, sort, expand-all, preview | `NotesHomePanel`, `NotesFolderView`, `NotesBoardView` | REQUIRED-ADAPTED | data + row components | `src/mobile/notes/NotesHomePage.tsx` | ✔ | ✔ (folders, statuses) | IMPLEMENTING (Phase 13: `NotesHomePage` list with search, type filters, folder chips, pinned; board/calendar views hosted under "All views") | folder drag-and-drop → move sheet |
| Folders (nested, rename, delete deep) | `folders:*` | REQUIRED | service | same | ✔ | ✔ | IMPLEMENTING (Phase 13: folder chips + move-to-folder; create/rename/delete via hosted panel) | |
| Pins, statuses, icons, colours, tags | `notes:*` | REQUIRED | service | same | ✔ | ✔ | IMPLEMENTING (Phase 13: pin + status from the note actions sheet; icon/colour/tags pending) | |
| Trash (restore, purge, empty; vault trash mirror) | `notes:*` + vault | REQUIRED | service | `src/mobile/notes/TrashPage.tsx` | ✔ | ✔ | IMPLEMENTED (Phase 13: `TrashPage`) | |
| Version history (diff + preview, restore) | `NoteVersionHistory.tsx` | REQUIRED | service + component | full-screen page; conflict versions surfaced (R058) | ✔ | ✔ | IMPLEMENTING (Phase 13: versions list + restore, conflict copies labelled; diff view pending) | |
| Scripture refs in notes: detect, render, click-to-open, context menu | `noteRefs.ts`, ref menu | REQUIRED | same | tap opens, long-press action sheet | ✔ | — | IMPLEMENTING (Phase 13: tap → reader in a scripture tab; long-press menu pending) | |
| Lexicon refs in notes | `noteLexiconRefsEnabled` | REQUIRED | same | same → Strong's sheet | ✔ | — | IMPLEMENTED (Phase 13: tap → Strong's sheet) | |
| Verse block auto-fetch (`/verse`) | `slashCommands.ts` | REQUIRED | same | same | ✔ | — | NOT STARTED | |
| Calendar widget / continuous daily scroll | `CalendarWidget.tsx`, `ContinuousDailyScroll.tsx` | REQUIRED-ADAPTED | same | Daily page | ✔ | ✔ | NOT STARTED | |
| Idioms book + export | `listIdioms`, `idiomsExport.ts` | REQUIRED | same | export via Share Sheet | ✔ | ✔ | NOT STARTED | |
| Print / PDF export with preview, margins, paper size | `PrintPreviewModal.tsx`, `app:printNote/exportNotePDF/renderPreviewPDF` | REQUIRED-ADAPTED | `notePreviewRender.ts` HTML | `BereanSystem.printHTML` (UIPrintInteractionController / PDF via `UIMarkupTextPrintFormatter`) → Share Sheet | ✔ | — | NOT STARTED | Electron `printToPDF` pagination differences documented after testing |
| Markdown reference modal | `MarkdownReferenceModal.tsx` | REQUIRED | same | page | ✔ | — | NOT STARTED | |
| Note open behaviours (tab / right panel / bottom panel) | store `noteOpenBehavior` | REQUIRED-ADAPTED | — | page or sheet | ✔ | — | NOT STARTED | |
| YouTube timestamp insert (⌘⇧L) | `berean:insertTimestamp` | REQUIRED | same | button in YouTube overlay toolbar | NETWORK | — | NOT STARTED | |
| Octarine/Obsidian vault sync, export, import, auto-export, watcher | `electron/ipc/vault.ts` | DESKTOP-ONLY (v1, per brief) | — | capability `vault=false`; future Files integration possible via `platform.files` | — | — | N/A | brief explicitly defers |
| BibleGateway import | `bgImport` | DESKTOP-ONLY | — | — | — | — | N/A | requires a Chromium window scraping a login session; deferred in CLAUDE.md §20 already |
| e-Sword import | `eSwordImport` | DESKTOP-ONLY | — | — | — | — | N/A | reads a desktop e-Sword installation; a Files-based `.bblx/.notx` import is a possible future item |

## 5. Lexicon

| Feature | Desktop | iPhone req. | Shared | iPhone impl. | Offline | iCloud | Status | Limitation |
|---|---|---|---|---|---|---|---|---|
| Entry view (lemma, translit, gloss, full def, derivation, extended def, occurrences with matched-word highlight, related words, BDB abbreviations, info popover) | `LexiconPanel.tsx` EntryView | REQUIRED | same | inside `StrongsSheet` (full-screen detent) and Lexicon page | ✔ | — | NOT STARTED | |
| Occurrence navigation → reader | same | REQUIRED | same | opens reader page | ✔ | — | NOT STARTED | |
| Lexicon in-tab history | `lexHistory` | REQUIRED | same | same | ✔ | ✔ | NOT STARTED | |

## 6. Study Trail, tags graph, history

| Feature | Desktop | iPhone req. | Shared | iPhone impl. | Offline | iCloud | Status | Limitation |
|---|---|---|---|---|---|---|---|---|
| Study Trail recording (navigation → nodes/connections, arrival prompts, reason prompts) | `studyTrailSlice.ts`, `StudyTrailArrivalPrompt`, `ReasonPromptPopover` | REQUIRED | slice + service | prompts as sheets | ✔ | ✔ | NOT STARTED | |
| Study Trail views: map (pan/zoom, marquee), threads, everything, search, sticky notes, session tags, merge/split/reorder, recap | `StudyTrailApp.tsx` (own window) | REQUIRED-ADAPTED | views | Trail page (full-screen), pinch/pan on map; marquee → long-press multi-select | ✔ | ✔ | NOT STARTED | separate window → page |
| Tags graph (force layout, edges, inspector) | `TagsGraphPanel.tsx` | REQUIRED-ADAPTED | canvas | page with pinch/pan | ✔ | ✔ | NOT STARTED | |
| App history | `HistoryModal.tsx` | REQUIRED-ADAPTED | service | page | ✔ | LOCAL | NOT STARTED | |

## 7. Media

| Feature | Desktop | iPhone req. | Shared | iPhone impl. | Offline | iCloud | Status | Limitation |
|---|---|---|---|---|---|---|---|---|
| Read Aloud (Kokoro neural TTS, voices, speed, word highlight, auto-advance, queue, playlists, progress bar, cross-window sync) | `src/lib/tts/**`, `AudioPlayer.tsx` | REQUIRED as far as technically possible | `textPrep.ts`, `extractSpokenText.ts`, chunking, alignment, queue model, `playlistsService` | Phase 16 spike: (a) Kokoro WASM in WKWebView worker; (b) native ONNX Runtime plugin if (a) fails memory/perf; `BereanAudio` for AVAudioSession + lock-screen controls + interruptions | ✔ after voice pack download (NETWORK once) | playlists ✔ | NOT STARTED | outcome documented after spike; system `AVSpeechSynthesizer` **not** used (desktop removed system voices by explicit direction) |
| YouTube: browse feed (allow-listed channels), search, video page, login, subscriptions, playlists, comments, history, resume position, starred, embed fallback | `YouTubeTab.tsx` (`<webview persist:youtube>`), `youtube:*` | REQUIRED (NETWORK) | feed/star/history DB service, `youtubeSearch.ts`, layouts | `BereanWebView` inline native WKWebView overlay with persistent data store (login survives), toolbar (back, PiP, timestamp) | feed cache ✔; playback ✗ | stars/positions ✔ | NOT STARTED | see §Limitations: PiP cannot be auto-triggered on tab switch without a user gesture in WKWebView; a PiP button is provided; comments/subscriptions are whatever m.youtube.com offers when signed in |
| YouTube secondary panels (notes/scripture/lexicon beside video, 11 layouts) | `YouTubeSecondaryPanel.tsx` | REQUIRED-ADAPTED | panels | video docked top (16:9) + study sheet below; layouts → iPad | NETWORK | ✔ (tab fields) | NOT STARTED | |
| Auto Picture-in-Picture on space switch | `autoPiP` | REQUIRED-ADAPTED | — | audio continues in background; PiP via button (user gesture) | NETWORK | — | NOT STARTED | WebKit restriction documented |
| Transcripts (dev-fetch, FTS search, dev-only guard) | `youtube:fetchTranscripts` (`is.dev`) | REQUIRED (read) | service | read-only; guard preserved | ✔ | LOCAL | NOT STARTED | |
| YouTube sign-out | `app:youTubeSignOut` | REQUIRED | — | `BereanWebView.clearData` | — | — | NOT STARTED | |
| PDF library: import, viewer (pdfjs), find, highlights, bookmarks, side panel, outline | `PDFViewer.tsx`, `pdf:*` | REQUIRED | viewer, `pdfService` | document picker import; files in container | ✔ | metadata ✔ | NOT STARTED | PDF bytes not synced (documented) |
| AI Lookup / Berean Chat (Ollama, retrieval over notes/scripture/transcripts, critique, chats) | `aiLookup.ts` (3638), `AiLookupPanel.tsx` | NETWORK (LAN Ollama host) | retrieval code (pure parts), chats service | Settings → "Ollama host" URL; feature shown only when configured | ✗ | chats ✔ | NOT STARTED | no on-device Ollama; documented |

## 8. Settings & appearance

| Feature | Desktop | iPhone req. | Shared | iPhone impl. | Offline | iCloud | Status | Limitation |
|---|---|---|---|---|---|---|---|---|
| Appearance: colour mode (light/dark/system), 37 theme presets, glass appearance, ambient background animation, section fonts | `ThemePicker.tsx`, `themePresets.ts`, `applyTheme.ts` | REQUIRED | same | System follows iOS via `prefers-color-scheme` + `BereanSystem.traits`; animation honours reduce-motion | ✔ | LOCAL | NOT STARTED | glass/vibrancy is CSS, works |
| Reading settings (all rows in audit §5) | `SettingsModal.tsx` | REQUIRED | store | Settings pages | ✔ | LOCAL | NOT STARTED | |
| Notes settings (all rows) | same | REQUIRED | store | pages | ✔ | LOCAL | NOT STARTED | |
| Sync (vault) section | same | DESKTOP-ONLY → replaced by **iCloud** section on iPhone; desktop gains the iCloud section too | — | iCloud status page | — | — | NOT STARTED | |
| YouTube settings (layout, auto-PiP, history, sign-out) | same | REQUIRED-ADAPTED | store | page | — | — | NOT STARTED | |
| Audio settings (voice pack download, voice, speed, autoplay, highlight, auto-advance) | same | REQUIRED | store | page | — | LOCAL | NOT STARTED | |
| Shortcuts (read-only) | same | REQUIRED-ADAPTED | `commands.ts` | "Gestures & shortcuts" page | ✔ | — | NOT STARTED | |
| Data: import, history limits, workspaces, danger zone | same | REQUIRED-ADAPTED (import desktop-only) | store/services | page | ✔ | — | NOT STARTED | |
| About & Updates | same | REQUIRED-ADAPTED | — | About page (version, licences, App Store link) | ✔ | — | NOT STARTED | updater desktop-only |
| Viewer window settings | same | DESKTOP-ONLY | — | — | — | — | N/A | |
| Study Trail settings | same | REQUIRED | store | page | ✔ | LOCAL | NOT STARTED | |
| Experimental (pull nav, PDF flag) | same | REQUIRED | store | page | ✔ | LOCAL | NOT STARTED | |
| macOS accent colour / reduce transparency / increase contrast | IPC | REQUIRED-ADAPTED | `applyTheme.ts` inputs | iOS tint + `UIAccessibility` flags | ✔ | — | NOT STARTED | |

## 9. Copy, share, open

| Feature | Desktop | iPhone req. | Shared | iPhone impl. | Offline | iCloud | Status | Limitation |
|---|---|---|---|---|---|---|---|---|
| Copy formats: verse text, reference, ranges, LXX suffix, multi-book labels, multi-verse block, raw selection, Strong's, Strong's reference | `verseClipboard.ts`, menus | REQUIRED | formatters | `@capacitor/clipboard`; every format listed in the copy sheet | ✔ | — | NOT STARTED | |
| Share (new on iPhone; desktop has copy/export only): verse text, note markdown, note PDF, idioms export, PDF file | — | REQUIRED | formatters | `@capacitor/share` | ✔ | — | NOT STARTED | desktop gains nothing new (no native share API), documented |
| Open external URLs | `shell.openExternal` | REQUIRED | — | `@capacitor/browser` (SFSafariViewController) | NETWORK | — | NOT STARTED | |
| Open in Berean: `berean://` scheme, shared text with refs, Share Extension (text/URL/.md/.pdf), universal links (optional) | — | REQUIRED | `parseRef.ts` | Share Extension + `@capacitor/app` URL handling → router | ✔ | — | NOT STARTED | universal links need a domain (developer) |
| Spotlight (notes, sessions, workspaces, books, chapters) | — | REQUIRED | index builders | `BereanSpotlight` | ✔ | — | NOT STARTED | verses not indexed (by design) |
| App Intents / Siri Shortcuts (Open Scripture, Search, Open Workspace, Open Book, Daily Note, Read Aloud) | — | REQUIRED | routes | `BereanIntents` | ✔ | — | NOT STARTED | |
| Haptics | — | REQUIRED | — | `@capacitor/haptics` in primitives | ✔ | — | NOT STARTED | |

## 10. Known cross-cutting limitations (each also in `implementation-progress.md`)

1. **Multi-window** (floating tabs, presenter, second windows) — no phone equivalent; hidden by capability. iPad may reintroduce multi-scene.
2. **Hover** affordances become tap/long-press; the information is the same.
3. **Freeform mosaic layouts** are stored/synced but rendered as sheets on the phone.
4. **YouTube auto-PiP on tab switch** — WebKit requires a user gesture to enter PiP; a PiP button and background audio are provided; exact behaviour verified on device in Phase 17.
5. **Read Aloud** engine choice depends on the Phase 16 device spike.
6. **AI Lookup** needs an Ollama host reachable over the network.
7. **Vault sync, BibleGateway import, e-Sword import** stay desktop-only (brief + technical reasons above).
8. **PDF bytes** are not synced through iCloud (size); metadata/highlights/bookmarks are.
