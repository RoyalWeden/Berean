# 03 — Feature inventory (native Swift migration audit)

> **Baseline note.** Investigated at `807c2d9`. The final baseline is `d97fb05`. The only code changes between them are PRs #9, #10 and #11, listed in `01-REPOSITORY-STABILIZATION.md`: fixes for sync defects D1-D4, note table-cell formatting, and audio cache keys. Anything below describing those defects as present is corrected where noted.

Repo: `/Users/roywe/Berean-audit`, detached at `807c2d974b795f95f4c05b8ae4b6796c273b572c` (merge of PR #8, 2026-11-05, package version 0.8.1, 923 commits). Read-only audit; nothing was built, run or committed. Tests were NOT executed by the auditor; every test statement below means "test file exists and covers X" (read, not run) unless stated.

## 0. Method, markers, legends

Evidence markers: **VERIFIED** (read in code at this commit), **INFERRED** (follows from code read, not directly observed), **UNVERIFIED** (claimed by a doc or comment; not confirmed in code or behaviour), **BLOCKED** (cannot be established without a device, certificate, network or runtime this audit may not use).

Status values: **implemented**, **partial**, **deferred** (documented as future, not built), **abandoned** (built, then superseded or dead), **undocumented** (present and working but not in `CLAUDE.md` and with at most one hit in `docs/`; the grep is in section J). Doc-state is shown only in section K.

Field legend used in every block: `1` current behaviour · `2` files · `3` architecture · `4` dependencies · `5` data contracts · `6` Mac vs iPhone · `7` defects/limits · `8` tests · `9` Swift strategy · `10` migration risks · `11` coexistence.

Swift strategy codes: **SW-DATA** port the service to a Swift package over the same SQLite schema (same SQL text, same migration ordinal, same sync journal format); **SW-UI** native SwiftUI/AppKit/UIKit view; **SW-TEXT** TextKit 2 attributed text; **SW-EDIT** native editor on a markdown model (no ProseMirror equivalent exists on Apple platforms); **SW-HOST** keep the React component in a `WKWebView` during transition. Coexistence codes: **C-DATA** can share `berean.db` + iCloud journal with the current apps; **C-HOST** can be hosted beside native screens in a WKWebView; **C-NO** cannot sensibly run side by side (explained).

Difficulty scale (K): 1 trivial … 5 hardest to replace.

## 1. Cross-cutting architecture facts (referenced by feature blocks as X1…X8)

**X1 Shells (VERIFIED).** Mac: Electron ^32.3.3 main process `electron/main.ts` (2201 lines), preload `electron/preload.ts` exposing 318 `ipcRenderer.invoke/send` channels (counted), renderer React 18 + Zustand + Tailwind (`src/App.tsx` 1105 lines, `src/store/index.ts` 3808 lines). Windows (`new BrowserWindow` in `electron/main.ts`): main, independent, floating tab, presenter/viewer, Study Trail, Berean Chat, verse picker. iPhone: Capacitor ^8.5.2 WKWebView loading the same React tree through `src/platform/ios/main.tsx` → `src/mobile/MobileApp.tsx` (555 lines) plus 14 local Swift plugins (`ios/App/BereanNative/Sources/BereanNative/*.swift`, about 2.6k lines), `ios/App/App/{AppDelegate,SceneDelegate,BereanBridgeViewController,BereanIntents}.swift`, `ios/App/ShareExtension`, `ios/App/BereanWidget`. Native Mac code is two Objective-C Node-API addons (`native/mac-icloud/berean_icloud.m`, `native/mac-liquid-glass/berean_glass.m`). There is no AppKit/SwiftUI Mac app and no SwiftUI iPhone UI today. `UIApplicationSupportsMultipleScenes` is false (single scene).

**X2 Shared service layer (VERIFIED).** `src/platform/services/*` (`createServices(ctx)`, `ServiceContext` in `context.ts`) is pure TypeScript over a `DatabaseAdapter` (`src/platform/db/DatabaseAdapter.ts`). Mac supplies better-sqlite3 adapters (`electron/db/adapters/*`, host `electron/servicesHost.ts`, registry `electron/services.ts`); iPhone supplies `capacitorSqliteAdapter.ts` over the `BereanSQLite` plugin (`ios/.../BereanSQLitePlugin.swift`, `SQLiteConnection.swift`, system SQLite with FTS5). Business rules live in this layer and in `src/lib/*`, which is the single most valuable asset for a Swift port, and also the main thing that must be re-implemented. `src/platform/__tests__/importBoundaries.test.ts` guards that services stay free of Node/Electron/Capacitor imports.

**X3 Renderer state (VERIFIED).** One Zustand store (`src/store/index.ts`, persist key version `AI_MODE_STORE_VERSION` at line 3436) holds tabs, sessions, layouts, selection, playback, display prefs and cached data epochs. Tabs/sessions/archived groups are mirrored into SQLite (`src/store/tabPersistence.ts`, `tabPersistenceRuntime.ts`) with fractional order keys. Cross-window sync of the shared slice is `src/lib/crossWindowSync.ts` over a relay in the main process. Per-window slice (active tab, space, layout, scroll) is deliberately not synced.

**X4 User database (VERIFIED).** `berean.db` with 49 ordered migrations (`src/platform/db/bereanMigrations.ts`, highest `version: 49`). Tables found by grep: notes, note_versions, note_folders, notes_fts (FTS5), highlights, settings, workspaces, history, pdfs, pdf_highlights, pdf_bookmarks, youtube_videos, youtube_transcripts(+segments+FTS5), youtube_watch_history, youtube_user, playlists/playlist_items, ai_chats, study_profiles, ai_saved_contexts, trail_* (sessions, nodes, connections, notes, tags, embeddings, collapse), verse_tags/verse_tag_members/verse_tag_verse, tag_edges, sessions/tabs/archived_groups/session_local_state, sync_* (state, outbox, record_meta, applied, failed, conflicts), note_heading_collapse, note_thread_collapse.

**X5 Bundled read-only data (VERIFIED from code, UNVERIFIED from the files).** `data/*.db` are symlinks into the main checkout (not read by this audit). Per-text schema as used by SQL in `bibleService.ts`: `verses(id, book_id, chapter, verse_num, text, text_tagged?, title?)`, `books(id, name, short_name, testament, chapters_count, sort_order?)`, FTS5 `verses_fts` joined on `rowid = verses.id`. This differs from `CLAUDE.md` §7 (`book_num`, `book_abbr`). Lexicon: `entries(strongs_id, word, transliteration, short_def, full_def, bdb_def, derivation…)`. Strong's occurrences are computed with `LIKE` over `text_tagged`, not from a table. iPhone bundles the list in `scripts/ios/bundled-dbs.txt` (24 files). The Mac package includes `data/*.db` except `youtube_index.db` (`package.json` extraResources); the embedding index is excluded from both.

**X6 Sync (VERIFIED).** iCloud Drive per-device op-journal: HLC clocks, per-field merge, fractional keys, snapshots, conflicts (`src/platform/sync/{engine,merge,journal,hlc,entities,hostCore,fractional,tabFields}.ts`, 1404-line `engine.ts`). Transports: Mac `electron/sync/fsSyncStore.ts` (+ `macContainer.ts`, `berean_icloud.m` for the MAS sandbox), iPhone `BereanCloudPlugin.swift` (NSFileCoordinator, NSMetadataQuery). Synced entities are the registry in `entities.ts` (about 27 kinds). Settings/Zustand preferences are not synced. The journal carries the DB `schema` ordinal, so mixed-version devices ignore unknown columns.

**X7 Test posture (VERIFIED by count, not run).** 387 `*.test.ts(x)` files (src, electron, tests, scripts). Swift: one test file (`ios/App/BereanNative/Tests/BereanNativeTests/SQLiteConnectionTests.swift`, 5 test functions). No XCUITest, no Electron E2E suite; UI is driven manually or through `scripts/perf/*` (CDP) and `scripts/ios/probe-server.mjs`. `docs/ai-upgrade/PLAN.md` records a 2026-10-28 baseline of 338 files / 5408 passing tests (UNVERIFIED here). `tests/integration/vault-sync.test.ts` is a tautology: it writes a file with `writeFileSync` and reads it back, importing no Berean code (VERIFIED); real vault tests are `electron/ipc/__tests__/vault.*.test.ts` (three files covering image extraction/inlining and `importVaultFile`).

**X8 Docs reliability (VERIFIED).** `CLAUDE.md` (written for the 2025–early-2026 Electron app) is materially out of date: 6 layouts vs 16 in code, DB schema names, "Hebrew/Greek interlinear deferred" (still true), BibleGateway sync "deferred" (a scraping importer exists), YouTube channel allowlist editable (hard-coded array), hints system (absent), cross-text highlight sync (absent). `docs/mobile/feature-matrix.md` lists many iPhone items as NOT STARTED that exist in code (calendar tab, tags graph tab, PDF viewer, tasks excluded). `docs/mobile/voices.md` says Kokoro-on-iOS is future work; code ships it. Treat both as intent, not state.

---

## A. Scripture

### S01 Text loading and bundled texts — implemented
1. Opens one read-only SQLite DB per text; `getBooks`, `queryChapter`, `queryVerse`, `queryVerses` (batch, capped 500), per-book chapter-count fallback for texts storing `chapters_count = 0` (LXX). Book names normalised (roman → arabic) in `getBooks`. 18 editions registered in `TRANSLATIONS` (`src/lib/bibleTexts.ts`): KJVA, Brenton LXX, 1 Enoch, Jubilees, Apoc. Elijah, Recognitions of Clement, Hermas (ANF and Taylor), Asc. Isaiah, Ep. Barnabas, T12P, Gad, T. Job, 1 Clement, Apoc. Abraham, Didache, T. Jacob, 2 Baruch. `kjv.db` is also bundled; `lxx.db` is an orphan shipped by glob on Mac only.
2. `src/platform/services/bibleService.ts`; `electron/db/bible.ts` (TEXT_FILES map), `electron/ipc/bible.ts`; `src/platform/ios/services.ts`; `src/lib/bibleTexts.ts`; `src/lib/chapterCache.ts`; `scripts/seed_*.py`, `scripts/fix_*.py`, `scripts/convert-dbs.js`.
3. X2 service; per-process caches (`_maxChaptersCache`, `chapterCache`).
4. better-sqlite3 / BereanSQLite; data seeding scripts (Python); `scripts/publish-data.js` publishes DBs to a GitHub Release for CI (CI checks out an empty `data/`, `scripts/audit-production.mjs`).
5. X5 schema. `text_tagged` token grammar: `word{H7225}`, `word{}`, `*word{}` italic, `!word{G1063}` red letter, `~{H853}` particle, `word{H914|H996}` multi, with malformed `sup>`/`blu>` fragments tolerated (`src/lib/taggedTokens.ts`). That grammar is an implicit contract with the data files.
6. Identical code path; iPhone opens from `App.app/data/` bundle. iPhone omits `lxx.db`, `youtube_seed.db` (split into `youtube_index.db` plus downloadable packs).
7. Data defects documented: concatenated multi-verse rows in some pseudepigrapha (`scripts/DATA_BUG_long_verse_rows.md`; `enoch.db` fix script exists, others "audited"); `lxx.db` has no UNIQUE verse key (PLAN.md); KJV italics markup missing in `kjva.db` (memory note; `ANNOTATION_KEYS.kjva_italics` exists in code; actual data UNVERIFIED because DB files were not opened). Data DBs are not in git (only `.gitkeep`); provenance is scripts plus a release asset.
8. `bibleService.contract.test.ts`, `psalmSuperscription.test.ts`, `textCoverage.test.ts`, `electron/__tests__/packagedAssets.test.ts`; Python tests `scripts/__tests__/test_data_merge_detector.py`.
9. SW-DATA: SQLite3/GRDB read-only; keep DB files byte-for-byte; port `text_tagged` parser first (it is the contract). Optionally later re-encode tags to a structured column.
10. Risk: loss of the many data-quality patches if DBs are regenerated; DBs are untracked so a clean checkout cannot build them (BLOCKED to rebuild from source here).
11. C-DATA (same files); trivially shareable.

### S02 Book / chapter / passage navigation — implemented
1. Reference bar, book/chapter picker, prev/next, continuous chapter scroll, pull-past-end rubber-band navigation, go-to-verse digits, `berean:next/prevChapter` events; iPhone horizontal pager and Go-to sheet; LXX↔KJV chapter mapping for Psalms and Jeremiah (chapter-level only).
2. `src/components/bible/{BiblePanel(4382 lines),BookChapterPicker,ContinuousChapterScroll,useChapterPullNav,ChapterPullIndicator}.tsx`; `src/lib/{bibleNav,translationChapterMap,verseNavigation,scrollToVerse}.ts`; `src/mobile/reader/{ReaderPage,PassagePicker,ReferencePicker,CompactPassageHeader}.tsx`.
3. Panel component owns tab state (`BibleTabState` in `src/types/index.ts`); store actions write it; iPhone uses `NavigationStack` and `readerScrollMemory`.
4. react-mosaic (Mac layout), framer-motion (iPhone pager).
5. `BibleTabState {bookId, chapter, endChapter?, verse?, targetVerse?, endVerse?, …}` synced as tab fields (`tabFields.ts`).
6. Different UI per platform, one parser (S03). Pull-nav physics is Mac trackpad; iPhone uses swipe + edge-back.
7. Verse-level LXX mapping not implemented (file header, VERIFIED). BiblePanel 4382 lines is a concentration risk.
8. `chapterPullNav.test.ts`, `passagePicker*.test.tsx`, `sheetAndReader.test.ts`, `translationChapterMap.test.ts`, `readerSoftEdge.test.ts`, `perTabHistory.test.ts`, `freshBibleTabNav.test.ts`.
9. SW-UI: SwiftUI `NavigationStack`/pager; rebuild picker; reuse parser port (S03).
10. Risk: the large number of back/forward, origin-tab-return, and per-tab history edge cases encoded in the store (`TabNavEntry`, `originTabId`) are behavioural contracts with only unit tests behind them.
11. C-DATA; C-HOST for panel while native shell grows.

### S03 Reference parsing — implemented
1. Parses book tokens, abbreviations, ranges, comma lists, chapter-only, Hermas/Recognitions forms, multi-book queries, roman/arabic variants, Strong's refs, canonical `book.chapter.verse` ids, and emits display, filename, wikilink forms.
2. `src/lib/parseRef.ts` (1054 lines), `multiBookSearch.ts`, `strongsSearch.ts`, `hermasMap.ts`, `chapterNumbering.ts`, `prologueBooks.ts`, `verseRangeFormat.ts`, `tests/unit/parseRef.test.ts`.
3. Pure TS, no I/O; used by reader, search intent, notes autocomplete, deep links, AI references.
4. None.
5. `ParsedRef`; canonical `createCanonical/parseCanonical`; `AMBIGUOUS_PATTERNS` set; `ALL_BOOKS` registry.
6. Same on both.
7. Duplicate `safeFtsQuery` exists in `parseRef.ts` and `bibleService.ts` with different behaviour (VERIFIED); a third copy `electron/ipc/numberWords.ts`/`src/lib/numberWords.ts` duplicates number-word tables.
8. `parseRef.test.ts` (two copies: `src/lib/__tests__` and `tests/unit`), `verseRefDisplay.test.ts`, `verseUtils.test.ts`, `multiBookSearch.test.ts`, `hermasMap.test.ts`, `refDecorations*.test.ts`.
9. SW-DATA: port as a pure Swift module, using the existing tests as golden cases (export the cases to JSON and run in XCTest).
10. Risk: regex-heavy; subtle ambiguity decisions encoded only in tests. Must be ported before any other Swift feature because search, notes, deep links and AI all use it.
11. C-DATA; can ship as a Swift package consumed by both engines with a JSON conformance corpus (INFERRED).

### S04 Verse rendering — implemented
1. Verse rows with number badge, tagged tokens, KJV italics, red-letter, translator-supply brackets per text (`ANNOTATION_KEYS` with hide toggles), Psalm superscriptions, section titles (`title` column), paragraph-style books, indicator dots, per-verse hover cards for idioms, flash/scroll targets, LXX repeated verses.
2. `src/components/bible/{VerseRow(2155),ChapterView(1431),TaggedVerseList,verseRowStyles}.tsx`; `src/lib/{taggedTokens,annotationFilters,psalmSuperscription,psalmTitles,verseTagRanges,scriptureText}.ts`; iPhone `src/mobile/study/VerseStudy.tsx`, `src/mobile/reader/readerViews.tsx`.
3. React tree builds DOM spans; char/word offsets map to DOM for highlights (S07/H02).
4. DOM selection APIs; Tailwind; per-theme CSS variables.
5. `Verse` type with `text_tagged`; highlight char offsets are into `verse.text` (plain), and `taggedTokenCharPos.test.ts` pins how tagged tokens map to those positions.
6. Same renderer on both; iPhone adds long-press sheets.
7. Rendering depends on DOM text-node ordering for selection→offset conversion; any native replacement must reproduce exactly the character positions that existing highlights were stored with (see H02).
8. `verseDisplayTokens.test.ts`, `taggedTokenCharPos.test.ts`, `supplyBrackets.test.ts`, `sirachRender.test.tsx`, `lxxRepeatedVerses.test.tsx`, `psalmSuperscription.test.ts`, `scriptureText.test.ts`.
9. SW-TEXT: `AttributedString`/TextKit 2 per verse with custom attributes for Strong's spans, highlights, search-hit ranges; selection via `UITextView`/`NSTextView` or custom.
10. Risk: Hardest piece of the reader. Attributed text with tappable word chips, multi-range highlights, inline Strong's chips and selection menus at 60 fps on long chapters (see S14). Offset semantics must match legacy data.
11. C-DATA; C-HOST (Scripture surface could remain WKWebView while other screens go native).

### S05 Strong's rendering and lexicon access — implemented
1. Inline Strong's chips (toggle per tab `showStrongs`), hover tooltip (Mac) / tap sheet (iPhone), click opens Lexicon tab/panel, context menu (open, new tab, float, copy), chapter-wide "echo" of a Strong's number, selected-verses Strong's summary, multi-Strong's tokens, word-phrase grouping.
2. `src/components/bible/{StrongsInline,StrongsTooltip,SelectedVersesStrongs}.tsx`; `src/components/lexicon/{LexiconPanel,LexiconTab,StrongsContextMenu,parts}.tsx`; `src/mobile/study/StrongsSheet.tsx`; `src/platform/services/lexiconService.ts` (432 lines); `electron/ipc/lexicon.ts`.
3. Lexicon service `getEntry`, `getOccurrences`, `getOccurrencePage`, `getRelated`, `search`, `findByNormalizedTransliteration`.
4. `strongs_hebrew.db`, `strongs_greek.db`; BDB abbreviations map (`src/lib/bdbAbbreviations.ts`).
5. Occurrences = `text_tagged LIKE` patterns (four variants for `{H123}`, `|`, etc.), paginated with LIMIT/OFFSET. Entry fields incl. `bdb_def`, `derivation`.
6. iPhone: sheet drag-up instead of hover. Floating-lexicon items hidden on iPhone.
7. LIKE-scan over all verses per lookup (no index); PLAN.md calls the `occurrences` tables stale. Hebrew occurrences lack `text_id`.
8. `lexiconService.contract.test.ts`, `lexicon.occurrences.test.ts`, `LexiconPanel.scrollPersistence.test.tsx`, `normalizeStrongsNums.test.ts`, `strongsSearch.test.ts`, `selectedVersesStrongs.test.tsx`, `bdbAbbreviations.test.ts`.
9. SW-DATA + SW-UI; consider an actual occurrences index table during migration (new work, not for now).
10. Risk: perf of LIKE scans on A-series; token grammar edge cases (multi-Strong's).
11. C-DATA.

### S06 Interlinear — deferred
1. Not present. No Hebrew (Leningrad/MT) or Greek (GNT) interlinear, no morphology data (PLAN.md: "No morphology; none in any DB"). Only Strong's-tagged English (KJVA) and Greek-Strong's-tagged Brenton LXX alignment.
2. grep `interlinear` in `src`/`electron` finds nothing; only `CLAUDE.md` lines 361–362 and 966–967 mention it.
3–6. n/a.
7. Absence VERIFIED by grep.
8. none.
9. Would be new data work plus SW-TEXT layout.
10. Risk: feature expectations in native plan must not assume it exists.
11. n/a.

### S07 Selection and copying — implemented
1. Verse-number click selection (single, range, multiple via shift/toggle), drag-select along verse numbers, text-range selection producing highlight toolbar, copy verse/ref/selection with KJV/LXX-aware formatting, Strong's-aware copy text, selection bar.
2. `src/lib/{verseSelection,verseClipboard,scriptureText,verseRangeFormat}.ts`; `src/components/bible/{VerseSelectionBar,VerseCopyMenu,verseDragSelect,verseInteraction,VerseDragIndicator}.ts(x)`; `src/mobile/study/{SelectionBar,MultiVerseSheet}.tsx`.
3. Store `selectedVersesByTab`; DOM Range → char offsets for highlights.
4. DOM Selection API; `@capacitor/clipboard`/`Share` on iPhone.
5. `SelectedVerseRef {bookId, chapter, verse}`; selection kinds none/single/range/multiple gate actions.
6. iPhone: long-press → `VerseActionSheet`; tap numbers toggles.
7. `HIGHLIGHT_OFFSET_DEBUG = true` leftover logging was found and fixed in the 2026-10-19 performance pass (doc claim; fix not re-verified).
8. `verseSelection.test.ts`, `multiVerseSelectionMenu.test.tsx`, `verseContextMenu.test.tsx`, `multiVerseSheet.test.tsx`.
9. SW-UI; pasteboard + `ShareLink`.
10. Risk: UIKit/AppKit text selection hit-testing differs from DOM; selection-to-offset translation must be re-proven.
11. C-DATA.

### S08 Verse context menus and actions — implemented
1. Right-click (Mac) / long-press sheet (iPhone): add verse note, show notes, cross refs, compare, tag, highlight swatches, copy, play audio from here, open in new tab/floating, idiom menu, note indicator menus.
2. `src/components/bible/VerseRow.tsx`, `VerseSelectionBar.tsx`; `src/mobile/study/VerseActionSheet.tsx`, `verseSheetMode.ts`, `src/mobile/primitives/{ActionSheet,PopoverMenu,anchoredMenu}.ts(x)`; Mac native menus built in main for some surfaces (`app:noteImageMenu`, `buildAppMenu`).
3. Handler functions invoked from several surfaces.
4. Radix popover, custom `ContextMenu`/`Menu` in `src/components/ui`.
5. Action ids shared with `commands.ts` list where applicable.
6. Floating-window items hidden on iPhone via `capabilities.multiWindow`-style checks (`platformCapabilities.ts`).
7. none beyond UX drift between two implementations of the same action list.
8. `verseContextMenu.test.tsx`, `anchoredMenu.test.tsx`, `popoverMenu.test.tsx`, `Menu.selectionStyle.test.tsx`.
9. SW-UI (`contextMenu`, `UIMenu`, `confirmationDialog`).
10. Low.
11. C-HOST.

### S09 Multiple translations and editions — implemented
1. Per-tab translation, translation switch preserving reading anchor, per-text annotation toggles, chapter-number remap for LXX, KJVA default, edition grouping, `lxx:`-style prefixes in search.
2. `src/lib/bibleTexts.ts`, `translationChapterMap.ts`, `passageDestinations.ts`, `src/components/bible/BiblePanel.tsx`, `src/mobile/reader/*`.
3. `textId` threaded through services.
4. All `data/*.db`.
5. `textId` strings (`kjva`, `lxx`, …) are persisted in notes (`text_id`), highlights, tabs.
6. Same.
7. LXX numbering is chapter-level only; Hermas has two translations with different versification and `hermasMap.ts` bridging.
8. `compareApplicable.test.ts`, `translationChapterMap.test.ts`, `hermasTaylor.test.ts`, `textCoverage.test.ts`.
9. SW-DATA; keep `textId` strings as stable keys.
10. `textId` renames would corrupt synced data; treat ids as frozen.
11. C-DATA.

### S10 Reading position and history — implemented
1. Per-tab scroll memory and reading-anchor (verse + offset) carried across translation/mode switches; chapter progress for progress bars; navigation history table with day/session grouping, History tab/modal; per-tab back/forward stacks.
2. `src/hooks/{useReadingAnchor,useKeyedScrollMemory,useChapterProgress}.ts`; `src/mobile/reader/readerScrollMemory.ts`; `src/platform/services/historyService.ts`; `src/components/shell/HistoryModal.tsx`; `src/mobile/history/HistoryPage.tsx`; `src/lib/historyModel.ts`; `src/store/index.ts` (`tabNavStacks`).
3. History rows in `history` table (local, not synced per feature-matrix "LOCAL"; `history` is absent from `SYNCED_ENTITY_KINDS` — VERIFIED); scroll state local.
4. none.
5. `history(timestamp, …)`; scroll offsets are not persisted in DB (store/localStorage — INFERRED).
6. iPhone adds edge-swipe back.
7. Reading position is device-local.
8. `historyService.contract.test.ts`, `historyModel.test.ts`, `readerScrollMemory` via `sheetAndReader.test.ts`, `scrollByTabNavReset.test.ts`, `verseScrollSync.test.ts`.
9. SW-DATA for history; position in `SceneStorage`/DB.
10. Low.
11. C-DATA.

### S11 Reading preferences — implemented
1. Bible font family/size, line-height presets, verse-number visibility, red-letter, per-text hidden annotations, app zoom, pinch-to-zoom (iPhone), reader width/margins, themes (S-UI theme item).
2. `src/store/index.ts` prefs; `src/hooks/useBibleLineHeight.ts`; `src/lib/{zoom,fontFamilies,textFit}.ts`; `src/mobile/reader/{usePinchFontSize,readerWidth,scriptureTheme.css}`; `src/mobile/settings/scriptureTheme.ts`.
3. Stored in the Zustand persisted slice, synced across Mac windows (not across devices).
4. none.
5. Persisted store keys (versioned) — migration `aiModeMigration.ts` shows the pattern.
6. iPhone uses Dynamic Type bridging via `BereanA11yPlugin.swift` (INFERRED from plugin name; content not read in detail).
7. Preferences do not sync via iCloud (X6).
8. `zoom.test.ts`, `textFit.test.ts`, `scriptureMargins.test.ts`, `scriptureTheme.test.ts`, `persistedSettings.test.ts`, `mobileAppearance.test.ts`.
9. SW-UI with `@AppStorage`/`UserDefaults`; map existing keys.
10. Preferences must be imported from localStorage on first native launch; localStorage in WKWebView is not accessible to native code without a bridge (INFERRED).
11. C-HOST can share if a bridge exports prefs.

### S12 Cross-references — implemented
1. Classic cross references (votes), TSKe (grouped headings, reciprocal), Taylor-Hermas footnotes, chapter-level "My Notes", reciprocal index; right panel on Mac (slots A/B), sheet on iPhone; viewer-window cross refs.
2. `src/platform/services/crossrefsService.ts`; `electron/ipc/crossrefs.ts` (352 lines, keeps sync helpers for AI); `src/lib/{crossRefIndex,crossRefs/xrefModel,notesCrossRefs}.ts`; `src/components/bible/BibleRightPanel.tsx` (2222); `src/components/viewer/ViewerCrossRefs.tsx`; `src/mobile/study/{CrossRefsSheet,XRefList,useVerseCrossRefs}.ts(x)`.
3. Service queries three DBs; results enriched with verse text in 300-row batches.
4. `cross_references.db`, `tske_refs.db`, `hermas_taylor.db`; `scripts/add_crossref_reverse_indexes.py`.
5. `CrossRef {bookId, chapter, verse, endVerse, votes, text}`; TSKe `&#x0027;` entity decoded in code (data defect worked around, VERIFIED).
6. Slot B (two simultaneous panels) Mac only; iPhone single sheet; TSK/Classic have no chapter-level rows.
7. Data bug workaround in code; TSKe headings may be keyword-searched by AI (`searchTskeHeadingsByKeywords`).
8. `crossrefsService.contract.test.ts`, `crossRefIndex.test.ts`, `xrefModel.test.ts`, `aiLookup.tskeCrossRefWidening.test.ts`, `crossrefs.searchTskeHeadingsByKeywords.test.ts`.
9. SW-DATA + SW-UI; port `translationChapterMap` first (used to canonicalise).
10. Medium: a `crossrefs` surface appears in 3 UI hosts.
11. C-DATA.

### S13 Parallel comparison — implemented
1. 2–4 translation columns with sync scroll, stacked (iPhone, interleaved verse cells), verse compare entry, presenter feed, per-column Strong's.
2. `src/components/bible/CompareView.tsx` (802), `src/mobile/reader/{ComparePage,compareState,compareInteraction}.tsx`, `src/components/viewer/ViewerCompare.tsx`, `src/platform/services/researchService.ts` (comparison payloads for AI), `src/lib/research/compareWords.ts`.
3. Compare is a Scripture-tab mode (`compareMode`, `compareColumns`, `compareSyncScroll` tab fields) — synced.
4. none.
5. Tab state fields.
6. Mac side-by-side; iPhone interleaved; CLAUDE.md "unlock a cell" independent navigation is not found (grep `unlock` only matched unrelated UI strings; UNVERIFIED but likely absent).
7. Persistence of compare state fixed per memory note ("compare persistence").
8. `compareState.test.ts`, `compareApplicable.test.ts`, `comparison.realdata.test.ts` (reads real DBs), `comparisonView.test.tsx`, `compareIntent.test.ts`.
9. SW-UI.
10. Medium (layout parity).
11. C-DATA / C-HOST.

### S14 Very long chapter performance — implemented (partly measured)
1. Chapters are NOT virtualised. `ContinuousChapterScroll` windows chapters (`LOAD_AHEAD = 1`, `WINDOW_CHAPTERS = 2`, eviction); each chapter renders all verses (Psalm 119, Isaiah). Advanced search results and chat transcripts ARE virtualised (`@tanstack/react-virtual`, `ScriptureSearchView`).
2. `src/components/bible/{ContinuousChapterScroll,ChapterView}.tsx`; `docs/performance-audit-2026-10-19.md`; `scripts/perf/{nav,scroll}.*`.
3. Per-chapter fetch (~0.2 ms IPC) and React render.
4. none.
5. n/a.
6. Doc reports Mac scroll with 0 frames over 25 ms and iPhone reader scroll p95 17 ms (60 Hz), one frame over 25 ms of 120, simulator only. Numbers are the doc's (UNVERIFIED by this audit); iPhone numbers are simulator, not device.
7. Physical-device scroll and memory not measured (doc says so). Chromium sibling-selector restyle problem fixed in CSS (doc).
8. `scripts/perf/*` are manual scripts, not CI tests. `chapterPullNav.test.ts` only for gesture logic.
9. SW-TEXT; Apple's TextKit handles long text lazily; use `UICollectionView`/`LazyVStack` per verse.
10. Risk: moving from DOM to native rows loses text-flow selection across verses unless a single text view is used.
11. C-HOST.

### S15 Find in chapter — implemented
1. Phrase/all/any highlight inside the chapter; handoff from search to find; iPhone `FindOnPage`.
2. `src/components/shell/FindBar.tsx`, `src/lib/{scriptureFind,findHandoff,scriptureHighlight}.ts`, `src/mobile/reader/FindOnPage.tsx`.
3. Client regex over rendered verses; number-word alternates.
4. none.
5. `buildHighlightPattern`.
6. same.
7. none known.
8. `scriptureFind.test.ts`, `findHandoff.test.tsx`, `scriptureHighlight.test.ts`, `findOnPage.test.ts`.
9. SW-UI (`.searchable`/`NSTextFinder`).
10. Low.
11. C-HOST.

### S16 Word replacer (display rules for divine names and search expansion) — implemented
1. User-defined replacement rules applied at render time with search-variant expansion (typing a replacement finds the original word); settings sections on both platforms.
2. `src/lib/wordReplacer.ts`, `src/components/settings/sections/WordReplacerSection.tsx`, `src/mobile/settings/WordReplacerPage.tsx`; used by search/unified search.
3. Rules in store; search issues one query per variant (`getWordReplacerSearchVariants`).
4. none.
5. `WordReplacerRule {queries[], replacement}` in settings store (not synced across devices).
6. same.
7. `expandQueryForWordReplacer` is documented in its own comment as broken for production use and kept only for tests (VERIFIED).
8. `wordReplacer.test.ts`, `lxxAndWordReplacer.test.ts`.
9. SW-DATA; apply at attribute-building time.
10. Rules must be applied in the same place as offsets (see S04).
11. C-DATA.

---

## B. Search

### Q01 Scripture full-text search — implemented
1. FTS5 per text with modes all/any/phrase, prefix wildcards, number↔word alternates, scoped by books and optional chapter; ordered by FTS `rank`; limits 2000 (unscoped) / 5000 (scoped), `any` mode merges per-term queries and caps at 3000.
2. `src/platform/services/bibleService.ts` (`searchText`, `safeFtsQuery`, `cleanWords`), `src/lib/{scriptureSearch,scriptureSearchFilters,numberWords}.ts`, `src/components/bible/ScriptureSearchView.tsx` (2090), `src/mobile/search/*`.
3. `verses_fts MATCH ? … ORDER BY rank`; results annotated client-side.
4. FTS5 in system SQLite (iOS compile options verified per D-002 doc).
5. `VerseSearchRow`. Query cleaning drops non `[a-zA-Z0-9']` characters, so non-Latin/diacritic queries (Greek, Hebrew, transliteration with diacritics) cannot be FTS-searched (VERIFIED from `cleanWords`).
6. Same; iPhone uses `src/lib/scriptureSearch.ts`.
7. FTS query failures are swallowed (`catch { return [] }`); ranking is plain FTS rank, no cross-text blending (SPEC_STATUS notes keyword matches from other texts can outrank canonical verses in AI use).
8. `scriptureSearch.test.ts`, `scriptureSearchFilters.test.ts`, `scriptureSearchSnippetRanges.test.ts`, `bibleService.contract.test.ts`, `multiBookSearch.test.ts`.
9. SW-DATA: SQLite FTS5 via the same DB files; keep the exact MATCH builder.
10. FTS tokenizer/rank must remain identical to keep results stable; the FTS index is stored in the data DB files (portable).
11. C-DATA.

### Q02 Reference search — implemented
1. A typed reference jumps to chapter/verse/range; ambiguous book tokens listed; Go-to groups in unified search; typed-digit go-to in reader.
2. `parseRef.ts`, `searchIntent.ts`, `FloatingSearch.tsx`, `src/mobile/search/SearchSurface.tsx`, `src/lib/navigation/destination.ts`.
3. Intent parser (`parseSearchIntent`) classifies reference vs Strong's vs keyword vs source-prefix.
4. none. 5. `SearchIntent`, `Destination`. 6. Same logic.
7. none known.
8. `searchIntent.test.ts`, `destination.test.ts`, `tabResolution.test.ts`, `passageDestinations.test.ts`, `floatingSearch.test.ts`.
9. SW-DATA (intent) + SW-UI. 10. Depends on S03 port. 11. C-DATA.

### Q03 Strong's search — implemented
1. `H####/G####` direct entry; multi-Strong's AND/OR; search verses containing a Strong's number with word highlight segments; "any Strong's" mode.
2. `src/lib/strongsSearch.ts`, `scriptureSearch.ts` (`runStrongsSearch`), `lexiconService.getOccurrences`.
3. Same LIKE over `text_tagged` as S05. 4–5 as S05. 6. same. 7. LIKE scan cost. 8. `strongsSearch.test.ts`, `lexicon.occurrences.test.ts`. 9. SW-DATA. 10. Perf on device. 11. C-DATA.

### Q04 Lexicon search — implemented
1. Search over `strongs_id/word/transliteration/short_def/full_def/bdb_def` with LIKE and ordered CASE ranking; diacritic-insensitive transliteration match done in JS (`findByNormalizedTransliteration` loads all transliterations).
2. `lexiconService.search`, `electron/ipc/lexicon.ts`, `src/components/lexicon/LexiconPanel.tsx`.
3. LIKE, no FTS. 4. lexicon DBs. 5. `LexiconEntry`. 6. same. 7. No FTS5 on lexicon; full scan per query (INFERRED perf). 8. `lexiconService.contract.test.ts`. 9. SW-DATA; add FTS later (new work). 10. Low. 11. C-DATA.

### Q05 Notes search — implemented
1. FTS5 over notes `title, content` (migration v19, triggers + backfill), modes all/any/phrase, "untitled" special case, tag and chapter queries, idiom lists.
2. `src/platform/services/notesService.ts` (`search`, `getByChapter`, `getChapterCounts`), `src/lib/panelDataCache.ts`.
3. `notes_fts` content table; ranked.
4. FTS5. 5. Note rows; deleted notes excluded via `deleted_at`. 6. same.
7. The index covers the raw markdown including inline base64 image data URLs (INFERRED from storage format, N05), which inflates the index and snippets.
8. `notesService.contract.test.ts`, `notesDailyDates.test.ts`, `matchExcerpt.test.ts`.
9. SW-DATA. 10. FTS content table triggers must be preserved byte-compatibly (shared DB). 11. C-DATA.

### Q06 Indexing — implemented (FTS), partial (others)
1. FTS5 for verses (prebuilt in data DBs), notes (`notes_fts`), YouTube transcripts (`youtube_transcripts_fts`); no index for lexicon, Strong's occurrences or note-to-verse references beyond `verse_ref`/`idx_notes_verse`; Spotlight index (iPhone) for notes, sessions, workspaces, books/chapters; embedding index is a dev artifact (Q08).
2. `bereanMigrations.ts` v13/v19; `scripts/build-embedding-index.js`; `src/platform/ios/spotlight.ts`; `BereanSpotlightPlugin.swift`.
3. Triggers keep FTS in sync. 4. SQLite. 5. as above. 6. Spotlight is iPhone-only. 7. Verses not indexed in Spotlight (feature-matrix, doc). 8. migration tests `bereanMigrations.test.ts`. 9. SW-DATA (GRDB FTS5), `CSSearchableIndex`. 10. Low. 11. C-DATA.

### Q07 Filtering and ranking — implemented / partial ranking
1. Filters by text, testament/book groups (10 presets), tag AND/OR, sort; unified search grouped results; AI collections (canon, apocrypha, pseudepigrapha, fathers) filter; YouTube search ranking (`rankVideosBySearch`); RRF fusion for AI candidates (`electron/rrf.ts`).
2. `src/lib/{scriptureSearchFilters,search/unifiedSearch,youtubeSearch,research/collections}.ts`, `electron/rrf.ts`.
3. Pure functions + SQL. 4. none. 5. Filter objects (`UnifiedFilters`). 6. same. 7. SPEC_STATUS: result ranking on the full AI library is "partial" (keyword matches from other texts can outrank canonical verses). Benchmark doesn't score order (doc).
8. `unifiedSearch.test.ts`, `rrf.test.ts`, `collections.test.ts`, `youtubeSearch.test.ts`. 9. SW-DATA. 10. Ranking regressions silent. 11. C-DATA.

### Q08 Semantic search and embeddings — partial (Mac dev only; not shipped)
1. Query-time cosine search over a prebuilt `verse_embeddings.db` using Ollama `nomic-embed-text`; best-effort extra candidate source for Ask Berean; brute-force scan, quantised vectors (`embeddingQuantize.ts`).
2. `electron/{embeddings,embeddingQuantize,rrf}.ts`, `electron/db/embeddingsDb.ts`, `electron/ipc/semanticCandidates.ts`, `scripts/build-embedding-index.js`, `scripts/eval/semanticEval.ts`.
3. Index path `electron/db-generated/verse_embeddings.db` (gitignored; the directory does not exist at this commit — VERIFIED); `app.isPackaged` path `Resources/data/verse_embeddings.db` which is never packaged (extraResources filter and bundled list exclude it). Every caller degrades to null.
4. Ollama on localhost:11434; index file (BLOCKED to rebuild: needs Ollama, forbidden here).
5. Index `meta` table (model, prefixes); vectors quantised. 6. Mac only; iPhone excludes entirely.
7. Not shipped in any build; SPEC_STATUS decision 11 "kept current index after measurement" while PLAN notes 17.4% semantic baseline (doc claim, UNVERIFIED). Brute-force scan cost unmeasured.
8. `embeddingQuantize.test.ts`, `rrf.test.ts`, `semanticCandidates.test.ts`; eval harness `scripts/eval` (manual).
9. If retained: Core ML/NLEmbedding or bundled small model + Accelerate vDSP; new work. Not required for parity because production never had it.
10. Risk: assuming it is shipped in a native parity matrix.
11. n/a (never in production).

### Q09 Floating search / unified Search Berean / command palette — implemented
1. Cmd+K/T modal (Mac): references, Strong's, keywords, notes, YouTube channels/videos, `>` commands (30 command ids), recents; iPhone plus/caret sheets and Search tab with scopes all/scripture/notes/lexicon and filters; "current tab vs new tab" destination contract.
2. `src/components/shell/FloatingSearch.tsx` (1678), `src/lib/{commands,search/*,navigation/*,searchNav}.ts`, `src/mobile/search/*`, `src/mobile/navigation/{NewTabSheet,destinationQuery}.tsx`, `docs/navigation-contract.md`.
3. One intent parser + unified result builder shared; UI per platform.
4. services. 5. `Destination`, `UnifiedResults`. 6. iPhone has no commands/YouTube groups in the plus search (doc).
7. FloatingSearch 1678 lines of UI logic.
8. `floatingSearch.test.ts`, `unifiedSearch.test.ts`, `searchSurface.test.tsx`, `searchPageIA.test.tsx`, `quickOpen.test.tsx`, `commands.test.ts`.
9. SW-UI (`.searchable` + custom palette), SW-DATA for intent/results.
10. Medium: behaviour contract (navigation-contract.md) must be re-implemented exactly.
11. C-HOST.

### Q10 YouTube transcript search — implemented (see M04)

---

## C. Notes

### N01 General, verse and daily notes — implemented
1. Note types `general`, `verse` (also `esword`, `biblegateway` imported), `daily`; verse notes anchored by `verse_ref` (`book.chapter.verse`) + `text_id`; per-note colour, tags (JSON array), icon, status, pin, AI-exclusion flag, folder id.
2. `src/platform/services/notesService.ts` (769 lines), `electron/ipc/notes.ts`, `src/types/index.ts` (`Note`), `src/components/notes/*`, `src/mobile/notes/*`, `src/lib/{noteUtils,noteTitle,noteStatus,notePreviewText,noteRecency,finalizeNote}.ts`.
3. One `notes` table, soft delete (`deleted_at`), versions table, folder table, FTS.
4. FTS5, uuid.
5. Content is a markdown string in `notes.content`. Frontmatter exists only in vault/file export. Verse refs `book_id.chapter.verse` (dotted) are the anchor; CLAUDE.md's `book_num` is wrong.
6. iPhone cannot print via Electron; uses `BereanPrintPlugin`. Verse sheets embed an in-place editor.
7. Verse-note anchor is verse-level only; no word-range anchor.
8. `notesService.contract.test.ts`, `noteTitle.test.ts`, `noteStatus.test.ts`, `finalizeNote.test.ts`, `noteRecency.test.ts`, `chapterNotes.test.ts`, `verseNotesAggregate.test.ts`, `noteGrouping.test.ts`.
9. SW-DATA for service; editor per N02.
10. Medium: types/enum compat must stay with the synced rows.
11. C-DATA.

### N02 Markdown model and ProseMirror structure — implemented
1. Notes are stored as markdown; the editor is ProseMirror (Typora-like rendered mode, with a raw-edit toggle, "Edit/View mode"); markdown → PM via markdown-it with custom rules, PM → markdown via custom serializer; custom nodes and marks.
2. `src/components/notes/pm/{schema,parser,serializer,markdownIt,NoteEditorPM(1587),keymap,inputRules,slashCommands,pastePlugin,nodeViews,blockHandles,blockDecorations,headingCollapse,threadNodeView,…}.ts(x)`, `src/lib/noteTextBlocks.ts`.
3. Schema nodes: doc, paragraph (indent attr stored as NBSP run), blockquote, callout (GFM `> [!NOTE]`), column_list/column, thread/thread_entry (conversation blocks), horizontal_rule, study_trail_embed, heading, code_block, text, image, hard_break, bullet_list (marker attr), ordered_list, list_item (checked), table family via prosemirror-tables; marks em, strong, code, strike, underline, highlight(color), link, wikilink.
4. prosemirror-* packages, markdown-it, marked; lucide icons.
5. Round trip must preserve markdown text; extensions (underline, highlight colour emoji, columns, threads, callouts, trail embeds, NBSP indent) are non-standard markdown conventions private to Berean/vault dialect.
6. iPhone uses the same PM editor in WKWebView (`NoteEditorPage`, `phoneEditorChrome`, `PhoneSelectionToolbar`, `iosTextInput.test.tsx`).
7. Non-standard markdown extensions make notes only partially portable (Octarine renders some, not all — INFERRED). Raw/rendered toggle named "markdown" in docs but "Edit/View" in commands.
8. 40 files under `pm/__tests__` incl. `roundtrip.test.ts`, `trailingSpaceRoundTrip.test.ts`, `schema.imageWidth.test.ts`, `threads.test.ts`, `columns.test.ts`, `inputRules.test.ts`, `slashCommands.test.ts`, `NoteEditorPM.smoke.test.tsx`, plus `markdownCombinations.test.ts`, `markdownEditor.test.ts`, `wysiwygEdit.test.ts`, `noteFormats.test.ts`.
9. SW-EDIT or SW-HOST. No native Apple editor handles callouts, columns, threads, tables with arbitrary markdown round-trip; a native editor means a custom block editor on a markdown AST plus TextKit 2 attachments. Keep ProseMirror in WKWebView as a first phase.
10. Highest-risk item in the product after Ask Berean: round-trip fidelity of existing notes (3,375 in the author's data per perf doc) and IME/dictation/autocorrect behaviour (`TEST25-NOTES-001` race documented in `useNoteAutosave.ts`).
11. C-DATA + C-HOST (the editor is the one component that can stay hosted indefinitely).

### N03 Inline formatting and block types — implemented
1. Bold/italic/code/strike/underline, coloured highlight marks, text alignment (paragraph attr), lists incl. tasks, quotes, callouts, code blocks with highlighting, horizontal rules, heading collapse (persisted per note), thread blocks with collapse (persisted), columns, slash commands, block handles/menu, selection toolbar, link editor, word/selection stats.
2. `src/components/notes/pm/*`, `src/lib/noteTextBlocks.ts`, `bereanMigrations.ts` v24/v27 collapse tables.
3. PM plugins. 4. highlight.js-like code highlighting in `codeBlockHighlight.ts` (own). 5. Collapse tables keyed by note + heading/thread key. 6. same; PhoneSelectionToolbar replaces Mac toolbar.
7. Alignment is PM attr, stored how in markdown? UNVERIFIED (not read).
8. `blockDecorations.test.ts`, `blockHandles*.test.ts`, `blockMenu.test.tsx`, `bulletStyleLiveUpdate.test.tsx`, `codeBlockNodeView.test.tsx`, `selectionToolbar.test.ts`, `headingCollapsePersistence.test.ts`.
9. SW-EDIT/SW-HOST. 10. as N02. 11. as N02.

### N04 Tables — implemented
1. GFM tables via prosemirror-tables with table status bar and column controls.
2. `src/components/notes/pm/{tablePlugins,tableStatusPlugin,columnControls}.ts(x)`.
3. PM tables ↔ markdown pipe tables. 4. prosemirror-tables. 5. Markdown pipe tables (alignment row). 6. same. 7. Complex cells (multi-block) cannot round-trip in pipe-table markdown (INFERRED). 8. `columns.test.ts`, `columnControls.test.tsx`, `markdownCombinations.test.ts`. 9. SW-EDIT. 10. as N02. 11. C-HOST.

### N05 Images and attachments — partial
1. Paste/drop/pick images; drag-resize; stored INLINE as base64 `data:` URLs inside `notes.content`; native Mac image menu (copy, save as, delete); iPhone photo-library insert (`NSPhotoLibraryUsageDescription`); vault export extracts to `{vault}/attachments/<hash>.<ext>` and import re-inlines.
2. `src/components/notes/pm/imageInsert.ts`, `nodeViews.ts`, `electron/ipc/noteImages.ts`, `electron/ipc/vault.ts` (`extractInlineImages` line 257, `inlineVaultImages` 307).
3. Content string holds the bytes. 4. Electron `nativeImage`. 5. `data:<mime>;base64,…` in markdown. 6. Mac context menu native; iPhone via editor chrome.
7. Inline base64 inflates DB, FTS, sync journal ops (full `fields` per upsert) and version snapshots (INFERRED); perf doc mentions a 452 KB image note and +25 MB footprint once. No general attachment type (PDF files are separate, see U-PDF).
8. `noteImages.test.ts`, `vault.extractInlineImages.test.ts`, `vault.inlineVaultImages.test.ts`, `imageNodeViewActions.test.tsx`, `schema.imageWidth.test.ts`.
9. SW-DATA: keep the data-URL contract initially (existing notes depend on it); later migrate to file attachments with a one-time conversion (new work).
10. Risk: sync journal growth and iCloud file-size limits (INFERRED); a native editor needs `NSTextAttachment` that loads from data URLs.
11. C-DATA.

### N06 Links, wikilinks and Scripture references — implemented
1. `[[Genesis 1:1]]` and `[[Note Title]]` wikilinks, auto-detected bare references decorated live, autocomplete popups (book/chapter/verse, notes), `berean://` links in notes, reference chips, timestamps links, backlinks-ish "cross refs from notes" for verses.
2. `src/components/notes/pm/{autocomplete,AutocompletePopups,refDecorations,linkModel,LinkEditor}.ts(x)`, `src/lib/{noteRefs,notesCrossRefs,deepLinks}.ts`, `src/components/notes/MarkdownReferenceModal.tsx`.
3. Decorations, not stored marks, for bare refs (`refDecorations.ts`); wikilink is a mark.
4. parseRef. 5. wikilink title = canonical display label; vault filenames derived via `toFilename`. 6. Same.
7. Display book labels vs canonical names (Hermas, roman numerals) can drift in titles; vault wikilinks are folder-unaware (memory: M6 issue list, fix status UNVERIFIED).
8. `refDecorations*.test.ts`, `autocomplete.test.ts`, `linkClick.test.ts`, `linkModel.test.ts`, `noteRefs.test.ts`, `verseRefDetection.test.ts`, `viewModeAutocomplete.test.ts`.
9. SW-EDIT (decorations map to attributed ranges). 10. Medium. 11. C-HOST.

### N07 Autosave — implemented
1. Desktop debounces 500 ms (NotesPanel; `registerPendingSaveFlusher` for floating windows); iPhone `useNoteAutosave` 500 ms debounce, version snapshot after 2 idle minutes and on leave, flush on pagehide/background/unmount; external changes preserved via `decideExternal`/`preserveExternal` while editing (`liveNote.ts`).
2. `src/lib/{pendingSaves,notes/liveNote}.ts`, `src/mobile/notes/useNoteAutosave.ts`, `src/components/notes/NotesPanel.tsx`.
3. Debounced IPC/service writes. 4. none. 5. `updated_at` LWW with per-field merge on sync. 6. same semantics; iPhone flush hooks differ.
7. Data-loss windows exist between keystroke and 500 ms flush and during force-quit (INFERRED); the editor owns the live doc and is not refreshed per save (documented fix).
8. `noteAutosave.test.tsx`, `liveOpenNote.test.tsx`, `liveNote.test.tsx`, `staleEchoGuard.test.tsx`, `saveIndicator.test.tsx`.
9. SW-DATA + native lifecycle hooks (`scenePhase`, `willTerminate`). 10. Must reproduce external-edit merge rules. 11. C-DATA.

### N08 Undo/redo and version history — implemented
1. PM history for in-editor undo/redo; persistent `note_versions` snapshots (auto kind, pruned) with restore UI.
2. `notesService` (`createVersion`, `pruneNoteVersions`, `getVersions`, `restoreVersion`), `src/components/notes/NoteVersionHistory.tsx`, `prosemirror-history` in `keymap.ts`.
3. Append-only entity `note_version` in sync. 4. none. 5. rows (note_id, title, content, kind, created_at). 6. same.
7. Undo stack is in-memory; lost on reload.
8. `notesService.contract.test.ts`; no component test for NoteVersionHistory found.
9. SW-DATA; native `UndoManager` for the editor (SW-EDIT). 10. Low. 11. C-DATA.

### N09 Export, import, print — implemented
1. Per-note markdown export/import with frontmatter (`noteToMarkdownFile`), Files/share export on iPhone, Mac print preview and PDF export (main-process `printToPDF`), iPhone print via `UIPrintInteractionController` + PDF renderer, idioms export, vault export/import (N10).
2. `src/lib/noteMarkdownFile.ts`, `src/platform/ios/exportNotes.ts`, `electron/main.ts` (`app:printNote`, `app:exportNotePDF`, `app:renderPreviewPDF`), `src/components/notes/PrintPreviewModal.tsx`, `BereanPrintPlugin.swift`, `src/lib/{notePreviewRender,idiomsExport}.ts`.
3. HTML render → print/PDF. 4. Chromium print (Mac). 5. Frontmatter keys: type, ref, title, created, updated, tags, color (emoji), icon, status, berean_id, folder_id, ai_excluded, verse, book, chapter, links. The Electron serializer keeps its own copy of this format (`vault.ts noteToMarkdown`), so there are two implementations (VERIFIED by the file comment).
6. Mac sandbox build; iPhone share sheet.
7. Two serializers can drift.
8. `noteMarkdownFile.test.ts`, `exportNotes.test.ts`, `printHTML.test.ts`, `printRendering.test.ts`, `printFitScale.test.ts`, `idiomsExport.test.ts`.
9. SW-DATA for markdown; `NSPrintOperation`/`UIPrintInteractionController`; PDF via WebKit or Core Text. 10. Printing fidelity depends on the HTML renderer (`staticRender.ts`). 11. C-DATA.

### N10 Vault integration (Octarine/Obsidian) — implemented (Mac only)
1. Optional vault folder: one `.md` per note with frontmatter and `berean_id`, attachments extraction, trash folder mirror, chokidar watcher (1.5 s polling, depth 10) with bidirectional reconcile, export-all and import-all on a timer and at quit, highlights/history/PDFs exported into the vault (`.attachments/`), hidden-path filter (`.git`, dotfiles).
2. `electron/ipc/vault.ts` (1449 lines), `electron/mac/folderAccess.ts` (security-scoped bookmarks for MAS), `src/components/shell/Onboarding.tsx` vault step, `src/components/settings/sections/ImportSection.tsx`.
3. Main-process fs + chokidar; reconcile compares `updated_at` last-write-wins (`importVaultFile`).
4. chokidar (imported at `electron/ipc/vault.ts:6` but NOT listed in `package.json`; `package-lock.json` has one `node_modules/chokidar` entry, so it is a transitive dependency — VERIFIED; fragile if the parent package drops it), iCloud Drive vault path.
5. Frontmatter dialect; `berean_id` reconciliation; Octarine-specific `cssclasses`-style fields appear only in the integration test mock (not code).
6. iPhone has NO vault (`R140`); it exports/imports single `.md` files via Files/share instead.
7. Known historic issues (memory M6/M7: bidirectional sync, wikilink folder-awareness, collisions): fix status UNVERIFIED. An iCloud-evicted file hang was found 2026-09-22 (memory) with sync `readFileSync` in `vault:reconcile`; mitigation status UNVERIFIED. The integration test is a tautology (X7).
8. `vault.importVaultFile.test.ts`, `vault.extractInlineImages.test.ts`, `vault.inlineVaultImages.test.ts`, `tests/unit/vault-note-icon.test.ts`, `tests/unit/vault-note-status.test.ts`, `Onboarding.maybeImportVault.test.ts`; `tests/integration/vault-sync.test.ts` is not a real test.
9. SW-DATA with `NSFileCoordinator`/`FSEvents` or `DispatchSource`, security-scoped bookmarks (already needed for MAS); this is plain file IO and is relatively portable.
10. Risk: iCloud eviction, conflicting edits between Octarine and journal sync (two sync systems writing the same notes), watcher semantics.
11. C-DATA (file format stays); both apps could run if only one watches the vault (C-NO for two simultaneous watchers — INFERRED).

### N11 Folders, trash, pin, status, icons, board, list views — implemented
1. Folder tree (nested), soft-delete trash with restore/purge, pin, status chips, note icons/emoji picker, list/folder/board views, filters/sorting, AI exclusion at note or folder level, recents.
2. `src/components/notes/{NotesHomePanel,NotesFolderView,NotesBoardView,NotesList,NoteContextMenu,NoteIcon*,NoteStatusDropdown,folderTreeGeometry}.tsx`, `src/mobile/notes/{NotesHomePage,VirtualNoteList,TrashPage,FolderPicker,notesHomeModel}.ts(x)`, `notesService` folder functions.
3. Tables `note_folders`, tombstones. 4. none. 5. folder ids; vault trash path. 6. iPhone folder-first home.
7. Folder delete cascades (`folderDeleteDeep`) rely on sync `dependents`.
8. `NotesBoardView.test.tsx`, `folderTreeGeometry.test.tsx`, `noteGrouping.test.ts`, `notesHome` tests (`chapterMyNotes.test.tsx`).
9. SW-UI + SW-DATA. 10. Medium. 11. C-DATA.

### N12 Daily notes, calendar and sunrise day boundary — implemented
1. Daily note per date titled `Daily — YYYY-MM-DD` (title is a de facto key); day boundary at local sunrise via `suncalc` plus location (location once per launch); Sabbath label for Saturday; calendar widget (Mac sidebar), calendar tab (both), continuous daily scroll, today shortcut (Cmd+Shift+D, intent, widget, `berean://daily`).
2. `src/lib/{dailyNotes,dailyNoteUtils,calendarModel,noteUtils}.ts`, `src/components/notes/{CalendarWidget,CalendarTabPanel,ContinuousDailyScroll,DailyNoteEditsSection}.tsx`, `src/mobile/calendar/*`, `BereanLocationPlugin.swift`, `suncalc`.
3. Date key math in lib. 4. suncalc, location permission (When In Use). 5. Daily note title string as key; stable ids fixed for sync per feature-matrix "stable daily ids".
6. Mac uses Electron geolocation path in main (INFERRED: `NSLocationWhenInUseUsageDescription` in `extendInfo`); iPhone plugin.
7. Location denied fallback to midnight (INFERRED); title-as-key means renames could break daily detection.
8. `dailyNoteUtils.test.ts` (two copies), `calendarModel.test.ts`, `calendar.test.tsx`, `CalendarWidget.monthYearPicker.test.tsx`, `notesDailyDates.test.ts`.
9. SW-DATA + CoreLocation + SwiftUI calendar. 10. Sunrise semantics and Sabbath label must match. 11. C-DATA.

### N13 Idiom / reference-book editor — implemented, niche
1. Idiom notes with structured fields (meaning, aliases, auto variants, examples), verse-row idiom hover/menu, idioms export.
2. `src/types/index.ts` (`IdiomData`), `notesService.listIdioms`, `src/lib/idiomsExport.ts`, `VerseRow.tsx`, `BibleRightPanel.tsx`, `SettingsModal.tsx`.
3. Fields stored on note rows. 4. none. 5. note columns for idiom data (v-migrations). 6. iPhone: tap preview (feature matrix: NOT STARTED, status unknown).
7. Not in CLAUDE.md. 8. `idiomsExport.test.ts`. 9. SW-DATA. 10. Easy to forget. 11. C-DATA.

### N14 BibleGateway notes importer — implemented (Mac only; contradicts CLAUDE.md)
1. Logs into BibleGateway in a hidden Chromium window with user-supplied credentials and scrapes notes into a review list, then imports selected notes. CLAUDE.md §20 lists it as deferred.
2. `electron/ipc/bgImport.ts` (820 lines), `src/components/settings/BibleGatewayImporter.tsx`, `BgImportProgress.tsx`.
3. Ephemeral BrowserWindow partition (`BG_PARTITION`), `fillLoginForm` injects credentials via `executeJavaScript`.
4. Network, Electron BrowserWindow. 5. `BgImportReviewNote`; imported as `type: biblegateway`. 6. Mac only.
7. Scrapes a third-party site (ToS risk, fragile selectors); handles passwords in the main process memory; whether credentials persist anywhere is UNVERIFIED (partition declared ephemeral in a comment).
8. none found for bgImport. 9. No native equivalent without WKWebView automation; likely drop or keep as a hosted helper. 10. Policy risk in App Store review. 11. C-NO (Electron-specific).

### N15 e-Sword import — implemented (Mac only)
1. Reads an installed e-Sword notes database and imports with review.
2. `electron/ipc/eSwordImport.ts` (543), `src/components/settings/ESwordImporter.tsx`. 3. better-sqlite3 on a user file; home-directory search. 4. e-Sword files. 5. maps to `type: esword`. 6. Mac only. 7. Home-dir probing is sandbox-hostile in MAS (INFERRED). 8. none found. 9. SW-DATA with `sqlite3` and a file picker. 10. Low. 11. C-DATA.

---

## D. Highlights

### H01 Storage — implemented
1. `highlights` table, id `hl-<textId>-<bookId>-<chapter>-<verse>-<range>` where range is `v`, `w<start>-<end>` or `c<start>-<end>` (deterministic so two devices highlighting the same range merge); older rows keep random ids; `label` column exists but no service API sets it.
2. `src/platform/services/highlightsService.ts`, `electron/ipc/highlights.ts`, `bereanMigrations.ts` v1/v2.
3. Toggle semantics: same range+colour removes, different colour updates, else insert. 4. none. 5. columns: id, text_id, book_id, chapter, verse_num, start_word, end_word, start_char, end_char, color, label, created_at. 6. same.
7. `label` is dead schema. `remove()` deletes ALL highlights on a verse with a bulk event.
8. `highlightsService.contract.test.ts`. 9. SW-DATA (trivial). 10. Id scheme is a sync contract. 11. C-DATA.

### H02 Verse, word and selection highlights; offsets and anchoring — implemented
1. Whole verse, word-range (start/end word index) and char-range (start/end char into plain `verse.text`) highlights; overlapping allowed; row tint for verse-level.
2. `highlightsService.ts`, `VerseRow.tsx`, `src/lib/{scriptureHighlight,verseUtils}.ts`, `src/mobile/study/VerseActionSheet.tsx`.
3. Anchoring is by offsets (no text-hash or quoted-text anchor). A text DB correction that shifts characters silently misplaces existing highlights.
4. none. 5. offsets into `verse.text` of a specific `text_id`. 6. same.
7. No re-anchoring after data fixes (e.g. the Enoch row splits, KJV italics re-seed) — INFERRED risk; legacy word-level rows use word index into tagged tokens, a second coordinate system.
8. `scriptureHighlight.test.ts`, `taggedTokenCharPos.test.ts`, `highlightsService.contract.test.ts`.
9. SW-TEXT with identical offset semantics; build a conformance test from real rows.
10. High: coordinate semantics must be preserved exactly.
11. C-DATA.

### H03 Colours and categories — partial
1. 15 colours (`HighlightColor` in `src/types/index.ts`) incl. yellow, red, green, blue, purple, orange, pink, teal, cyan, indigo, lime, amber, rose, violet, sky; no categories/labels UI; CLAUDE.md's 5 colours and "label/tag" are outdated/unused. Verse tags (S18) are the categorisation mechanism instead.
2. types, `ColorSwatchRow.tsx`. 3–6 trivial; `electron.d.ts` still declares a 5-colour union (type drift, VERIFIED). 7. Type drift in `electron.d.ts`. 8. none specific. 9. SW-UI. 10. Low. 11. C-DATA.

### H04 Note and tag indicators on verses — implemented
1. Dots/badges per verse for notes (count), highlights, tags, cross-refs; click opens notes popover; chapter-notes banner.
2. `VerseRow.tsx`, `verseNotesAggregate.ts`, `chapterNotes.ts`, `notesService.getChapterCounts/getByChapter`, `src/mobile/study/{VerseNotesSheet,ChapterNotesView}.tsx`. 3. batch queries per chapter. 4. none. 5. `hasNote`, `hasHighlight` flags on `Verse`. 6. iPhone sheet. 7. CLAUDE.md "dot position setting" not found (grep). 8. `chapterNotesBanner.test.tsx`, `verseNotesAggregate.test.ts`, `chapterMyNotes.test.tsx`. 9. SW-UI. 10. Low. 11. C-DATA.

### H05 Cross-translation highlights — absent (documented in CLAUDE.md §15 as a setting) — deferred
1. Highlights are keyed by `text_id` and fetched per `(textId, book, chapter)` (`ChapterView.tsx:709`). No setting or mapping carries them across translations. Offsets would not transfer between texts anyway.
2. `highlightsService.getChapter`. 3–6 n/a. 7. Absence VERIFIED by grep. 8. none. 9. New design needed (anchor by Strong's/word alignment). 10. Don't assume parity. 11. n/a.

### H06 Highlight sync — implemented
1. `highlight` is a synced entity (deterministic ids).
2. `src/platform/sync/entities.ts` (`tableEntity({kind:'highlight'})`). 3. journal. 4–6 X6. 7. Vault export writes highlights as markdown previews, one-way. 8. `engine.integration.test.ts` etc. 9. SW-DATA. 10. Sync port is the hard part. 11. C-DATA.

---

## E. Interface and shell

### U01 Spaces — implemented
1. Five spaces: scripture, notes, lexicon, youtube, search; each with its own tab list; iPhone shows tab types in a switcher, history/settings/calendar as tabs.
2. `src/types/index.ts` (`SpaceId`, `TabType` adds pdf, tags, history, settings, calendar), `Sidebar.tsx` (856), `src/mobile/navigation/{BottomNav,experiences,TabTypeSwitcher}.ts(x)`.
3. `tabs: Record<SpaceId, Tab[]>`. 4. none. 5. persisted as tabs rows. 6. different chrome. 7. `Cmd+1..5` space jump from CLAUDE.md: UNVERIFIED. 8. `tabPlacement.test.ts`, `tabTypeSwitcher.test.ts`, `goToTabHome.test.ts`. 9. SW-UI (sidebar `NavigationSplitView`). 10. Medium. 11. C-HOST.

### U02 Vertical tabs, sessions, archive — implemented
1. Arc-style vertical tab lists, sessions (named tab groups), archived groups, MRU, auto-close, move/duplicate/rename/close others, drag reorder (Mac), tab grid cards (iPhone), saved workspaces.
2. `src/components/shell/{Sidebar,TabBar,TabSwitcher,SessionSwitcher}.tsx`, `src/components/ui/TabStrip.tsx`, `src/mobile/tabs/*`, `src/store/{index,tabPersistence,tabPersistenceRuntime}.ts`, `sessionsService.ts`.
3. Fractional order keys, tombstones. 4. none. 5. `sessions`, `tabs`, `archived_groups` (+ `session_local_state` device-local). 6. drag-reorder pending on iPhone per doc (UNVERIFIED), long-press move exists.
7. Large store coupling; `tabPersistenceRuntime` exists to reconcile store↔DB.
8. 19 store tests (`tabMRU`, `duplicateTab`, `closeTabPrune`, `archivedGroups`, `tabPersistence*`, `workspaceRestore`, …), `sessionsService.contract.test.ts`, `tabSort.test.ts`, `tabOrder.test.ts`, `tabs-reorderDiff.test.ts`, `tabList.test.tsx`, `tabCardsSheetDrag.test.tsx`.
9. SW-DATA + SW-UI; `SessionsService` first. 10. Sync semantics of tab moves. 11. C-DATA.

### U03 Pinned tabs — partial (data only; no setter)
1. `Tab.isPinned` is persisted (`tabs.is_pinned`), synced, and respected by close actions/labels on iPhone, but no code anywhere sets it true (grep of `isPinned:` assignments finds only the readers/serialisers). No pin UI on either platform. (Note pinning is separate and works: `Note.pinned`.)
2. `src/types/index.ts:315`, `tabPersistence.ts:191`, `tabFields.ts:139`, `src/mobile/tabs/TabCardsSheet.tsx`, `TabList.tsx`. 7. dead capability. 8. none. 9. Decide before port. 11. C-DATA.

### U04 Tab and session persistence — implemented
1. Tabs/sessions hydrate from SQLite rows at startup, Zustand persisted to localStorage (debounced 5 s via `debouncedStorage`), flushed before quit/background.
2. `src/store/{tabPersistence,tabPersistenceRuntime}.ts`, `src/lib/debouncedStorage.ts`. 3. dual persistence (localStorage + DB mirror). 4. none. 5. `TabRow` with `local_state_json` excluded from sync. 6. same. 7. Two stores of truth for tab structure (INFERRED risk). 8. `tabPersistence.test.ts`, `tabPersistenceRuntime.test.ts`, `debouncedStorage.test.ts`. 9. SW-DATA. 10. Medium. 11. C-DATA.

### U05 Workspaces and layouts — implemented
1. Saved workspaces (layout + tab snapshot, named "Saved sessions" in UI); 16 Scripture layouts (mosaic trees) with LayoutPicker; per-window layout state.
2. `src/components/bible/LayoutPicker.tsx`, `src/components/shell/PanelLayout.tsx` (react-mosaic-component), `src/lib/workspaceSnapshot.ts`, `workspacesService.ts`, `WorkspacesSection.tsx`, `src/mobile/tabs/WorkspacesPage.tsx`.
3. Mosaic tree JSON in `workspaces.layout_json`. 4. react-mosaic. 5. `workspaces` rows + `scriptureLayout` tab field. 6. iPhone ignores mosaic layout (documented).
7. CLAUDE.md says 6 presets, code has 16. 8. `workspaceRestore.test.ts`, `workspacesService` contract test not found (`workspacesService` has no contract test in the list — VERIFIED absence). 9. SW-UI (`NSSplitView`/`NavigationSplitView` or custom pane manager). 10. Resizable pane layout engine has no direct SwiftUI equivalent. 11. C-DATA.

### U06 Resizable panels, drag and drop — implemented (Mac)
1. Mosaic dividers, panel resize handles, right-panel width, tab drag between spaces/sessions, note drag to folders, block drag in editor.
2. `ResizeHandle.tsx`, `PanelLayout.tsx`, `Sidebar.tsx`, `NotesFolderView.tsx`, `blockHandles.ts`. 3. DOM drag events/react-mosaic. 4. HTML5 DnD. 5. layout JSON. 6. iPhone uses long-press/sheets. 7. none specific. 8. `blockHandles*.test.ts`, `folderTreeGeometry.test.tsx`, `inspectorLayout.test.ts`. 9. SW-UI (`Transferable`, `draggable`). 10. Medium. 11. C-HOST.

### U07 Multi-window, floating panels, presenter/viewer — implemented (Mac only)
1. Synced peer windows, independent windows, floating tab windows, floating hover panel/rail, verse-picker window, Berean Chat window, Study Trail window, presenter/viewer window mirroring the main Bible panel (scroll fraction, outline band, content/settings sync).
2. `electron/main.ts` (window creators ~lines 789–1134), `src/lib/{crossWindowSync,floatingTab,perWindowViewState,presenterBand,presenterOverlay,windowChrome}.ts`, `src/hooks/useViewerSync.ts`, `src/components/viewer/*`, `src/components/bible/PresenterOutline.tsx`, `src/components/shell/{FloatingShell,FloatingRail,FloatingHoverPanel,PresenterControls}.tsx`, `src/types/viewer.ts`.
3. Each window = renderer process + own Zustand store; relay IPC; viewer has its own store and receives payloads.
4. Electron `BrowserWindow`. 5. `ViewerPayload`. 6. iPhone `capabilities` hide these; single scene (`UIApplicationSupportsMultipleScenes=false`).
7. Heavy debug instrumentation hooks (`window.__bereanPresenterDebug`). Pending-save flush when returning a floating tab (`flushPendingSaves`).
8. `presenterBand.test.ts`, `presenterCenteredBand.test.ts`, `presenterPercentForScrollTop.test.ts`, `crossWindowSync.test.ts`, `perWindowViewState*.test.ts`, `floatingTabState.test.ts`, `windowActive.test.ts`.
9. SW-UI: `WindowGroup`/`NSWindow`, scene-based; presenter needs a shared model object across windows (actor). 10. Whole class of behaviours has no iOS equivalent. 11. C-NO between two engines (cross-window state is in-process IPC); retain old app for it.

### U08 Navigation state and history stacks — implemented
1. Per-tab back/forward stacks, origin-tab return, scroll resets, "Study Trail" integration on navigation; `navigateToVerse` single entry point with `NavOrigin`.
2. `src/store/index.ts`, `src/lib/verseNavigation.ts`, `src/lib/navigation/*`, `docs/navigation-contract.md`, `src/mobile/navigation/*`. 3. store actions. 4. none. 5. `TabNavEntry`. 6. iPhone edge-swipe. 7. contract doc must be kept in sync. 8. `perTabHistory.test.ts`, `originTabReturn.test.ts`, `freshBibleTabNav.test.ts`, `scrollByTabNavReset.test.ts`, `edgeBack.test.ts`, `destination.test.ts`. 9. SW-UI (NavigationPath). 10. Medium. 11. C-HOST.

### U09 Menus, context actions, commands — implemented
1. Native macOS app menu built in main (`buildAppMenu`) with actions dispatched to renderer as custom events; command palette list (30 commands); native image menu; iPhone caret command sheet.
2. `electron/main.ts` (line 376), `src/lib/commands.ts`, `src/mobile/commands/*`, `src/App.tsx`.
3. Menu clicks → `berean:*` window events → panel-local handlers. 4. Electron Menu. 5. command ids. 6. iPhone has no menu bar; hardware-keyboard shortcuts "NOT STARTED" per doc. 7. Event-bus coupling by string names (INFERRED fragility). 8. `commands.test.ts`, `caretGoTo.test.tsx`, `TabBarContextMenu.test.tsx`. 9. SW-UI (`Commands`, `CommandMenu`). 10. Event names are an undocumented contract among components. 11. C-HOST.

### U10 Keyboard shortcuts — partial
1. Global handler in `App.tsx` (19 meta-key references) plus panel-local handlers; shortcut list shown in Onboarding and Settings (read-only); CLAUDE.md table (Cmd+1–5, Cmd+Shift+L, etc.) is only partly verified.
2. `src/App.tsx`, `src/lib/commands.ts`, `src/components/shell/ShortcutKeys.tsx`, onboarding `StepShortcuts`. 3. keydown handlers. 4. none. 5. n/a. 6. Mac only; iPad deferred. 7. No shortcut editing (documented deferred). Individual shortcut parity with CLAUDE.md UNVERIFIED. 8. `menuKeyNav.test.ts`, `keymap.test.ts` (editor only). 9. SW-UI `.keyboardShortcut`. 10. Low. 11. C-HOST.

### U11 Themes and appearance — implemented
1. 38 theme presets (family-grouped, light/dark variants, optional ambient animation), custom themes, contrast helpers, accent colour from system, reduce-transparency/increase-contrast hooks, Liquid Glass on Mac (native addon) and iPhone (plugin), design-system doc.
2. `src/lib/{themePresets,customTheme,applyTheme,contrast}.ts`, `src/components/settings/{ThemePicker,ThemePreviewCard}.tsx`, `src/platform/liquidGlass/*`, `native/mac-liquid-glass/berean_glass.m`, `BereanGlassPlugin.swift` (492 lines), `docs/{design-system,liquid-glass}.md`.
3. CSS variables on `<html>` class; native shim for glass. 4. macOS 26+ glass APIs (INFERRED). 5. theme ids in settings. 6. Glass bridges differ. 7. 2 s theme poll noted in perf doc. 8. `customTheme.test.ts`, `liquidGlass.test.tsx`, `liquidGlassShell.test.ts`, `glassPressRecipe.test.ts`. 9. SW-UI with asset catalog/`Color`; many themes become a theme engine. 10. Medium (38 presets). 11. C-HOST.

### U12 Settings — implemented
1. Settings modal (Mac) with ~16 sections (Display, Texts, Layout, Notes, YouTube, Audio, iCloud, Updates, History, Print/Export, Sessions, Workspaces, Import, Word replacer, Ask Berean/Local models, Experimental, About, Danger) and iPhone pages.
2. `src/components/settings/*`, `src/mobile/settings/*`. 3. store-backed switches; `settings` table. 4. none. 5. `settings(key,value JSON)`; many prefs only in localStorage. 6. different pages. 7. SettingsModal is a very large monolith (INFERRED). 8. `settings/sections/__tests__` exists; `settingsService.contract.test.ts`, `searchSettingsHistory.test.ts`. 9. SW-UI `Settings` scene + `Form`. 10. Prefs migration (S11). 11. C-HOST.

### U13 Onboarding and hints — partial
1. First-run wizard (welcome, translation, vault, import, Ask Berean model step, shortcuts, done); iPhone 4-page flow incl. iCloud opt-in. CLAUDE.md's per-feature hint tooltips with "Don't show again" are not present (grep for hint/dismiss state finds none).
2. `src/components/shell/{Onboarding,OnboardingModelStep}.tsx`, `src/mobile/onboarding/*`, `TasksPanel.tsx` (first-steps checklist, Mac only). 3. flags in store. 4. none. 5. `onboardingCompleted`. 6. different flows; no Tasks panel on iPhone. 7. Hints absent. 8. `Onboarding.maybeImportVault.test.ts`, `OnboardingModelStep.test.tsx`. 9. SW-UI. 10. Low. 11. C-HOST.

### U14 Study Trail — implemented
1. Records navigation as a graph (sessions, nodes, connections), reason-prompt popovers on chapter jumps, arrival prompt eligibility rules, map/threads/everything/search views, sticky notes, tags, merge/split, recap, embeds in notes (`study_trail_embed` node), own window (Mac) and page (iPhone, hosting the desktop views).
2. `src/store/studyTrailSlice.ts` (1091), `src/platform/services/studyTrailService.ts` (1223), `electron/ipc/studyTrail.ts`, `src/components/studyTrail/*` (MapView, StudyTrailApp, …), `src/lib/studyTrail/arrivalEligibility.ts`, `src/mobile/trail/*`, migrations v28–40.
3. Recorder installed on store; graph layout in `trailGraph.ts`; SVG connector overlay. 4. none external. 5. `trail_*` tables synced as entities; `trail_embeddings` table exists (usage UNVERIFIED). 6. Mac separate window; iPhone page.
7. Several `stub` mentions inside trail components (grep) — INFERRED placeholders. Not in CLAUDE.md.
8. `studyTrailSlice.test.ts`, `arrivalEligibility.test.ts`, `trailGraph.test.ts` (two copies), `studyTrailEmbed.test.ts`, `chapterNotes`-adjacent. No service contract test for `studyTrailService` in the list (VERIFIED absence: only aiChats/bible/crossrefs/highlights/history/lexicon/notes/playlists/research/savedContexts/sessions/settings/studyProfiles/tagGraph contract tests).
9. SW-DATA + SW-UI (Canvas/SpriteKit-like pan/zoom map). 10. High: custom graph UI; 1223-line service untested by contract tests. 11. C-DATA / C-HOST.

### U15 Tasks panel and first steps — implemented (Mac only)
1. Checklist of first steps. 2. `src/components/shell/TasksPanel.tsx`. 3–5 trivial. 6. no iPhone equivalent (VERIFIED: only desktop references). 7. none. 8. none. 9. SW-UI. 10. Low. 11. C-HOST.

### U16 Tags and tag graph — implemented
1. Verse tags (named, coloured, member refs as spans), chapter-tag narrowing, tag manager, tag graph with force layout, edges with editor, co-occurrence, search by tag, tagged verse browsing.
2. `src/platform/services/{verseTagsService,tagGraphService}.ts`, `electron/ipc/{verseTags,tagGraph}.ts`, `src/components/tags/*`, `src/lib/{tagPalette,verseTagRanges,verseTagSearch,tagRefScan}.ts`, `src/mobile/study/TagPickerSheet.tsx`. 3. members expanded to `verse_tag_verse` index (rebuilt on sync apply). 4. custom force layout (`tagForceLayout.ts`). 5. `verse_tags`, `verse_tag_members`, `verse_tag_verse`, `tag_edges`. 6. iPhone hosts the same graph canvas in a tab with pinch/pan (code in `MobileApp.tsx`; doc says NOT STARTED — doc stale). 7. Not in CLAUDE.md. 8. `tagGraphService.contract.test.ts`, `tagForceLayout.test.ts`, `verseTagRanges.test.ts`, `verseTagSearch.test.ts`, `tagPalette.test.ts`, `tagRefScan.test.ts`. 9. SW-DATA + SW-UI (Canvas). 10. Medium. 11. C-DATA.

### U17 PDFs — partial
1. Library with import (dialog on Mac; file input on iPhone), pdf.js viewer, find bar, highlights, bookmarks, outline, copy-link `berean://pdf/<id>/<page>`; metadata synced, bytes not; Mac files in `userData/pdfs/<id>.pdf`; iPhone `Library/Berean/pdfs`. Feature-flagged (`pdfFeatureEnabled`, Settings → Experimental).
2. `src/components/pdf/*`, `electron/ipc/pdf.ts`, `src/platform/services/pdfService.ts`, `src/lib/pdfjs.ts`, `src/platform/ios/bridgeExtras.ts` (`pdf`), iPhone `PdfLibraryPage` in `MobileApp.tsx`, Share Extension PDF intake.
3. pdfjs-dist in renderer; hash-matching of synced metadata to local files. 4. pdfjs-dist ^4. 5. `pdfs`, `pdf_highlights`, `pdf_bookmarks`; file hash. 6. iPhone "Files import arrives with the PDF phase" text still in the empty-state (VERIFIED string) though file-input import code exists; "PDF library" row is shown regardless of the flag (documented FOLLOW-UP in `ExperimentalSettingsPage.tsx`, status of fix: row has `pdfFeatureEnabled &&` at MobileApp line 416, so fixed in one list and not in the other — INFERRED partial).
7. Bytes never sync (documented). 8. none for pdf components; `bereanMigrations` v11/v46 only. 9. SW-UI with PDFKit (`PDFView`) — a strong native fit; highlights via `PDFAnnotation`. 10. Highlight geometry must map from pdf.js text-layer coordinates to PDFKit selections (INFERRED, medium). 11. C-DATA.

### U18 Berean Chat (notes-style chat) — implemented
1. A Messages-style notes/chat surface using `ai_chats` rows; list, days, conversations, folders, search, reply quotes, composer (ProseMirror), find in conversation, window or tab; iPhone page and Home Screen widget "New Message".
2. `src/components/ailookup/*`, `src/mobile/chat/*`, `ios/App/BereanWidget/BereanChatWidget.swift`, `src/platform/services/aiChatsService.ts`, `docs/berean-chat.md`.
3. Chat transcript virtualised, windowed find (perf-fixed). 4. ProseMirror composer. 5. `ai_chats` rows synced (messages inside JSON). 6. Mac window + tab; iPhone page + widget. 7. whole-row sync for long conversations (INFERRED size risk). 8. 23 tests under `ailookup/__tests__`, `aiChatsService.contract.test.ts`, `aiChatSync*.integration.test.ts`. 9. SW-UI + SW-DATA; composer = SW-EDIT lite. 10. Medium. 11. C-DATA.

---

## F. Media

### M01 YouTube browsing and playback — implemented
1. Mac: Electron `<webview persist:youtube>` for login/browse/watch, allow-listed channel feed (hard-coded `CHANNELS` array of 15+ handles in `electron/ipc/youtube.ts`), feed fetched by scraping channel pages (`executeJavaScript(EXTRACT_JS)` in hidden windows), search videos, stars, watch history, resume positions, 11 layouts with secondary panels (notes/scripture/lexicon beside video). iPhone: native `WKWebView` overlay (`BereanWebViewPlugin`) loading the embed from an https base because the embed refuses the `capacitor://` origin; IFrame API relays position and end.
2. `src/components/youtube/{YouTubeTab(2763),YouTubeSecondaryPanel,TouchYouTubePlayer,TranscriptViewer}.tsx`, `electron/ipc/youtube.ts` (1428), `src/platform/services/{youtubeService,youtubeFetchService,youtubeIndexMerge}.ts`, `src/lib/{youtubeLayouts,youtubeSearch,youtubeTitle}.ts`, `BereanWebViewPlugin.swift`.
3. Scraping + `webRequest.onCompleted` hooks for transcripts; muted hidden windows. 4. YouTube HTML structure, `electron/youtube-key.ts` (gitignored API key file; exists in the audit checkout; value not read). 5. `youtube_videos`, `youtube_watch_history`, `youtube_user` (synced), playlists. 6. See 1.
7. Scraping is brittle and a ToS exposure; CLAUDE.md claims a user-editable allowlist with add-channel prompt, but channels are hard-coded (VERIFIED). WebKit blocks programmatic PiP without a user gesture (iPhone doc). The `webviewTag: true` line carries a stale comment saying it is disabled in MAS.
8. `youtubeSearch.test.ts`, `youtubeTranscriptCore.test.ts`, `playlistsService.contract.test.ts`; no tests for YouTubeTab; `youtubeFetchService` untested (VERIFIED absence).
9. SW-UI with `WKWebView`/YouTube IFrame; scraping logic ported as URLSession + parser, or dropped in favour of the Data API. 10. High: platform-policy and fragile scraping. 11. C-HOST.

### M02 Picture-in-Picture — partial
1. Mac auto-PiP: when leaving the YouTube space with a playing video and `autoPiP` on, `webview.executeJavaScript` calls `video.requestPictureInPicture()`; returning exits it; Cmd+Shift+P toggles; tested only manually. `PiPController.tsx` is a dead stub returning null ("Phase 4 stub") — abandoned file. iPhone: system PiP only from the native player's fullscreen controls (no auto-PiP).
2. `src/components/youtube/{YouTubeTab.tsx (~1099–1140),PiPController.tsx}`, `src/store/index.ts` (`autoPiP`). 3. DOM PiP API inside the embedded page. 4. Chromium/WebKit. 5. setting `autoPiP`. 6. as above. 7. depends on YouTube page DOM. 8. none. 9. `AVPictureInPictureController` over an `AVPlayer` is not possible with YouTube embed (no stream URL); WKWebView PiP only. 10. Parity impossible without owning the stream. 11. C-HOST.

### M03 Video-linked notes and timestamps — implemented
1. Insert `[Title — mm:ss](https://youtu.be/ID?t=N)` into the active note (Cmd+Shift+L on Mac; "Insert video timestamp" action on iPhone), notes beside video, `berean://video/<id>?t=` deep links, transcript click seeks.
2. `YouTubeTab.tsx` (`insertTimestamp` ~1487), `NoteEditorPM.tsx` listener, `deepLinks.ts`, `NoteEditorPage`. 3. window events `berean:requestTimestamp`/`berean:insertTimestamp`. 4. none. 5. markdown link text. 6. both. 7. CLAUDE.md timestamp-format setting not found. 8. `deepLinks.test.ts`, `deepLinkDedupe.test.ts`; no timestamp-insert test found. 9. SW-DATA + SW-UI. 10. Low. 11. C-HOST.

### M04 Transcripts and transcript search — implemented (dev-fetch model)
1. Transcripts for allow-listed channels are fetched in dev builds only (`fetchTranscripts`/`clearTranscripts` gated by `is.dev` and `devToolsEnabled`), baked into `youtube_seed.db`, shipped read-only; FTS5 over transcript segments; synced transcript viewer with seek; iPhone downloads per-channel transcript packs (resumable, SHA-256 verified via `BereanDownloadsPlugin`) and merges them into the local DB.
2. `electron/ipc/{youtube,youtubeTranscriptCore}.ts`, `scripts/export-transcript-seed.js`, `scripts/data/split-youtube-seed.mjs` (referenced), `src/mobile/youtube/{transcriptPacks.ts,TranscriptPacksPage.tsx}`, `BereanDownloadsPlugin.swift`, `youtubeIndexMerge.ts`.
3. `youtube_transcripts`, `youtube_transcript_segments`, FTS5 triggers; 4.06 M segments in the author's DB per perf doc. 4. Network at dev time. 5. segments `(start_ms, dur_ms, text)`. 6. iPhone packs from a configurable base URL (default host UNVERIFIED). 7. Production users cannot refresh transcripts (by design, memory). Scraping legality UNVERIFIED. 8. `youtubeTranscriptCoreTest`, `youtubeService` contract not present (only playlists contract test). 9. SW-DATA; port the pack downloader (URLSession background). 10. Large data movement; 196 MB seed. 11. C-DATA.

### M05 Read Aloud engine (Kokoro) — implemented
1. Chapter/passage speech with Kokoro-82M (ONNX q8) in a Web Worker on Mac; chunking by sentences, audio cache (`tts-audio-cache` PCM + LRU index), pitch-preserving playback rate via `HTMLAudioElement.preservesPitch`, voice picker with tiers, queue/playlists, progress bar, cross-window sync, auto-advance. iPhone: native ONNX Runtime synthesis (`BereanVoicePackPlugin.synthesize`, `onnxruntime-swift-package-manager` 1.24.2) with voice pack download, plus the curated Apple voices fallback (`BereanSpeechPlugin`).
2. `src/lib/tts/{ttsEngine,ttsBackend,textPrep,extractSpokenText,nativeSpeechBackend}.ts`, `src/lib/tts/kokoro/*`, `src/hooks/{useTTSPlayback,useKokoroModelDownload}.ts`, `src/components/audio/*`, `electron/ipc/{ttsModel,ttsAudioCache}.ts`, `electron/{ttsModelManifest,ttsModelProtocol}.ts`, `src/mobile/audio/*`, `ios/.../{BereanVoicePackPlugin,BereanSpeechPlugin,BereanAudioPlugin}.swift`, `docs/mobile/voices.md` (stale).
3. Worker + Web Audio on Mac; iOS plugin synthesises from ids/style tensors computed in JS (`voicePack.ts` line ~79) — phonemisation stays in JS. 4. kokoro-js/transformers.js, onnxruntime-web (Mac), onnxruntime (iOS), voice pack from Hugging Face (`onnx-community/Kokoro-82M-v1.0-ONNX`, third-party). 5. cache key `cacheKeyFor()`; model manifest. 6. Mac requires one-time download (Web Speech backend removed); iPhone offers Apple voices too. 7. `docs/mobile/voices.md` says iOS Kokoro is future work (stale). On-device performance and memory not measured (BLOCKED). The CSP carries a narrow `wasm-unsafe-eval` carve-out for the worker.
8. `ttsEngine.test.ts`, `textPrep.test.ts`, `extractSpokenText.test.ts`, `kokoroChunking.test.ts`, `kokoroVoices.test.ts`, `timestampAlignment.test.ts`, `audioCacheStore.test.ts`, `modelDownloadState.test.ts`, `ttsModelManifest.test.ts`, `ttsModel.test.ts`, `bereanVoices.test.tsx`, `nativeSpeechBackend.test.ts`.
9. SW-DATA: phonemiser (espeak-ng/misaki port) is the blocker — `kokoro-js` phonemises in JS; native port needs an equivalent G2P (new work); synthesis via ONNX Runtime/Core ML; playback via `AVAudioEngine`. 10. High: G2P parity and voice quality. 11. C-DATA (cache not shared).

### M06 Audio playback, seeking, queue and background — implemented
1. Pause/resume, rate, skip verse, queue popover, saved playlists with autosave of the queue (800 ms debounce), sleep timer (iPhone), chapter progress bar seeking, lock-screen Now Playing and remote commands via `BereanAudioPlugin` (`.playback` category, `UIBackgroundModes: audio`).
2. `src/components/audio/*`, `src/hooks/useQueueAutosave.ts`, `src/mobile/audio/{AudioBar,AudioSheet,QueuePage,audioControls,followState,sleepTimer,useIosAudioSession}.ts(x)`, `playlistsService.ts`. 3. store playback state; plugin events. 4. AVAudioSession/MediaPlayer. 5. `playlists`, `playlist_items`. 6. background audio iPhone only; Mac window app has no media-key integration found (UNVERIFIED). 7. Sleep timer appears in docs only once (undocumented). 8. `audioFollowAndControls.test.tsx`, `audioSleepTimer.test.ts`, `audioQueueRef.test.ts`, `playlistsService.contract.test.ts`. 9. SW-UI + `AVAudioEngine`, `MPNowPlayingInfoCenter`. 10. Medium. 11. C-DATA.

### M07 Word-follow highlighting — implemented (estimated, not forced alignment)
1. Per-word highlight during playback by distributing each chunk's real audio duration proportionally over characters (`timestampAlignment.ts` header says Kokoro does not expose alignment; the timestamped model variant was not adopted); Apple voices use `boundary` events with char offsets.
2. `src/lib/tts/kokoro/timestampAlignment.ts`, `nativeSpeechBackend.ts`, `VerseRow.tsx`, `src/mobile/audio/followState.ts`. 3. char-position map from tagged tokens (`taggedTokenCharPos`). 4. none. 5. n/a. 6. same. 7. Drift on long chunks (INFERRED from method). 8. `timestampAlignment.test.ts`, `audioFollowAndControls.test.tsx`. 9. SW-TEXT; use `AVSpeechSynthesizer` callbacks or a forced-alignment model. 10. Needs the same highlight coordinates as S04. 11. C-DATA.

### M08 Voice downloads and caching — implemented
1. Mac: opt-in pack download into `userData/tts-models` (temp dir + atomic rename, size-verified), served to the worker via `berean-model://` protocol; iPhone: sequential file download to `Application Support/Berean/tts-models` with background task and manifest written last; audio cache LRU with size cap on Mac.
2. `electron/ipc/ttsModel.ts`, `electron/ttsModelProtocol.ts`, `BereanVoicePackPlugin.swift`, `src/platform/ios/voicePack.ts`, `src/lib/tts/kokoro/{audioCacheStore,modelDownloadState}.ts`. 3. fetch/URLSession. 4. Hugging Face hosting. 5. manifest file list from `ttsModelManifest.ts` shared by both. 6. Mac uses size checks only; iPhone no SHA check in this path (INFERRED; `BereanDownloadsPlugin` has SHA but this plugin is separate). 7. `electron/downloads/modelDownloader.ts` (resumable + SHA-256 + disk check) is referenced only by its own test (VERIFIED) — an unused production module (abandoned or pending). 8. `ttsModel.test.ts`, `ttsModelManifest.test.ts`, `modelDownloader.test.ts`, `audioCacheStore.test.ts`. 9. SW-DATA with `URLSession` background downloads. 10. Third-party host dependency. 11. C-DATA.

### M09 Sleep timer (iPhone) — undocumented
1. Read Aloud sleep timer with presets; stops playback at expiry.
2. `src/mobile/audio/sleepTimer.ts`, `AudioSheet.tsx`. 3. timer state in the audio sheet. 4. none. 5. none persisted (INFERRED). 6. iPhone only. 7. Only one file in `docs/` mentions it (grep). 8. `src/mobile/__tests__/audioSleepTimer.test.ts`. 9. SW-UI + `AVAudioPlayer`/engine stop. 10. Low. 11. C-HOST.

---

## G. Ask Berean (status per `docs/ai-upgrade/SPEC_STATUS.md`, re-checked in code)

Architecture common to G items (VERIFIED): renderer `ChatComposer` → `useChatController` → on Mac IPC `ailookup:query` into `electron/ipc/aiLookup.ts` (4156 lines) with deterministic resolvers in `src/lib/research/*` (pure TS), model calls through `electron/modelGateway.ts` (local Ollama at `http://localhost:11434` via `electron/ollama.ts`, or a cloud route from `electron/ipc/aiProviders.ts`), results typed `AiLookupResponse`. On iPhone only the model-free path runs: `src/platform/services/modelFreeLookup.ts` + `researchService.ts` in the renderer. No bundled inference runtime exists anywhere (grep for llama.cpp/node-llama finds nothing).

### G01 Direct references and Strong's without a model — implemented (statuses: SPEC "Complete")
1. John-3:16-style references, Strong's ids, lexical studies (forms, glosses), word tables, occurrence counts, comparisons (e.g. two Strong's), follow-up resolution ("now only Greek", "the second") — answered from DBs with no model; keyword fallback labelled `NO_MODEL_INSTALLED`.
2. `src/platform/services/{modelFreeLookup,researchService}.ts`, `src/lib/research/{references,strongsId,lexicalIntent,compareIntent,compareWords,conversationState,exclusions}.ts`, `src/components/ailookup/{ComparisonView,ResearchResults}.tsx`.
3. Pure functions + services. 4. none. 5. `AiLookupResponse`, `ResearchResult` payloads. 6. Same code on both; SPEC_STATUS cites simulator-only verification on iPhone (not a device).
7. Intent detection is regex/heuristic; coverage limited to patterns tested.
8. `researchService.realdata.test.ts` (reads real DBs), `modelFreeLookup.realdata.test.ts`, `lexicalIntent.test.ts`, `compareIntent.test.ts`, `conversationState.test.ts`, `strongsId.test.ts`, `exclusions.test.ts`, `comparisonView.test.tsx`, `researchResults.test.tsx`.
9. SW-DATA (port `src/lib/research` and services). 10. Regex-heavy; golden tests transfer. 11. C-DATA.

### G02 Local model runtime (Ollama), model picker, downloads — partial
1. Requires the user's own Ollama on `localhost:11434`; model list, pull with progress, cancel, remove, catalog of 5 models (qwen3.5:2b, gemma4:12b-it-qat, llama3.1, llama3.2:3b, ministral-3:3b) with tiers; Automatic ordering and memory-gated escalation for Deep Search; onboarding model step. The resumable SHA-verified downloader (`modelDownloader.ts`) is NOT wired (VERIFIED); pulls go through Ollama's `/api/pull`. No bundled runtime or model; a full new download was not tested (SPEC_STATUS).
2. `electron/{ollama,modelGateway}.ts`, `electron/ipc/aiModels.ts`, `src/lib/research/{modelCatalog,modelChoice,modelRouting}.ts`, `src/components/settings/sections/LocalModelsSettings.tsx`, `OnboardingModelStep.tsx`.
3. HTTP to localhost; MAS forbids `network.server` and `disable-library-validation` (PLAN.md, `verify-mas.mjs`), so a bundled llama-server helper is not viable as-is; in-process Node-API addon is a possibility. 4. Ollama (external install). 5. Model ids. 6. Mac only; iPhone has no local model (BLOCKED, device + approval). 7. Whether the App Store build can reach `localhost:11434` under `network.client` only: UNVERIFIED. SPEC_STATUS scenarios 28/29 BLOCKED (provisioning profile, installer certificate, model-download approval).
8. `aiModels.test.ts`, `modelCatalog.test.ts`, `modelChoice.test.ts`, `modelRouting.test.ts`, `ollama.thinking.test.ts`, `modelGateway.test.ts`, `localModelsUi.test.tsx`, `modelDownloader.test.ts`.
9. Native replacement: MLX/llama.cpp in-process or Core ML; Foundation Models on newer OS (INFERRED). New runtime, not a port. 10. Highest uncertainty in the product: licensing (`RUNTIME_LICENSE.md`), memory, App Review. 11. C-NO for model runtime until chosen; services can be coexisting.

### G03 Ask Berean modes (Commentary ON/OFF), prose stripping, premise check — implemented (ON partial)
1. Commentary OFF strips interpretive prose in the main process and shows references only; ON adds model commentary (prompt-level, adaptive depth); premise check and its notice; "interpretation offered" prompt; nonexistent-reference scrubbing (`removeNonexistentReferences`).
2. `electron/ipc/aiLookup.ts`, `src/lib/research/{modePolicy,commentaryDepth,premise,outputGuard,policy}.ts`, `src/store/aiModeMigration.ts`, `src/components/ailookup/chatModes.ts`.
3. Policy + guard + prompt. 4. model. 5. mode flags in store (persist migration v8). 6. Mac only for model-backed output. 7. SPEC_STATUS: Commentary ON quality "Partial" (generic "historical setting", no named perspectives; one 2B model gave a wrong claim on the Sabbath verses — doc claim). Human review set has no entries (BLOCKED). The user's own instruction forbids model interpretations of verses; the Commentary ON mode produces interpretations by design (product decision, flagged for the owner).
8. `modePolicy.test.ts`, `commentaryDepth.test.ts`, `premise.test.ts`, `outputGuard.test.ts`, `policy.test.ts`, `aiModeMigration.test.ts`, `aiLookup.verifyGeneratedText.test.ts`, `aiLookup.runCritique.test.ts`.
9. SW-DATA for policy; prompts portable as strings. 10. Prompt/behaviour regression without a human review set. 11. C-DATA.

### G04 Deep Search, escalation, cancel and time budgets — implemented (Mac), partial (budgets)
1. Multi-round retrieval with refine pass, automatic larger-model escalation (installed, local, Deep Search only, memory-gated: `chooseLocalModel(…, totalMemoryBytes)` verified), Stop/cancel via `ailookup:cancel` and `AbortSignal`, findings view; budgets are per-call timeouts only (120 s for large models); no per-question budget.
2. `electron/ipc/aiLookup.ts` (`agentic` option, line ~2668/2691), `electron/modelGateway.ts` (cancellable, `LARGE_MODEL_TIMEOUT_MS = 120_000`), `src/components/ailookup/ResearchFindings.tsx`, `electron/tokenBudget.ts`.
3. AsyncLocalStorage per request. 4. Ollama. 5. n/a. 6. Mac only. 7. No iPhone Deep Search (needs model). Memory-gating measured on 32 GB only (SPEC).
8. `tokenBudget.test.ts`, `aiLookup.routing.test.ts`, `aiLookup.scopeDetection.test.ts`, `partialResults.test.ts`, an end-to-end timeout/cancel test per SPEC (location UNVERIFIED).
9. Swift concurrency (`Task` cancellation) maps cleanly. 10. Behavioural tuning tied to specific model families. 11. C-NO until model runtime chosen.

### G05 Collections, study profiles, saved contexts, memory — implemented
1. Collections (canon, apocrypha, pseudepigrapha, fathers, notes, etc.), study profiles (per-profile model, scope, mode, instructions) with Mac and iPhone UI, explicitly saved research contexts, cross-chat memory only by explicit save, profile instructions with no adversarial test set.
2. `src/lib/research/{collections,studyProfile}.ts`, `src/platform/services/{studyProfilesService,savedContextsService}.ts`, `src/components/ailookup/{useStudyProfiles,profileActivation}.ts`, `src/mobile/chat/AskOptionsPage.tsx`, `src/mobile/settings/AskBereanSettingsPage.tsx`; migration v49.
3. Rows synced (`study_profile`, `ai_saved_context`). 4. none. 5. rows with tombstones. 6. a profile edited on the other device may need re-selecting (SPEC). 7. no adversarial test set. 8. `studyProfilesService.contract.test.ts`, `savedContextsService.contract.test.ts`, `profilesUi.test.tsx`, `collections.test.ts`. 9. SW-DATA. 10. Low. 11. C-DATA.

### G06 Verse-note influence and note exclusion — partial
1. Notes can be excluded (note or folder) and are never used; an excluded note is never sent; verse notes add a fixed ranking boost and referenced verses feed retrieval; Mac only; "notes never outrank text"; injected-note scenario tested.
2. `src/lib/research/noteExclusion.ts`, `aiLookup.ts`, `notesService.setAiExcluded/folderSetAiExcluded`, `docs/ai-upgrade/SPEC_STATUS.md` decisions 16/22.
3. fixed boost, not context-tuned. 4. none. 5. `ai_excluded` flags. 6. unused on iPhone. 7. SPEC: partial. 8. `noteExclusion.test.ts`, `noteMarkdownFile.aiExcluded.test.ts`, `aiLookup.decideNotesAreLead.test.ts`. 9. SW-DATA. 10. Privacy-critical: exclusion must hold in every code path. 11. C-DATA.

### G07 Cloud model (BYO key) — partial (Mac), not implemented (iPhone)
1. Anthropic only (`providers.ts` registers `id: 'anthropic'`); key saved via Electron `safeStorage` (Keychain-backed) into `provider-keys.json` (base64 ciphertext, 0600), never sent to the renderer; routing is explicit-opt-in (`cloudEnabled`, key + model set, policy allows, never as a response to local failure); private-context flag; mocks only — no real call was made (SPEC_STATUS: "Done, unverified by hand").
2. `electron/secrets/{providerKeys,providerSettings}.ts`, `electron/ipc/aiProviders.ts`, `src/lib/research/{providers,policy}.ts`, `src/components/ailookup/cloudSettingsUi` tests, `SUBSCRIPTIONS.md`.
3. `net.fetch` from main. 4. Anthropic API; macOS Keychain via Electron. 5. `provider-keys.json`. 6. iPhone: no Keychain code anywhere in `ios/` or `src/` (grep, VERIFIED) so cloud on iPhone is absent (SPEC agrees).
7. ChatGPT plan connection and general web search blocked on decisions (SPEC). Key format validation is length/whitespace only.
8. `providerKeys.test.ts`, `providerSettings.test.ts`, `providers.test.ts`, `cloudSettingsUi.test.tsx`, `aiNoLogging.test.ts`.
9. SW-DATA with Keychain Services (`SecItem`), URLSession. 10. Migrating existing safeStorage keys is impossible without the old Electron key; users must re-enter keys (INFERRED). 11. C-NO for key sharing.

### G08 Online research (Wikipedia, Sefaria) — partial
1. Keyless Wikipedia and Sefaria queries; only content words leave the device; results rendered as labelled cards, never fed to a model prompt; Commentary OFF shows title+link only; default off, ask, or automatic with Deep Search; implemented on both platforms; general web search blocked on a provider decision.
2. `src/lib/research/webResearch.ts`, `electron/ipc/aiProviders.ts`, `src/platform/ios/{bridgeExtras,onlineResearchSetting}.ts`. 3. fetch via `net.fetch` (Mac) / CapacitorHttp (iPhone). 4. Wikimedia/Sefaria APIs. 5. `ExternalSource`. 6. iPhone real search in simulator only (SPEC). 7. Live API shape probed once (SPEC); no contract tests against live services (by design).
8. `webResearch.test.ts`, `researchWeb.test.ts`, `aiProviders.web.test.ts`, `onlineResearch.test.ts`. 9. SW-DATA with URLSession. 10. API drift. 11. C-DATA.

### G09 Retrieval benchmark and evaluation harness — implemented (dev tooling)
1. Case files, holdout (`HOLDOUT.lock`), retrieval eval and semantic eval scripts; SPEC says no fresh independent holdout so no new independent quality claim.
2. `scripts/eval/*`, `docs/ai-upgrade/*`. 3–5 offline; 6. Mac dev only. 7. Human-review page has no entries (SPEC). 8. harness itself is the test (`vitest.eval.config.ts`). 9. Rebuild eval in Swift test target or keep Node tooling. 10. Needed to prove parity. 11. C-DATA.

### G10 iPhone Ask Berean (model-free) — partial
1. On iPhone the Ask surface runs only the deterministic path (G01), profile/scope/mode screens, saved context, online research; no local model, no cloud model, no Deep Search (SPEC: "Partial; Local model blocked").
2. `src/mobile/chat/{ChatPage,AskOptionsPage}.tsx`, `src/platform/ios/bridgeExtras.ts` (`aiLookup`). 3. renderer. 4. none. 5. same chat rows. 6. see 1. 7. low-memory behaviour BLOCKED. 8. `chatController.test.tsx`. 9. SW-UI + services. 10. Foundation Models/MLX decisions. 11. C-DATA.

---

## H. Apple ecosystem

### A01 iCloud sync (journal) — implemented, device matrix BLOCKED
1. See X6. Per-device folder under the ubiquity container (`Documents/sync/v1`), HLC-ordered ops, snapshots/compaction, conflict records, holds on account/container mismatch, identity isolation (prod vs dev containers).
2. `src/platform/sync/*`, `electron/sync/*`, `native/mac-icloud/berean_icloud.m`, `BereanCloudPlugin.swift`, `src/platform/ios/{cloudSyncStore,syncHost}.ts`, `src/components/settings/sections/ICloudSection.tsx`, `docs/mobile/{icloud,sync,icloud-lifecycle,data-safety}.md`.
3. Engine is TS shared by both; transports differ. 4. iCloud Drive, entitlements `com.apple.developer.icloud-container-identifiers`, `NSUbiquitousContainers`. 5. op format X6. 6. Mac DMG: plain fs under `~/Library/Mobile Documents/iCloud~com~berean~app`; MAS: Node-API container call; iPhone: coordinated reads.
7. Real-iCloud device matrix pending (docs) — BLOCKED; engine tested with a simulator (`icloudDriveSim.ts`). Uses iCloud Drive files not CloudKit (no push; polling + metadata query). `1404`-line engine.
8. `engine.integration.test.ts`, `chaos.fuzz.test.ts`, `dataSafety.integration.test.ts`, `lifecycle.integration.test.ts`, `liveSync.test.ts`, `merge.test.ts`, `hlc.test.ts`, `journal.test.ts`, `hostCore.test.ts`, `fractional.test.ts`, `tabFields.test.ts`, `fsSync.integration.test.ts`, `fsSyncStore.test.ts`, `devIsolation.test.ts`, `cloudSyncStore.test.ts`, `cloudPluginMainThread.test.ts`.
9. SW-DATA: port engine to Swift (large, correctness-critical) or keep sync engine in JS-core via JavaScriptCore during transition; alternatively adopt CloudKit/SwiftData (new design, not compatible with journal). 10. Highest data-loss risk in the migration. 11. C-DATA is the key coexistence enabler: a Swift app that speaks the same journal can interoperate with the current apps.

### A02 Keychain / secure storage — partial
1. Mac: `safeStorage` for BYO cloud keys only. No other secrets. `electron/youtube-key.ts` is a build-time gitignored file (YouTube Data API key) embedded in the app (value never read; whether bundled into the renderer is UNVERIFIED). iPhone: none.
2. `electron/secrets/*`, `electron/youtube-key.example.ts`. 3–6 above. 7. Embedding an API key in a shipped binary is extractable (INFERRED). 8. `providerKeys.test.ts`. 9. Keychain Services. 10. Key migration impossible. 11. n/a.

### A03 App Groups and Share Extension — implemented (iPhone)
1. Share Sheet extension collects text (reference → open passage, other text → note), URLs (YouTube → video), PDFs into the App Group inbox then opens `<scheme>://share`; the app's `BereanShareInboxPlugin` hands items to the deep-link router.
2. `ios/App/ShareExtension/{ShareViewController.swift,Info.plist,ShareExtension.entitlements}`, `BereanShareInboxPlugin.swift`, `src/platform/ios/shareInbox.ts`. 3. App Group container files. 4. App Group id from `$(BEREAN_APP_GROUP)`. 5. inbox JSON items. 6. iPhone only. 7. crash-safe inbox hardening documented; device behaviour BLOCKED. 8. `shareInbox.test.ts`. 9. SW-UI native extension is already native Swift; reuse. 10. Low. 11. C-DATA (shares group with any new app that keeps the identifiers).

### A04 Spotlight — implemented (iPhone)
1. Core Spotlight index of notes, sessions, workspaces, books and chapters; deep link ids; incremental on `data:changed`; verses not indexed.
2. `BereanSpotlightPlugin.swift`, `src/platform/ios/spotlight.ts`. 3. `CSSearchableIndex`. 4. CoreSpotlight. 5. identifier = deep link URL. 6. none on Mac. 7. none. 8. none found. 9. Already native Swift; trivial to keep. 10. Low. 11. C-DATA.

### A05 App Intents and Siri Shortcuts — implemented (iPhone)
1. Intents: Open Scripture, Search Berean, Open Daily Note, Read Aloud, Open Workspace (and more past line 80, not read); each opens a deep link with `openAppWhenRun`.
2. `ios/App/App/BereanIntents.swift` (103 lines), `src/lib/deepLinks.ts`. 3. intents → URL → router. 4. AppIntents iOS 17. 5. deep-link grammar (13 routes). 6. iPhone only. 7. An `AppShortcutsProvider` exists at `BereanIntents.swift:95` (corrected after doc 08 review). 8. `deepLinks.test.ts`. 9. Native already; re-point to native navigation. 10. Low. 11. C-DATA.

### A06 Deep links and URL schemes — implemented
1. `berean://` (dev: `berean-dev://`) routes: verse, open, note, lexicon, video, pdf (legacy `berean-pdf://`), search, trail, daily, share, workspace, session, chat[/new], `&play=1`; Mac registers via `setAsDefaultProtocolClient` and second-instance argv; iPhone `appUrlOpen` with dedupe.
2. `src/lib/{deepLinks,deepLinkTarget}.ts`, `electron/main.ts` (line 1370), `src/platform/ios/deepLinks.ts`. 3. one router. 4. none. 5. grammar. 6. Universal Links not implemented. 7. none. 8. `deepLinks.test.ts`, `deepLinkDedupe.test.ts`. 9. SW-DATA router + `onOpenURL`. 10. Links already written into users' notes must keep resolving (`berean://` and `berean-pdf://`). 11. C-DATA.

### A07 Widget — implemented (iPhone)
1. Static "New Message" widget (Home/Lock Screen) opening `<scheme>://chat/new`; no data in timeline.
2. `ios/App/BereanWidget/BereanChatWidget.swift`. 3–6 trivial. 7. none. 8. none. 9. already SwiftUI. 10. Low. 11. C-DATA.

### A08 File providers / document access — partial
1. No File Provider extension. Mac MAS: security-scoped bookmarks for vault and sync folder (`sandbox-bookmarks.json`, max 32); iPhone: iCloud container is document-scope public (`NSUbiquitousContainerIsDocumentScopePublic`, folder levels any) so the folder appears in Files; document picker for PDF/md import; `@capacitor/filesystem`.
2. `electron/mac/folderAccess.ts`, `ios/App/App/Info.plist`, `src/platform/ios/bridgeExtras.ts`. 3. system APIs. 4. n/a. 5. bookmark map. 6. Mac sandbox only. 7. DMG build unsandboxed. 8. none found for folderAccess. 9. Native security-scoped bookmarks. 10. Medium. 11. C-DATA.

### A09 Notifications — absent (deferred)
1. No local or remote notification code (grep for `UNUserNotification`/`Notification(` finds none). 2. n/a. 7. VERIFIED by grep. 9. n/a.

### A10 App lifecycle — implemented
1. Mac: single instance with second-instance handling, will-quit export, autoUpdater (beta channel, manual or auto download), power events (`powerAwareness.ts`), nativeTheme push. iPhone: AppDelegate/SceneDelegate, Capacitor lifecycle, background audio, pagehide flush, `BereanPowerPlugin` (low power).
2. `electron/{main,powerAwareness}.ts`, `ios/App/App/*.swift`, `BereanPowerPlugin.swift`. 3. native events → renderer. 4. electron-updater. 5. n/a. 6. MAS uses Mac App Store updates, DMG uses electron-updater (`app:isMasBuild`). 7. none. 8. `entitlements.test.ts`, `packagedAssets.test.ts`, `scripts/smoke-electron.mjs` (manual). 9. SwiftUI scene phases + Sparkle (DMG) or App Store. 10. Low. 11. C-NO for simultaneous instances of old and new apps on same DB (use different identity).

### A11 Entitlements, sandbox, identity — implemented
1. Two identities (Berean `com.berean.app`, Berean Dev `com.berean.app.dev`) with separate containers, groups, URL schemes; MAS sandbox entitlements (JIT, unsigned exec memory, network.client, user-selected rw, bookmarks, iCloud); Developer ID hardened-runtime entitlements (JIT, unsigned memory, DYLD); verify scripts check signed artefacts.
2. `config/app-identity.json`, `build/entitlements.*.plist`, `scripts/mac/{verify-mas,package-mas,build-mas-dev,profileAuthorises}.mjs`, `scripts/ios/{identity,verify-identity,dev-safety-check}`, `electron/appIdentity.ts`, `src/platform/appIdentity.ts`, `ios/App/*.xcconfig`. 3. generated xcconfig per identity. 4. Apple certificates/profiles (provisioning profiles in `build/` are binary files). 5. identity JSON. 6. both. 7. MAS provisioning/installer cert still pending per docs (BLOCKED). `com.apple.security.cs.allow-jit`/unsigned memory exist only because of Electron. 8. `entitlements.test.ts`, `appIdentity.test.ts`, `iosDevIdentity.test.ts`, `iosCheckSetup.test.ts`, `devIsolation.test.ts`. 9. Native app removes JIT entitlements; identity machinery carries over. 10. Preserve bundle IDs, iCloud container and App Group so existing users' data and sync survive (cannot change). 11. C-DATA.

### A12 App Store requirements — partial
1. iPhone privacy manifest present (`PrivacyInfo.xcprivacy` declares UserDefaults, file timestamp, disk space, boot time), `ITSAppUsesNonExemptEncryption=false`, location/photos usage strings, ATS local networking exception; Mac `privacy.md/html` docs; `audit-production.mjs` checks shipped content.
2. `ios/App/App/{Info.plist,PrivacyInfo.xcprivacy}`, `docs/{privacy.md,privacy.html,mac-app-store.md}`, `scripts/audit-production.mjs`. 3–6 n/a. 7. App Review exposure from YouTube scraping/BibleGateway credential flow (INFERRED); privacy manifest for third-party SDKs (onnxruntime) not audited. 8. `iosCheckSetup.test.ts`. 9. Native apps need the same manifests. 10. Review risk. 11. n/a.

### A13 Share/print/export to Files (iPhone) — implemented
1. `@capacitor/share` for text/markdown, `BereanPrintPlugin` for print/PDF. See N09. Status: implemented. 2–11 as N09 (iPhone side).

### A14 Accessibility — partial
1. `BereanA11yPlugin.swift` (64 lines), `aria-label` usage in React; SPEC scenario 30 notes no VoiceOver pass. 2. `src/mobile/*`, plugin. 7. No VoiceOver audit (SPEC, BLOCKED device). 8. none. 9. Native a11y comes mostly free. 10. Web a11y gaps do not carry over. 11. n/a.

### A15 Auto-update and distribution (Mac) — implemented
1. `electron-updater` with GitHub Releases, stable/beta channel, GitHub Actions release workflow, DMG notarisation via `build/notarize.js`; MAS path separate. 2. `electron/main.ts`, `scripts/tag-release.js`, `.github` (not in this checkout listing). 7. Release CI not inspected. 8. none. 9. Sparkle or App Store only. 10. Update channel continuity for existing DMG users. 11. n/a.

---

## I. Other features found

### O01 Deep-linked "Berean Dev" identity separation — implemented (A11 covers).
### O02 Crash report on next launch — implemented (`CrashReport.tsx`, `ErrorBoundary.tsx`; Mac and iPhone mounted in `src/main.tsx`).
- 1 shows a report after a renderer crash. 7 content of crash payload UNVERIFIED. 8 none. 9 MetricKit/`MXCrashDiagnostic`. 11 C-HOST.

### O03 Hermas / Recognitions special-case handling — implemented
1. Hermas has two translations and a traditional numbering map (`hermasMap.ts`); Recognitions and Hermas rows are paragraph-sized "verses"; Taylor footnotes cross-refs; section titles. Files `src/lib/{hermasMap,prologueBooks,chapterNumbering}.ts`, `setHermasTextId` global in `parseRef.ts` (module-level mutable state, VERIFIED). 7. Global mutable setter is a hidden coupling. 8. `hermasMap.test.ts`, `hermasTaylor.test.ts`. 9. SW-DATA. 11. C-DATA.

### O04 Data publication pipeline — implemented
1. `scripts/publish-data.js` uploads `data/*.db` to a GitHub release for CI; `audit-production.mjs` guards packaged content. Native build must replace with an asset pipeline. Status: implemented, tooling only.

### O05 Diagnostics and performance tooling — implemented
1. `src/lib/{perfMarks,perfSpan}.ts`, `scripts/perf/*`, `docs/performance-audit-2026-10-19.md`, `electron/devTools.ts` (dev-only guards), `src/platform/ios/{devProbe,perf,selfTest}.ts` (BEREAN_E2E_PROBE builds). 7. The probe must be absent from release (`npm run audit:prod`). 8. `devTools.test.ts`. 9. Instruments/`os_signpost`. 11. n/a.

---

## J. Documented but absent / present but undocumented / contradicted

**Documented but absent or different (VERIFIED by grep/read):**
- Hebrew and Greek interlinear (CLAUDE.md §7/§20: deferred): absent.
- Cross-text highlight sync setting (CLAUDE.md §15): absent; highlights are per `text_id`.
- Verse indicator dot position setting (§15): not found.
- Hints system with "Don't show again" (§16): not found.
- YouTube channel allowlist editing, add-channel prompt (§12): channels are a hard-coded array (`electron/ipc/youtube.ts`).
- YouTube timestamp link format setting (§15): not found.
- Compare-cell "unlock" independent navigation (§11): not found (UNVERIFIED).
- Three/four-square compare layouts as such (§11): compare columns 2–4 plus stacked; exact layout set not verified.
- Layout presets: CLAUDE.md lists 6, code has 16.
- DB/table names in CLAUDE.md §7/§9/§10/§17 (book_num, text_tagged schema parity, notes table, tabs table, highlights table) differ from the actual schema.
- `PiPController.tsx` is a stub; PiP lives in `YouTubeTab.tsx`.
- Vault watcher uses `chokidar`, which is only a transitive dependency (not in `package.json`; present once in `package-lock.json`).
- Semantic embedding index "shipped": not shipped on any platform.
- `docs/mobile/feature-matrix.md` NOT STARTED rows that exist: Calendar, Tags graph, PDF library (partly), reading position, zoom, word replacer (settings page exists), Share (plugin exists).
- `docs/mobile/voices.md`: Kokoro-on-iOS "future work" vs code with native ONNX synthesis.
- "Cmd+1 through Cmd+5 jump to space" and other shortcut rows: UNVERIFIED.
- CLAUDE.md §20 BibleGateway sync deferred: an importer exists (N14).
- Code comment `electron/main.ts:1181` says webview is disabled in MAS; `webviewTag: true` is set.

**Present but not in CLAUDE.md (docs/ coverage by grep count of files in `docs/` + CLAUDE.md):** study trail (17 files), tags graph (11), word replacer (7), idioms (16), trash (18), note version history (8), presenter (14), sunrise daily boundary (10), widget (7), App Intents (8), transcript packs (9), playlists (17), crash report (7), Berean Chat (own doc), Ask Berean AI subsystem (own docs), iCloud sync (own docs), Liquid Glass (own doc), Berean Dev identity (own docs). **Only one file** mentions the iPhone sleep timer (`grep -rli "sleep timer"` → 1 hit), so it is classified undocumented in section K.

---

## K. Summary table

Columns: ID, feature, status, platforms (M Mac, P iPhone), verification, replacement difficulty 1–5 (5 = hardest), doc state (D accurate, S stale/contradicted, N not in CLAUDE.md but in docs/, X nowhere).

| ID | Feature | Status | Plat | Verif | Diff | Doc |
|---|---|---|---|---|---|---|
| S01 | Text loading, bundled texts | implemented | M P | VERIFIED | 2 | S |
| S02 | Book/chapter/passage navigation | implemented | M P | VERIFIED | 3 | D |
| S03 | Reference parsing | implemented | M P | VERIFIED | 3 | D |
| S04 | Verse rendering and annotations | implemented | M P | VERIFIED | 5 | S |
| S05 | Strong's rendering and lexicon access | implemented | M P | VERIFIED | 3 | D |
| S06 | Interlinear | deferred | - | VERIFIED | 5 | D |
| S07 | Selection and copying | implemented | M P | VERIFIED | 4 | D |
| S08 | Verse context menus and actions | implemented | M P | VERIFIED | 2 | D |
| S09 | Multiple translations/editions | implemented | M P | VERIFIED | 2 | S |
| S10 | Reading position and history | implemented | M P | VERIFIED | 2 | D |
| S11 | Reading preferences | implemented | M P | VERIFIED | 2 | D |
| S12 | Cross-references | implemented | M P | VERIFIED | 3 | D |
| S13 | Parallel comparison | implemented | M P | VERIFIED | 3 | S |
| S14 | Very long chapter performance | implemented | M P | INFERRED | 4 | N |
| S15 | Find in chapter | implemented | M P | VERIFIED | 1 | D |
| S16 | Word replacer | implemented | M P | VERIFIED | 2 | N |
| Q01 | Scripture full-text search | implemented | M P | VERIFIED | 2 | D |
| Q02 | Reference search | implemented | M P | VERIFIED | 2 | D |
| Q03 | Strong's search | implemented | M P | VERIFIED | 2 | D |
| Q04 | Lexicon search | implemented | M P | VERIFIED | 2 | D |
| Q05 | Notes search | implemented | M P | VERIFIED | 2 | D |
| Q06 | Indexing | partial | M P | VERIFIED | 2 | N |
| Q07 | Filtering and ranking | partial | M P | VERIFIED | 3 | N |
| Q08 | Semantic search and embeddings | partial | M (dev) | VERIFIED | 4 | S |
| Q09 | Floating/unified search, palette | implemented | M P | VERIFIED | 4 | D |
| Q10 | YouTube transcript search | implemented | M P | VERIFIED | 2 | N |
| N01 | General, verse, daily notes | implemented | M P | VERIFIED | 2 | S |
| N02 | Markdown model and ProseMirror | implemented | M P | VERIFIED | 5 | S |
| N03 | Inline formatting and blocks | implemented | M P | VERIFIED | 5 | N |
| N04 | Tables | implemented | M P | INFERRED | 4 | N |
| N05 | Images and attachments | partial | M P | VERIFIED | 3 | D |
| N06 | Links, wikilinks, Scripture refs | implemented | M P | VERIFIED | 4 | D |
| N07 | Autosave | implemented | M P | VERIFIED | 3 | N |
| N08 | Undo/redo and version history | implemented | M P | VERIFIED | 2 | N |
| N09 | Export, import, print | implemented | M P | VERIFIED | 3 | N |
| N10 | Vault integration | implemented | M | VERIFIED | 4 | D |
| N11 | Folders, trash, pin, status, views | implemented | M P | VERIFIED | 3 | N |
| N12 | Daily notes, calendar, sunrise | implemented | M P | VERIFIED | 3 | N |
| N13 | Idiom/reference-book editor | implemented | M P | INFERRED | 2 | N |
| N14 | BibleGateway importer | implemented | M | VERIFIED | 4 | S |
| N15 | e-Sword importer | implemented | M | VERIFIED | 2 | N |
| H01 | Highlight storage | implemented | M P | VERIFIED | 1 | S |
| H02 | Verse/word/selection highlights, anchoring | implemented | M P | VERIFIED | 4 | S |
| H03 | Colours and categories | partial | M P | VERIFIED | 1 | S |
| H04 | Note/tag indicators | implemented | M P | VERIFIED | 2 | D |
| H05 | Cross-translation highlights | deferred | - | VERIFIED | 4 | S |
| H06 | Highlight sync | implemented | M P | VERIFIED | 3 | N |
| U01 | Spaces | implemented | M P | VERIFIED | 2 | D |
| U02 | Vertical tabs, sessions, archive | implemented | M P | VERIFIED | 4 | N |
| U03 | Pinned tabs | partial | M P | VERIFIED | 1 | X |
| U04 | Tab/session persistence | implemented | M P | VERIFIED | 3 | N |
| U05 | Workspaces and layouts | implemented | M P | VERIFIED | 4 | S |
| U06 | Resizable panels, drag and drop | implemented | M | VERIFIED | 3 | D |
| U07 | Multi-window, floating, presenter/viewer | implemented | M | VERIFIED | 5 | N |
| U08 | Navigation state and stacks | implemented | M P | VERIFIED | 3 | N |
| U09 | Menus, context actions, commands | implemented | M P | VERIFIED | 3 | D |
| U10 | Keyboard shortcuts | partial | M | INFERRED | 2 | S |
| U11 | Themes and appearance | implemented | M P | VERIFIED | 3 | N |
| U12 | Settings | implemented | M P | VERIFIED | 3 | N |
| U13 | Onboarding and hints | partial | M P | VERIFIED | 2 | S |
| U14 | Study Trail | implemented | M P | VERIFIED | 4 | N |
| U15 | Tasks panel | implemented | M | VERIFIED | 1 | N |
| U16 | Tags and tag graph | implemented | M P | VERIFIED | 3 | N |
| U17 | PDFs | partial | M P | INFERRED | 3 | N |
| U18 | Berean Chat | implemented | M P | VERIFIED | 3 | N |
| M01 | YouTube browsing and playback | implemented | M P | VERIFIED | 4 | S |
| M02 | Picture-in-Picture | partial | M P | VERIFIED | 4 | S |
| M03 | Video-linked notes, timestamps | implemented | M P | VERIFIED | 2 | S |
| M04 | Transcripts (dev-fetch, packs) | implemented | M P | VERIFIED | 3 | N |
| M05 | Read Aloud engine (Kokoro) | implemented | M P | VERIFIED | 5 | S |
| M06 | Audio playback, queue, background | implemented | M P | VERIFIED | 3 | N |
| M07 | Word-follow highlighting | implemented | M P | VERIFIED | 4 | N |
| M08 | Voice downloads and caching | implemented | M P | VERIFIED | 3 | N |
| M09 | Sleep timer (iPhone) | undocumented | P | VERIFIED | 1 | X |
| G01 | Ask: references/Strong's model-free | implemented | M P | VERIFIED | 4 | N |
| G02 | Local model runtime, picker, downloads | partial | M | VERIFIED | 5 | N |
| G03 | Modes, prose stripping, premise check | partial | M | VERIFIED | 4 | N |
| G04 | Deep Search, escalation, cancel | partial | M | VERIFIED | 4 | N |
| G05 | Collections, profiles, saved contexts | implemented | M P | VERIFIED | 3 | N |
| G06 | Verse-note influence, exclusion | partial | M | VERIFIED | 3 | N |
| G07 | Cloud model (BYO key) | partial | M | VERIFIED | 3 | N |
| G08 | Online research | partial | M P | VERIFIED | 2 | N |
| G09 | Evaluation harness | implemented | M (dev) | VERIFIED | 2 | N |
| G10 | iPhone Ask Berean (model-free) | partial | P | VERIFIED | 3 | N |
| A01 | iCloud sync journal | implemented | M P | VERIFIED (matrix BLOCKED) | 5 | N |
| A02 | Keychain / secure storage | partial | M | VERIFIED | 2 | N |
| A03 | App Groups, Share Extension | implemented | P | VERIFIED | 1 | N |
| A04 | Spotlight | implemented | P | VERIFIED | 1 | N |
| A05 | App Intents / Siri | implemented | P | VERIFIED | 1 | N |
| A06 | Deep links / URL schemes | implemented | M P | VERIFIED | 2 | N |
| A07 | Widget | implemented | P | VERIFIED | 1 | N |
| A08 | File access / providers | partial | M P | INFERRED | 2 | N |
| A09 | Notifications | deferred | - | VERIFIED | 1 | X |
| A10 | App lifecycle and updates | implemented | M P | VERIFIED | 2 | N |
| A11 | Entitlements, sandbox, identity | implemented | M P | VERIFIED | 2 | N |
| A12 | App Store requirements | partial | M P | INFERRED | 2 | N |
| A13 | Share/print to Files (iPhone) | implemented | P | VERIFIED | 2 | N |
| A14 | Accessibility | partial | P | INFERRED | 3 | N |
| A15 | Auto-update and distribution (Mac) | implemented | M | INFERRED | 2 | N |
| O02 | Crash report on next launch | implemented | M P | INFERRED | 1 | N |
| O03 | Hermas/Recognitions special handling | implemented | M P | VERIFIED | 2 | N |
| O04 | Data publication pipeline | implemented | dev | VERIFIED | 2 | N |
| O05 | Diagnostics and performance tooling | implemented | M P | VERIFIED | 2 | N |
| X-PiPstub | `PiPController.tsx` dead stub | abandoned | M | VERIFIED | 1 | S |
| X-dl | `electron/downloads/modelDownloader.ts` (tested, unused in production) | abandoned | M | VERIFIED | 1 | X |

(O01 folded into A11. Q10 is reported once under M04.)

## L. Items that remain unverified or blocked

BLOCKED: physical-iPhone behaviour (scroll performance, memory, Share Extension, Spotlight, Kokoro on-device, background audio, PiP), real-iCloud multi-device sync, Mac App Store build (provisioning profile and installer certificate), bundled AI runtime and offline-without-Ollama scenarios, human review of AI answers, rebuilding data DBs or the embedding index, running the test suite.

UNVERIFIED: contents of `data/*.db` (not opened; KJV italics, concatenated-verse repairs), iPhone drag-reorder and hardware shortcuts, Cmd+1..5 behaviour, release CI, whether `youtube-key.ts` ends up in a shipped bundle, transcript-pack default host, Mac media-key support, `trail_embeddings` usage, the full set of App Intents beyond those read, vault-sync fixes listed in memory notes M6/M7, passwords in `bgImport` never persisted (comment only).
