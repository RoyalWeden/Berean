# Full feature parity — original Berean (Electron Mac + Capacitor iPhone) vs native (SwiftUI/AppKit/UIKit)

Authoritative feature-by-feature record (owner request 2026-11-12). Keyed by the audit's feature IDs (`docs/native-migration-audit/03-FEATURE-INVENTORY.md`).
Original behaviour, files and platform differences are quoted from the audit. Native status was verified in this repository and, where noted, in the running apps.
Issues live in `UX-AND-FUNCTIONAL-ISSUES.md`; screens in `SCREEN-INVENTORY.md`.

Status: ✅ parity or better (verified) · 🟡 partial · ❌ missing · ❓ unverified · — not applicable / deferred in the original.
Priority: P0 data-safety, P1 major missing workflow, P2 incomplete / usability, P3 polish or niche.

## Coverage summary

- **Mac:** — 13, ✅ 31, ❌ 36, 🟡 24
- **iPhone:** — 16, ✅ 17, ❌ 35, ❓ 1, 🟡 35

Largest open gaps (priority order): Study Trail (U14), sync (A01/H06), Notes home (N11), partial-selection highlights (H02), find in chapter (S15), unified ⌘K with notes (Q09/Q05), iPhone reader gestures and cross-verse selection (S02/S07), advanced note structures (N04/N05), PDFs/YouTube/Read Aloud/Ask Berean (U17, M01, M05, G01).

## Index

| ID | Feature | Original status | Mac | iPhone | Pri | Native state / next |
|---|---|---|---|---|---|---|
| S01 | Text loading and bundled texts | implemented | ✅ | ✅ | — | All 19 texts bundled; lxx→lxx_brenton mapping fixed; text list = legacy TRANSLATIONS (KJV hidden, Hermas Taylor listed) |
| S02 | Book / chapter / passage navigation | implemented | ✅ | 🟡 | P1 | Mac: passage navigator (all-text search, history, internal back, texts column), real chapter lists incl. prologue 0, single-chapter books open directly, chapter stepping over real chapters. iPhone: navigator as sheet; NO swipe/edge-tap chapter change, no pull-nav |
| S03 | Reference parsing | implemented | ✅ | ✅ | — | Golden-pinned parser + native resolver (bare book names, "Jude 5", other texts) |
| S04 | Verse rendering | implemented | ✅ | 🟡 | P1 | Mac continuous TextKit reader (red letters, italics, titles, note dots, tags, highlights). iPhone per-verse SwiftUI rows; no psalm superscription special-casing check yet |
| S05 | Strong's rendering and lexicon access | implemented | ✅ | 🟡 | P1 | Mac: clickable superscript Strong's → study panel lexicon; iPhone: Strong's links in rows open lexicon via openURL (needs device check); hover gloss tooltip missing on Mac |
| S06 | Interlinear | deferred | — | — | — | Deferred in original too |
| S07 | Selection and copying | implemented | ✅ | 🟡 | P1 | Mac: cross-verse text selection; verse-number click/⇧-click selection; selection bar; legacy copy formats (⌘C/⌘⇧C). iPhone: tap-select verses + selection bar; no cross-verse text selection (rows) |
| S08 | Verse context menus and actions | implemented | ✅ | 🟡 | P2 | Verse actions: copy, highlight, tag verse/chapter, add note, verse notes, cross refs, open in new tab. Missing vs original: copy reference, play audio from here, compare this verse |
| S09 | Multiple translations and editions | implemented | ✅ | ✅ | — | Text switching in navigator; Compare mode for parallel texts |
| S10 | Reading position and history | implemented | ✅ | 🟡 | P3 | Per-tab back/forward history + picker History (recent passages). Missing: global History tab/sheet, scroll-position memory per tab |
| S11 | Reading preferences | implemented | 🟡 | 🟡 | P2 | Font size, line spacing, Scripture font, word replacer, theme. Missing: verse-number visibility, red-letter toggle, paragraph mode, per-text options (Hermas translation etc.) |
| S12 | Cross-references | implemented | ✅ | 🟡 | P2 | Cross refs (TSKe/Classic) in study panel; iPhone via inspector sheet (not device-verified) |
| S13 | Parallel comparison | implemented | 🟡 | 🟡 | P2 | Compare columns aligned by verse; missing per-column navigation, verse compare view from verse menu |
| S14 | Very long chapter performance | implemented (partly measured) | 🟡 | ❓ | P2 | Mac TextKit renders whole chapter (Ps 119 untested for latency); iPhone LazyVStack |
| S15 | Find in chapter | implemented | ✅ | ❌ | P2 | Find in chapter (⌘F) missing — NSTextView find bar can be enabled |
| S16 | Word replacer (display rules for divine names and search expansion) | implemented | ✅ | ✅ | — | Word replacer display + search variants + Strong's bridge |
| Q01 | Scripture full-text search | implemented | ✅ | 🟡 | — | Native multi-text search (All Texts default, scope menu, per-text counts, options popover). iPhone uses same view (not tap-verified) |
| Q02 | Reference search | implemented | ✅ | ✅ | — | References in ⌘K/New/search field go to passage |
| Q03 | Strong's search | implemented | ✅ | 🟡 | — | Strong's number queries (single/multi + words), uncapped occurrences for search (native improvement over legacy 1000 cap) |
| Q04 | Lexicon search | implemented | 🟡 | 🟡 | P2 | Lexicon search service ported; no UI entry other than Strong's numbers |
| Q05 | Notes search | implemented | 🟡 | 🟡 | P1 | Notes home search field (FTS); ⌘K does NOT search notes (MAC-FUNC-003) |
| Q06 | Indexing | implemented (FTS), partial (others) | ✅ | ✅ | — | FTS5 per text; deterministic ordering (ADR-0008) |
| Q07 | Filtering and ranking | implemented / partial ranking | ✅ | 🟡 | — | Testament, books, match mode, scripture/relevance order, grouping by text/book/none |
| Q08 | Semantic search and embeddings | partial (Mac dev only; not shipped) | — | — | — | Dev-only in original |
| Q09 | Floating search / unified Search Berean / command palette | implemented | ✅ | 🟡 | P2 | ⌘K palette: references, Strong's, word search. Missing unified grouped results (Go to · Verses · Lexicon · Notes · Commands) |
| Q10 | YouTube transcript search | implemented (see M04) | ❌ | ❌ | P3 | Depends on YouTube (M01) |
| N01 | General, verse and daily notes | implemented | 🟡 | 🟡 | P1 | General + verse notes create/edit; Today's Note (daily) on iPhone New sheet; Mac lacks daily-note command (⌘⇧D) and calendar |
| N02 | Markdown model and ProseMirror structure | implemented | 🟡 | 🟡 | P1 | Live-preview editor over verbatim Markdown (ADR-0014) — no data loss by construction; structures shown simplified |
| N03 | Inline formatting and block types | implemented | 🟡 | 🟡 | P2 | Bold/italic/underline/strike/highlight/code/headings/quotes/callouts/lists/tasks render; commands ⌘B/I/U etc. Missing toolbar & slash commands, task toggling by click |
| N04 | Tables | implemented | 🟡 | 🟡 | P2 | Tables shown as aligned monospace source, not grid |
| N05 | Images and attachments | partial | ❌ | ❌ | P2 | Images shown as alt-text caption only |
| N06 | Links, wikilinks and Scripture references | implemented | 🟡 | 🟡 | P2 | Links and wikilinks clickable; Scripture refs in plain text not auto-linked |
| N07 | Autosave | implemented | ✅ | ✅ | — | 600 ms autosave + snapshots on idle/leave/close |
| N08 | Undo/redo and version history | implemented | ✅ | 🟡 | — | Version history sheet, restore with pre-restore snapshot (golden); undo via text system |
| N09 | Export, import, print | implemented | ✅ | 🟡 | — | Export (save panel) / import / copy; iPhone document picker untapped; no print |
| N10 | Vault integration (Octarine/Obsidian) | implemented (Mac only) | ❌ | — | P2 | Vault sync not ported (M7-03) |
| N11 | Folders, trash, pin, status, icons, board, list views | implemented | ✅ | ✅ | P2 | Notes list with type filters/folder picker/pin/trash/restore. Missing: real Notes home (recent, folders browser, sort, previews, status/icons, board view), folder management UI |
| N12 | Daily notes, calendar and sunrise day boundary | implemented | 🟡 | 🟡 | P2 | Today's note (iPhone New sheet); no calendar / sunrise day boundary |
| N13 | Idiom / reference-book editor | implemented, niche | ❌ | ❌ | P3 | Idiom editor not ported |
| N14 | BibleGateway notes importer | implemented (Mac only; contradicts CLAUDE.md) | ❌ | — | P3 | BibleGateway importer (Mac) not ported |
| N15 | e-Sword import | implemented (Mac only) | ❌ | — | P3 | e-Sword import not ported |
| H01 | Storage | implemented | ✅ | ✅ | — | Highlights service golden-verified |
| H02 | Verse, word and selection highlights; offsets and anchoring | implemented | ✅ | 🟡 | P2 | Whole-verse highlight + rendering of stored char ranges; cannot create partial-selection highlights yet |
| H03 | Colours and categories | partial | ✅ | ✅ | — | 5 colours |
| H04 | Note and tag indicators on verses | implemented | ✅ | 🟡 | — | Note dots + tag chips (Mac); iPhone note dots, tag chips in rows |
| H05 | Cross-translation highlights | absent (documented in CLAUDE.md §15 as a setting) — deferred | — | — | — | Deferred in original |
| H06 | Highlight sync | implemented | ❌ | ❌ | P1 | No native sync (M4) |
| U01 | Spaces | implemented | ✅ | ✅ | — | Spaces as tab types, ⌘1–5 |
| U02 | Vertical tabs, sessions, archive | implemented | ✅ | ✅ | — | Unified Workspaces (ADR-0011), archive, ordered tab list |
| U03 | Pinned tabs | partial (data only; no setter) | ✅ | ✅ | — | Pin/unpin + drag into Pinned (native adds setter) |
| U04 | Tab and session persistence | implemented | ✅ | ✅ | — | Synced sessions/tabs tables, relaunch restore |
| U05 | Workspaces and layouts | implemented | ✅ | 🟡 | — | 16 layouts (Mac); saved workspaces both |
| U06 | Resizable panels, drag and drop | implemented (Mac) | 🟡 | — | P2 | Split panes; no drag tabs into panes |
| U07 | Multi-window, floating panels, presenter/viewer | implemented (Mac only) | ❌ | — | P2 | Single window only (no floating tabs/presenter/Study Trail window) |
| U08 | Navigation state and history stacks | implemented | ✅ | 🟡 | — | Per-tab history; [sidebar ‹ ›] group (Mac); iPhone Back/Forward in More |
| U09 | Menus, context actions, commands | implemented | 🟡 | 🟡 | P2 | Menus/context menus partial; no Commands group in ⌘K |
| U10 | Keyboard shortcuts | partial | 🟡 | — | P2 | Core shortcuts; no shortcuts list in Settings |
| U11 | Themes and appearance | implemented | ✅ | ✅ | — | System/light/dark; dark mode visually checked on Mac reader/search |
| U12 | Settings | implemented | 🟡 | 🟡 | P2 | Reading, Appearance, Workspaces, Library. Missing many sections (Texts, Shortcuts, About, Notes, YouTube, AI, Read Aloud) |
| U13 | Onboarding and hints | partial | ❌ | ❌ | P3 | Onboarding not ported |
| U14 | Study Trail | implemented | ❌ | ❌ | P1 | Study Trail not ported (1223-line service) |
| U15 | Tasks panel and first steps | implemented (Mac only) | ❌ | — | P3 | Tasks panel not ported |
| U16 | Tags and tag graph | implemented | 🟡 | 🟡 | P2 | Verse tags (golden), chips, picker, #tag search. Missing tag manager / tag graph |
| U17 | PDFs | partial | ❌ | ❌ | P2 | PDFs not ported |
| U18 | Berean Chat (notes-style chat) | implemented | ❌ | ❌ | P3 | Berean Chat not ported |
| M01 | YouTube browsing and playback | implemented | ❌ | ❌ | P2 | YouTube not ported |
| M02 | Picture-in-Picture | partial | ❌ | ❌ | P3 |  |
| M03 | Video-linked notes and timestamps | implemented | ❌ | ❌ | P3 |  |
| M04 | Transcripts and transcript search | implemented (dev-fetch model) | ❌ | ❌ | P3 |  |
| M05 | Read Aloud engine (Kokoro) | implemented | ❌ | ❌ | P2 | Read Aloud not ported |
| M06 | Audio playback, seeking, queue and background | implemented | ❌ | ❌ | P2 |  |
| M07 | Word-follow highlighting | implemented (estimated, not forced alignment) | ❌ | ❌ | P3 |  |
| M08 | Voice downloads and caching | implemented | ❌ | ❌ | P3 |  |
| M09 | Sleep timer (iPhone) | undocumented | — | ❌ | P3 |  |
| G01 | Direct references and Strong's without a model | implemented (statuses: SPEC "Complete") | ❌ | ❌ | P2 | Ask Berean not ported |
| G02 | Local model runtime (Ollama), model picker, downloads | partial | ❌ | ❌ | P3 |  |
| G03 | Ask Berean modes (Commentary ON/OFF), prose stripping, premise check | implemented (ON partial) | ❌ | ❌ | P3 |  |
| G04 | Deep Search, escalation, cancel and time budgets | implemented (Mac), partial (budgets) | ❌ | — | P3 |  |
| G05 | Collections, study profiles, saved contexts, memory | implemented | ❌ | ❌ | P3 |  |
| G06 | Verse-note influence and note exclusion | partial | ❌ | ❌ | P3 |  |
| G07 | Cloud model (BYO key) | partial (Mac), not implemented (iPhone) | ❌ | ❌ | P3 |  |
| G08 | Online research (Wikipedia, Sefaria) | partial | ❌ | ❌ | P3 |  |
| G09 | Retrieval benchmark and evaluation harness | implemented (dev tooling) | — | — | — | Dev tooling |
| G10 | iPhone Ask Berean (model-free) | partial | — | ❌ | P3 |  |
| A01 | iCloud sync (journal) | implemented, device matrix BLOCKED | ❌ | ❌ | P1 | Sync engine port pending (M4, OD-5 gates) |
| A02 | Keychain / secure storage | partial | ❌ | ❌ | P3 |  |
| A03 | App Groups and Share Extension | implemented (iPhone) | — | ❌ | P2 | Share Extension not built for native |
| A04 | Spotlight | implemented (iPhone) | — | ❌ | P3 |  |
| A05 | App Intents and Siri Shortcuts | implemented (iPhone) | — | ❌ | P3 |  |
| A06 | Deep links and URL schemes | implemented | ❌ | ❌ | P2 | berean:// deep links not handled natively |
| A07 | Widget | implemented (iPhone) | — | ❌ | P3 |  |
| A08 | File providers / document access | partial | 🟡 | 🟡 | — | Open/save panels, document picker |
| A09 | Notifications | absent (deferred) | — | — | — | Deferred |
| A10 | App lifecycle | implemented | ✅ | ✅ | — | Single-instance lock, autosave on quit |
| A11 | Entitlements, sandbox, identity | implemented | ✅ | ✅ | — | Native dev identities isolated; device deploy guards |
| A12 | App Store requirements | partial | ❌ | ❌ | — | Release gate (not in scope) |
| A13 | Share/print/export to Files (iPhone) | implemented | 🟡 | 🟡 | P2 | Note share/export; no verse share sheet |
| A14 | Accessibility | partial | 🟡 | 🟡 | P2 | Labels/hints on new controls; no full VoiceOver pass |
| A15 | Auto-update and distribution (Mac) | implemented | ❌ | — | — | Release gate |
| O01 | Deep-linked "Berean Dev" identity separation | implemented (A11 covers). | ✅ | ✅ | — |  |
| O02 | Crash report on next launch | implemented (`CrashReport.tsx`, `ErrorBoundary.tsx`; Mac and iPhone mounted in `src/main.tsx`). | ❌ | ❌ | P3 |  |
| O03 | Hermas / Recognitions special-case handling | implemented | 🟡 | 🟡 | P2 | Hermas sections/Recognitions numbering in parser; Hermas translation choice not exposed |
| O04 | Data publication pipeline | implemented | — | — | — | Pipeline unaffected |
| O05 | Diagnostics and performance tooling | implemented | — | — | — |  |

