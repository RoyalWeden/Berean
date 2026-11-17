# Berean Native Migration — Append-only Engineering Log

> **Do not rewrite older entries** to conceal errors. Record supersessions/corrections with new entries. No user note content or secrets.

## Template entry (copy for each meaningful increment)

### YYYY-MM-DD HH:MM TZ — Task Mx-yy — STATUS
- **Agent/session context:**
- **Repository/worktree/branch and SHA before:**
- **Code changed:**
- **Actual behavior delivered:**
- **Commands and results:**
- **Data touched:** synthetic / isolated Dev / read-only copy / production (production prohibited without explicit approval)
- **Known failures, regressions and their fixes:**
- **Branch / commit / PR / CI link:**
- **Documentation/parity rows updated:**
- **Next exact action and its prerequisites:**

---

*Initial playbook/templates authored for handoff; no code migration results asserted.*

### 2026-11-07 17:50 PST — M0-02 / M0-03 — VERIFIED (cleanup), records initialized
- **Agent/session context:** Claude Code, owner-authorized native migration start (2026-11-07).
- **Repository/worktree/branch and SHA before:** `/Users/roywe/Berean` main `ceaaa73`.
- **Code changed:** none (Git housekeeping only).
- **Actual behavior delivered:** worktrees `Berean-ai-integrate`, `Berean-chat-rename`, `Berean-quick-open`, `Berean-ai-upgrade`
  removed with normal `git worktree remove`; their branches deleted with `git branch -d`; `worktree-agent-a0acb949f0128b5e6`
  kept because `-d` refused (unmerged). Everything first captured in `~/Berean-backups/cleanup-2026-11-07/` (refs bundle with all
  branches, tags, `refs/recovery/*`, both stashes; per-worktree patches and untracked/ignored archives; `SHA256SUMS` 17 OK).
- **Commands and results:** line-level containment check (chat-rename 54/54, quick-open 1,076/1,076, ai-upgrade 9,733/9,851 with the
  rest intentional rewrites); bundle restore test passed before deletion.
