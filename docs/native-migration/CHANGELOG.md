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