## Detail (original behaviour → native)

### S01 Text loading and bundled texts
- **Original (both):** Opens one read-only SQLite DB per text; `getBooks`, `queryChapter`, `queryVerse`, `queryVerses` (batch, capped 500), per-book chapter-count fallback for texts storing `chapters_count = 0` (LXX). Book names normalised (roman → arabic) in `getBooks`. 18 editions registered in `TRANSLATIONS` (`src/lib/bibleTexts.ts`): KJVA, Brenton LXX, 1 Enoch, Jubilees, Apoc. Elijah, Recognitions of Clement, Hermas (ANF and Taylor), Asc. Isaiah, Ep. Barnabas, T12P, Gad, T. Job, 1 Clement, Apoc. Abraham, Didache, T. Jacob, 2 Baruch. `kjv.db` is also bundled; `lxx.db` is an orphan shipped by glob on Mac only.
- **Mac vs iPhone (original):** Identical code path; iPhone opens from `App.app/data/` bundle. iPhone omits `lxx.db`, `youtube_seed.db` (split into `youtube_index.db` plus downloadable packs).
- **Original files:** `src/platform/services/bibleService.ts`; `electron/db/bible.ts` (TEXT_FILES map), `electron/ipc/bible.ts`; `src/platform/ios/services.ts`; `src/lib/bibleTexts.ts`; `src/lib/chapterCache.ts`; `scripts/seed_*.py`, `scripts/fix_*.py`, `scripts/convert-dbs.js`.
- **Known original defects:** Data defects documented: concatenated multi-verse rows in some pseudepigrapha (`scripts/DATA_BUG_long_verse_rows.md`; `enoch.db` fix script exists, others "audited"); `lxx.db` has no UNIQUE verse key (PLAN.md); KJV italics markup missing in `kjva.db` (memory note; `ANNOTATION_KEYS.kjva_italics` exis
- **Native Mac / iPhone:** ✅ / ✅ — All 19 texts bundled; lxx→lxx_brenton mapping fixed; text list = legacy TRANSLATIONS (KJV hidden, Hermas Taylor listed)
- **Native files:** Corpora.swift, AppModel.swift availableTexts
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### S02 Book / chapter / passage navigation
- **Original (both):** Reference bar, book/chapter picker, prev/next, continuous chapter scroll, pull-past-end rubber-band navigation, go-to-verse digits, `berean:next/prevChapter` events; iPhone horizontal pager and Go-to sheet; LXX↔KJV chapter mapping for Psalms and Jeremiah (chapter-level only).
- **Mac vs iPhone (original):** Different UI per platform, one parser (S03). Pull-nav physics is Mac trackpad; iPhone uses swipe + edge-back.
- **Original files:** `src/components/bible/{BiblePanel(4382 lines),BookChapterPicker,ContinuousChapterScroll,useChapterPullNav,ChapterPullIndicator}.tsx`; `src/lib/{bibleNav,translationChapterMap,verseNavigation,scrollToVerse}.ts`; `src/mobile/reader/{ReaderPage,PassagePicker,ReferencePicker,CompactPassageHeader}.tsx`.
- **Known original defects:** Verse-level LXX mapping not implemented (file header, VERIFIED). BiblePanel 4382 lines is a concentration risk.
- **Native Mac / iPhone:** ✅ / 🟡 — Mac: passage navigator (all-text search, history, internal back, texts column), real chapter lists incl. prologue 0, single-chapter books open directly, chapter stepping over real chapters. iPhone: navigator as sheet; NO swipe/edge-tap chapter change, no pull-nav
- **Native files:** PassagePicker.swift, ScriptureView.swift step()
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### S03 Reference parsing
- **Original (both):** Parses book tokens, abbreviations, ranges, comma lists, chapter-only, Hermas/Recognitions forms, multi-book queries, roman/arabic variants, Strong's refs, canonical `book.chapter.verse` ids, and emits display, filename, wikilink forms.
- **Mac vs iPhone (original):** Same on both.
- **Original files:** `src/lib/parseRef.ts` (1054 lines), `multiBookSearch.ts`, `strongsSearch.ts`, `hermasMap.ts`, `chapterNumbering.ts`, `prologueBooks.ts`, `verseRangeFormat.ts`, `tests/unit/parseRef.test.ts`.
- **Known original defects:** Duplicate `safeFtsQuery` exists in `parseRef.ts` and `bibleService.ts` with different behaviour (VERIFIED); a third copy `electron/ipc/numberWords.ts`/`src/lib/numberWords.ts` duplicates number-word tables.
- **Native Mac / iPhone:** ✅ / ✅ — Golden-pinned parser + native resolver (bare book names, "Jude 5", other texts)
- **Native files:** BereanReference, PassageResolver.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### S04 Verse rendering
- **Original (both):** Verse rows with number badge, tagged tokens, KJV italics, red-letter, translator-supply brackets per text (`ANNOTATION_KEYS` with hide toggles), Psalm superscriptions, section titles (`title` column), paragraph-style books, indicator dots, per-verse hover cards for idioms, flash/scroll targets, LXX repeated verses.
- **Mac vs iPhone (original):** Same renderer on both; iPhone adds long-press sheets.
- **Original files:** `src/components/bible/{VerseRow(2155),ChapterView(1431),TaggedVerseList,verseRowStyles}.tsx`; `src/lib/{taggedTokens,annotationFilters,psalmSuperscription,psalmTitles,verseTagRanges,scriptureText}.ts`; iPhone `src/mobile/study/VerseStudy.tsx`, `src/mobile/reader/readerViews.tsx`.
- **Known original defects:** Rendering depends on DOM text-node ordering for selection→offset conversion; any native replacement must reproduce exactly the character positions that existing highlights were stored with (see H02).
- **Native Mac / iPhone:** ✅ / 🟡 — Mac continuous TextKit reader (red letters, italics, titles, note dots, tags, highlights). iPhone per-verse SwiftUI rows; no psalm superscription special-casing check yet
- **Native files:** ChapterTextView.swift, ScriptureView.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### S05 Strong's rendering and lexicon access
- **Original (both):** Inline Strong's chips (toggle per tab `showStrongs`), hover tooltip (Mac) / tap sheet (iPhone), click opens Lexicon tab/panel, context menu (open, new tab, float, copy), chapter-wide "echo" of a Strong's number, selected-verses Strong's summary, multi-Strong's tokens, word-phrase grouping.
- **Mac vs iPhone (original):** iPhone: sheet drag-up instead of hover. Floating-lexicon items hidden on iPhone.
- **Original files:** `src/components/bible/{StrongsInline,StrongsTooltip,SelectedVersesStrongs}.tsx`; `src/components/lexicon/{LexiconPanel,LexiconTab,StrongsContextMenu,parts}.tsx`; `src/mobile/study/StrongsSheet.tsx`; `src/platform/services/lexiconService.ts` (432 lines); `electron/ipc/lexicon.ts`.
- **Known original defects:** LIKE-scan over all verses per lookup (no index); PLAN.md calls the `occurrences` tables stale. Hebrew occurrences lack `text_id`.
- **Native Mac / iPhone:** ✅ / 🟡 — Mac: clickable superscript Strong's → study panel lexicon; iPhone: Strong's links in rows open lexicon via openURL (needs device check); hover gloss tooltip missing on Mac
- **Native files:** ChapterTextView.swift, StudyViews.swift LexiconEntryView
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### S06 Interlinear
- **Original (both):** Not present. No Hebrew (Leningrad/MT) or Greek (GNT) interlinear, no morphology data (PLAN.md: "No morphology; none in any DB"). Only Strong's-tagged English (KJVA) and Greek-Strong's-tagged Brenton LXX alignment.
- **Mac vs iPhone (original):** —
- **Original files:** grep `interlinear` in `src`/`electron` finds nothing; only `CLAUDE.md` lines 361–362 and 966–967 mention it.
- **Known original defects:** Absence VERIFIED by grep.
- **Native Mac / iPhone:** — / — — Deferred in original too
- **Native files:** 
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### S07 Selection and copying
- **Original (both):** Verse-number click selection (single, range, multiple via shift/toggle), drag-select along verse numbers, text-range selection producing highlight toolbar, copy verse/ref/selection with KJV/LXX-aware formatting, Strong's-aware copy text, selection bar.
- **Mac vs iPhone (original):** iPhone: long-press → `VerseActionSheet`; tap numbers toggles.
- **Original files:** `src/lib/{verseSelection,verseClipboard,scriptureText,verseRangeFormat}.ts`; `src/components/bible/{VerseSelectionBar,VerseCopyMenu,verseDragSelect,verseInteraction,VerseDragIndicator}.ts(x)`; `src/mobile/study/{SelectionBar,MultiVerseSheet}.tsx`.
- **Known original defects:** `HIGHLIGHT_OFFSET_DEBUG = true` leftover logging was found and fixed in the 2026-10-19 performance pass (doc claim; fix not re-verified).
- **Native Mac / iPhone:** ✅ / 🟡 — Mac: cross-verse text selection; verse-number click/⇧-click selection; selection bar; legacy copy formats (⌘C/⌘⇧C). iPhone: tap-select verses + selection bar; no cross-verse text selection (rows)
- **Native files:** ChapterTextView.swift, ScriptureView.swift selection
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### S08 Verse context menus and actions
- **Original (both):** Right-click (Mac) / long-press sheet (iPhone): add verse note, show notes, cross refs, compare, tag, highlight swatches, copy, play audio from here, open in new tab/floating, idiom menu, note indicator menus.
- **Mac vs iPhone (original):** Floating-window items hidden on iPhone via `capabilities.multiWindow`-style checks (`platformCapabilities.ts`).
- **Original files:** `src/components/bible/VerseRow.tsx`, `VerseSelectionBar.tsx`; `src/mobile/study/VerseActionSheet.tsx`, `verseSheetMode.ts`, `src/mobile/primitives/{ActionSheet,PopoverMenu,anchoredMenu}.ts(x)`; Mac native menus built in main for some surfaces (`app:noteImageMenu`, `buildAppMenu`).
- **Known original defects:** none beyond UX drift between two implementations of the same action list.
- **Native Mac / iPhone:** ✅ / 🟡 — Verse actions: copy, highlight, tag verse/chapter, add note, verse notes, cross refs, open in new tab. Missing vs original: copy reference, play audio from here, compare this verse
- **Native files:** ScriptureView.swift verseNSMenu/verseActions
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### S09 Multiple translations and editions
- **Original (both):** Per-tab translation, translation switch preserving reading anchor, per-text annotation toggles, chapter-number remap for LXX, KJVA default, edition grouping, `lxx:`-style prefixes in search.
- **Mac vs iPhone (original):** Same.
- **Original files:** `src/lib/bibleTexts.ts`, `translationChapterMap.ts`, `passageDestinations.ts`, `src/components/bible/BiblePanel.tsx`, `src/mobile/reader/*`.
- **Known original defects:** LXX numbering is chapter-level only; Hermas has two translations with different versification and `hermasMap.ts` bridging.
- **Native Mac / iPhone:** ✅ / ✅ — Text switching in navigator; Compare mode for parallel texts
- **Native files:** PassagePicker.swift, CompareView.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### S10 Reading position and history
- **Original (both):** Per-tab scroll memory and reading-anchor (verse + offset) carried across translation/mode switches; chapter progress for progress bars; navigation history table with day/session grouping, History tab/modal; per-tab back/forward stacks.
- **Mac vs iPhone (original):** iPhone adds edge-swipe back.
- **Original files:** `src/hooks/{useReadingAnchor,useKeyedScrollMemory,useChapterProgress}.ts`; `src/mobile/reader/readerScrollMemory.ts`; `src/platform/services/historyService.ts`; `src/components/shell/HistoryModal.tsx`; `src/mobile/history/HistoryPage.tsx`; `src/lib/historyModel.ts`; `src/store/index.ts` (`tabNavStac
- **Known original defects:** Reading position is device-local.
- **Native Mac / iPhone:** 🟡 / 🟡 — Per-tab back/forward history + picker History (recent passages). Missing: global History tab/sheet, scroll-position memory per tab
- **Native files:** AppModel goBack/goForward, PassagePicker recents
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### S11 Reading preferences
- **Original (both):** Bible font family/size, line-height presets, verse-number visibility, red-letter, per-text hidden annotations, app zoom, pinch-to-zoom (iPhone), reader width/margins, themes (S-UI theme item).
- **Mac vs iPhone (original):** iPhone uses Dynamic Type bridging via `BereanA11yPlugin.swift` (INFERRED from plugin name; content not read in detail).
- **Original files:** `src/store/index.ts` prefs; `src/hooks/useBibleLineHeight.ts`; `src/lib/{zoom,fontFamilies,textFit}.ts`; `src/mobile/reader/{usePinchFontSize,readerWidth,scriptureTheme.css}`; `src/mobile/settings/scriptureTheme.ts`.
- **Known original defects:** Preferences do not sync via iCloud (X6).
- **Native Mac / iPhone:** 🟡 / 🟡 — Font size, line spacing, Scripture font, word replacer, theme. Missing: verse-number visibility, red-letter toggle, paragraph mode, per-text options (Hermas translation etc.)
- **Native files:** SettingsView.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### S12 Cross-references
- **Original (both):** Classic cross references (votes), TSKe (grouped headings, reciprocal), Taylor-Hermas footnotes, chapter-level "My Notes", reciprocal index; right panel on Mac (slots A/B), sheet on iPhone; viewer-window cross refs.
- **Mac vs iPhone (original):** Slot B (two simultaneous panels) Mac only; iPhone single sheet; TSK/Classic have no chapter-level rows.
- **Original files:** `src/platform/services/crossrefsService.ts`; `electron/ipc/crossrefs.ts` (352 lines, keeps sync helpers for AI); `src/lib/{crossRefIndex,crossRefs/xrefModel,notesCrossRefs}.ts`; `src/components/bible/BibleRightPanel.tsx` (2222); `src/components/viewer/ViewerCrossRefs.tsx`; `src/mobile/study/{CrossRe
- **Known original defects:** Data bug workaround in code; TSKe headings may be keyword-searched by AI (`searchTskeHeadingsByKeywords`).
- **Native Mac / iPhone:** ✅ / 🟡 — Cross refs (TSKe/Classic) in study panel; iPhone via inspector sheet (not device-verified)
- **Native files:** StudyViews.swift CrossRefsView
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### S13 Parallel comparison
- **Original (both):** 2–4 translation columns with sync scroll, stacked (iPhone, interleaved verse cells), verse compare entry, presenter feed, per-column Strong's.
- **Mac vs iPhone (original):** Mac side-by-side; iPhone interleaved; CLAUDE.md "unlock a cell" independent navigation is not found (grep `unlock` only matched unrelated UI strings; UNVERIFIED but likely absent).
- **Original files:** `src/components/bible/CompareView.tsx` (802), `src/mobile/reader/{ComparePage,compareState,compareInteraction}.tsx`, `src/components/viewer/ViewerCompare.tsx`, `src/platform/services/researchService.ts` (comparison payloads for AI), `src/lib/research/compareWords.ts`.
- **Known original defects:** Persistence of compare state fixed per memory note ("compare persistence").
- **Native Mac / iPhone:** 🟡 / 🟡 — Compare columns aligned by verse; missing per-column navigation, verse compare view from verse menu
- **Native files:** CompareView.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### S14 Very long chapter performance
- **Original (both):** Chapters are NOT virtualised. `ContinuousChapterScroll` windows chapters (`LOAD_AHEAD = 1`, `WINDOW_CHAPTERS = 2`, eviction); each chapter renders all verses (Psalm 119, Isaiah). Advanced search results and chat transcripts ARE virtualised (`@tanstack/react-virtual`, `ScriptureSearchView`).
- **Mac vs iPhone (original):** Doc reports Mac scroll with 0 frames over 25 ms and iPhone reader scroll p95 17 ms (60 Hz), one frame over 25 ms of 120, simulator only. Numbers are the doc's (UNVERIFIED by this audit); iPhone numbers are simulator, not device.
- **Original files:** `src/components/bible/{ContinuousChapterScroll,ChapterView}.tsx`; `docs/performance-audit-2026-10-19.md`; `scripts/perf/{nav,scroll}.*`.
- **Known original defects:** Physical-device scroll and memory not measured (doc says so). Chromium sibling-selector restyle problem fixed in CSS (doc).
- **Native Mac / iPhone:** 🟡 / ❓ — Mac TextKit renders whole chapter (Ps 119 untested for latency); iPhone LazyVStack
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### S15 Find in chapter
- **Original (both):** Phrase/all/any highlight inside the chapter; handoff from search to find; iPhone `FindOnPage`.
- **Mac vs iPhone (original):** same.
- **Original files:** `src/components/shell/FindBar.tsx`, `src/lib/{scriptureFind,findHandoff,scriptureHighlight}.ts`, `src/mobile/reader/FindOnPage.tsx`.
- **Known original defects:** none known.
- **Native Mac / iPhone:** ❌ / ❌ — Find in chapter (⌘F) missing — NSTextView find bar can be enabled
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### S16 Word replacer (display rules for divine names and search expansion)
- **Original (both):** User-defined replacement rules applied at render time with search-variant expansion (typing a replacement finds the original word); settings sections on both platforms.
- **Mac vs iPhone (original):** same.
- **Original files:** `src/lib/wordReplacer.ts`, `src/components/settings/sections/WordReplacerSection.tsx`, `src/mobile/settings/WordReplacerPage.tsx`; used by search/unified search.
- **Known original defects:** `expandQueryForWordReplacer` is documented in its own comment as broken for production use and kept only for tests (VERIFIED).
- **Native Mac / iPhone:** ✅ / ✅ — Word replacer display + search variants + Strong's bridge
- **Native files:** BereanText WordReplacer
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### Q01 Scripture full-text search
- **Original (both):** FTS5 per text with modes all/any/phrase, prefix wildcards, number↔word alternates, scoped by books and optional chapter; ordered by FTS `rank`; limits 2000 (unscoped) / 5000 (scoped), `any` mode merges per-term queries and caps at 3000.
- **Mac vs iPhone (original):** Same; iPhone uses `src/lib/scriptureSearch.ts`.
- **Original files:** `src/platform/services/bibleService.ts` (`searchText`, `safeFtsQuery`, `cleanWords`), `src/lib/{scriptureSearch,scriptureSearchFilters,numberWords}.ts`, `src/components/bible/ScriptureSearchView.tsx` (2090), `src/mobile/search/*`.
- **Known original defects:** FTS query failures are swallowed (`catch { return [] }`); ranking is plain FTS rank, no cross-text blending (SPEC_STATUS notes keyword matches from other texts can outrank canonical verses in AI use).
- **Native Mac / iPhone:** ✅ / 🟡 — Native multi-text search (All Texts default, scope menu, per-text counts, options popover). iPhone uses same view (not tap-verified)
- **Native files:** ScriptureSearchView.swift, ScriptureSearch.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### Q02 Reference search
- **Original (both):** A typed reference jumps to chapter/verse/range; ambiguous book tokens listed; Go-to groups in unified search; typed-digit go-to in reader.
- **Mac vs iPhone (original):** —
- **Original files:** `parseRef.ts`, `searchIntent.ts`, `FloatingSearch.tsx`, `src/mobile/search/SearchSurface.tsx`, `src/lib/navigation/destination.ts`.
- **Known original defects:** none known.
- **Native Mac / iPhone:** ✅ / ✅ — References in ⌘K/New/search field go to passage
- **Native files:** PassageResolver.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### Q03 Strong's search
- **Original (both):** `H####/G####` direct entry; multi-Strong's AND/OR; search verses containing a Strong's number with word highlight segments; "any Strong's" mode.
- **Mac vs iPhone (original):** —
- **Original files:** `src/lib/strongsSearch.ts`, `scriptureSearch.ts` (`runStrongsSearch`), `lexiconService.getOccurrences`.
- **Known original defects:** —
- **Native Mac / iPhone:** ✅ / 🟡 — Strong's number queries (single/multi + words), uncapped occurrences for search (native improvement over legacy 1000 cap)
- **Native files:** ScriptureSearch.strongs
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### Q04 Lexicon search
- **Original (both):** Search over `strongs_id/word/transliteration/short_def/full_def/bdb_def` with LIKE and ordered CASE ranking; diacritic-insensitive transliteration match done in JS (`findByNormalizedTransliteration` loads all transliterations).
- **Mac vs iPhone (original):** —
- **Original files:** `lexiconService.search`, `electron/ipc/lexicon.ts`, `src/components/lexicon/LexiconPanel.tsx`.
- **Known original defects:** —
- **Native Mac / iPhone:** 🟡 / 🟡 — Lexicon search service ported; no UI entry other than Strong's numbers
- **Native files:** LexiconService.search
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### Q05 Notes search
- **Original (both):** FTS5 over notes `title, content` (migration v19, triggers + backfill), modes all/any/phrase, "untitled" special case, tag and chapter queries, idiom lists.
- **Mac vs iPhone (original):** —
- **Original files:** `src/platform/services/notesService.ts` (`search`, `getByChapter`, `getChapterCounts`), `src/lib/panelDataCache.ts`.
- **Known original defects:** The index covers the raw markdown including inline base64 image data URLs (INFERRED from storage format, N05), which inflates the index and snippets.
- **Native Mac / iPhone:** 🟡 / 🟡 — Notes home search field (FTS); ⌘K does NOT search notes (MAC-FUNC-003)
- **Native files:** NotesViews.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### Q06 Indexing
- **Original (both):** FTS5 for verses (prebuilt in data DBs), notes (`notes_fts`), YouTube transcripts (`youtube_transcripts_fts`); no index for lexicon, Strong's occurrences or note-to-verse references beyond `verse_ref`/`idx_notes_verse`; Spotlight index (iPhone) for notes, sessions, workspaces, books/chapters; embedding index is a dev artifact (Q08).
- **Mac vs iPhone (original):** —
- **Original files:** `bereanMigrations.ts` v13/v19; `scripts/build-embedding-index.js`; `src/platform/ios/spotlight.ts`; `BereanSpotlightPlugin.swift`.
- **Known original defects:** —
- **Native Mac / iPhone:** ✅ / ✅ — FTS5 per text; deterministic ordering (ADR-0008)
- **Native files:** BibleService
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### Q07 Filtering and ranking
- **Original (both):** Filters by text, testament/book groups (10 presets), tag AND/OR, sort; unified search grouped results; AI collections (canon, apocrypha, pseudepigrapha, fathers) filter; YouTube search ranking (`rankVideosBySearch`); RRF fusion for AI candidates (`electron/rrf.ts`).
- **Mac vs iPhone (original):** —
- **Original files:** `src/lib/{scriptureSearchFilters,search/unifiedSearch,youtubeSearch,research/collections}.ts`, `electron/rrf.ts`.
- **Known original defects:** —
- **Native Mac / iPhone:** ✅ / 🟡 — Testament, books, match mode, scripture/relevance order, grouping by text/book/none
- **Native files:** ScriptureSearchView.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### Q08 Semantic search and embeddings
- **Original (both):** Query-time cosine search over a prebuilt `verse_embeddings.db` using Ollama `nomic-embed-text`; best-effort extra candidate source for Ask Berean; brute-force scan, quantised vectors (`embeddingQuantize.ts`).
- **Mac vs iPhone (original):** —
- **Original files:** `electron/{embeddings,embeddingQuantize,rrf}.ts`, `electron/db/embeddingsDb.ts`, `electron/ipc/semanticCandidates.ts`, `scripts/build-embedding-index.js`, `scripts/eval/semanticEval.ts`.
- **Known original defects:** Not shipped in any build; SPEC_STATUS decision 11 "kept current index after measurement" while PLAN notes 17.4% semantic baseline (doc claim, UNVERIFIED). Brute-force scan cost unmeasured.
- **Native Mac / iPhone:** — / — — Dev-only in original
- **Native files:** 
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### Q09 Floating search / unified Search Berean / command palette
- **Original (both):** Cmd+K/T modal (Mac): references, Strong's, keywords, notes, YouTube channels/videos, `>` commands (30 command ids), recents; iPhone plus/caret sheets and Search tab with scopes all/scripture/notes/lexicon and filters; "current tab vs new tab" destination contract.
- **Mac vs iPhone (original):** —
- **Original files:** `src/components/shell/FloatingSearch.tsx` (1678), `src/lib/{commands,search/*,navigation/*,searchNav}.ts`, `src/mobile/search/*`, `src/mobile/navigation/{NewTabSheet,destinationQuery}.tsx`, `docs/navigation-contract.md`.
- **Known original defects:** FloatingSearch 1678 lines of UI logic.
- **Native Mac / iPhone:** 🟡 / 🟡 — ⌘K palette: references, Strong's, word search. Missing unified grouped results (Go to · Verses · Lexicon · Notes · Commands)
- **Native files:** StudyInspector.swift CommandPalette
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### Q10 YouTube transcript search
- **Original (both):** 
- **Mac vs iPhone (original):** —
- **Original files:** —
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / ❌ — Depends on YouTube (M01)
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### N01 General, verse and daily notes
- **Original (both):** Note types `general`, `verse` (also `esword`, `biblegateway` imported), `daily`; verse notes anchored by `verse_ref` (`book.chapter.verse`) + `text_id`; per-note colour, tags (JSON array), icon, status, pin, AI-exclusion flag, folder id.
- **Mac vs iPhone (original):** iPhone cannot print via Electron; uses `BereanPrintPlugin`. Verse sheets embed an in-place editor.
- **Original files:** `src/platform/services/notesService.ts` (769 lines), `electron/ipc/notes.ts`, `src/types/index.ts` (`Note`), `src/components/notes/*`, `src/mobile/notes/*`, `src/lib/{noteUtils,noteTitle,noteStatus,notePreviewText,noteRecency,finalizeNote}.ts`.
- **Known original defects:** Verse-note anchor is verse-level only; no word-range anchor.
- **Native Mac / iPhone:** 🟡 / 🟡 — General + verse notes create/edit; Today's Note (daily) on iPhone New sheet; Mac lacks daily-note command (⌘⇧D) and calendar
- **Native files:** NotesViews.swift, AppModel+Workspaces openTodayDailyNote
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### N02 Markdown model and ProseMirror structure
- **Original (both):** Notes are stored as markdown; the editor is ProseMirror (Typora-like rendered mode, with a raw-edit toggle, "Edit/View mode"); markdown → PM via markdown-it with custom rules, PM → markdown via custom serializer; custom nodes and marks.
- **Mac vs iPhone (original):** iPhone uses the same PM editor in WKWebView (`NoteEditorPage`, `phoneEditorChrome`, `PhoneSelectionToolbar`, `iosTextInput.test.tsx`).
- **Original files:** `src/components/notes/pm/{schema,parser,serializer,markdownIt,NoteEditorPM(1587),keymap,inputRules,slashCommands,pastePlugin,nodeViews,blockHandles,blockDecorations,headingCollapse,threadNodeView,…}.ts(x)`, `src/lib/noteTextBlocks.ts`.
- **Known original defects:** Non-standard markdown extensions make notes only partially portable (Octarine renders some, not all — INFERRED). Raw/rendered toggle named "markdown" in docs but "Edit/View" in commands.
- **Native Mac / iPhone:** 🟡 / 🟡 — Live-preview editor over verbatim Markdown (ADR-0014) — no data loss by construction; structures shown simplified
- **Native files:** RichNoteEditor.swift, RichNoteEditorIOS.swift, MarkdownLiveSpans.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### N03 Inline formatting and block types
- **Original (both):** Bold/italic/code/strike/underline, coloured highlight marks, text alignment (paragraph attr), lists incl. tasks, quotes, callouts, code blocks with highlighting, horizontal rules, heading collapse (persisted per note), thread blocks with collapse (persisted), columns, slash commands, block handles/menu, selection toolbar, link editor, word/selection stats.
- **Mac vs iPhone (original):** —
- **Original files:** `src/components/notes/pm/*`, `src/lib/noteTextBlocks.ts`, `bereanMigrations.ts` v24/v27 collapse tables.
- **Known original defects:** Alignment is PM attr, stored how in markdown? UNVERIFIED (not read).
- **Native Mac / iPhone:** 🟡 / 🟡 — Bold/italic/underline/strike/highlight/code/headings/quotes/callouts/lists/tasks render; commands ⌘B/I/U etc. Missing toolbar & slash commands, task toggling by click
- **Native files:** RichNoteEditor.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### N04 Tables
- **Original (both):** GFM tables via prosemirror-tables with table status bar and column controls.
- **Mac vs iPhone (original):** —
- **Original files:** `src/components/notes/pm/{tablePlugins,tableStatusPlugin,columnControls}.ts(x)`.
- **Known original defects:** —
- **Native Mac / iPhone:** 🟡 / 🟡 — Tables shown as aligned monospace source, not grid
- **Native files:** RichNoteEditor.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### N05 Images and attachments
- **Original (both):** Paste/drop/pick images; drag-resize; stored INLINE as base64 `data:` URLs inside `notes.content`; native Mac image menu (copy, save as, delete); iPhone photo-library insert (`NSPhotoLibraryUsageDescription`); vault export extracts to `{vault}/attachments/<hash>.<ext>` and import re-inlines.
- **Mac vs iPhone (original):** —
- **Original files:** `src/components/notes/pm/imageInsert.ts`, `nodeViews.ts`, `electron/ipc/noteImages.ts`, `electron/ipc/vault.ts` (`extractInlineImages` line 257, `inlineVaultImages` 307).
- **Known original defects:** Inline base64 inflates DB, FTS, sync journal ops (full `fields` per upsert) and version snapshots (INFERRED); perf doc mentions a 452 KB image note and +25 MB footprint once. No general attachment type (PDF files are separate, see U-PDF).
- **Native Mac / iPhone:** ❌ / ❌ — Images shown as alt-text caption only
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### N06 Links, wikilinks and Scripture references
- **Original (both):** `[[Genesis 1:1]]` and `[[Note Title]]` wikilinks, auto-detected bare references decorated live, autocomplete popups (book/chapter/verse, notes), `berean://` links in notes, reference chips, timestamps links, backlinks-ish "cross refs from notes" for verses.
- **Mac vs iPhone (original):** —
- **Original files:** `src/components/notes/pm/{autocomplete,AutocompletePopups,refDecorations,linkModel,LinkEditor}.ts(x)`, `src/lib/{noteRefs,notesCrossRefs,deepLinks}.ts`, `src/components/notes/MarkdownReferenceModal.tsx`.
- **Known original defects:** Display book labels vs canonical names (Hermas, roman numerals) can drift in titles; vault wikilinks are folder-unaware (memory: M6 issue list, fix status UNVERIFIED).
- **Native Mac / iPhone:** 🟡 / 🟡 — Links and wikilinks clickable; Scripture refs in plain text not auto-linked
- **Native files:** NotesViews.swift openLink
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### N07 Autosave
- **Original (both):** Desktop debounces 500 ms (NotesPanel; `registerPendingSaveFlusher` for floating windows); iPhone `useNoteAutosave` 500 ms debounce, version snapshot after 2 idle minutes and on leave, flush on pagehide/background/unmount; external changes preserved via `decideExternal`/`preserveExternal` while editing (`liveNote.ts`).
- **Mac vs iPhone (original):** —
- **Original files:** `src/lib/{pendingSaves,notes/liveNote}.ts`, `src/mobile/notes/useNoteAutosave.ts`, `src/components/notes/NotesPanel.tsx`.
- **Known original defects:** Data-loss windows exist between keystroke and 500 ms flush and during force-quit (INFERRED); the editor owns the live doc and is not refreshed per save (documented fix).
- **Native Mac / iPhone:** ✅ / ✅ — 600 ms autosave + snapshots on idle/leave/close
- **Native files:** NotesViews.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### N08 Undo/redo and version history
- **Original (both):** PM history for in-editor undo/redo; persistent `note_versions` snapshots (auto kind, pruned) with restore UI.
- **Mac vs iPhone (original):** —
- **Original files:** `notesService` (`createVersion`, `pruneNoteVersions`, `getVersions`, `restoreVersion`), `src/components/notes/NoteVersionHistory.tsx`, `prosemirror-history` in `keymap.ts`.
- **Known original defects:** Undo stack is in-memory; lost on reload.
- **Native Mac / iPhone:** ✅ / 🟡 — Version history sheet, restore with pre-restore snapshot (golden); undo via text system
- **Native files:** NotesViews.swift NoteVersionHistoryView
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### N09 Export, import, print
- **Original (both):** Per-note markdown export/import with frontmatter (`noteToMarkdownFile`), Files/share export on iPhone, Mac print preview and PDF export (main-process `printToPDF`), iPhone print via `UIPrintInteractionController` + PDF renderer, idioms export, vault export/import (N10).
- **Mac vs iPhone (original):** Mac sandbox build; iPhone share sheet.
- **Original files:** `src/lib/noteMarkdownFile.ts`, `src/platform/ios/exportNotes.ts`, `electron/main.ts` (`app:printNote`, `app:exportNotePDF`, `app:renderPreviewPDF`), `src/components/notes/PrintPreviewModal.tsx`, `BereanPrintPlugin.swift`, `src/lib/{notePreviewRender,idiomsExport}.ts`.
- **Known original defects:** Two serializers can drift.
- **Native Mac / iPhone:** ✅ / 🟡 — Export (save panel) / import / copy; iPhone document picker untapped; no print
- **Native files:** NoteFileTransfer.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### N10 Vault integration (Octarine/Obsidian)
- **Original (both):** Optional vault folder: one `.md` per note with frontmatter and `berean_id`, attachments extraction, trash folder mirror, chokidar watcher (1.5 s polling, depth 10) with bidirectional reconcile, export-all and import-all on a timer and at quit, highlights/history/PDFs exported into the vault (`.attachments/`), hidden-path filter (`.git`, dotfiles).
- **Mac vs iPhone (original):** iPhone has NO vault (`R140`); it exports/imports single `.md` files via Files/share instead.
- **Original files:** `electron/ipc/vault.ts` (1449 lines), `electron/mac/folderAccess.ts` (security-scoped bookmarks for MAS), `src/components/shell/Onboarding.tsx` vault step, `src/components/settings/sections/ImportSection.tsx`.
- **Known original defects:** Known historic issues (memory M6/M7: bidirectional sync, wikilink folder-awareness, collisions): fix status UNVERIFIED. An iCloud-evicted file hang was found 2026-09-22 (memory) with sync `readFileSync` in `vault:reconcile`; mitigation status UNVERIFIED. The integration test is a tautology (X7).
- **Native Mac / iPhone:** ❌ / — — Vault sync not ported (M7-03)
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### N11 Folders, trash, pin, status, icons, board, list views
- **Original (both):** Folder tree (nested), soft-delete trash with restore/purge, pin, status chips, note icons/emoji picker, list/folder/board views, filters/sorting, AI exclusion at note or folder level, recents.
- **Mac vs iPhone (original):** —
- **Original files:** `src/components/notes/{NotesHomePanel,NotesFolderView,NotesBoardView,NotesList,NoteContextMenu,NoteIcon*,NoteStatusDropdown,folderTreeGeometry}.tsx`, `src/mobile/notes/{NotesHomePage,VirtualNoteList,TrashPage,FolderPicker,notesHomeModel}.ts(x)`, `notesService` folder functions.
- **Known original defects:** Folder delete cascades (`folderDeleteDeep`) rely on sync `dependents`.
- **Native Mac / iPhone:** 🟡 / 🟡 — Notes list with type filters/folder picker/pin/trash/restore. Missing: real Notes home (recent, folders browser, sort, previews, status/icons, board view), folder management UI
- **Native files:** NotesViews.swift NotesHomeView
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### N12 Daily notes, calendar and sunrise day boundary
- **Original (both):** Daily note per date titled `Daily — YYYY-MM-DD` (title is a de facto key); day boundary at local sunrise via `suncalc` plus location (location once per launch); Sabbath label for Saturday; calendar widget (Mac sidebar), calendar tab (both), continuous daily scroll, today shortcut (Cmd+Shift+D, intent, widget, `berean://daily`).
- **Mac vs iPhone (original):** Mac uses Electron geolocation path in main (INFERRED: `NSLocationWhenInUseUsageDescription` in `extendInfo`); iPhone plugin.
- **Original files:** `src/lib/{dailyNotes,dailyNoteUtils,calendarModel,noteUtils}.ts`, `src/components/notes/{CalendarWidget,CalendarTabPanel,ContinuousDailyScroll,DailyNoteEditsSection}.tsx`, `src/mobile/calendar/*`, `BereanLocationPlugin.swift`, `suncalc`.
- **Known original defects:** Location denied fallback to midnight (INFERRED); title-as-key means renames could break daily detection.
- **Native Mac / iPhone:** 🟡 / 🟡 — Today's note (iPhone New sheet); no calendar / sunrise day boundary
- **Native files:** AppModel+Workspaces
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### N13 Idiom / reference-book editor
- **Original (both):** Idiom notes with structured fields (meaning, aliases, auto variants, examples), verse-row idiom hover/menu, idioms export.
- **Mac vs iPhone (original):** —
- **Original files:** `src/types/index.ts` (`IdiomData`), `notesService.listIdioms`, `src/lib/idiomsExport.ts`, `VerseRow.tsx`, `BibleRightPanel.tsx`, `SettingsModal.tsx`.
- **Known original defects:** Not in CLAUDE.md. 8. `idiomsExport.test.ts`. 9. SW-DATA. 10. Easy to forget. 11. C-DATA.
- **Native Mac / iPhone:** ❌ / ❌ — Idiom editor not ported
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### N14 BibleGateway notes importer
- **Original (both):** Logs into BibleGateway in a hidden Chromium window with user-supplied credentials and scrapes notes into a review list, then imports selected notes. CLAUDE.md §20 lists it as deferred.
- **Mac vs iPhone (original):** —
- **Original files:** `electron/ipc/bgImport.ts` (820 lines), `src/components/settings/BibleGatewayImporter.tsx`, `BgImportProgress.tsx`.
- **Known original defects:** Scrapes a third-party site (ToS risk, fragile selectors); handles passwords in the main process memory; whether credentials persist anywhere is UNVERIFIED (partition declared ephemeral in a comment).
- **Native Mac / iPhone:** ❌ / — — BibleGateway importer (Mac) not ported
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### N15 e-Sword import
- **Original (both):** Reads an installed e-Sword notes database and imports with review.
- **Mac vs iPhone (original):** —
- **Original files:** `electron/ipc/eSwordImport.ts` (543), `src/components/settings/ESwordImporter.tsx`. 3. better-sqlite3 on a user file; home-directory search. 4. e-Sword files. 5. maps to `type: esword`. 6. Mac only. 7. Home-dir probing is sandbox-hostile in MAS (INFERRED). 8. none found. 9. SW-DATA with `sqlite3` an
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / — — e-Sword import not ported
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### H01 Storage
- **Original (both):** `highlights` table, id `hl-<textId>-<bookId>-<chapter>-<verse>-<range>` where range is `v`, `w<start>-<end>` or `c<start>-<end>` (deterministic so two devices highlighting the same range merge); older rows keep random ids; `label` column exists but no service API sets it.
- **Mac vs iPhone (original):** —
- **Original files:** `src/platform/services/highlightsService.ts`, `electron/ipc/highlights.ts`, `bereanMigrations.ts` v1/v2.
- **Known original defects:** `label` is dead schema. `remove()` deletes ALL highlights on a verse with a bulk event.
- **Native Mac / iPhone:** ✅ / ✅ — Highlights service golden-verified
- **Native files:** HighlightsService.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### H02 Verse, word and selection highlights; offsets and anchoring
- **Original (both):** Whole verse, word-range (start/end word index) and char-range (start/end char into plain `verse.text`) highlights; overlapping allowed; row tint for verse-level.
- **Mac vs iPhone (original):** —
- **Original files:** `highlightsService.ts`, `VerseRow.tsx`, `src/lib/{scriptureHighlight,verseUtils}.ts`, `src/mobile/study/VerseActionSheet.tsx`.
- **Known original defects:** No re-anchoring after data fixes (e.g. the Enoch row splits, KJV italics re-seed) — INFERRED risk; legacy word-level rows use word index into tagged tokens, a second coordinate system.
- **Native Mac / iPhone:** 🟡 / 🟡 — Whole-verse highlight + rendering of stored char ranges; cannot create partial-selection highlights yet
- **Native files:** ChapterTextView.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### H03 Colours and categories
- **Original (both):** 15 colours (`HighlightColor` in `src/types/index.ts`) incl. yellow, red, green, blue, purple, orange, pink, teal, cyan, indigo, lime, amber, rose, violet, sky; no categories/labels UI; CLAUDE.md's 5 colours and "label/tag" are outdated/unused. Verse tags (S18) are the categorisation mechanism instead.
- **Mac vs iPhone (original):** —
- **Original files:** types, `ColorSwatchRow.tsx`. 3–6 trivial; `electron.d.ts` still declares a 5-colour union (type drift, VERIFIED). 7. Type drift in `electron.d.ts`. 8. none specific. 9. SW-UI. 10. Low. 11. C-DATA.
- **Known original defects:** —
- **Native Mac / iPhone:** ✅ / ✅ — 5 colours
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### H04 Note and tag indicators on verses
- **Original (both):** Dots/badges per verse for notes (count), highlights, tags, cross-refs; click opens notes popover; chapter-notes banner.
- **Mac vs iPhone (original):** —
- **Original files:** `VerseRow.tsx`, `verseNotesAggregate.ts`, `chapterNotes.ts`, `notesService.getChapterCounts/getByChapter`, `src/mobile/study/{VerseNotesSheet,ChapterNotesView}.tsx`. 3. batch queries per chapter. 4. none. 5. `hasNote`, `hasHighlight` flags on `Verse`. 6. iPhone sheet. 7. CLAUDE.md "dot position sett
- **Known original defects:** —
- **Native Mac / iPhone:** ✅ / 🟡 — Note dots + tag chips (Mac); iPhone note dots, tag chips in rows
- **Native files:** ChapterTextView.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### H05 Cross-translation highlights
- **Original (both):** Highlights are keyed by `text_id` and fetched per `(textId, book, chapter)` (`ChapterView.tsx:709`). No setting or mapping carries them across translations. Offsets would not transfer between texts anyway.
- **Mac vs iPhone (original):** —
- **Original files:** `highlightsService.getChapter`. 3–6 n/a. 7. Absence VERIFIED by grep. 8. none. 9. New design needed (anchor by Strong's/word alignment). 10. Don't assume parity. 11. n/a.
- **Known original defects:** —
- **Native Mac / iPhone:** — / — — Deferred in original
- **Native files:** 
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### H06 Highlight sync
- **Original (both):** `highlight` is a synced entity (deterministic ids).
- **Mac vs iPhone (original):** —
- **Original files:** `src/platform/sync/entities.ts` (`tableEntity({kind:'highlight'})`). 3. journal. 4–6 X6. 7. Vault export writes highlights as markdown previews, one-way. 8. `engine.integration.test.ts` etc. 9. SW-DATA. 10. Sync port is the hard part. 11. C-DATA.
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / ❌ — No native sync (M4)
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### U01 Spaces
- **Original (both):** Five spaces: scripture, notes, lexicon, youtube, search; each with its own tab list; iPhone shows tab types in a switcher, history/settings/calendar as tabs.
- **Mac vs iPhone (original):** —
- **Original files:** `src/types/index.ts` (`SpaceId`, `TabType` adds pdf, tags, history, settings, calendar), `Sidebar.tsx` (856), `src/mobile/navigation/{BottomNav,experiences,TabTypeSwitcher}.ts(x)`.
- **Known original defects:** —
- **Native Mac / iPhone:** ✅ / ✅ — Spaces as tab types, ⌘1–5
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### U02 Vertical tabs, sessions, archive
- **Original (both):** Arc-style vertical tab lists, sessions (named tab groups), archived groups, MRU, auto-close, move/duplicate/rename/close others, drag reorder (Mac), tab grid cards (iPhone), saved workspaces.
- **Mac vs iPhone (original):** —
- **Original files:** `src/components/shell/{Sidebar,TabBar,TabSwitcher,SessionSwitcher}.tsx`, `src/components/ui/TabStrip.tsx`, `src/mobile/tabs/*`, `src/store/{index,tabPersistence,tabPersistenceRuntime}.ts`, `sessionsService.ts`.
- **Known original defects:** Large store coupling; `tabPersistenceRuntime` exists to reconcile store↔DB.
- **Native Mac / iPhone:** ✅ / ✅ — Unified Workspaces (ADR-0011), archive, ordered tab list
- **Native files:** Sidebar.swift, AppModel+TabList.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### U03 Pinned tabs
- **Original (both):** `Tab.isPinned` is persisted (`tabs.is_pinned`), synced, and respected by close actions/labels on iPhone, but no code anywhere sets it true (grep of `isPinned:` assignments finds only the readers/serialisers). No pin UI on either platform. (Note pinning is separate and works: `Note.pinned`.)
- **Mac vs iPhone (original):** —
- **Original files:** `src/types/index.ts:315`, `tabPersistence.ts:191`, `tabFields.ts:139`, `src/mobile/tabs/TabCardsSheet.tsx`, `TabList.tsx`. 7. dead capability. 8. none. 9. Decide before port. 11. C-DATA.
- **Known original defects:** —
- **Native Mac / iPhone:** ✅ / ✅ — Pin/unpin + drag into Pinned (native adds setter)
- **Native files:** Sidebar.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### U04 Tab and session persistence
- **Original (both):** Tabs/sessions hydrate from SQLite rows at startup, Zustand persisted to localStorage (debounced 5 s via `debouncedStorage`), flushed before quit/background.
- **Mac vs iPhone (original):** —
- **Original files:** `src/store/{tabPersistence,tabPersistenceRuntime}.ts`, `src/lib/debouncedStorage.ts`. 3. dual persistence (localStorage + DB mirror). 4. none. 5. `TabRow` with `local_state_json` excluded from sync. 6. same. 7. Two stores of truth for tab structure (INFERRED risk). 8. `tabPersistence.test.ts`, `tabP
- **Known original defects:** —
- **Native Mac / iPhone:** ✅ / ✅ — Synced sessions/tabs tables, relaunch restore
- **Native files:** SessionsService
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### U05 Workspaces and layouts
- **Original (both):** Saved workspaces (layout + tab snapshot, named "Saved sessions" in UI); 16 Scripture layouts (mosaic trees) with LayoutPicker; per-window layout state.
- **Mac vs iPhone (original):** —
- **Original files:** `src/components/bible/LayoutPicker.tsx`, `src/components/shell/PanelLayout.tsx` (react-mosaic-component), `src/lib/workspaceSnapshot.ts`, `workspacesService.ts`, `WorkspacesSection.tsx`, `src/mobile/tabs/WorkspacesPage.tsx`.
- **Known original defects:** CLAUDE.md says 6 presets, code has 16. 8. `workspaceRestore.test.ts`, `workspacesService` contract test not found (`workspacesService` has no contract test in the list — VERIFIED absence). 9. SW-UI (`NSSplitView`/`NavigationSplitView` or custom pane manager). 10. Resizable pane layout engine has no 
- **Native Mac / iPhone:** ✅ / 🟡 — 16 layouts (Mac); saved workspaces both
- **Native files:** ScriptureLayouts.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### U06 Resizable panels, drag and drop
- **Original (both):** Mosaic dividers, panel resize handles, right-panel width, tab drag between spaces/sessions, note drag to folders, block drag in editor.
- **Mac vs iPhone (original):** —
- **Original files:** `ResizeHandle.tsx`, `PanelLayout.tsx`, `Sidebar.tsx`, `NotesFolderView.tsx`, `blockHandles.ts`. 3. DOM drag events/react-mosaic. 4. HTML5 DnD. 5. layout JSON. 6. iPhone uses long-press/sheets. 7. none specific. 8. `blockHandles*.test.ts`, `folderTreeGeometry.test.tsx`, `inspectorLayout.test.ts`. 9. 
- **Known original defects:** —
- **Native Mac / iPhone:** 🟡 / — — Split panes; no drag tabs into panes
- **Native files:** ScriptureLayouts.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### U07 Multi-window, floating panels, presenter/viewer
- **Original (both):** Synced peer windows, independent windows, floating tab windows, floating hover panel/rail, verse-picker window, Berean Chat window, Study Trail window, presenter/viewer window mirroring the main Bible panel (scroll fraction, outline band, content/settings sync).
- **Mac vs iPhone (original):** —
- **Original files:** `electron/main.ts` (window creators ~lines 789–1134), `src/lib/{crossWindowSync,floatingTab,perWindowViewState,presenterBand,presenterOverlay,windowChrome}.ts`, `src/hooks/useViewerSync.ts`, `src/components/viewer/*`, `src/components/bible/PresenterOutline.tsx`, `src/components/shell/{FloatingShell,
- **Known original defects:** Heavy debug instrumentation hooks (`window.__bereanPresenterDebug`). Pending-save flush when returning a floating tab (`flushPendingSaves`).
- **Native Mac / iPhone:** ❌ / — — Single window only (no floating tabs/presenter/Study Trail window)
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### U08 Navigation state and history stacks
- **Original (both):** Per-tab back/forward stacks, origin-tab return, scroll resets, "Study Trail" integration on navigation; `navigateToVerse` single entry point with `NavOrigin`.
- **Mac vs iPhone (original):** —
- **Original files:** `src/store/index.ts`, `src/lib/verseNavigation.ts`, `src/lib/navigation/*`, `docs/navigation-contract.md`, `src/mobile/navigation/*`. 3. store actions. 4. none. 5. `TabNavEntry`. 6. iPhone edge-swipe. 7. contract doc must be kept in sync. 8. `perTabHistory.test.ts`, `originTabReturn.test.ts`, `fresh
- **Known original defects:** —
- **Native Mac / iPhone:** ✅ / 🟡 — Per-tab history; [sidebar ‹ ›] group (Mac); iPhone Back/Forward in More
- **Native files:** MacRootView.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### U09 Menus, context actions, commands
- **Original (both):** Native macOS app menu built in main (`buildAppMenu`) with actions dispatched to renderer as custom events; command palette list (30 commands); native image menu; iPhone caret command sheet.
- **Mac vs iPhone (original):** —
- **Original files:** `electron/main.ts` (line 376), `src/lib/commands.ts`, `src/mobile/commands/*`, `src/App.tsx`.
- **Known original defects:** —
- **Native Mac / iPhone:** 🟡 / 🟡 — Menus/context menus partial; no Commands group in ⌘K
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### U10 Keyboard shortcuts
- **Original (both):** Global handler in `App.tsx` (19 meta-key references) plus panel-local handlers; shortcut list shown in Onboarding and Settings (read-only); CLAUDE.md table (Cmd+1–5, Cmd+Shift+L, etc.) is only partly verified.
- **Mac vs iPhone (original):** —
- **Original files:** `src/App.tsx`, `src/lib/commands.ts`, `src/components/shell/ShortcutKeys.tsx`, onboarding `StepShortcuts`. 3. keydown handlers. 4. none. 5. n/a. 6. Mac only; iPad deferred. 7. No shortcut editing (documented deferred). Individual shortcut parity with CLAUDE.md UNVERIFIED. 8. `menuKeyNav.test.ts`, `k
- **Known original defects:** —
- **Native Mac / iPhone:** 🟡 / — — Core shortcuts; no shortcuts list in Settings
- **Native files:** BereanMacApp.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### U11 Themes and appearance
- **Original (both):** 38 theme presets (family-grouped, light/dark variants, optional ambient animation), custom themes, contrast helpers, accent colour from system, reduce-transparency/increase-contrast hooks, Liquid Glass on Mac (native addon) and iPhone (plugin), design-system doc.
- **Mac vs iPhone (original):** —
- **Original files:** `src/lib/{themePresets,customTheme,applyTheme,contrast}.ts`, `src/components/settings/{ThemePicker,ThemePreviewCard}.tsx`, `src/platform/liquidGlass/*`, `native/mac-liquid-glass/berean_glass.m`, `BereanGlassPlugin.swift` (492 lines), `docs/{design-system,liquid-glass}.md`.
- **Known original defects:** —
- **Native Mac / iPhone:** ✅ / ✅ — System/light/dark; dark mode visually checked on Mac reader/search
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### U12 Settings
- **Original (both):** Settings modal (Mac) with ~16 sections (Display, Texts, Layout, Notes, YouTube, Audio, iCloud, Updates, History, Print/Export, Sessions, Workspaces, Import, Word replacer, Ask Berean/Local models, Experimental, About, Danger) and iPhone pages.
- **Mac vs iPhone (original):** —
- **Original files:** `src/components/settings/*`, `src/mobile/settings/*`. 3. store-backed switches; `settings` table. 4. none. 5. `settings(key,value JSON)`; many prefs only in localStorage. 6. different pages. 7. SettingsModal is a very large monolith (INFERRED). 8. `settings/sections/__tests__` exists; `settingsServi
- **Known original defects:** —
- **Native Mac / iPhone:** 🟡 / 🟡 — Reading, Appearance, Workspaces, Library. Missing many sections (Texts, Shortcuts, About, Notes, YouTube, AI, Read Aloud)
- **Native files:** SettingsView.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### U13 Onboarding and hints
- **Original (both):** First-run wizard (welcome, translation, vault, import, Ask Berean model step, shortcuts, done); iPhone 4-page flow incl. iCloud opt-in. CLAUDE.md's per-feature hint tooltips with "Don't show again" are not present (grep for hint/dismiss state finds none).
- **Mac vs iPhone (original):** —
- **Original files:** `src/components/shell/{Onboarding,OnboardingModelStep}.tsx`, `src/mobile/onboarding/*`, `TasksPanel.tsx` (first-steps checklist, Mac only). 3. flags in store. 4. none. 5. `onboardingCompleted`. 6. different flows; no Tasks panel on iPhone. 7. Hints absent. 8. `Onboarding.maybeImportVault.test.ts`, `
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / ❌ — Onboarding not ported
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### U14 Study Trail
- **Original (both):** Records navigation as a graph (sessions, nodes, connections), reason-prompt popovers on chapter jumps, arrival prompt eligibility rules, map/threads/everything/search views, sticky notes, tags, merge/split, recap, embeds in notes (`study_trail_embed` node), own window (Mac) and page (iPhone, hosting the desktop views).
- **Mac vs iPhone (original):** —
- **Original files:** `src/store/studyTrailSlice.ts` (1091), `src/platform/services/studyTrailService.ts` (1223), `electron/ipc/studyTrail.ts`, `src/components/studyTrail/*` (MapView, StudyTrailApp, …), `src/lib/studyTrail/arrivalEligibility.ts`, `src/mobile/trail/*`, migrations v28–40.
- **Known original defects:** Several `stub` mentions inside trail components (grep) — INFERRED placeholders. Not in CLAUDE.md.
- **Native Mac / iPhone:** ❌ / ❌ — Study Trail not ported (1223-line service)
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### U15 Tasks panel and first steps
- **Original (both):** Checklist of first steps. 2. `src/components/shell/TasksPanel.tsx`. 3–5 trivial. 6. no iPhone equivalent (VERIFIED: only desktop references). 7. none. 8. none. 9. SW-UI. 10. Low. 11. C-HOST.
- **Mac vs iPhone (original):** —
- **Original files:** —
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / — — Tasks panel not ported
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### U16 Tags and tag graph
- **Original (both):** Verse tags (named, coloured, member refs as spans), chapter-tag narrowing, tag manager, tag graph with force layout, edges with editor, co-occurrence, search by tag, tagged verse browsing.
- **Mac vs iPhone (original):** —
- **Original files:** `src/platform/services/{verseTagsService,tagGraphService}.ts`, `electron/ipc/{verseTags,tagGraph}.ts`, `src/components/tags/*`, `src/lib/{tagPalette,verseTagRanges,verseTagSearch,tagRefScan}.ts`, `src/mobile/study/TagPickerSheet.tsx`. 3. members expanded to `verse_tag_verse` index (rebuilt on sync a
- **Known original defects:** —
- **Native Mac / iPhone:** 🟡 / 🟡 — Verse tags (golden), chips, picker, #tag search. Missing tag manager / tag graph
- **Native files:** VerseTagsService.swift, VerseTagViews.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### U17 PDFs
- **Original (both):** Library with import (dialog on Mac; file input on iPhone), pdf.js viewer, find bar, highlights, bookmarks, outline, copy-link `berean://pdf/<id>/<page>`; metadata synced, bytes not; Mac files in `userData/pdfs/<id>.pdf`; iPhone `Library/Berean/pdfs`. Feature-flagged (`pdfFeatureEnabled`, Settings → Experimental).
- **Mac vs iPhone (original):** —
- **Original files:** `src/components/pdf/*`, `electron/ipc/pdf.ts`, `src/platform/services/pdfService.ts`, `src/lib/pdfjs.ts`, `src/platform/ios/bridgeExtras.ts` (`pdf`), iPhone `PdfLibraryPage` in `MobileApp.tsx`, Share Extension PDF intake.
- **Known original defects:** Bytes never sync (documented). 8. none for pdf components; `bereanMigrations` v11/v46 only. 9. SW-UI with PDFKit (`PDFView`) — a strong native fit; highlights via `PDFAnnotation`. 10. Highlight geometry must map from pdf.js text-layer coordinates to PDFKit selections (INFERRED, medium). 11. C-DATA.
- **Native Mac / iPhone:** ❌ / ❌ — PDFs not ported
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### U18 Berean Chat (notes-style chat)
- **Original (both):** A Messages-style notes/chat surface using `ai_chats` rows; list, days, conversations, folders, search, reply quotes, composer (ProseMirror), find in conversation, window or tab; iPhone page and Home Screen widget "New Message".
- **Mac vs iPhone (original):** —
- **Original files:** `src/components/ailookup/*`, `src/mobile/chat/*`, `ios/App/BereanWidget/BereanChatWidget.swift`, `src/platform/services/aiChatsService.ts`, `docs/berean-chat.md`.
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / ❌ — Berean Chat not ported
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### M01 YouTube browsing and playback
- **Original (both):** Mac: Electron `<webview persist:youtube>` for login/browse/watch, allow-listed channel feed (hard-coded `CHANNELS` array of 15+ handles in `electron/ipc/youtube.ts`), feed fetched by scraping channel pages (`executeJavaScript(EXTRACT_JS)` in hidden windows), search videos, stars, watch history, resume positions, 11 layouts with secondary panels (notes/scripture/lexicon beside video). iPhone: native `WKWebView` overlay (`BereanWebViewPlugin`) loading the embed from an https base because the embed refuses the `capacitor://` origin; IFrame API relays position and end.
- **Mac vs iPhone (original):** —
- **Original files:** `src/components/youtube/{YouTubeTab(2763),YouTubeSecondaryPanel,TouchYouTubePlayer,TranscriptViewer}.tsx`, `electron/ipc/youtube.ts` (1428), `src/platform/services/{youtubeService,youtubeFetchService,youtubeIndexMerge}.ts`, `src/lib/{youtubeLayouts,youtubeSearch,youtubeTitle}.ts`, `BereanWebViewPlug
- **Known original defects:** Scraping is brittle and a ToS exposure; CLAUDE.md claims a user-editable allowlist with add-channel prompt, but channels are hard-coded (VERIFIED). WebKit blocks programmatic PiP without a user gesture (iPhone doc). The `webviewTag: true` line carries a stale comment saying it is disabled in MAS.
- **Native Mac / iPhone:** ❌ / ❌ — YouTube not ported
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### M02 Picture-in-Picture
- **Original (both):** Mac auto-PiP: when leaving the YouTube space with a playing video and `autoPiP` on, `webview.executeJavaScript` calls `video.requestPictureInPicture()`; returning exits it; Cmd+Shift+P toggles; tested only manually. `PiPController.tsx` is a dead stub returning null ("Phase 4 stub") — abandoned file. iPhone: system PiP only from the native player's fullscreen controls (no auto-PiP).
- **Mac vs iPhone (original):** —
- **Original files:** `src/components/youtube/{YouTubeTab.tsx (~1099–1140),PiPController.tsx}`, `src/store/index.ts` (`autoPiP`). 3. DOM PiP API inside the embedded page. 4. Chromium/WebKit. 5. setting `autoPiP`. 6. as above. 7. depends on YouTube page DOM. 8. none. 9. `AVPictureInPictureController` over an `AVPlayer` is
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### M03 Video-linked notes and timestamps
- **Original (both):** Insert `[Title — mm:ss](https://youtu.be/ID?t=N)` into the active note (Cmd+Shift+L on Mac; "Insert video timestamp" action on iPhone), notes beside video, `berean://video/<id>?t=` deep links, transcript click seeks.
- **Mac vs iPhone (original):** —
- **Original files:** `YouTubeTab.tsx` (`insertTimestamp` ~1487), `NoteEditorPM.tsx` listener, `deepLinks.ts`, `NoteEditorPage`. 3. window events `berean:requestTimestamp`/`berean:insertTimestamp`. 4. none. 5. markdown link text. 6. both. 7. CLAUDE.md timestamp-format setting not found. 8. `deepLinks.test.ts`, `deepLinkD
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### M04 Transcripts and transcript search
- **Original (both):** Transcripts for allow-listed channels are fetched in dev builds only (`fetchTranscripts`/`clearTranscripts` gated by `is.dev` and `devToolsEnabled`), baked into `youtube_seed.db`, shipped read-only; FTS5 over transcript segments; synced transcript viewer with seek; iPhone downloads per-channel transcript packs (resumable, SHA-256 verified via `BereanDownloadsPlugin`) and merges them into the local DB.
- **Mac vs iPhone (original):** —
- **Original files:** `electron/ipc/{youtube,youtubeTranscriptCore}.ts`, `scripts/export-transcript-seed.js`, `scripts/data/split-youtube-seed.mjs` (referenced), `src/mobile/youtube/{transcriptPacks.ts,TranscriptPacksPage.tsx}`, `BereanDownloadsPlugin.swift`, `youtubeIndexMerge.ts`.
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### M05 Read Aloud engine (Kokoro)
- **Original (both):** Chapter/passage speech with Kokoro-82M (ONNX q8) in a Web Worker on Mac; chunking by sentences, audio cache (`tts-audio-cache` PCM + LRU index), pitch-preserving playback rate via `HTMLAudioElement.preservesPitch`, voice picker with tiers, queue/playlists, progress bar, cross-window sync, auto-advance. iPhone: native ONNX Runtime synthesis (`BereanVoicePackPlugin.synthesize`, `onnxruntime-swift-package-manager` 1.24.2) with voice pack download, plus the curated Apple voices fallback (`BereanSpeechPlugin`).
- **Mac vs iPhone (original):** —
- **Original files:** `src/lib/tts/{ttsEngine,ttsBackend,textPrep,extractSpokenText,nativeSpeechBackend}.ts`, `src/lib/tts/kokoro/*`, `src/hooks/{useTTSPlayback,useKokoroModelDownload}.ts`, `src/components/audio/*`, `electron/ipc/{ttsModel,ttsAudioCache}.ts`, `electron/{ttsModelManifest,ttsModelProtocol}.ts`, `src/mobile
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / ❌ — Read Aloud not ported
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### M06 Audio playback, seeking, queue and background
- **Original (both):** Pause/resume, rate, skip verse, queue popover, saved playlists with autosave of the queue (800 ms debounce), sleep timer (iPhone), chapter progress bar seeking, lock-screen Now Playing and remote commands via `BereanAudioPlugin` (`.playback` category, `UIBackgroundModes: audio`).
- **Mac vs iPhone (original):** —
- **Original files:** `src/components/audio/*`, `src/hooks/useQueueAutosave.ts`, `src/mobile/audio/{AudioBar,AudioSheet,QueuePage,audioControls,followState,sleepTimer,useIosAudioSession}.ts(x)`, `playlistsService.ts`. 3. store playback state; plugin events. 4. AVAudioSession/MediaPlayer. 5. `playlists`, `playlist_items`.
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### M07 Word-follow highlighting
- **Original (both):** Per-word highlight during playback by distributing each chunk's real audio duration proportionally over characters (`timestampAlignment.ts` header says Kokoro does not expose alignment; the timestamped model variant was not adopted); Apple voices use `boundary` events with char offsets.
- **Mac vs iPhone (original):** —
- **Original files:** `src/lib/tts/kokoro/timestampAlignment.ts`, `nativeSpeechBackend.ts`, `VerseRow.tsx`, `src/mobile/audio/followState.ts`. 3. char-position map from tagged tokens (`taggedTokenCharPos`). 4. none. 5. n/a. 6. same. 7. Drift on long chunks (INFERRED from method). 8. `timestampAlignment.test.ts`, `audioFo
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### M08 Voice downloads and caching
- **Original (both):** Mac: opt-in pack download into `userData/tts-models` (temp dir + atomic rename, size-verified), served to the worker via `berean-model://` protocol; iPhone: sequential file download to `Application Support/Berean/tts-models` with background task and manifest written last; audio cache LRU with size cap on Mac.
- **Mac vs iPhone (original):** —
- **Original files:** `electron/ipc/ttsModel.ts`, `electron/ttsModelProtocol.ts`, `BereanVoicePackPlugin.swift`, `src/platform/ios/voicePack.ts`, `src/lib/tts/kokoro/{audioCacheStore,modelDownloadState}.ts`. 3. fetch/URLSession. 4. Hugging Face hosting. 5. manifest file list from `ttsModelManifest.ts` shared by both. 6. 
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### M09 Sleep timer (iPhone)
- **Original (both):** Read Aloud sleep timer with presets; stops playback at expiry.
- **Mac vs iPhone (original):** —
- **Original files:** `src/mobile/audio/sleepTimer.ts`, `AudioSheet.tsx`. 3. timer state in the audio sheet. 4. none. 5. none persisted (INFERRED). 6. iPhone only. 7. Only one file in `docs/` mentions it (grep). 8. `src/mobile/__tests__/audioSleepTimer.test.ts`. 9. SW-UI + `AVAudioPlayer`/engine stop. 10. Low. 11. C-HOST
- **Known original defects:** —
- **Native Mac / iPhone:** — / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### G01 Direct references and Strong's without a model
- **Original (both):** John-3:16-style references, Strong's ids, lexical studies (forms, glosses), word tables, occurrence counts, comparisons (e.g. two Strong's), follow-up resolution ("now only Greek", "the second") — answered from DBs with no model; keyword fallback labelled `NO_MODEL_INSTALLED`.
- **Mac vs iPhone (original):** —
- **Original files:** `src/platform/services/{modelFreeLookup,researchService}.ts`, `src/lib/research/{references,strongsId,lexicalIntent,compareIntent,compareWords,conversationState,exclusions}.ts`, `src/components/ailookup/{ComparisonView,ResearchResults}.tsx`.
- **Known original defects:** Intent detection is regex/heuristic; coverage limited to patterns tested.
- **Native Mac / iPhone:** ❌ / ❌ — Ask Berean not ported
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### G02 Local model runtime (Ollama), model picker, downloads
- **Original (both):** Requires the user's own Ollama on `localhost:11434`; model list, pull with progress, cancel, remove, catalog of 5 models (qwen3.5:2b, gemma4:12b-it-qat, llama3.1, llama3.2:3b, ministral-3:3b) with tiers; Automatic ordering and memory-gated escalation for Deep Search; onboarding model step. The resumable SHA-verified downloader (`modelDownloader.ts`) is NOT wired (VERIFIED); pulls go through Ollama's `/api/pull`. No bundled runtime or model; a full new download was not tested (SPEC_STATUS).
- **Mac vs iPhone (original):** —
- **Original files:** `electron/{ollama,modelGateway}.ts`, `electron/ipc/aiModels.ts`, `src/lib/research/{modelCatalog,modelChoice,modelRouting}.ts`, `src/components/settings/sections/LocalModelsSettings.tsx`, `OnboardingModelStep.tsx`.
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### G03 Ask Berean modes (Commentary ON/OFF), prose stripping, premise check
- **Original (both):** Commentary OFF strips interpretive prose in the main process and shows references only; ON adds model commentary (prompt-level, adaptive depth); premise check and its notice; "interpretation offered" prompt; nonexistent-reference scrubbing (`removeNonexistentReferences`).
- **Mac vs iPhone (original):** —
- **Original files:** `electron/ipc/aiLookup.ts`, `src/lib/research/{modePolicy,commentaryDepth,premise,outputGuard,policy}.ts`, `src/store/aiModeMigration.ts`, `src/components/ailookup/chatModes.ts`.
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### G04 Deep Search, escalation, cancel and time budgets
- **Original (both):** Multi-round retrieval with refine pass, automatic larger-model escalation (installed, local, Deep Search only, memory-gated: `chooseLocalModel(…, totalMemoryBytes)` verified), Stop/cancel via `ailookup:cancel` and `AbortSignal`, findings view; budgets are per-call timeouts only (120 s for large models); no per-question budget.
- **Mac vs iPhone (original):** —
- **Original files:** `electron/ipc/aiLookup.ts` (`agentic` option, line ~2668/2691), `electron/modelGateway.ts` (cancellable, `LARGE_MODEL_TIMEOUT_MS = 120_000`), `src/components/ailookup/ResearchFindings.tsx`, `electron/tokenBudget.ts`.
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / — — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### G05 Collections, study profiles, saved contexts, memory
- **Original (both):** Collections (canon, apocrypha, pseudepigrapha, fathers, notes, etc.), study profiles (per-profile model, scope, mode, instructions) with Mac and iPhone UI, explicitly saved research contexts, cross-chat memory only by explicit save, profile instructions with no adversarial test set.
- **Mac vs iPhone (original):** —
- **Original files:** `src/lib/research/{collections,studyProfile}.ts`, `src/platform/services/{studyProfilesService,savedContextsService}.ts`, `src/components/ailookup/{useStudyProfiles,profileActivation}.ts`, `src/mobile/chat/AskOptionsPage.tsx`, `src/mobile/settings/AskBereanSettingsPage.tsx`; migration v49.
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### G06 Verse-note influence and note exclusion
- **Original (both):** Notes can be excluded (note or folder) and are never used; an excluded note is never sent; verse notes add a fixed ranking boost and referenced verses feed retrieval; Mac only; "notes never outrank text"; injected-note scenario tested.
- **Mac vs iPhone (original):** —
- **Original files:** `src/lib/research/noteExclusion.ts`, `aiLookup.ts`, `notesService.setAiExcluded/folderSetAiExcluded`, `docs/ai-upgrade/SPEC_STATUS.md` decisions 16/22.
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### G07 Cloud model (BYO key)
- **Original (both):** Anthropic only (`providers.ts` registers `id: 'anthropic'`); key saved via Electron `safeStorage` (Keychain-backed) into `provider-keys.json` (base64 ciphertext, 0600), never sent to the renderer; routing is explicit-opt-in (`cloudEnabled`, key + model set, policy allows, never as a response to local failure); private-context flag; mocks only — no real call was made (SPEC_STATUS: "Done, unverified by hand").
- **Mac vs iPhone (original):** —
- **Original files:** `electron/secrets/{providerKeys,providerSettings}.ts`, `electron/ipc/aiProviders.ts`, `src/lib/research/{providers,policy}.ts`, `src/components/ailookup/cloudSettingsUi` tests, `SUBSCRIPTIONS.md`.
- **Known original defects:** ChatGPT plan connection and general web search blocked on decisions (SPEC). Key format validation is length/whitespace only.
- **Native Mac / iPhone:** ❌ / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### G08 Online research (Wikipedia, Sefaria)
- **Original (both):** Keyless Wikipedia and Sefaria queries; only content words leave the device; results rendered as labelled cards, never fed to a model prompt; Commentary OFF shows title+link only; default off, ask, or automatic with Deep Search; implemented on both platforms; general web search blocked on a provider decision.
- **Mac vs iPhone (original):** —
- **Original files:** `src/lib/research/webResearch.ts`, `electron/ipc/aiProviders.ts`, `src/platform/ios/{bridgeExtras,onlineResearchSetting}.ts`. 3. fetch via `net.fetch` (Mac) / CapacitorHttp (iPhone). 4. Wikimedia/Sefaria APIs. 5. `ExternalSource`. 6. iPhone real search in simulator only (SPEC). 7. Live API shape pro
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### G09 Retrieval benchmark and evaluation harness
- **Original (both):** Case files, holdout (`HOLDOUT.lock`), retrieval eval and semantic eval scripts; SPEC says no fresh independent holdout so no new independent quality claim.
- **Mac vs iPhone (original):** —
- **Original files:** `scripts/eval/*`, `docs/ai-upgrade/*`. 3–5 offline; 6. Mac dev only. 7. Human-review page has no entries (SPEC). 8. harness itself is the test (`vitest.eval.config.ts`). 9. Rebuild eval in Swift test target or keep Node tooling. 10. Needed to prove parity. 11. C-DATA.
- **Known original defects:** —
- **Native Mac / iPhone:** — / — — Dev tooling
- **Native files:** 
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### G10 iPhone Ask Berean (model-free)
- **Original (both):** On iPhone the Ask surface runs only the deterministic path (G01), profile/scope/mode screens, saved context, online research; no local model, no cloud model, no Deep Search (SPEC: "Partial; Local model blocked").
- **Mac vs iPhone (original):** —
- **Original files:** `src/mobile/chat/{ChatPage,AskOptionsPage}.tsx`, `src/platform/ios/bridgeExtras.ts` (`aiLookup`). 3. renderer. 4. none. 5. same chat rows. 6. see 1. 7. low-memory behaviour BLOCKED. 8. `chatController.test.tsx`. 9. SW-UI + services. 10. Foundation Models/MLX decisions. 11. C-DATA.
- **Known original defects:** —
- **Native Mac / iPhone:** — / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### A01 iCloud sync (journal)
- **Original (both):** See X6. Per-device folder under the ubiquity container (`Documents/sync/v1`), HLC-ordered ops, snapshots/compaction, conflict records, holds on account/container mismatch, identity isolation (prod vs dev containers).
- **Mac vs iPhone (original):** —
- **Original files:** `src/platform/sync/*`, `electron/sync/*`, `native/mac-icloud/berean_icloud.m`, `BereanCloudPlugin.swift`, `src/platform/ios/{cloudSyncStore,syncHost}.ts`, `src/components/settings/sections/ICloudSection.tsx`, `docs/mobile/{icloud,sync,icloud-lifecycle,data-safety}.md`.
- **Known original defects:** Real-iCloud device matrix pending (docs) — BLOCKED; engine tested with a simulator (`icloudDriveSim.ts`). Uses iCloud Drive files not CloudKit (no push; polling + metadata query). `1404`-line engine.
- **Native Mac / iPhone:** ❌ / ❌ — Sync engine port pending (M4, OD-5 gates)
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### A02 Keychain / secure storage
- **Original (both):** Mac: `safeStorage` for BYO cloud keys only. No other secrets. `electron/youtube-key.ts` is a build-time gitignored file (YouTube Data API key) embedded in the app (value never read; whether bundled into the renderer is UNVERIFIED). iPhone: none.
- **Mac vs iPhone (original):** —
- **Original files:** `electron/secrets/*`, `electron/youtube-key.example.ts`. 3–6 above. 7. Embedding an API key in a shipped binary is extractable (INFERRED). 8. `providerKeys.test.ts`. 9. Keychain Services. 10. Key migration impossible. 11. n/a.
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### A03 App Groups and Share Extension
- **Original (both):** Share Sheet extension collects text (reference → open passage, other text → note), URLs (YouTube → video), PDFs into the App Group inbox then opens `<scheme>://share`; the app's `BereanShareInboxPlugin` hands items to the deep-link router.
- **Mac vs iPhone (original):** —
- **Original files:** `ios/App/ShareExtension/{ShareViewController.swift,Info.plist,ShareExtension.entitlements}`, `BereanShareInboxPlugin.swift`, `src/platform/ios/shareInbox.ts`. 3. App Group container files. 4. App Group id from `$(BEREAN_APP_GROUP)`. 5. inbox JSON items. 6. iPhone only. 7. crash-safe inbox hardening 
- **Known original defects:** —
- **Native Mac / iPhone:** — / ❌ — Share Extension not built for native
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### A04 Spotlight
- **Original (both):** Core Spotlight index of notes, sessions, workspaces, books and chapters; deep link ids; incremental on `data:changed`; verses not indexed.
- **Mac vs iPhone (original):** —
- **Original files:** `BereanSpotlightPlugin.swift`, `src/platform/ios/spotlight.ts`. 3. `CSSearchableIndex`. 4. CoreSpotlight. 5. identifier = deep link URL. 6. none on Mac. 7. none. 8. none found. 9. Already native Swift; trivial to keep. 10. Low. 11. C-DATA.
- **Known original defects:** —
- **Native Mac / iPhone:** — / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### A05 App Intents and Siri Shortcuts
- **Original (both):** Intents: Open Scripture, Search Berean, Open Daily Note, Read Aloud, Open Workspace (and more past line 80, not read); each opens a deep link with `openAppWhenRun`.
- **Mac vs iPhone (original):** —
- **Original files:** `ios/App/App/BereanIntents.swift` (103 lines), `src/lib/deepLinks.ts`. 3. intents → URL → router. 4. AppIntents iOS 17. 5. deep-link grammar (13 routes). 6. iPhone only. 7. An `AppShortcutsProvider` exists at `BereanIntents.swift:95` (corrected after doc 08 review). 8. `deepLinks.test.ts`. 9. Native
- **Known original defects:** —
- **Native Mac / iPhone:** — / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### A06 Deep links and URL schemes
- **Original (both):** `berean://` (dev: `berean-dev://`) routes: verse, open, note, lexicon, video, pdf (legacy `berean-pdf://`), search, trail, daily, share, workspace, session, chat[/new], `&play=1`; Mac registers via `setAsDefaultProtocolClient` and second-instance argv; iPhone `appUrlOpen` with dedupe.
- **Mac vs iPhone (original):** —
- **Original files:** `src/lib/{deepLinks,deepLinkTarget}.ts`, `electron/main.ts` (line 1370), `src/platform/ios/deepLinks.ts`. 3. one router. 4. none. 5. grammar. 6. Universal Links not implemented. 7. none. 8. `deepLinks.test.ts`, `deepLinkDedupe.test.ts`. 9. SW-DATA router + `onOpenURL`. 10. Links already written into
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / ❌ — berean:// deep links not handled natively
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### A07 Widget
- **Original (both):** Static "New Message" widget (Home/Lock Screen) opening `<scheme>://chat/new`; no data in timeline.
- **Mac vs iPhone (original):** —
- **Original files:** `ios/App/BereanWidget/BereanChatWidget.swift`. 3–6 trivial. 7. none. 8. none. 9. already SwiftUI. 10. Low. 11. C-DATA.
- **Known original defects:** —
- **Native Mac / iPhone:** — / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### A08 File providers / document access
- **Original (both):** No File Provider extension. Mac MAS: security-scoped bookmarks for vault and sync folder (`sandbox-bookmarks.json`, max 32); iPhone: iCloud container is document-scope public (`NSUbiquitousContainerIsDocumentScopePublic`, folder levels any) so the folder appears in Files; document picker for PDF/md import; `@capacitor/filesystem`.
- **Mac vs iPhone (original):** —
- **Original files:** `electron/mac/folderAccess.ts`, `ios/App/App/Info.plist`, `src/platform/ios/bridgeExtras.ts`. 3. system APIs. 4. n/a. 5. bookmark map. 6. Mac sandbox only. 7. DMG build unsandboxed. 8. none found for folderAccess. 9. Native security-scoped bookmarks. 10. Medium. 11. C-DATA.
- **Known original defects:** —
- **Native Mac / iPhone:** 🟡 / 🟡 — Open/save panels, document picker
- **Native files:** NoteFileTransfer.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### A09 Notifications
- **Original (both):** No local or remote notification code (grep for `UNUserNotification`/`Notification(` finds none). 2. n/a. 7. VERIFIED by grep. 9. n/a.
- **Mac vs iPhone (original):** —
- **Original files:** —
- **Known original defects:** —
- **Native Mac / iPhone:** — / — — Deferred
- **Native files:** 
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### A10 App lifecycle
- **Original (both):** Mac: single instance with second-instance handling, will-quit export, autoUpdater (beta channel, manual or auto download), power events (`powerAwareness.ts`), nativeTheme push. iPhone: AppDelegate/SceneDelegate, Capacitor lifecycle, background audio, pagehide flush, `BereanPowerPlugin` (low power).
- **Mac vs iPhone (original):** —
- **Original files:** `electron/{main,powerAwareness}.ts`, `ios/App/App/*.swift`, `BereanPowerPlugin.swift`. 3. native events → renderer. 4. electron-updater. 5. n/a. 6. MAS uses Mac App Store updates, DMG uses electron-updater (`app:isMasBuild`). 7. none. 8. `entitlements.test.ts`, `packagedAssets.test.ts`, `scripts/smo
- **Known original defects:** —
- **Native Mac / iPhone:** ✅ / ✅ — Single-instance lock, autosave on quit
- **Native files:** AppModel.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### A11 Entitlements, sandbox, identity
- **Original (both):** Two identities (Berean `com.berean.app`, Berean Dev `com.berean.app.dev`) with separate containers, groups, URL schemes; MAS sandbox entitlements (JIT, unsigned exec memory, network.client, user-selected rw, bookmarks, iCloud); Developer ID hardened-runtime entitlements (JIT, unsigned memory, DYLD); verify scripts check signed artefacts.
- **Mac vs iPhone (original):** —
- **Original files:** `config/app-identity.json`, `build/entitlements.*.plist`, `scripts/mac/{verify-mas,package-mas,build-mas-dev,profileAuthorises}.mjs`, `scripts/ios/{identity,verify-identity,dev-safety-check}`, `electron/appIdentity.ts`, `src/platform/appIdentity.ts`, `ios/App/*.xcconfig`. 3. generated xcconfig per i
- **Known original defects:** —
- **Native Mac / iPhone:** ✅ / ✅ — Native dev identities isolated; device deploy guards
- **Native files:** scripts/native/ios-device.sh
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### A12 App Store requirements
- **Original (both):** iPhone privacy manifest present (`PrivacyInfo.xcprivacy` declares UserDefaults, file timestamp, disk space, boot time), `ITSAppUsesNonExemptEncryption=false`, location/photos usage strings, ATS local networking exception; Mac `privacy.md/html` docs; `audit-production.mjs` checks shipped content.
- **Mac vs iPhone (original):** —
- **Original files:** `ios/App/App/{Info.plist,PrivacyInfo.xcprivacy}`, `docs/{privacy.md,privacy.html,mac-app-store.md}`, `scripts/audit-production.mjs`. 3–6 n/a. 7. App Review exposure from YouTube scraping/BibleGateway credential flow (INFERRED); privacy manifest for third-party SDKs (onnxruntime) not audited. 8. `ios
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / ❌ — Release gate (not in scope)
- **Native files:** 
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### A13 Share/print/export to Files (iPhone)
- **Original (both):** `@capacitor/share` for text/markdown, `BereanPrintPlugin` for print/PDF. See N09. Status: implemented. 2–11 as N09 (iPhone side).
- **Mac vs iPhone (original):** —
- **Original files:** —
- **Known original defects:** —
- **Native Mac / iPhone:** 🟡 / 🟡 — Note share/export; no verse share sheet
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### A14 Accessibility
- **Original (both):** `BereanA11yPlugin.swift` (64 lines), `aria-label` usage in React; SPEC scenario 30 notes no VoiceOver pass. 2. `src/mobile/*`, plugin. 7. No VoiceOver audit (SPEC, BLOCKED device). 8. none. 9. Native a11y comes mostly free. 10. Web a11y gaps do not carry over. 11. n/a.
- **Mac vs iPhone (original):** —
- **Original files:** —
- **Known original defects:** —
- **Native Mac / iPhone:** 🟡 / 🟡 — Labels/hints on new controls; no full VoiceOver pass
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### A15 Auto-update and distribution (Mac)
- **Original (both):** `electron-updater` with GitHub Releases, stable/beta channel, GitHub Actions release workflow, DMG notarisation via `build/notarize.js`; MAS path separate. 2. `electron/main.ts`, `scripts/tag-release.js`, `.github` (not in this checkout listing). 7. Release CI not inspected. 8. none. 9. Sparkle or App Store only. 10. Update channel continuity for existing DMG users. 11. n/a.
- **Mac vs iPhone (original):** —
- **Original files:** —
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / — — Release gate
- **Native files:** 
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### O01 Deep-linked "Berean Dev" identity separation
- **Original (both):** 
- **Mac vs iPhone (original):** —
- **Original files:** —
- **Known original defects:** —
- **Native Mac / iPhone:** ✅ / ✅ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### O02 Crash report on next launch
- **Original (both):** 
- **Mac vs iPhone (original):** —
- **Original files:** —
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### O03 Hermas / Recognitions special-case handling
- **Original (both):** Hermas has two translations and a traditional numbering map (`hermasMap.ts`); Recognitions and Hermas rows are paragraph-sized "verses"; Taylor footnotes cross-refs; section titles. Files `src/lib/{hermasMap,prologueBooks,chapterNumbering}.ts`, `setHermasTextId` global in `parseRef.ts` (module-level mutable state, VERIFIED). 7. Global mutable setter is a hidden coupling. 8. `hermasMap.test.ts`, `hermasTaylor.test.ts`. 9. SW-DATA. 11. C-DATA.
- **Mac vs iPhone (original):** —
- **Original files:** —
- **Known original defects:** —
- **Native Mac / iPhone:** 🟡 / 🟡 — Hermas sections/Recognitions numbering in parser; Hermas translation choice not exposed
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### O04 Data publication pipeline
- **Original (both):** `scripts/publish-data.js` uploads `data/*.db` to a GitHub release for CI; `audit-production.mjs` guards packaged content. Native build must replace with an asset pipeline. Status: implemented, tooling only.
- **Mac vs iPhone (original):** —
- **Original files:** —
- **Known original defects:** —
- **Native Mac / iPhone:** — / — — Pipeline unaffected
- **Native files:** 
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### O05 Diagnostics and performance tooling
- **Original (both):** `src/lib/{perfMarks,perfSpan}.ts`, `scripts/perf/*`, `docs/performance-audit-2026-10-19.md`, `electron/devTools.ts` (dev-only guards), `src/platform/ios/{devProbe,perf,selfTest}.ts` (BEREAN_E2E_PROBE builds). 7. The probe must be absent from release (`npm run audit:prod`). 8. `devTools.test.ts`. 9. Instruments/`os_signpost`. 11. n/a.
- **Mac vs iPhone (original):** —
- **Original files:** —
- **Known original defects:** —
- **Native Mac / iPhone:** — / — — not started
- **Native files:** 
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).