- **Data touched:** none (no user database, vault or iCloud journal opened).
- **Known failures:** first bundle attempt used an invalid rev spec (`refs/recovery/`); fixed with `--glob='refs/recovery/*'`.
- **Next exact action:** archive the benchmark REPORT.md (PR #13, docs only), then remove `Berean-ai-bench`.

### 2026-11-07 17:50 PST — M1-01 / M1-03 / M1-04 — IMPLEMENTED (CI pending)
- **Repository/worktree/branch and SHA before:** `/Users/roywe/Berean-native`, `native/m0-execution-records` from `ceaaa73`.
- **Code changed:** `Packages/BereanKit` (BereanCore: JSString/JSObject/JSValue, JSON.parse, JSON.stringify, Number::toString, FNV-1a;
  BereanSync: SyncHash, HLC + HybridLogicalClock, Journal, OrderKey); `apple/Berean.xcodeproj` + `apple/{BereanMac,BereanIOS,Shared,Config}`;
  `scripts/golden/{corpus,export}.ts`; `tests/unit/goldenCorpus.test.ts`; `scripts/native/build.sh`; npm scripts `golden:export`,
  `native:test`, `native:build:mac`, `native:build:ios`, `native:check`; CI job `native`; `.gitignore` entries.
- **Actual behavior delivered:** native Mac app (`com.berean.native.mac.dev`) launches and shows a core status view computed by
  BereanKit; iOS app (`com.berean.native.ios.dev`) builds for the Simulator. Swift reproduces every golden case.
- **Commands and results:** `npm run native:check` → BereanCoreTests 4 passed, BereanConformanceTests 19 passed, both builds succeeded,
  identity checks OK. `npx vitest run` → 390 files / 5,771 tests passed. `npm run typecheck` clean. Mutation checks: removing the key sort
  → 227 failed assertions; leaving a lone low surrogate unescaped → 305.
- **Data touched:** synthetic only.
- **Known failures and fixes:** the HLC fixture's `format` cases overwrote the file header `format: 1`; renamed to `formatCases` and the
  header now spreads last.
- **Documentation/parity rows updated:** STATUS, TASKS (statuses + 105-row parity ledger), DECISIONS (ADR-0001…0005, F-01…F-03), HANDOFF.
- **Next exact action:** open PR, wait for CI `check` + `native`, merge.

### 2026-11-07 18:25 PST — M1-03 — FIX (golden determinism across Node versions)
- **What failed:** PR #14 CI `check` job: `tests/unit/goldenCorpus.test.ts` reported core-json, sync-hash and journal fixtures stale.
  The CI runner uses Node 22; the fixtures were exported with Node 24. The corpus built some doubles as `r() * 10 ** n`, and V8
  versions differ in `Math.pow` for negative exponents, so the inputs themselves differed. (The native job passed.)
- **Fix:** such numbers are now built by parsing a decimal string (correctly rounded on every engine); the corpus rules forbid
  non-exact arithmetic; the drift guard now prints the first differing line.
- **Verified:** drift guard passes under Node 22.23.4 and Node 24.14.0; `swift test` still 23/23.

### 2026-11-07 17:59 PST — M2-01 (first part) / M1-02 — IMPLEMENTED (branch `native/m2-reference`, CI pending)
- **Code changed:** `Packages/BereanKit/Sources/BereanReference` (parseRef grammar, book tokens incl. fuzzy fallback,
  labels, canonical forms, Hermas sections, RCL3 chapter numbering); `BereanCore/JSText.swift` (JS trim/whitespace/parseInt/
  Number); `scripts/golden/swiftTables.ts` generates `Generated/ReferenceTables.swift` from the TypeScript tables (drift-guarded);
  golden `reference.json` (11.9k calls over 24 functions, both Hermas translations, boundaries); `scripts/native/gen_xcodeproj.py`
  (project generator, now in the repo); both apps link BereanReference and show a live reference parser.
- **Commands and results:** `npm run native:check` → 4 + 20 Swift tests pass, Mac + iOS builds OK, identities OK. Drift guard 7/7.
  Mutations: fuzzy distance 2 → 39 mismatches; verse cap 199 → 375; chapter cap +1 → 289 (boundary cases added after the
  first verse-cap mutation went unnoticed). iOS Simulator (iPhone 17 Pro) install + launch of `com.berean.native.ios.dev` OK.
- **Known gaps (documented in code):** JS Final_Sigma lowercasing not reproduced (no observable effect on book tokens);
  `Reference.parse` returns nil for chapter numbers beyond `Int` (Esther has no chapter cap); Swift Regex rejects class ranges
  starting at U+2000, so the whitespace class lists those scalars.
- **Data touched:** none.
- **Next exact action:** after PR #14 merges, open the PR for `native/m2-reference`; then Strong's ids (`strongsId.ts`),
  `findReferencesInText`, tagged tokens / DisplayMap (M2-02).

### 2026-11-07 18:03 PST — M0-02 — VERIFIED (cleanup complete)
- PR #13 (docs-only archive of the benchmark REPORT.md) merged as `a4e3d74`; worktree `Berean-docs-archive` removed and branch deleted.
- `Berean-ai-bench`: untracked `scripts/eval/bench/` and ignored `out/` verified byte-identical to `~/Berean-backups/cleanup-2026-11-07/
  ai-bench.untracked.tgz` / `ai-bench.ignored-unique.tgz` (only a regenerable `__pycache__` was not archived); no file newer than the
  backup; its `data/*.db` were symlinks into main. Removed `scripts/eval/bench/`, then normal `git worktree remove`; `git branch -d
  eval/ai-benchmark` succeeded (merged). Main's `data/berean.db` is the 0-byte placeholder it has been since 2026-05-27 (checked).
- Remaining branches kept on purpose: `feature/octarine-vault-integration` (owner question F-02), `worktree-agent-a0acb949f0128b5e6` (unmerged).

### 2026-11-07 18:05 PST — correction
- The entry headed "18:25 PST — M1-03 — FIX" was actually written at about 17:56 PST (clock misread). Content unchanged.

### 2026-11-07 18:40 PST — M2-03 / M2-04 (first part) — IMPLEMENTED (branch `native/m2-reference`)
- PR #14 merged (`ce37379`, CI check + native green). Main's untracked install copy of `docs/native-migration/` backed up to
  `~/Berean-backups/native-migration-install-copy-2026-11-07/` (SHA256SUMS; the five user-supplied files were byte-identical to
  the committed ones, the four templates are kept there), then removed so main could fast-forward; main clean at `ce37379`.
  Local branch `native/m0-execution-records` deleted (merged).
- **Code:** `BereanSQLite` (system SQLite, read-only), `BereanBible` (getBooks, queryChapter, queryVerse, queryVerses, searchText,
  cleanWords, safeFtsQuery, numberTokenAlternates); `StrongsId`; `Reference.findReferences`; golden `bible.json` (scripts/golden/bible.ts,
  skipped when data/*.db is absent) and `strongs.json`; native CI job downloads the text databases.
- **Results:** `swift test` 4 + 26 pass; drift guard 9/9. Mutations caught (book-name normalisation removed; any-mode cap 2999).
  Findings F-04 (number words) and F-05 (FTS tie order, SQLite 3.51.2 vs 3.54.0) recorded.
- **Data touched:** bundled corpora read-only; no user data.

### 2026-11-07 18:20 PST — M2-02 — IMPLEMENTED; PR #15 CI fix (FTS golden vs Node's SQLite)
- **CI failure:** PR #15 `check` reported bible.json stale. Text databases are byte-identical to the `data-v1` release; the cause
  is Node's bundled SQLite (Node 22 → 3.53.4 on CI, Node 24 → 3.51.2 locally) ordering equal-rank FTS rows differently (F-05).
  bible.json now records `sqliteVersion`; the drift guard compares search results by row set when versions differ and exactly
  otherwise. Re-exported with Node 22 (3.53.4); Swift on macOS SQLite 3.54.0 now matches every search exactly.
- **M2-02 code:** `BereanText` — `TaggedText.parse` (text_tagged tokens), `annotationRanges` (KJV italic / red letter),
  `OffsetMap` (display ⇄ original offsets, incl. a batch form that aligns once), `Annotations.strip` (LXX/Enoch/Jubilees).
  `JSRegex` moved to BereanCore, gained `replaceAll` ($n templates), and escapes "[" inside classes (Swift reads it as a nested class).
- **Golden:** `text.json` (scripts/golden/text.ts) digests tokens, ranges and offset maps for EVERY verse of KJVA and LXX, and
  stripping + offsets for every LXX/Enoch/Jubilees verse under each annotation toggle; all reproduced (full run ~60 s in debug).
- **Data touched:** bundled corpora read-only.

### 2026-11-07 18:35 PST — M2-04 (lexicon) — IMPLEMENTED
- `BereanBible.LexiconService`: getEntry, getRelated (Hebrew whole-number derivation match), search, getOccurrencePage — same SQL.
- Golden `lexicon.json` (scripts/golden/lexicon.ts): every Hebrew (H1–H8676) and Greek (G1–G5626) entry in 250-id digests, edge ids,
  related, 39 searches, 9 occurrence pages (with clamping cases); records the database sha256s. All reproduced; mutations caught.
- Not yet ported: `getOccurrences` (tag scan + match indices) and `findByNormalizedTransliteration`.

### 2026-11-07 18:50 PST — G2 progress — first native reader (Mac + iPhone Simulator)
- "Bundle corpora" build phase (scripts/native/gen_xcodeproj.py) copies kjva, kjv, lxx, strongs_hebrew, strongs_greek (read-only
  corpora, never user data) into the dev apps under Resources/Corpora; both apps link BereanBible + BereanText.
- `apple/Shared/Reader.swift`: KJVA chapter reader with KJV italics and red letter from text_tagged, optional Strong's numbers,
  previous/next chapter (crossing books), and one search field: a typed reference navigates, anything else runs FTS search.
  The core status view moved to an info sheet.
- Verified: Mac build + launch (Genesis 1 renders with italics); iOS Simulator (iPhone 17 Pro) build + launch renders Genesis 1.
  Search/navigation not yet driven by UI automation in this session.

### 2026-11-07 18:58 PST — PR #15 merged
- Merged as `c6531fd` (CI check + native green on head `2de429f`). Local `native/m2-reference` deleted; work continues on
  `native/m2-continued`.

### 2026-11-07 19:20 PST — Owner decisions OD-1…OD-5 applied; OD-4 deterministic search; OD-2 macOS 27 target
- Recorded OD-1…OD-5 (DECISIONS). OD-1: kept the shipped vault layout; Octarine branch archived as tag
  `archive/octarine-vault-integration` (pushed) and the local branch deleted after verifying main already carries its features.
- OD-4 (ADR-0008): stable tie-breakers on every FTS/notes search in legacy TS (bibleService, electron bible ×2, youtube ×2, notes ×2,
  aiLookup notes) and BereanBible. bible.json now identical on SQLite 3.51.2 / 3.53.4 and matched exactly by Swift on 3.54.0;
  tie-order allowances removed from the drift guard and the Swift suite. New tests in bibleService.contract.test.ts.
- OD-2 (ADR-0007): native Mac deployment target 27.0; native CI job → `macos-26` + newest Xcode 27.
- Results: vitest 390 files / 5,779 tests; typecheck clean; drift guard 11/11 on Node 22 and 24; Swift Bible suite exact; Mac build OK.

### 2026-11-07 19:55 PST — M2-02 complete (word replacer + verse display)
- `BereanText.WordReplacer` (apply, applyStrongs, searchVariants, strongsSearch) — JavaScript `/\bq\b/gi` semantics hand-implemented
  (Swift Regex has no lookbehind): non-unicode case canonicalisation table, ASCII word boundaries, stable rule ordering, cached
  compiled rules. `VerseDisplay` (text, tokens, studyTokens, matchWordIndices, glossWords, wordWindow). Default rules generated
  from `src/store/index.ts` into `Generated/DefaultWordReplacerRules.swift` (drift-guarded).
- Golden `display.json`: every KJVA verse (replacer on/off/custom rules, display tokens, study tokens, match indices) + every 7th
  verse of LXX/Enoch/KJV + hand cases. All reproduced.
- Native package tests now run in release mode (`scripts/native/build.sh test`): 4 + 33 tests in ~30 s.

### 2026-11-07 22:15 PST — M2 complete; gate G2 accepted
- PR #16 merged (`bfbf8ea`; OD-4 ordering + macOS 27 target; Mac build verified locally with Xcode 27.2 — hosted CI has no Xcode 27).
- `LexiconService.occurrences` (getOccurrences incl. LXX re-anchoring and phrase expansion), `CrossrefsService` (Classic, TSKe,
  Taylor-Hermas footnotes), `ChapterMap` (KJV⇄LXX numbering, versification notes; structural notes generated from TS). Legacy
  cross-reference queries gained the `rowid` tie-breaker (ADR-0008 extended to `ORDER BY votes DESC`).
- Goldens: lexicon.json (+14 occurrence cases), crossrefs.json (every book's first/middle/last chapter both datasets, LXX Psalms,
  verse cases, Hermas, the chapter map over chapters 0–152 for 8 books). All reproduced.
- B-15: the full BereanKit golden suite passes on the iOS Simulator (iOS 27.2, SQLite 3.51.0, FTS5) — `npm run native:test:ios`,
  now also a CI step. macOS: SQLite 3.54.0.
- G2 accepted (STATUS). Next: M3 (writable store on synthetic copies) in parallel with M6 Mac shell work on read-only data.

### 2026-11-07 22:45 PST — M3-01 (schema + migrations) — IMPLEMENTED
- `BereanSQLite`: read-write open, `exec`, `run`. `BereanStore`: `Migrator` (ADR-0009) and `UserDatabase` (WAL, foreign keys, transactions).
- Golden `schema.json` + generated `RecordedMigrations.swift` (92 statements over 48 steps). Tests: every checkpoint schema exact, v48→v49
  upgrade, newer/old/damaged/backup-failure refusals, step rollback, WAL/FK/transaction behaviour. Synthetic in-memory/temp databases only.

### 2026-11-07 23:20 PST — M3-04 (sessions/tabs) + workspace model — IMPLEMENTED
- `BereanWorkspace`: `SpaceId`, `TabType`, `Tab` (state kept as an ordered JSObject so unknown fields round-trip), `Session`,
  `ArchivedGroup`; `TabFields` (split/merge allow-lists from tabFields.ts), `TabPersistence` (assignOrderKeys, buildSnapshot, hydrate),
  `SessionsService` (reads, upserts with sync-clock rules, tombstones, applySnapshot, purge, device-local active tab) reporting
  `DataChange` events for sync capture. `JSON.stableJSON` in BereanCore.
- Golden `tabs.json`: split/merge for 13 states, stableJson, assignOrderKeys, buildSnapshot of a two-session store, an 11-step service
  script on a migrated DB with a fake clock (raw table dumps, list results, 22 events, diffs, purge) and hydration — all reproduced.

### 2026-11-08 00:40 PST — M6-01/M6-03 (first slice): native app shells on the synced workspace model
- `apple/Shared/AppModel.swift`: sessions → Spaces → tabs, persisted through BereanWorkspace into a native **dev** library in the app's
  own container (`Application Support/BereanNative/berean.db`, migrated by BereanStore with a VACUUM INTO backup before upgrades),
  single-instance flock (OD-5), debounced snapshot saves, device-local active tab per space.
- Mac (`MacRootView`): NavigationSplitView sidebar of Spaces with vertical tabs (select, reorder, pin, duplicate, move to session, close),
  session menu (switch/new/rename/delete), detail by tab type (Scripture, Lexicon, Search), study inspector (Lexicon / Cross References),
  command palette (⌘T/⌘K: reference → Scripture, Strong's → Lexicon, words → Search), menu commands (⌘W, ⌘1–5 Spaces, ⌃Tab).
  Scripture: 760-pt reading column, verse selection, word replacer restorations, KJV italics/red letter, clickable Strong's numbers, text picker,
  chapter navigation across books, context menu (copy, cross references, open in new tab), versification notes for LXX numbering.
- iPhone (`IOSRootView`): bottom tab cards / plus / caret (existing mobile navigation), tab cards sheet grouped by Space with sessions,
  shared content views; inspector as a sheet.
- Bundled corpora extended (LXX Brenton, Enoch, Jubilees, cross_references, tske_refs).
- Verified by driving the running Mac app (System Events + cliclick): ⌘K "John 3:16" opened a new tab at verse 16; Strong's toggle; study
  panel; clicking a Strong's number showed the lexicon entry with occurrences; quitting and relaunching restored both tabs, the active tab,
  the selected verse, Strong's and the open panel from the database. iOS Simulator launch shows the reader with the three bottom controls.
- Known gaps: Notes/YouTube/PDF/Tags/History/Settings/Calendar tab types show an explanatory placeholder (state preserved); no layout presets,
  multi-pane compare, settings UI, highlights, notes yet; tab back/forward history not yet.

### 2026-11-08 00:55 PST — Correction: native upgrade floor is v42, not v18 (ADR-0009)
- A per-version scan of bereanMigrations.ts (the first scan split the file wrongly) found data-dependent JavaScript up to v42 (verse-tag
  colour-slot loop) and try/catch ALTERs in v20–v41. `Migrator.lastDataDependentVersion` = 42; libraries below v42 are refused with
  `requiresLegacyUpgrade`. Test: v41 refused; v42 → v49 replay equals the fresh v49 schema. Real libraries are ≥ v47, so no user impact.
- Housekeeping: local branch `native/m2-finish` was deleted with `-D` after its unmerged commits were rebased onto `native/m3-store`
  (content preserved; noted for the record).

### 2026-11-08 01:30 PST — Notes Space (Mac + iPhone) on BereanNotes
- `BereanNotes.NotesService`: read path (list, get, folders, FTS search all/any/phrase + "untitled", by verse / by chapter with KJV⇄LXX
  cross-links and Psalm numbering, chapter dot counts, trash, daily dates) and writes (create with daily-date ids, default status and
  idempotent ids; update; soft delete; restore to root when the folder is gone; folders; pin) — golden `notes.json` (19 synthetic notes,
  39 searches, verse/chapter cases, an 11-step write script with table dumps and change events), all reproduced.
- UI: Notes home (search, type filters incl. Trash, folders, pinned first, context menu pin/trash/restore), note view (rendered Markdown
  with headings/quotes/lists/rules + inline Markdown; ⇧⌘M Markdown source mode with autosave — interim until the M7 native editor), study
  inspector Notes panel (verse notes + "New Note for <verse>"), verse note dots in Scripture, context menu Add Note / Verse Notes, ⇧⌘N.
- Verified by driving the Mac app: ⇧⌘N → typed title, Return, Markdown body → autosaved; ⇧⌘M rendered it; tab title followed the note title.

### 2026-11-08 02:10 PST — Highlights (M7-04 first part)
- `BereanNotes.HighlightsService` (getChapter, toggle verse/word/char with deterministic ids, remove) — golden `highlights.json`
  (11-step toggle script, chapter maps, rows, events incl. bulk scope), all reproduced.
- Scripture: whole-verse highlights tint the row (word-range highlights faintly); character-range highlights are drawn on the displayed
  words by mapping the stored verse.text offsets through `OffsetMap` (word replacer/annotation changes respected); verse context menu
  Highlight ▸ colours / Remove Highlights. Verified in the running app with seeded dev-library highlights (John 3:16 chars 4–25, 3:17 verse).
- Known gaps: highlighting a partial text selection (needs the TextKit reader, M5-01); spaces/Strong's chips between highlighted words
  are not tinted.
- Test-harness note: a cliclick click on the sidebar left SwiftUI in a mouse-down tracking loop (screens lagged, keystrokes hung); an explicit
  `dd:`/`du:` pair released it. Use explicit down/up for sidebar clicks in future visual QA.

### 2026-11-08 02:30 PST — Settings (M6-04 first part)
- `BereanStore.SettingsService` (settings table get/set/all, JSON values; seeded defaults verified by test).
- App: reading preferences on AppModel persisted in the settings table (`defaultText`, `fontSize`, `lineHeight` — same keys as the
  existing apps — plus `wordReplacerEnabled`, `theme`); Mac Settings scene (⌘,) and iPhone Settings sheet; reader applies text size,
  line spacing and the word-replacer toggle; theme System/Light/Dark; new Scripture tabs open in the default text. Verified by opening
  the Settings window in the running app.

### 2026-11-08 08:30 PST — Workspaces service, tab history, Compare mode; renderer fix
- `BereanWorkspace.WorkspacesService` (list/save/load/delete/rename; layout/state JSON verbatim) — golden `workspaces.json` reproduced.
- In-tab back/forward history (⌘[ / ⌘] on Mac, caret menu on iPhone): records the place a tab shows (passage/note/Strong's/query), not
  scroll or panel state. Verified: John 3 → 4 → 5, ⌘[ → John 4, ⌘] → John 5, ⌘[⌘[ → John 3.
- Compare mode (⌥⌘C): parallel columns aligned by verse; columns follow the tab's passage with LXX numbering mapped (KJV Psalm 23 beside
  LXX Psalm 22 verified); add/remove columns (max 4); stored in the synced `compareMode`/`compareColumns` fields.
- BUG FIXED: the Scripture renderer fell back to raw tokens when the word replacer suppressed "the" before a restored name ("The LORD is
  my shepherd" showed instead of "Yehovah is my shepherd"). New `VerseDisplay.renderTokens` (display words + Strong's); test asserts it
  equals `buildVerseDisplayTokens` output for every KJVA verse.
- Known gaps vs legacy compare: per-column independent navigation and synced scrolling across differently numbered chapters.

### 2026-11-08 10:15 PST — Scripture layout presets + saved workspaces (M6-02)
- Mac: the 16 scripture layout presets with the legacy ids (stored per tab in `scriptureLayout`), study panels (tabbed / notes / lexicon /
  cross refs) in resizable HSplitView/VSplitView; toolbar Layout menu. Verified study-grid in the running app.
- `BereanWorkspace.WorkspaceSnapshot`: port of src/lib/workspaceSnapshot.ts (buildWorkspaceState / parseWorkspaceState / workspaceSessionId).
  `workspaces.json` golden gained 3 build and 13 parse cases (NULL, empty, malformed, array, v1, v2, wrong-space tabs, invalid tabs,
  duplicate/junk display order, non-string icon) — all reproduced byte-for-byte.
- App: Save Session as Workspace… / Open Workspace ▸ in the session menu; Settings → Workspaces (open, rename, delete with confirm).
  Opening creates or switches to session `ws:<id>` with fresh ids for tabs already open elsewhere (as `openWorkspaceSession`).
  A native save writes the desktop default mosaic tree as layout_json (the native layout preset travels inside each tab's state).
- Verified: a workspace row in the existing app's v2 format, seeded into the native dev library, opened as session "Ten Words" with
  its 3 tabs, active tab and order, and persisted as `ws:qa-ws1` tab rows.

### 2026-11-08 11:00 PST — Note Markdown files + version history (M7-01 part)
- `BereanNotes.NoteMarkdownFile`: port of src/lib/noteMarkdownFile.ts (export, import parse, file name) over UTF-16 units; `JSDate.isoString`.
  Golden `note-markdown.json`: 12 notes exported + round-tripped, 17 hand-written files (CRLF, BOM, no frontmatter, `#`-heading edge
  cases, empty/unclosed frontmatter, U+2028 in values, quoted/unterminated titles, highlight-preview stripping), 16 file names.
- `NotesService` version history: createVersion (duplicate skip), versions, restoreVersion (pre-restore snapshot), prune (7 days, one per
  UTC day, manual/pre-restore kept, cap 50) — notes golden gains a 70-step version script (results, final list, events).
- `NotesService.importMarkdown` (iPhone Notes import rules: berean_id updates an existing non-trashed note, else creates; ai_excluded
  applied, never cleared) + `setAiExcluded`; behaviour test.
- App: Version History sheet (list, preview, Restore with confirmation, Save Version Now); automatic snapshots after 2 minutes of editing
  idle, on leaving a note and on close (desktop SNAPSHOT_IDLE_MS rules); Export Markdown… (file exporter) and Import Markdown… (Notes home).
  Verified in the running Mac app: two seeded versions listed and previewed; restoring wrote a pre-restore snapshot and updated the note.
- Tooling: `npm run golden:export` now runs vite-node with vitest.config.ts so `@/` imports resolve (all existing goldens unchanged).

### 2026-11-08 07:30 PST — FIX: note Share/Export did nothing (Michael's manual test); #21 re-landed
- Root cause (reproduced in the running app): SwiftUI `.fileExporter` attached to the note view never presented from the note toolbar —
  no panel, no log line. Separately the sandboxed app lacked `com.apple.security.files.user-selected.read-write`, which any save/open
  panel needs (`ENABLE_USER_SELECTED_FILES = readwrite`).
- Fix: `NoteFileTransfer` drives `NSSavePanel`/`NSOpenPanel` as window sheets (iPhone: `UIDocumentPickerViewController`); outcomes are
  reported (saved / cancelled / failed → alert with the system reason). The toolbar control is now a labelled Share menu (Export as
  Markdown File…, Copy as Markdown, Share…), plus File ▸ Import Markdown… / Export Note as Markdown… ⇧⌘E.
- Second bug found while verifying: an open note did not refresh after an import (or any external change) — the note view now reloads on
  `notesRevision` unless it holds unsaved edits.
- Verified in the running Mac app: toolbar Share ▸ Export and ⇧⌘E present the save panel; file written in the vault format; edited file
  re-imported → "Imported 0 new notes, updated 1." and the open note updated in place; Cancel → no alert; read-only folder → "The note
  could not be exported. You don't have permission…". Regression: `npm run native:ui:smoke` (System Events, local only) — PASS.
- PR #21 had merged into `native/m6-layouts` after #20 was already merged, so its commit never reached main. Re-landed by cherry-pick on
  `native/m7-export` (tree identical to #21) together with this fix.

### 2026-11-08 09:30 PST — Native Mac navigation redesign from a real side-by-side comparison (ADR-0010)
- Captured the existing app (`BEREAN_CDP_PORT=9222 npm run dev`, Berean Dev profile) and the native app at 1300×800, then compared:
  sidebar, session popover, tab context menu, toolbar. Tracker: `VISUAL-UX-PARITY.md` (17 areas).
- Sidebar: session switcher (sessions with tab counts and a checkmark, New Session ⌘⇧0, Rename, Close, Saved Workspaces, Save Session
  as Workspace…) · location field "Space › Title" (opens ⌘K) · New Tab · one tab list in display order (pinned first, type-coloured
  symbols, × on hover/active, drag reorder persisted to display_order) · Workspaces section (open, "Open" badge, rename/delete, + save) ·
  Archived section (restore / remove). Sidebar context menu: Group Tabs by Space, Archive All Tabs.
- Tabs: Archive Tab (archived_groups, tabs_json = JS tab objects); closing the active tab selects its list neighbour; new tabs are placed
  after the active tab in the display order.
- Scripture toolbar: history ← → (were missing; ⌘[ ⌘] only) + passage pill ‹ Psalm 23 › with a book/chapter picker popover (book list
  by section with filter, chapter grid, current chapter marked); text button shows the short name (KJVA); duplicate "Go to reference"
  field removed (⌘L / ⌘K open the location search); window title kept for the Window menu but not drawn in the toolbar.
- UI-complete gate added to the playbook.
- Verified in the running app: session switch, archive → restore, drag reorder kept across relaunch, picker → Psalm 24 → Back → Psalm 23.
  Swift suite 60 tests/24 suites PASS; Mac + iOS builds PASS.

### 2026-11-08 10:15 PST — iPhone tab sheet, sessions and saved workspaces
- The native iPhone tab sheet follows the existing iPhone TabCardsSheet list view:
  - a session row with its tab count, opening the Sessions page;
  - tab search;
  - the session's tabs in the user's order, pinned first, with type colours and the Space shown under the title;
  - swipe actions: Close, Archive, Pin;
  - context menu: Duplicate, Pin, Move to Session, Archive, Close;
  - Edit to reorder;
  - New Tab;
  - Archived Tabs page (restore, remove).
- Sessions page:
  - lists sessions with tab counts; tap switches;
  - New Session; Rename, Archive All and Close from the context menu or swipe;
  - **Saved Workspaces** section (open, "Open" badge, rename/delete, "Save This Session as a Workspace…"), with a one-line
    explanation under each section.
- Verified with real taps on the iPhone 18 Pro Simulator (Xcode MCP): tab sheet → Sessions → Save "Study Phone" → open it → the sheet
  shows the session "Study Phone" with its tab.
- Naming: the native iPhone uses "Sessions" (as the existing tab sheet does) and "Saved Workspaces" (the existing iPhone More page calls
  these "Saved snapshots") so the Mac and iPhone native apps use one vocabulary.

### 2026-11-08 11:30 PST — Verse tags (service + reader UI) and the verse-actions bug
- `BereanNotes.VerseTagsService` is a port of verseTagsService.ts: expand, list, create (case-insensitive find-or-create, least-used colour
  slot), rename, setColor, setColorSlot, reorder, merge, delete (refuses while a note says "#name" unless forced), addMembers,
  removeMember, updateMemberRanges, forChapter, members.
  - Golden `verse-tags.json`: 4 expansion cases (dedup, whole chapter, 400-verse cap, fractional spans) and a 22-step script.
  - Results, events and all four tables (`verse_tags`, `verse_tag_members`, `verse_tag_verse`, `tag_edges`) are reproduced exactly.
  - `Math.random` is pinned in the golden; Swift takes an injected `pick`.
- Reader:
  - "#name" chips under tagged verses, in palette or literal colours; whole-chapter tags above the passage.
  - Verse menu: Tag Verse… / Tag Chapter…, opening a picker that filters and creates (Return creates, or applies the single match).
  - Chip menu: Remove “label” from #tag, and Search #tag.
  - Search tab: "#name" lists the tag's members with verse text.
- BUG FIXED: right-clicking verse TEXT showed the system text-editing menu (the text is selectable), so the verse actions (Copy,
  Highlight, Tag, Note, Cross References…) were reachable only from the margin. The verse number now opens the verse actions menu, as the
  existing app's verse popover does (CLAUDE.md §6); the row context menu shares the same items.
- Verified in the running Mac app:
  - verse number 16 → menu → Tag Verse… → typed "Gospel" → Create → chip shown;
  - verse 17 → Tag Verse… → "Gospel" + Return → chip shown;
  - chip → Search #Gospel → results with John 3:16 text.
- Checks: Swift 62 tests/25 suites PASS; golden drift guard 22/22 PASS; Mac + iOS builds PASS.
- Found while testing: Return in `.searchable` inside a macOS sheet does nothing (`onSubmit(of: .search)` never fires), and the field
  was not focused, so typing went nowhere. Replaced with a focused TextField.

### 2026-11-08 13:30 PST — Continuous reader, passage navigator, texts, typography, toolbar (owner batch "UI refinement")
- **Continuous Mac reader** (`apple/BereanMac/ChapterTextView.swift`): one TextKit text view per chapter, so a selection can cross verses.
  - Verse numbers, Strong's numbers and tag chips are links: pointing-hand cursor, hover underline, tooltip.
  - Clicking a verse number opens the verse actions (Copy, Highlight ▸, Tag Verse/Chapter, Add Note, Verse Notes, Cross References,
    Open in New Tab); clicking a Strong's number opens the lexicon; clicking a tag chip opens remove/search.
  - Right-clicking text gives the verse actions plus Copy / Copy as Plain Text.
  - Copy follows the existing app (ChapterView.tsx):
    - within one verse → the selected words;
    - across verses → "Book c:v1-v2" + numbered lines;
    - ⌘⇧C → plain text on one line.
  - Gutter numbers, Strong's numbers and chips are never copied as text.
  - Highlights (whole verse and character ranges), red letters, italics, note dots and verse tags are kept.
  - Verified: shift-click selection Lev 8:2→4 copied as "Leviticus 8:2-4" + 3 lines; ⌘⇧C plain; a partial selection inside a verse copied
    only those words; a Strong's click opened H3068; a verse-number click opened the menu.
  - Two AppKit-in-SwiftUI issues worked around (verified by file logging): SwiftUI's Edit ▸ Copy never reaches a hosted NSTextView, so ⌘C
    and ⌘⇧C are handled in the reader's performKeyEquivalent; the built-in link-click delegate did not fire, so single clicks on links
    are dispatched in mouseDown.
  - iPhone keeps per-verse rows for now.
- **Passage navigator** (replaces the book/chapter popover):
  - Left: one search field over every book of every text plus references ("Go to"), and History of recently opened passages
    (deduped by text + book + chapter, 40, per device).
  - Middle: books → chapters, with an internal ‹ Books back button (⌘←).
  - Right: the text list.
  - A book found in another text switches text; a reference stays in the current text when that text has the book.
  - The iPhone uses it as a sheet (compact layout with a text picker).
- **Texts:** the native list is now the existing app's TRANSLATIONS (one KJV + Apocrypha, one Septuagint, and every extra-biblical text).
  `kjv` is hidden but still opens.
  - **Data-parity BUG FIXED:** the native app served textId `lxx` from `lxx.db`; the existing app serves it from `lxx_brenton.db`
    (electron/db/bible.ts). `Corpora` now maps it the same way.
  - All 19 text databases are bundled. The separate toolbar text menu was removed; the pill shows "Leviticus 8 KJVA".
- **Typography:** Scripture defaults to the system font (the existing `scriptureFontFamily` setting, 'system'); Settings → Scripture font
  (System, Georgia, Palatino, New York, Sans-serif, Monospace).
- **Toolbar:** Back / Forward (the active tab's history) sit beside the sidebar button for every tab type and stay put when the sidebar is
  collapsed; the chapter pill keeps ‹ ›.
- **Note Share:** the dropdown caret is hidden (`menuIndicator(.hidden)`), with a VoiceOver label.

### 2026-11-08 14:45 PST — Unified Workspaces (ADR-0011), Yab-style sidebar (ADR-0012), window drag, sidebar toggle
- Workspace switcher with no "Sessions" wording: one list (live, then saved-not-open), each with a tab count and a checkmark; New, Rename,
  Duplicate, Save Snapshot…, Delete (with confirm), Manage Saved ▸. ⌘⇧0 = New Workspace. Tab menu: "Move to Workspace".
- `BereanSidebar` replaces the List sidebar: raised active-tab card, hover fill, close on hover, live drag reordering (drop into Pinned to pin).
- Verified in the running app:
  - drag "Untitled" from 5th to 1st → order changed, the active tab and the window position unchanged;
  - dragging empty space below the tabs moved the window (100,60 → 200,100);
  - Duplicate → "Study Copy" with the same 9 tabs, order and active tab; Delete → confirm → back to "Study";
  - the sidebar button hides and shows the sidebar, and Back / Forward stay beside it.
- BUG FOUND + FIXED: a full-height drag area swallowed clicks on the title-bar sidebar button; it is now limited to below the title bar.

### 2026-11-08 15:20 PST — iPhone: working New (Plus) sheet, simpler bottom bar, Workspaces page (ADR-0013)
- BUG FIXED: Plus opened `CommandPalette` (a fixed 520-pt-wide view in a 220-pt sheet). On a 402-pt iPhone it was clipped on both sides
  and had no buttons. It is replaced by `NewSheet` (full width, field + Open rows + Recent).
- Bottom bar: Tabs · New · More. More holds Back/Forward, the reader commands, tab actions and Settings.
- The Workspaces page is one list (live + saved), with switch, new, rename, duplicate, delete, save snapshot and archive all. The tab
  sheet's workspace row says Workspaces; the tab menu says "Move to Workspace".
- Verified with real taps on the iPhone 18 Pro Simulator:
  - Plus → New sheet → New Note → note open for typing;
  - Plus → "John 3:16" + Return → John 3 with v16 selected;
  - Tabs → workspace row → Workspaces list (Study 1 tab, Study Phone 3 tabs ✓);
  - More → menu with Cross References / Notes / Strong's / Compare / Duplicate / Close / Settings.

### 2026-11-08 15:40 PST — Physical iPhone deployment (UI-13)
- `npm run native:ios:device [UDID]` (scripts/native/ios-device.sh):
  - finds the connected iPhone;
  - creates the gitignored `apple/Config/Signing.xcconfig` with ONLY the team id (copied from ios/App/Signing.xcconfig; never its bundle
    id, iCloud container or App Group);
  - builds with automatic development signing;
  - refuses to install unless the bundle id is `com.berean.native.ios.dev` and there are no iCloud / App Group entitlements;
  - installs and launches with devicectl.
- Done on Michael's iPhone 16e. The device now lists Berean (com.berean.app 0.8.1 (7)), Berean Dev (com.berean.app.dev) and Berean Native
  Dev (com.berean.native.ios.dev) side by side; production was not touched.

### 2026-11-08 16:30 PST — Formatted notes editor (Mac + iPhone), Copy as Plain Text (ADR-0014)
- `MarkdownLiveSpans` (BereanNotes) + 6 tests: inline markup hidden; nested bold/italic; snake_case and "2 * 3" left alone; lists, tasks,
  quotes, callouts, images (width suffix hidden), structure comments, code fences literal, tables, ranges always inside the string.
- Mac `RichNoteEditor` (NSTextView, TextKit 1 null glyphs + per-glyph substitution) and iPhone `RichNoteEditorIOS` (UITextView, same
  model, Format ▸ in the edit menu, Copy as Plain Text). The old monospace TextEditor is now only View ▸ Show Markdown Source.
- Verified in the running Mac app on a seeded note: the heading, bold, italic, wikilink, bullets, highlight, □/☑ tasks, underline,
  "Note:" callout, table, inline code and link all rendered without markup;
  - typing saved into the Markdown at the caret;
  - double-click "Code" + ⌘B → shown bold, saved as `**Code**`;
  - Copy as Plain Text → no markup (bullets "•", tasks □ / ☑, "Note:");
  - Copy → plain + RTF + Markdown source flavours.
- Checks: Swift 68 tests/26 suites PASS; golden drift 22/22 PASS; Mac + iOS builds PASS.

### 2026-11-12 — Owner batch "continuous reconstruction" (cycle 1)
- Fixed (owner reports):
  - single-chapter books (chapter lists from real chapters, prologue 0, open directly, stepping, all-books test over 19 texts);
  - verse-number click selects (⇧-click range, selection bar, ⌘C, Esc; iPhone tap);
  - [sidebar ‹ ›] group in the sidebar title bar (same place when collapsed);
  - multi-text search (All Texts default, scope menu, per-text counts, options popover, Strong's queries and bridge, phrase, history,
    truncation notice; engine port + 6 tests).
- Found and fixed (exploratory):
  - bare book names and "Jude 5" did not resolve;
  - same-verse-count passages kept the scroll position;
  - Strong's bridge capped at 1000 rows;
  - the New sheet stayed open on iPhone;
  - the selection bar overlapped the iPhone bottom bar.
- New:
  - Notes home (folders home, folder view, trash, folder management, note status / move / duplicate);
  - ⌘F find in chapter;
  - ⌘K grouped results including notes and commands.
- Records: FULL-FEATURE-PARITY.md (104 features × 2 platforms), UX-AND-FUNCTIONAL-ISSUES.md, SCREEN-INVENTORY.md.
- Checks: Swift 78/30 PASS; Mac + iOS builds PASS; each fix exercised in the running Mac app; iPhone verified in the Simulator (verse
  selection, search, New → Obadiah, Notes home).

### 2026-11-12 — cycle 2
- Partial-selection highlight (Mac) with offset mapping (verified the stored range = the shown words).
- iPhone swipe chapter change (verified in the Simulator).
- ⌘⇧D Today's Note; Copy Reference and Compare This Verse.
- Exploratory fixes: single-digit verse numbers unclickable; reader swallowed app shortcuts.
- History (service port + tests, History tab, ⌘Y).
- Tag Manager.
- Checks: Swift 79/31 PASS; Mac + iOS builds PASS.

### 2026-11-12 — Native reader, Notes search, Calendar and iPhone Go

- `793a525` explicitly bundles the full Scripture catalog on both targets. No writable store in either resource list.
- `22da4aa` opens daily notes through a native month grid on both platforms.
- `83c2e96` replaces the iPhone per-verse rows with a continuous chapter text view, adds text actions and connects Strong’s links and character highlights to existing services.
- `65c96d5` adds Notes match modes, folder scope, type/status filters, match previews and refresh. Regression covers more than 200 matches, edits, trash and restore.
- `4946b16`, `5ca6b6f` add the compact labeled dock, remove Scripture link underlines, streamline the destination picker and reuse compatible tabs during normal iPhone navigation.
- Verification and remaining touch checks are recorded in HANDOFF. No production database, signing, or sync work in this branch.
- `87fd228` adds contained-tab lookup and preview for workspaces, and reviewable bulk archive that preserves pinned and selected tabs. Archive groups use the existing restore path.

### 2026-11-12 — Scripture navigation and verse actions

- iPhone Scripture shows the passage and text picker and chapter arrows in a single toolbar. Study commands are in More. The dock uses icons with accessibility labels.
- Tapping an iPhone verse number highlights the verse and opens its actions directly. Long press still opens text selection. Notes and cross-references receive the verse with the inspector request.
- Closing a comparison column returns to the reader when fewer than two remain. The remaining translation and its chapter numbering carry over. Previously saved single-column comparisons can also be closed.
- Xcode 27.2 Dev builds passed for Mac and iPhone Simulator. On iPhone 18 Pro, tapping Jonah 1:2 opened its actions, Copy Verse closed the sheet, a saved one-column comparison could be closed, and closing KJV in a fresh two-column comparison kept Jonah 1 in the Septuagint reader.

### 2026-11-12 — Floating reader controls and navigation parity

- The iPhone Scripture header and dock use Liquid Glass where available. The passage button has no dropdown caret.
- Tap verse numbers to add and remove whole verses. The floating panel copies, highlights or tags the selected verses. Single-verse details and native text selection remain available.
- iPhone Go groups passage, lexicon, notes and Scripture search destinations. More includes native Find in Chapter.
- Mac routine navigation reuses eligible tabs. The command palette offers exact open passages in other workspaces, and New Tab remains explicit.
- The implementation backlog compares the native apps with Electron and Capacitor workflows and records acceptance checks.

### 2026-11-12 — Archive access and Study Trail browsing

- Mac Workspace and the top of iPhone Tabs expose the archive controls. Mac Dev verified excluding one tab, archiving two, and restoring both while keeping the active passage.
- Mac Go and iPhone More open saved Study Trails with their recaps and ordered Scripture stops. The reader uses legacy tables and preserves saved translations. The migrated fixture checks legacy ordering and excludes the implicit loose-stops bucket. The Mac entry and empty state were checked in the running app.

- Study Trail can start a named trail, add the current chapter, pause, resume, and finish. Existing connections show their destination and reason. Recording currently requires an explicit action.

### 2026-11-13 — Scripture selection and Compare polish
- **Branch and base:** `native/reader-notes` at `c90d7ec`, draft PR #24.
- **Delivered:** macOS Scripture selection panel with spaced native controls and a caret-free passage picker. Both readers use a verse-number marker for whole-verse selection and preserve saved highlights. Mac keyboard copy formats references with gaps. Compare follows reader settings and clears stale results when navigating.
- **Verification:** `npm run native:build:mac`, `npm run native:build:ios` and `git diff --check` passed. Mac Dev visually confirmed the panel and picker and verified Escape dismissal. The attempted range click did not establish a new range.
- **Data touched:** isolated Mac Dev fixtures for UI verification.
- **Next:** use visible verse numbers for Mac range and clipboard verification, repeat multi-verse selection in the iPhone Simulator, and exercise Compare settings and narrow Mac pane layout.

### 2026-11-13 — Simplify verse selection controls
- Replaced the two-row panel with a compact floating icon row on both platforms. Mac keeps hover help and iPhone keeps 44-point tap targets.
- Whole-verse selection uses bold accent verse numbers. The selection no longer paints a box behind the number.
- Both Dev builds passed. Mac Dev verified single-verse selection, the floating toolbar and Escape dismissal.

### 2026-11-13 — Reader, tab, and calendar parity
- Added a reversible Mac sidebar tab filter and improved verse gutter range handling. Cross References uses the current verse.
- Added Mac Strong’s gloss tooltips and shared Strong’s search snippets with match positions. Added the Hermas edition preference and edition-aware reference labels.
- Added local sunrise settings for Today and Calendar with tests for the DST boundary, missing coordinates, and polar fallback.
- Mac Dev verified tab filtering, Shift-click range selection and opening Cross References. See HANDOFF for remaining runtime checks.

### 2026-11-13 — iPhone verse targets, note previews, and deep-link grammar
- Expanded iPhone verse tap targets into the gutter, keeping body text available for normal selection.
- Added a read-only preview that renders Markdown tables and code in current notes and version history.
- Ported legacy deep-link parsing to Swift, with 37 fixtures. Registration and routing remain open.
- Both Dev builds and Swift conformance passed. The iPhone Simulator clipboard verified exact nonconsecutive verse copy.

### 2026-11-13 — Dashed verse range outlines
- Draw one rounded dashed outline around each consecutive selection in the native readers.
- Float verse actions over the reader with extra scroll clearance for the chapter ending.
- Add pointing-device cues to Mac sidebar controls and the native verse action row.
- Both Dev builds passed. Verified grouped and separated ranges and end scrolling on the iPhone Simulator. Verified the Mac outline and adjacent selection.

### 2026-11-13 — Verse actions for multiple selections
- Keep iPhone More visible for multi-verse selections and target the active verse for notes and cross references.
- Keep the range anchor on a selected verse and add hover feedback to the iPhone dock menu.
- Both native Dev builds passed.

### 2026-11-13 — Verse ranges in linked Scripture
- Open linked verse ranges as a selection in both native readers and retain the legacy range key in tab state.
- Preserve a reference’s LXX suffix unless the link names a text explicitly.
- Save pending note edits before routing internal deep links.
- Native conformance, both Dev builds and the updated focused parser suite passed.

### 2026-11-13 — Independent Compare passages

- Mac and iPhone can change one Compare column's chapter or edition and open its exact destination in the reader. Saved columns retain their individual destinations and legacy metadata. Mixed passages use labeled sections.

### 2026-11-14 — iPhone tab switcher search — VERIFIED
- Branch `native/reader-notes`, after `f2eee0d`, draft PR #24.
- Tabs shows search as the first list row, including a clear button while a query is active.
- iOS Simulator Dev build and identity check passed. Verified search and tab reuse with a mixed verse reference on iPhone 18 Pro. Only the isolated Dev library was exercised.

### 2026-11-14 — iPhone workspace and archive search — VERIFIED
- Shared the inline tab search field across the three iPhone tab-management lists.
- Verified a mixed Scripture reference in Workspaces and Archived Tabs on the iOS 27 Simulator. Archive and restore preserved the full selection and returned the original tab count.
- iOS Dev build and identity check passed. Used the isolated Dev library.

### 2026-11-14 — Descriptive move destinations — BUILT
- Mac and iPhone Move to Workspace menus include destination tab previews. Destination IDs and move persistence use the existing path.
- Both Dev identity builds and diff check passed. Same-named destination fixture remains to exercise in the UI.

### 2026-11-14 — iPhone adjacent verse outline and selection feedback
- Verified a joint outline and unobscured final verse for Obadiah 1:20–21 LXX on iOS 27 Simulator.
- Added haptic feedback and explicit verse toggle action names. The tab-search clear button now uses the shared pressed and hover feedback. iOS Dev build and identity check passed.

### 2026-11-14 — Scripture Display from the iPhone reader
- Restored quick access to reader display preferences from legacy mobile. The native sheet shares controls and storage with Settings.
- Grouped chapter export in More and removed the Mac minimum size from iPhone Settings.
- Both Dev builds passed. Verified toggling and restoring verse numbers on the iOS 27 Simulator.

### 2026-11-14 — Direct chapter tagging
- Added a direct route to the existing chapter tag picker from the iPhone More menu and Mac reader toolbar.
- Both Dev builds passed. The iOS 27 Simulator verified creating a chapter tag while retaining a two-verse selection.

### 2026-11-14 — Scripture tag picker feedback
- Fit the iPhone sheet to its available width and keep the passage visible in the navigation bar.
- Expose tag selection and selected count, preserve selections on keyboard submission, and report library failures.
- Both Dev builds passed. Checked the heading, selected trait, and cancellation on the iPhone Simulator.

### 2026-11-14 — Quick translation switching on iPhone
- Restored the legacy KJVA/LXX shortcut using chapter mapping and installed chapter coverage.
- iPhone Dev build passed. Verified Psalm numbering, Back, and unchanged tab count on iOS 27 Simulator.

### 2026-11-14 — Explicit King James editions in native Go
- Shared native reference resolver accepts KJV and KJVA suffixes with the requested edition's book coverage.
- Both Dev builds and 101 native tests passed. Verified distinct edition results and tab reuse on the iOS 27 Simulator.

### 2026-11-14 — Mac quick edition switching
- Added the mapped edition shortcut to the Mac Scripture toolbar and shared its coverage and navigation logic with iPhone.
- Both Dev builds passed. Verified the Mac control appears for Genesis 1. Persisted navigation QA remains open.

### 2026-11-14 — Mac edition navigation verification
- Verified Psalm chapter mapping, Back with verse selection restoration, a stable 26-tab count, and shortcut omission on John 7 in Mac Dev.

### 2026-11-14 — Compare verse actions
- Added edition-aware verse copy, reference copy and open-in-new-tab actions to aligned and independent comparisons.
- Both native Dev builds passed. Live cell menu activation and clipboard output remain to verify.

### 2026-11-14 — Discoverable Compare verse actions
- Added an edition-labeled ellipsis to each Compare cell, with pointer feedback and a 44-point touch target on iPhone.
- Both Dev builds passed. Verified the Mac action menu and exact LXX clipboard reference.

### 2026-11-14 — Compare clipboard feedback
- Added accessibility announcements for successful verse and reference copies.
- Both Dev builds passed. Verified mapped LXX reference clipboard contents and retained comparison on iOS 27 Simulator.

### 2026-11-14 — Edition-aware Scripture references
- Copy Reference includes KJV and KJVA suffixes for verse selections, individual verses and chapters.
- Both Dev builds passed. Verified the KJVA chapter reference round trip on iOS 27 Simulator.

### 2026-11-14 — Copied references for other installed writings
- Native Copy Reference and Go share bracketed edition labels for other writings, including both Hermas editions.
- Native tests and both Dev builds passed. Verified Taylor chapter reference copy/paste on iOS 27 Simulator.

### 2026-11-14 — Chapter navigation during overlapping requests
- Cancelled superseded chapter lookups and guarded completion against newer reader destinations.
- Both native Dev builds passed. Interactive race verification remains open.

### 2026-11-14 — Scripture search result actions
- Added a visible, edition-labeled actions button to Scripture hits on Mac and iPhone. Copied references share the Go format.
- Both Dev builds passed. iOS 27 Simulator verified the exact KJVA reference and stable tab count.

### 2026-11-14 — Cross-reference actions
- Added edition-qualified reference copy, preview copy and explicit new-tab navigation to cross-reference rows on Mac and iPhone.
- Both Dev builds passed. Mac Dev showed the new controls in expanded Classic cross references.

### 2026-11-14 — Cross references for selected verses
- The Mac and iPhone selection bars now pass all selected verses to the cross-reference inspector. Multiple source verses are grouped and the heading shows the complete reference.
- Both native Dev builds passed. Live multi-verse and source-switching checks remain open.

### 2026-11-14 — iPhone dock cross-reference scope
- Cross References in More now uses the current verse selection.
- Verified disjoint TSKe groups and reference clipboard output on iOS 27 Simulator. The iPhone Dev build passed.

### 2026-11-14 — Cross-reference source control
- The inspector's source menu displays the active source and gives the passage heading more room.
- Both Dev builds passed. Verified Classic-to-TSKe switching with both verses of a disjoint selection on iOS 27 Simulator.

### 2026-11-14 — Cross-reference scope restoration
- Restore cross-reference scope from the saved Scripture selection when there is no live override.
- Both Dev builds passed. On iOS 27 Simulator, an open cross-reference sheet restored both John 7:47 and 50 after relaunch.

### 2026-11-14 — Empty results for selected cross-reference verses
- Preserve rows for empty selected verses and keep successful results visible when another selected verse fails to load.
- Both Dev builds passed. Verified per-verse empty results for Didache 1:1–2 in the iOS 27 Simulator.

### 2026-11-14 — Tab duplication and cleanup
- Duplicate Tab preserves the source type, state and origin, and inserts after the source in stored order.
- Copies start unpinned so they can be reviewed once inactive. Both Dev build commands passed.

### 2026-11-14 — Duplicate archive review
- Identify the copy that stays open and recheck duplicate eligibility before archiving. Both Dev builds passed.

### 2026-11-14 — Reachable iPhone archive confirmation
- Keep archive and cancel controls in a persistent iPhone cleanup footer.
- Verified archiving the unpinned copy, keeping the pinned original, and restoring the full verse selection in the iOS 27 Simulator.

### 2026-11-14 — Restore archived tabs near their original positions
- Save local sidebar ordering for recent archives and reuse it when restoring to the source workspace.
- Both Dev builds passed. Existing archive records and sync schema are compatible.

### 2026-11-14 — Workspace context for archived tabs
- Show and search source workspace names in the native archive browser when local metadata is available. Both Dev builds passed.

### 2026-11-14 — Restore archives to the source workspace
- Added an explicit action to return archived groups to their original workspace while staying in the current workspace.
- Both native Dev builds passed. Live cross-workspace group restore remains to verify.

### 2026-11-14 — Return individual archive results to their source
- Added a Mac context action and iPhone swipe action for restoring just one archived search result to its original workspace. Both Dev builds passed.

### 2026-11-14 — Accessible iPhone floating verse actions
- Expose individual selection toolbar controls and name the passage in the clear action hint.
- Verified opening cross references for both selected verses from the toolbar on the iOS 27 Simulator.

### 2026-11-14 — Floating selection copy verification
- Verified Didache range reference round-trip, unchanged tab count and exact two-verse clipboard content on iOS 27 Simulator.
- Added an accessibility value for transient copy confirmation. Both Dev builds passed.

### 2026-11-14 — Mac whole-verse keyboard copy confirmation
- Reuse the floating toolbar copy confirmation after successful ⌘C and multi-verse menu copy. Both Dev builds passed.

### 2026-11-14 — iPhone chapter-end dashed selection
- Draw consecutive verse outlines using the same TextKit layout as the chapter text.
- Verified John 7:51–53 in iOS 27 Simulator with one visible rounded outline and clear floating toolbar.

### 2026-11-14 — Keep the iPhone reading position during reflow
- Preserve the visible verse anchor when a setting or annotation rebuilds the same chapter.
- Verified Strong's toggle at John 7:51–53 on iOS 27 Simulator.

### 2026-11-14 — Keep Mac reading position during reflow
- Preserve the visible verse across same-chapter text rebuilds and avoid reusing character selection offsets against changed text.
- Full native check passed with both Dev builds.

### 2026-11-14 — Character selection through reader reflow
- Preserve character selections when formatting changes leave UTF-16 text intact, and clear stale offsets when rendered text changes.
- Both Dev builds passed. Mac Dev verified a Strong's toggle round trip kept the late chapter verse selection.

### 2026-11-14 — Scripture text width presets
- Added Wide, Normal and Narrow to the native Scripture display preferences using device-local storage.
- Both Dev builds passed. Visually verified iPhone Narrow with the selected final verses and dashed outline still above the floating actions.

### 2026-11-14 — Mac Scripture Display
- Added a toolbar popover backed by the shared Scripture display preferences.
- `npm run native:build:mac` passed with the Dev bundle identity. Opened the popover in Mac Dev and visually confirmed all six controls over John 7.
- Draft PR #24. No production data touched.

### 2026-11-14 — Reader display polish and parity corrections
- Hid the slider's redundant visible label while retaining its accessible name.
- Updated the parity matrix for the continuous reader, verse actions, history and display options.
- Both native Dev builds passed.

### 2026-11-14 — Mac reader without verse numbers
- Removed invisible verse-number hit targets and reclaimed their gutter when verse numbers are off.
- Mac Dev build and identity check passed. Live hover and toggle verification remain open.

### 2026-11-14 — Full-verse iPhone selection outlines
- Extended the existing grouped iPhone outline to cover the full rendered verse, including wrapped inline annotations. The iPhone Dev build passed.
- In Mac Dev, toggling verse numbers off and back on removed and restored accessibility links while keeping John 7:47–50 selected at the chapter end.

### 2026-11-14 — iPhone selection reveal
- Use the final rendered verse line when calculating scroll clearance above the floating verse actions, including wrapped inline annotations.
- Full native check passed. Wrapped annotation layout still needs visual verification.

### 2026-11-14 — Mac selection reveal
- Matched scroll clearance to the last visible verse line and dashed frame on Mac, including wrapped annotations.
- Mac Dev build and identity check passed.

### 2026-11-14 — Compact selection controls
- Scoped icon-only styling to direct controls and added Mac help to compact actions.
- Both native Dev builds passed. Narrow-window and overflow-menu UI checks remain open.

### 2026-11-14 — iPhone Scripture pinch-to-resize
- Brought the legacy Scripture pinch interaction to the native iPhone reader with a live point-size badge and one settings write on completion.
- Both native Dev builds passed. Multitouch runtime verification remains open.

### 2026-11-14 — Mac Scripture text-size shortcuts
- Added View menu commands for increasing, decreasing and resetting Scripture size using the original zoom key combinations.
- Shared default and bounds across Mac commands, the Settings slider and iPhone pinch.
- Full native check passed with 103 tests and both Dev builds.

### 2026-11-14 — Preserve the end of the chapter during reflow
- Kept the reader at the chapter end when text reflows while already scrolled to the bottom.
- Both Dev builds passed. Live resize verification remains open.

### 2026-11-14 — Mapped edition shortcut in the passage picker
- Added Same Passage for installed KJV/LXX counterparts in the Mac and iPhone pickers.
- Both Dev builds passed. Runtime mapping and column isolation remain to verify.

### 2026-11-14 — Passage picker edition switching
- Bound edition and chapter loading to the current browse request on Mac and iPhone.
- Both Dev builds passed. Rapid-switch running-app QA remains open.

### 2026-11-14 — Passage picker Back and dismissal
- Restored the cached book list immediately on Back and prevented a late lookup from submitting a second destination.
- Both Dev builds passed.

### 2026-11-14 — Chapter grid navigation
- Centered the current chapter on entry, added its selected accessibility trait, and expanded compact chapter hit targets.
- Both Dev builds passed. Running-app scroll and focus checks remain open.

### 2026-11-14 — Mac reader toolbar affordances
- Applied pointing-hand style to chapter navigation and the Compare, Strong’s Numbers and Study Panel toggles.
- Mac Dev build passed. Live pointer inspection remains open.

### 2026-11-14 — Outline bounds for blank verses
- Shared the visible-range calculation on Mac and iPhone, including blank verses and disjoint selections.
- Both Dev builds and four focused range assertions passed.

### 2026-11-14 — iPhone chapter swipe arbitration
- Suppressed chapter swipes while whole verses are selected or a pinch resize is in progress.
- iPhone Dev build passed. Physical gesture verification remains open.

### 2026-11-14 — Chapter navigation boundaries
- Disabled unavailable chapter arrows at edition boundaries on both platforms.
- Both Dev builds passed. Live boundary checks remain open.

### 2026-11-14 — iPhone New Tab presentation
- Sequenced Tabs dismissal and the explicit New Tab picker through the sheet’s dismissal callback.
- iPhone Dev build passed. Simulator presentation and tab counts still need verification.

### 2026-11-14 — Reuse Scripture tag search tabs
- Moved the Mac tag menu and iPhone tag sheet to the shared Search tab reuse path.
- Both Dev builds passed.

### 2026-11-14 — Tag search result transitions
- Isolated tag results and asynchronous previews across reused search destinations.
- Both Dev builds passed. Running-app history and duplicate-number checks remain open.

### 2026-11-14 — Tag result edition labels
- Made the reading edition visible and consistent across tag previews, reference labels and navigation.
- Both Dev builds passed.

### 2026-11-14 — Dynamic Type in iPhone Scripture
- Scaled continuous Scripture with Dynamic Type while keeping pinch and Settings in base points.
- iPhone Dev build passed. Large-size visual and gesture checks remain open.

### 2026-11-14 — Dynamic Type in iPhone Compare
- Scaled verse text and switched to stacked layouts at accessibility sizes.
- Both Dev builds passed. Accessibility-size runtime QA remains open.

### 2026-11-14 — Saved highlights in Compare
- Rendered chapter- and edition-specific verse highlights, including character ranges, in both native Compare layouts.
- Both Dev builds passed after adding the missing highlight module import.

### 2026-11-14 — Compare highlight actions
- Added apply and remove actions for the actual verse and edition in each Compare column.
- Separated legacy word-offset marks from whole-verse tint. Both Dev builds passed.

### 2026-11-14 — Legacy word highlights
- Restored rendering for saved word-level highlights in Scripture and Compare.
- Both Dev builds passed. Rendering uses existing stored highlights without a migration.

### 2026-11-14 — Open compared verses in the same reader
- Added a same-tab action to Compare verse menus, using the exact rendered edition, chapter and verse.
- Both Dev builds passed.

### 2026-11-14 — Selection transfer from Compare
- Used column row mappings to carry whole-verse selections into the single reader.
- Both Dev builds passed.

### 2026-11-14 — Compare selection indicators
- Showed the same selected verses that transfer from Compare to Scripture and cleared old ranges on an explicit single-verse click.
- Both Dev builds passed.

### 2026-11-14 — Preserve selected verses during Compare changes
- Kept saved verse selections across mode and column changes when the passage anchor stays the same.
- Both Dev builds passed.

### 2026-11-14 — Compare column controls
- Made passage picking available directly from every column heading.
- Both Dev builds passed. Live layout and hit testing remain open.

### 2026-11-14 — Unavailable passages in Compare
- Kept empty column headings actionable and identified the unavailable edition without repeating placeholders on iPhone.
- Both Dev builds passed.

### 2026-11-14 — Unavailable Scripture recovery
- Gave unavailable chapters a way to choose a new passage or switch to a verified counterpart in the current tab.
- Both Dev builds passed.

### 2026-11-14 — Unavailable chapter commands
- Disabled tag and text export actions on unavailable Scripture chapters while retaining reference copy.
- Both Dev builds passed.

### 2026-11-14 — Direct iPhone Compare exit
- Added a floating close control that returns to the source passage and preserves the comparison layout for reentry.
- iPhone Dev build and iOS 27 Simulator same-tab exit passed.

### 2026-11-14 — iPhone Compare control capsule
- Grouped Manage Translations with Exit Compare and removed the menu’s caret on iPhone.
- Both Dev builds passed. Live capsule checks remain open.

### 2026-11-14 — Compare reader destinations in Recents
- Recorded same-tab Compare column destinations and their mapped verse selections in Recents.
- Cleared stale multi-verse selection when opening an individual verse. Both Dev builds passed.

### 2026-11-14 — Compare study actions
- Added edition-aware verse notes and same-tab cross-reference navigation to Compare.
- Both Dev builds passed.

### 2026-11-14 — Compare verse notes and tags
- Added same-tab Verse Notes and direct Tag Verse actions for the displayed verse.
- Both Dev builds passed.

### 2026-11-14 — iPhone tag picker controls
- Added an inline passage heading and persistent Cancel and Add controls.
- Both Dev builds passed. Live keyboard and save checks remain open.

### 2026-11-14 — Compare verse tags
- Displayed tags alongside compared verses and connected chips to reusable tag search.
- Both Dev builds passed.

### 2026-11-14 — Compare note indicators
- Added clickable, edition-aware note indicators with accessible counts.
- Both Dev builds passed.

### 2026-11-14 — Stacked Compare reading width
- Moved note and verse action controls into the edition header on stacked comparisons.
- Both Dev builds passed.

### 2026-11-14 — Compare dock spacing
- Removed the duplicate bottom dock allowance from all Compare scroll layouts.
- Both Dev builds passed. Chapter-end visual QA remains open.

### 2026-11-14 — Scripture dock spacing
- Removed the fixed dock deduction from the reader viewport, retaining space for verse actions.
- Both Dev builds passed. Chapter-end visual testing is pending.

### 2026-11-14 — Corrected Scripture dock clearance
- Restored continuous reader dock clearance after Simulator testing reproduced overlapping floating controls.
- Verified the final verse, grouped outline, verse actions and dock were all visible in iPhone portrait.

### 2026-11-14 — Flexible Scripture viewport
- Removed explicit viewport dimensions after reproducing clipping on iPhone rotation.
- Both Dev builds passed. The rebuilt rotation path still needs live verification.

### 2026-11-14 — Reader and study UI feedback
- Added selection fill, pointer feedback, Mac tab filtering and LXX state, simpler cross references, Search layout fixes, and Notes toolbar cleanup.
- Both native Dev builds passed. Runtime checks and the compact-height rotation workaround remain open.

### 2026-11-14 — iPhone tab type filtering
- Added tab type alongside space and a single Clear Filters action.
- iPhone Dev build passed. Live filtering checks remain open.

### 2026-11-14 — Lexicon entry navigation
- Moved full-tab adjacent Strong’s entry controls into a floating capsule and removed the duplicate heading.
- Both native Dev builds passed. Live layout and navigation checks remain open.

### 2026-11-14 — Lexicon occurrence options
- Grouped occurrence filters and sorting in one menu and enlarged result row hit areas.
- Both native Dev builds passed.

### 2026-11-14 — Lexicon and Scripture Search navigation
- Added a Back/Forward link for Search Scripture actions from Lexicon.
- Both native Dev builds passed. Cross-tab scroll restoration remains open.

### 2026-11-14 — Return to a Scripture Search result
- Linked result navigation back to the source Search tab and saved a scroll anchor for the opened row.
- Both native Dev builds passed. Live restoration remains open.

### 2026-11-14 — Notes Format menu
- Exposed existing inline formatting through a visible editor menu on Mac and iPhone.
- Both native Dev builds passed.

### 2026-11-14 — Consistent inline formatting
- Reapplying inline note formatting now toggles it off on iPhone, using the same selection edit as Mac.
- Native tests and both Dev builds passed.

### 2026-11-14 — Native note headings
- Added Body and Heading 1–3 to the Notes Format menu on Mac and iPhone.
- Both Dev builds passed.

### 2026-11-14 — Notes list commands
- Added bulleted, numbered and checklist formatting to native Notes.
- Both Dev builds and three focused list edit checks passed.

### 2026-11-14 — Native note list continuation
- Return continues bullet, numbered and checklist items on Mac and iPhone and exits an empty item.
- Both Dev builds and eight focused Swift edit checks passed. Live keyboard and undo checks remain open.

### 2026-11-14 — Native checklist interaction
- Added click and tap handling for the rendered checklist box. Toggling edits the Markdown marker in place.
- Both Dev builds and six focused Swift checks passed. Live interaction, undo and accessibility checks remain open.

### 2026-11-14 — Native Notes table insertion
- Added Insert Table to the Notes Format menu on Mac and iPhone.
- Both Dev builds and six focused Swift checks passed. Grid presentation and structural editing remain open.

### 2026-11-14 — Native Notes table keyboard navigation
- Tab and Shift–Tab move between table cells on Mac and with a hardware keyboard on iPhone.
- Both Dev builds and six focused Swift checks passed. Live keyboard dispatch remains to verify.

### 2026-11-14 — Native Notes table rows
- Added Add Row Below to the Notes Format menu on Mac and iPhone.
- Both Dev builds, six insertion checks and six table navigation regression checks passed. Live menu and undo checks remain open.

### 2026-11-14 — Native Notes table columns
- Added Add Column After to the Notes Format menu on Mac and iPhone.
- Both Dev builds and 19 focused table checks passed. Live interaction and undo remain open.

### 2026-11-14 — Native Notes table deletion
- Added Delete Row and Delete Column to native Notes.
- Both Dev builds and 26 focused table checks passed. Live undo and persistence remain open.

### 2026-11-14 — Native Notes table menus
- Grouped table editing commands under Format → Table on both platforms.
- Added conditional Previous Cell and Next Cell actions to the iPhone text-edit menu.
- Both Dev builds and iOS 27 simulator launch passed. Live menu interaction remains to verify.

### 2026-11-14 — Scripture selection scroll
- Cancelled stale deferred verse reveals on Mac and iPhone when the selection or passage changes, or when an explicit passage jump starts.
- Both Dev builds passed. Live rapid-selection and chapter-end checks remain open.

### 2026-11-14 — Scripture selection drawing
- Drew the selection fill and dashed outline behind verse text on both platforms and matched their opacity.
- Both Dev builds passed. Visual checks in light and dark mode remain open.

### 2026-11-14 — Floating verse action feedback
- Matched hover feedback and icon sizing between verse action buttons and menus.
- Both Dev builds passed. Live desktop hover checks remain open.

### 2026-11-14 — Verse action menu labels
- Scoped the icon-only button treatment to visible floating controls and retained system styling inside their menus.
- Both Dev builds passed. Runtime menu checks remain open.

### 2026-11-14 — Scripture Search result consistency
- Hide stale results during a new search and restore the clicked row only in the active Search tab.
- Both Dev builds passed. Live rapid-filter and Back/Forward checks remain open.

### 2026-11-14 — Scripture Search scroll restoration
- Remember the visible result when returning to a Search tab without opening a passage.
- Both Dev builds passed. Live scrolling and history checks remain open.

### 2026-11-14 — Search filter scroll positions
- Kept separate result positions for different filters, sorts and groups within a Search tab.
- Both Dev builds passed. Live filter switching remains to verify.

### 2026-11-14 — Notes folder scroll restoration
- Remember a visible row per Notes tab and folder configuration for the current run.
- Both Dev builds passed. Live folder return and large-library checks remain open.

### 2026-11-14 16:05 PST — Reader controls and Search — BUILD VERIFIED

- Mac Scripture selection controls use regular glass with individual rollover feedback and the standard pointer. The window toolbar still hosts passage navigation.
- Scripture Search keeps an active edition filter clearable at zero matches and counts results in the focused edition.
- Xcode 27.2 Mac and iPhone Simulator Dev builds passed, including the Dev bundle identity checks. Live glass appearance and the filter recovery interaction remain pending. No production data touched.

### 2026-11-14 — Cross-reference sidebar — MAC LIVE VERIFIED

- Chapter and multi-verse cross references use one expandable row per verse with a reference count. TSKe headings and reciprocal links appear inside that verse.
- Mac and iPhone Simulator Dev builds passed. Mac Dev Ephesians 2 verified expansion in Classic and TSKe. iPhone interaction and discontinuous selection remain pending.

### 2026-11-14 — Cross-reference scope — MAC LIVE VERIFIED

- Both native inspectors can toggle between chapter and selected-verse references while preserving the reader selection. iPhone disclosure and scope controls have 44-point minimum heights.
- Both Dev builds passed. The 2 Samuel 22:10 scope round trip passed in the running Mac Dev app.

### 2026-11-14 19:25 PST — Cursor, lexicon, reader parity batch — MAC LIVE VERIFIED, iPhone BUILD VERIFIED
- **Agent/session context:** Claude Code, continuing Codex's goal while Codex is out of usage.
- **Repository/worktree/branch and SHA before:** `/Users/roywe/Berean-native`, `native/reader-notes` at `64df1059`.
- **Code changed:** `apple/BereanMac/ClickableCursor.swift` (new), `apple/Shared/LexiconSearchView.swift` (new), StudyViews, StudyInspector,
  ScriptureView, SettingsView, NotesViews, AppModel, ChapterTextView, RichNoteEditor, GoSheet, IOSRootView, MacRootView;
  BereanKit `StrongsRefTokens`, `PsalmSuperscription`, `PsalmTitleData` (generated), `AnnotationFilters`, `NotesService.dailyDisplayTitle`,
  public `ChapterVerseRow.init`.
- **Actual behavior delivered:** hand cursor on native Mac controls; palette command ranking; Search for selection; lexicon search view,
  definition links, Strong's context menu, toolbar ‹ › + Search; daily "Sabbath" titles; Psalm superscriptions; LXX/Enoch/Jubilees
  annotation Hide toggles; Workspace wording.
- **Commands and results:** `npm run native:build:mac` / `native:build:ios` PASS after each commit; `swift test -c release` 106 tests / 37 suites PASS.
- **Data touched:** isolated Dev only (Mac Dev library; one daily note for 2026-11-14 created by ⌘⇧D; a "Search: Pharisees" tab opened and closed).
- **Known failures, regressions and their fixes:** palette ran Scripture search for command names (fixed); lexicon search lost its query on Back
  (task saved "" before restore; fixed with a restored flag); disabled toolbar buttons still show the hand cursor (open).
- **Branch / commit / PR / CI link:** `native/reader-notes` `68c75906`…`a33189d0`, PR #24.
- **Documentation/parity rows updated:** AUDIT-2026-11-14.md (D1, D2, D3, D5, D6, D7 statuses), HANDOFF.md evening checkpoint.
- **Next exact action and its prerequisites:** iPhone simulator QA of this batch, then I1 iPhone verse sheet (see HANDOFF "Next executable tasks").

### 2026-11-14 — My Notes cross references — BUILD VERIFIED

- My Notes is a Cross Refs source on Mac and iPhone. It shows attached-note citations, reverse verse-note links, and a separate Indirect Mentions section. Links retain their edition and provide a source-note action.
- `npm run native:check` passed with 112 Swift tests across 40 suites and both Dev builds. The synthetic database fixture checks verse ranges, LXX identity, deduplication, and exclusion of trashed notes. Live UI verification remains pending.

### 2026-11-14 — Mac Scripture chapter citations — BUILD VERIFIED

- A compact menu lists verse notes that cite the whole chapter and opens the source note. The synthetic SQLite test covers abbreviated book names, verse-only references, other chapters, general notes, and trashed notes.
- `npm run native:check` passed with 113 Swift tests and both Dev builds. Live menu and edit-refresh checks remain pending.

### 2026-11-14 — Mac verse citations — BUILD VERIFIED

- Citation arrows preview linked passages and note titles and open My Notes for the verse. Abbreviated incoming verse citations now resolve in the Notes service.
- Full native check passed with 113 Swift tests and both Dev builds. Live visual and interaction testing remains pending.

### 2026-11-15 01:10 PST — Parity/polish batch on Codex's 839a362d — MAC LIVE + iPhone SIMULATOR VERIFIED
- **Agent/session context:** Claude Code, continuing after Codex's 15 commits (My Notes, compact verse sheet, notes inspector).
- **Repository/worktree/branch and SHA before:** `/Users/roywe/Berean-native`, `native/reader-notes` at `839a362d`.
- **Actual behavior delivered:** tab card grid + dock swipe + tab-type switcher (iPhone); note Insert menu, keyboard format bar with
  undo/redo, dock hidden while editing, Note Details menu, reference auto-linking, auto em dash; Lexicon ⌘F; Mac Settings panes;
  calendar today circle; history/daily titles; Notes select mode + bulk actions; search result Share/Add Note, Jump to, book-scoped
  search; note-return pill; palette Top Hit; missing-LXX-verse markers; selected-verses Strong's strip; invalid SF Symbol fix.
- **Commands and results:** `native:check` passed at 00:50 (114 tests / 41 suites, both Dev builds); later commits built for both
  platforms; final check recorded in HANDOFF.
- **Data touched:** isolated Dev libraries only (synthetic notes "Insert menu QA", "Proverbs 8:2, 4"; status in-progress on the first).
- **Known failures, regressions and their fixes:** em dash initially broke `---` dividers (fixed `62102592`); scanner refactor flattened
  Unicode spaces in NoteVerseRefs (caught by golden, fixed before commit).
- **Next exact action:** see HANDOFF "Still open, best next picks".

### 2026-11-15 — N04 — Whole-table deletion and Mac verification

- Mac and iPhone Notes expose Format → Table → Delete Table for outer-pipe Markdown tables. Both Dev builds and seven focused Swift checks passed at `cec84643`.
- Live Mac scratch QA verified deletion from a body cell, undo, redo, and reopening the edited note. Updated parity row N04 and the handoff. Live iPhone verification and grid rendering remain open.

### 2026-11-15 — Mac command palette location

- Command-L prefills and selects the current location, prefers the active compatible tab, and records a Back route for destinations in another space. Renamed the palette command to Notes and made the title-bar dimming use the same strength as the content.
- Mac Dev build and scratch UI verified same-tab Scripture navigation, Back, Strong’s prefill, and Notes. Dark mode, fullscreen, and additional tab types remain open.

### 2026-11-15 — N03 — Notes highlight colors

- Format → Highlight offers six colors on both native apps. The editor renders existing legacy colors and preserves Markdown compatibility.
- Both Dev builds passed. Mac scratch QA applied Blue to selected text and verified its markup. The 17 focused Swift selection checks and the full package suite (128 Swift tests and 4 XCTest tests) passed. iPhone interaction remains open.

### 2026-11-15 — I19 — Notes preferences

- Mac and iPhone Notes settings support Scripture reference detection, spell check, and the default status for new notes. The native editor applies the writing settings in place.
- Full native check passed. Mac scratch QA exercised the controls and confirmed a newly created note inherited In Progress. Updated the migration audit and handoff.

### 2026-11-15 — I19 — Optional Notes Trash confirmation

- The editor and Notes list can ask before moving notes with content to Trash, including bulk actions and iPhone swipe. The preference defaults to off and uses the existing setting name.
- Both Dev builds and all 132 tests passed. Mac scratch QA verified the editor prompt and Cancel.

### 2026-11-15 — I19 — Copy verses when highlighting

- Added the optional copy-on-highlight setting to Reading on Mac and iPhone. Scripture and Compare use their existing verse-copy formatting.
- Both Dev builds and 132 tests passed. Live Mac scratch QA verified the clipboard contained Romans 8:1–2 and both displayed verses after applying a color.

### 2026-11-15 — I19 — Notes editor font

- Both native Notes editors can use a font selected in Settings → Notes. The font changes the editor display and leaves the saved Markdown intact.
- Both Dev builds and all 132 tests passed. Live Mac scratch QA verified the open note restyled in Monospace.

### 2026-11-15 — I4 / I10 — Notes icons and list printing

- Both apps support editing the legacy note emoji icon and opening Print from a Notes row.
- Both native builds and 132 tests passed, as did the final Mac build. Isolated Mac QA verified saving and displaying Dove, plus opening and canceling the print sheet.

### 2026-11-15 — D25 — Fixed Lexicon study panes

- Fixed Mac Scripture layouts share the inspector’s Selected Verses return flow. Superseded verse lookups cannot replace the current selection.
- Both Dev builds and all 132 tests passed. Mac scratch QA verified Genesis 2:1 LXX → G3772 → Selected Verses in the fixed Lexicon layout.

### 2026-11-15 — D3 — Inline Strong’s commands

- Scripture numbers offer native open and copy commands on Mac and iPhone. Mac layouts without a Lexicon open the study panel when a number is activated.
- Both Dev builds and 132 tests passed. The Mac Reading layout opened G2316 in the inspector during scratch QA. Context menu actions still need live verification.

### 2026-11-15 — D3 — Lexicon occurrence actions

- Occurrence menus now open in the current reading workflow or explicitly in a new tab, and copy the verse or reference. Mac scratch QA verified the clipboard, fresh tab, and Back flow.
- Both Dev builds and all 132 tests passed.

### 2026-11-15 — Scripture search tab reuse

- Plain searches and book-scoped History replay now preserve existing filtered tabs and reuse only result-compatible tabs.
- Both Dev builds and all 132 tests passed. Live Mac scratch QA verified the same query stayed separate with 52 unfiltered results and zero tagged results.

### 2026-11-15 — Advanced Scripture Search History replay

- Submitting an advanced search captures its filters and presentation for History replay. The legacy query and history table remain compatible.
- Both Dev builds and all 133 tests passed. Mac scratch QA verified replay after closing a tagged search, Back to History, and replay of an older plain query.

### 2026-11-15 — I7 — iPhone leading-edge history gesture

- Added a native inward swipe that traverses available tab history. Tabs remain open when there is no Back destination.
- iPhone Dev built and launched. Device Hub verified opening a search result; the edge swipe itself remains unverified.

### 2026-11-15 — I12 — iPhone reader navigation feedback

- Chapter changes, edition flips and Compare column steps now observe the shared haptics preference. Both Dev builds passed and Simulator taps verified chapter and edition navigation.

### 2026-11-15 — Compare column chapter controls

- Mac and iPhone Compare chapter actions now use the installed chapters and disable unavailable directions. Both Dev builds passed, and Mac QA verified the independent LXX chapter round trip.

### 2026-11-15 — Compare scroll restoration

- Compare remembers shared scroll offsets and separate column verse positions while the app is open. Both Dev builds passed. Mac scratch QA verified the viewport on a tab switch and after opening Scripture and using Back.

### 2026-11-15 — Compare column changes keep their reading position

- Shared scrolling stays in place when columns are reordered. Unchanged independent columns carry their verse positions into the updated comparison.
- Both Dev builds passed. Mac QA verified a swap at Genesis 1:10 without moving the viewport.

### 2026-11-15 — Recognize unnamed workspaces by their tabs

- Mac and iPhone show the passage-based name on the current workspace control and use it as an editable rename suggestion. Mac scratch QA verified the label and cancel path.

### 2026-11-15 — Workspace passage search

- Workspace search accepts displayed passage names, prioritizes direct tab matches, and keeps unrelated tabs out of passage-only results.
- Both Dev builds passed. Mac scratch QA verified the result list and exact-label Return.

### 2026-11-15 — Archive restore with existing tabs

- Restoring a group resolves existing tab IDs and restores the remaining tabs. Future-format records are retained.
- Both Dev builds and the focused mixed-record regression passed.

### 2026-11-15 — Archive workspace labels

- Archived tabs can be found using the workspace passage label or stored workspace name. Both Dev builds passed. Mac QA verified both searches and restored the tab.

### 2026-11-15 — Archived results ranking

- Go gives exact archived titles priority over partial matches and workspace labels. Both Dev builds passed, and Mac QA verified an older exact passage ranked above a newer contextual match.

### 2026-11-15 — Lexicon and Study Trail
- The full Lexicon tab uses a circled Info symbol sized by the native toolbar.
- Find a Study Trail searches saved content and opens the matched trail with the search carried into its detail view.
- Both Dev builds and 138 Swift tests passed. The migrated SQLite search assertions passed in a focused rerun. Mac interactions were verified in the isolated QA library. Live iPhone verification remains open.

### 2026-11-15 — Study Trail library ordering
- Added Move Up and Move Down to saved trail rows. The order persists in the original trail session rows.
- Both Dev builds and all 138 Swift tests passed. Mac scratch QA verified the order after reopening the library. Live iPhone verification remains open.

### 2026-11-15 — Study Trail tags
- Create and assign tags from Trail Actions. Find saved trails by their assigned tag names.
- Both Dev builds and all 139 Swift tests passed. Mac scratch QA verified tag creation, assignment, and library search.

### 2026-11-15 — Study Trail sticky notes
- Add and edit sticky notes and section headers from Trail Actions. The sheet shows each entry’s anchor chapter.
- Both final Dev builds and 140 Swift tests passed. Mac scratch QA verified creating and editing a section. Live iPhone verification remains open.

### 2026-11-15 — Sticky notes in Study Trail Map
- Map shows sticky notes at their saved stops, and library and trail searches include sticky titles and bodies.
- Both Dev builds and all 140 Swift tests passed. Mac scratch QA verified map placement and both search paths. The iPhone Dev build launched in Simulator.

### 2026-11-15 — Move Study Trail sticky notes
- Sticky notes and section headers can move to another recorded passage or become unanchored.
- Both Dev builds and all 140 Swift tests passed. The Mac map control was checked in the running app. The move and detach actions were verified at the service layer.

### 2026-11-15 — iPhone floating reader controls
- The Scripture dock floats above the reading view and releases its scroll clearance when hidden. Verse actions follow the dock’s position.
- Both Dev builds passed. The iPhone 18 Pro Simulator showed the final three verses of Romans 8 completely above the two floating controls.

### 2026-11-15 — iPhone Scripture chapter edges
- The next-chapter pull cue clears the floating dock. Scroll direction and toolbar state reset on passage changes.
- Both Dev builds passed. iPhone Simulator displayed the new chapter and its selected range after a Dev link changed chapters. Pull gestures remain to verify.

### 2026-11-15 — Keep newly selected verses in view
- The reader brings a contiguous selected group clear of the floating controls when it fits. For a taller group it prioritizes the newly selected verse.
- Mac and iPhone Dev builds passed, along with nine focused range and clearance assertions. Live selection interaction remains to verify.

### 2026-11-15 — Scripture taps near the iPhone screen edge
- Chapter-turn taps stay in the empty margin so they do not intercept linked Scripture content. UIKit keeps control of active text selections and their handles.
- The iPhone Dev build passed and opened John 3:16–18 in Simulator. Direct gesture checks remain open.

### 2026-11-16 — iPhone Scripture control contrast
- Increased the backing opacity of the floating Scripture dock and verse actions to improve icon readability over red-letter verses.
- Both Dev builds passed. Light and Dark Mode were visually checked in iPhone Simulator.

### 2026-11-16 — Mac Scripture pointer feedback
- Verse numbers and inline links use a single pointer decision for hover and tracking events. Hover shading remains limited to visible link characters.
- The Mac Dev build passed and the selected reader loaded in the isolated QA app. Live pointer transitions remain to verify.

### 2026-11-16 — Compact Mac verse actions
- Kept Tag accessible in the compact Scripture action bar alongside Copy, Highlight, and Clear.
- Both Dev builds passed. A 320-point Mac QA check verified the visible controls and overflow menu.

### 2026-11-16 — Landscape iPhone Scripture controls
- The dock and verse actions share one row when landscape has room, leaving more space for reading.
- Both Dev builds passed. A temporary rotation build showed Jude 1:22–25 above both capsules on iPhone 18 Pro Simulator. Restored-position behavior remains open.

### 2026-11-16 — Explicit Scripture range navigation
- Keep verse-jump requests through reader loading and calculate the iPhone scroll limit after laying out the chapter.
- Both Dev builds passed. iPhone Simulator verified that a late John 3 range opened fully above the floating controls after an earlier visit to the chapter.

### 2026-11-16 — Restore iPhone Scripture position after layout
- Wait for the reader viewport before restoring. Reuse the reading verse when width changes and preserve chapter-end positions.
- Both Dev builds passed. A simulator tab-return sequence retained the full final selection after rotating to landscape.

### 2026-11-16 — Preserve the reading position during iPhone rotation
- The reader reapplies the last visible verse or end-of-chapter position after its viewport settles.
- The iPhone Dev build passed. Simulator QA confirmed that Romans 8:37–39 stayed fully visible after rotating with the tab open.

### 2026-11-16 — Keep visible verse selections in view while rotating
- Preserve a fully visible contiguous selection after rotation when it fits in the resized viewport.
- The iPhone Dev build passed. Simulator verified Romans 8:17–19 fully visible after rotation in both directions.

### 2026-11-16 — Compare directly from selected verses
- Verse action overflow opens Compare in the current tab with the selection carried over. The single-verse context action opens only the chosen verse.
- Both Dev builds passed. Mac QA verified KJVA and LXX comparison with Genesis 1:1–3 selected.

### 2026-11-16 — Multi-select verses in aligned Compare
- Toggle individual verses and retain contiguous or disjoint selections when returning to Scripture. Mac adds Shift-click range extension.
- Both Dev builds passed. Mac QA verified deselecting the middle verse and returning to the same disjoint selection in Scripture.

### 2026-11-16 — Selected verses in independent Compare columns
- Following columns display selected verses and use the first matching verse as their initial position when they have no saved scroll position.
- Both Dev builds passed. Mac QA verified matching selected rows in KJVA and LXX with Sync Scrolling off.

### 2026-11-16 — Align Compare rows by known verse counterparts
- Align verified KJV–Brenton verse differences in Compare, including chapter joins.
- Both Dev builds passed. Mac QA verified KJVA Psalm 10:1 beside Brenton Psalm 9:22.

### 2026-11-16 — Clarify Compare chapter joins and pinned columns
- Aligned Compare names both chapters when an edition contributes rows from a chapter join.
- Pinning takes effect even when the column is currently on the main passage’s chapter. Both Dev builds passed, and Mac QA verified pinning, following again, and the Psalm 113 join.

### 2026-11-16 — Honor the selected range when leaving Compare
- Opening a selected passage from Compare jumps to its mapped verse or range in Scripture.
- Both Dev builds passed. Mac QA verified Brenton Psalm 113:9–10 opened KJVA Psalm 115:1–2 with both verses selected.

### 2026-11-16 — Carry Compare reading position into Scripture
- Opening an unselected Compare column takes its current reading position into Scripture without selecting a verse.
- Both Dev builds passed. Mac QA verified that leaving a scrolled Psalm 113 comparison opened the contributing KJVA Psalm 115.

### 2026-11-16 — Preserve reading position from stacked Compare
- Open in Reader carries the chosen stacked column’s reading verse without creating a selection.
- Both Dev builds passed. A temporary iPhone simulator fixture verified Genesis 1:9 appeared first when leaving the scrolled stacked comparison.

### 2026-11-16 — Keep stacked Compare anchored when scrolling back
- Open in Reader uses the chosen column’s visible rows after scrolling in either direction.
- Both Dev builds passed. Scripted iPhone QA scrolled from Genesis 1:18 back to 1:7 and verified Scripture opened at verse 7.

### 2026-11-16 — Use visible rows for aligned Compare scroll handoffs
- Aligned Compare uses its visible verses when handing off to Scripture or switching to independent scrolling.
- Both Dev builds passed. Mac QA verified a scrolled chapter join still opens the visible contributing chapter.

### 2026-11-16 — Map live Compare scrolling between editions
- Synchronize independent columns that cover the same passage and use known verse mappings across edition boundaries.
- All 141 Swift tests and both Dev builds passed. Mac QA verified downward wheel synchronization for Psalm 10 KJVA and Psalm 9 LXX. The upward wheel case remains open.

### 2026-11-16 — Restore bidirectional Mac Compare wheel sync
- Use the wheel’s source pane and its visible verses to synchronize equivalent passages.
- Both Dev builds passed. Mac QA verified the Brenton pane follows KJVA Psalm 10 down and back up.

### 2026-11-16 — Use the current query when submitting floating search
- Return resolves the text currently in the search field, including exact note titles.
- Both Dev builds passed. Mac scratch QA verified immediate Return after pasting a passage and a note title.

### 2026-11-16 09:38 PST — iPhone Go and Lexicon entry help — IMPLEMENTED

- **Changes:** Focus the iPhone Go field after presentation and resolve immediate submission against the current input, including exact titles in the Notes matches. Size the Lexicon Entry Guide control for the platform toolbar and anchor its guide to the icon.
- **Verification:** The iPhone 18 Pro simulator showed the Go field's insertion cursor, opened a synthetic exact-title note from Scripture when submitted before the results task ran, and rendered the revised Lexicon info control. Mac Dev scratch QA opened the guide from the toolbar and dismissed it with Done. Temporary launch fixtures lived in the scratch checkout. Physical iPhone touch remains unverified.

### 2026-11-16 — Cross-reference previews — MAC UI VERIFIED

- Split the reference link from its inline preview. The preview can expand when clipped at the current width, and the row menu now offers Open.
- Mac Dev scratch QA expanded and collapsed Mark 13:19 from Genesis 1:1 in TSKe and verified that shorter adjacent previews showed no toggle. iPhone touch and VoiceOver remain open.

### 2026-11-16 — Cross-reference row accessibility — MAC AX VERIFIED

- Expose the passage, preview toggle and actions as separate controls and keep the section headings navigable. Suppress preview animation with Reduce Motion.
- Both Dev targets built. Mac accessibility automation activated expansion and collapse and verified the passage action menu. Direct VoiceOver and iPhone touch checks remain open.

### 2026-11-16 — Full cross-reference ranges — MAC UI VERIFIED

- Expand Classic and TSKe Scripture ranges into the full referenced verse text without leaving the inspector. Fetch the chapter only when the user expands the row.
- Mac Dev scratch QA verified that Proverbs 8:22–24 displayed all three verses and returned to the first-verse preview on collapse. iPhone touch remains open.

### 2026-11-16 — Cross-reference and Lexicon interaction — IPHONE SIMULATOR VERIFIED

- iOS 27, iPhone 18 Pro in Xcode Device Hub. Opened and dismissed the full Lexicon entry guide, expanded a verse group by tapping its row, expanded John 8:26–28 inline, and opened the range from its long-press menu. The reader showed verses 26–28 within a single selection outline.
- Physical-device behavior, VoiceOver, clipboard and the remaining cross-reference sources were outside this run.

### 2026-11-16 — iPhone verse action clearance — SIMULATOR VERIFIED

- Reserve real reader viewport space while the verse action bar is visible so the controls cannot cover mid-chapter lines. The dock-only layout returns when selection clears.
- iOS Dev build passed. On iPhone 18 Pro Simulator, verified John 8:26–28 and a newly selected verse 33 near the bottom edge, then cleared selection. Mac behavior was outside this change.

### 2026-11-16 — Mac verse action clearance — MAC UI VERIFIED

- Place the floating action bar below the actual reader viewport and use the clip bounds for selection navigation.
- Mac Dev build passed. Verified unobstructed mid-chapter text on John 8:26–28, the last verse on John 8:59, and clearing with Escape using the scratch library.

### 2026-11-16 — Restore scrolling beneath floating verse actions

- Restored the overlapping glass action bars for both readers after the owner clarified that Scripture should extend behind them. Retained bottom scrolling clearance and selection reveal.

### 2026-11-16 — Mac Scripture selection during window resize

- Preserve an already-visible selection above the floating action bar when the window resizes. Mac Dev built successfully. Fill → Top tile kept John 8:58–59 visible in the scratch reader.

### 2026-11-16 — Mac Scripture pointer ownership

- Limit the reader's cursor updates and link hover to locations where the text view owns the hit. Mac Dev build passed. Direct pointer motion verification remains open.

### 2026-11-16 — Notes excerpts in iPhone Go

- Show the matching note's body excerpt below its title, using the same renderer as Notes. iPhone simulator verified a body-only search and opening its result.

### 2026-11-16 — Scripture excerpts in iPhone Go

- Preview the requested verse or chapter opening in the resolved edition. The iPhone 18 Pro simulator verified Jude 5, replacing it with Isaiah 53 LXX, and opening the Septuagint result.

### 2026-11-16 — Scripture excerpts in Mac floating search

- Share the passage excerpt loader with iPhone Go. Mac scratch QA verified both verse and chapter excerpts, edition replacement and Return navigation.

### 2026-11-16 — Notes excerpts in Mac floating search

- Display matching body excerpts in Notes results. Mac scratch QA verified a body-only match, keyboard selection, and Shift-Return opening a new tab. Both Dev builds passed.

### 2026-11-16 — Stable floating search selection

- Track explicitly selected rows by result ID and current query. Both Dev builds passed, and Mac scratch QA verified arrow selection and Return.

### 2026-11-16 — Strong's previews in Go and floating search

- Direct Strong's results now show the headword, transliteration and gloss. Both Dev builds passed. Mac verified G3056 and H3068 preview replacement and Return navigation.

### 2026-11-16 — iPhone Lexicon toolbar and Strong’s lookup verification

- Group Find, Search and Copy in Entry Tools, leaving the adjacent-entry and guide buttons visible. Simulator QA confirmed the menu and Find in Entry, plus valid and missing Strong’s lookups from Go.

### 2026-11-16 — Inline Strong’s title on iPhone

- Keep the Strong’s number in the navigation bar and lead the entry body with its headword. iOS Dev built successfully. iPhone 17e simulator verified the full H3068 title and Info access.

### 2026-11-16 — Removable Lexicon occurrence filters

- Show active occurrence settings as individual removable chips. Both Dev targets built in the scratch checkout. Mac QA verified independent edition and book clearing.

### 2026-11-16 — Accurate Lexicon sample counts

- Detect capped results independently for each edition and label filters against the loaded sample. Both scratch Dev builds and seven Lexicon tests passed. Mac QA verified the capped and exact count states.

### 2026-11-16 — Full Lexicon occurrence filtering

- Filter the complete tagged corpus in the full Lexicon. Mac QA verified 5,517 H3068 results and 141 in Genesis. Both scratch Dev builds and eight focused tests passed.

### 2026-11-16 — Background Lexicon occurrence formatting

- Prepare occurrence snippets and filter keys off the main actor. Both scratch Dev builds passed. iPhone simulator verified navigation from H3068 to H3069 with the destination's own occurrence count.

### 2026-11-16 — Floating verse actions

- Both readers keep Scripture in place when the action capsule adds bottom scroll room. iPhone uses less padding after the final line.
- Mac and iPhone Simulator Dev builds passed. AppKit viewport and scroll-limit assertions passed. The iPhone Dev simulator showed text beneath both reader capsules with Genesis 1:25–26 selected. No production data was used.
- See HANDOFF for final-verse and live Mac checks.

### 2026-11-16 — Lexicon occurrence order

- Full Lexicon occurrence lists follow Scripture order within each edition on Mac and iPhone.
- Eight Lexicon tests passed, covering complete lists, edition grouping, deduplication, and legacy capped results.

### 2026-11-16 — Combined Lexicon filters

- Edition, book, and translated-word filters retain their selections when combined. Incompatible selections show zero results and can be removed individually.
- Both Dev builds passed. iPhone Simulator verified a zero-result edition and book combination and restored the scoped 18 results by clearing the edition.

### 2026-11-16 — Strong’s lookup context

- History shows the passage behind inline Strong’s lookups and can filter by that reference. Opening a related Lexicon entry in a new tab records the source for Back.
- Both Dev builds and two history store regression tests passed. Live checks are recorded in HANDOFF.

### 2026-11-16 — Reopen a Strong’s source passage

- New Strong’s History entries save their source edition. Open Source Passage returns to the recorded reader location, including the clicked edition in Compare. Both Dev builds passed.

### 2026-11-16 — Lexicon filters and Search hover

- Moved Lexicon Filters beside Search Scripture and replaced the split counts with one results summary. The filter panel adds searchable books and translated words.
- Added pointer hover feedback to Lexicon and Advanced Search controls. The iPhone Dev simulator verified the new book filter and result summary.

### 2026-11-16 — Lexicon and Advanced Search option controls

- Grouped Lexicon occurrence counts, Filters and Search Scripture in the leading section of both entry surfaces. Separated narrowing choices from ordering and strengthened pointer feedback in the two study tools.
- Verified Mac and iPhone Simulator Debug builds. Mac visual verification could only reach a stale Dev window and needs a fresh isolated pass. No production library used.

### 2026-11-16 — Empty workspace recovery

- Added direct access to the existing archive browser from empty workspaces on Mac and iPhone. Added a Go button to the Mac empty state.
- Both Dev builds passed with identity checks. Mac scratch QA restored the final archived tab with the sidebar hidden. iPhone interaction check pending.

### 2026-11-16 — Archive directly from the iPhone reader

- Grouped Duplicate, Archive and Close in More → Tab Actions. iOS Dev built successfully and the iPhone 18 Pro simulator verified archiving the final tab and restoring it from the empty screen.

### 2026-11-16 — Undo an iPhone reader archive

- Added immediate Undo above the dock when archiving from Tab Actions. Verified in the iOS 27 iPhone 18 Pro Dev simulator by archiving and undoing the last Scripture tab.

### 2026-11-16 — Consistent archive feedback in iPhone Tabs

- Reused bulk archive feedback for individual swipe and context-menu actions and offered Restore Here when the source workspace cannot accept Undo. iOS Dev build and simulator launch passed.

### 2026-11-16 — Undo archive from the Mac sidebar

- Added a sidebar notice with Undo after archiving one or all tabs. Verified the last-tab archive and Undo in the Mac Dev scratch library.

### 2026-11-16 — Reader clearance while archive Undo is visible

- Included the iPhone archive notice in floating reader clearance. Verified selection and separated action, Undo and dock controls in a two-tab simulator workflow.

### 2026-11-16 — iPhone Scripture note citations

- Added the chapter citation menu and tappable verse citation markers that jump to My Notes cross references. Both native Dev builds passed. Simulator fixture verification remains open.

### 2026-11-16 — Keep the Mac study panel when browsing history

- Keep each Scripture tab’s inspector visibility when leaving and returning to it. Verified Back and Forward across a TSKe cross reference opened in a new tab.

### 2026-11-17 — Notes formatting and editable tables

- Mac and iPhone notes use the body font for editable table cells and draw header shading and cell borders. Notes previews show vertical dividers. Format includes Inline Code.
- UIKit table insertion preserves ASCII Markdown separators. Mac scratch verified live rendering and cell editing. iPhone 18 Pro Simulator verified insertion, Undo and Redo. Both Dev builds passed.
- Full SwiftPM testing encountered local package file and resource staging timeouts. Existing iPhone notes with substituted em-dash separators and wide-table layout need follow-up.

### 2026-11-17 — Older iPhone table recovery

- Recognize older iPhone table separators in the editor and preview without rewriting stored notes. Focused Swift checks confirmed that valid tables retain literal em-dash cells, and the iPhone Simulator rendered the previously malformed fixture as a grid.

### 2026-11-17 — Live Dynamic Type in Notes

- The iPhone editor updates note text and table geometry when the system text size changes. Verified growth and restoration with a populated header and active caret on iPhone 18 Pro Simulator.

### 2026-11-17 — Wrapped Notes table rows

- Wide editable tables retain visible row boundaries and header shading when content wraps. Short rows avoid extra line breaks caused by trailing padding. Both native builds and the focused AppKit layout check passed.

### 2026-11-17 — Mac control cursors

- The shared control cursor follows effective enabled state. Native toolbar pointer tracking releases records when their views are discarded.

- Applied the disabled-aware cursor to the Mac chapter toolbar, navigation history, sidebar tabs and Notes preview links. Mac scratch QA confirmed chapter boundary and floating-search control states.
