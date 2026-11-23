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

### 2026-11-17 — Review selected inactive tabs

- Archive Inactive Tabs exposes a full selection review on both platforms. Returning to matches restores the filters. Verified the hidden-selection and cancel flow in Mac Dev.

- Cleanup titles distinguish review from matching tabs on both platforms. Archive and move return to matches after displaying their result. Verified iPhone archive and undo from review.

### 2026-11-17 — Distinguish workspaces with matching names

- Workspace lists and move menus show an ordinal when visible names collide. Existing names, passage previews, and IDs remain intact.

- Workspace Rename opens with the stored name on Mac and iPhone. Verified generated-name prefill and switching between two colliding names in Mac Dev.

- Tab search, recent tabs and already-open passage destinations use duplicate-aware workspace labels. Verified selection of the second identical tab result in Mac Dev.

- Archived tab titles and restore actions distinguish same-name live workspaces. Verified restoration to the second matching workspace in Mac Dev.

- The iPhone workspace picker shows the current workspace first and puts New Workspace in the header. Verified switching and creation on iPhone 18 Pro Simulator.

- Return in workspace search leaves ambiguous results visible for a choice. Verified ambiguous and unique tab queries in Mac Dev.

- iPhone workspace rows put identifying details before passage previews and make the full row tappable. Simulator verified ambiguous and exact keyboard submissions.

- Advanced Scripture Search supports opening a verse and applying or removing its highlights from the result menu. Verified the complete cycle in Mac Dev.

- Scripture search results show a live indicator for saved verse highlights and disable removal when the result has no saved marks. Mac Dev verified apply and remove without leaving results.

- Scripture search rows share saved-highlight reads by chapter and edition. A focused check verified cache reuse and refresh after a change.

- Search highlight menus show a checkmark for the saved whole-verse color. iPhone Simulator verified highlight and removal from overflow and long-press menus.

- iPhone Scripture search option pickers stack their labels and values. Verified scrolling and menu readability at Accessibility Large.

- Scripture search can browse the installed book catalog without typing and filter by full or short name. iPhone Simulator verified selecting and clearing a book filter.

- Scripture search book suggestions honor the selected editions and testament. Verified scoped browsing and reset on iPhone Simulator.

- Scripture search explains conflicting book and scope filters and can clear just the book selection from the empty state. Verified recovery in Mac Dev.

- Lexicon offers Reset Filters alongside empty occurrence results. Mac Dev verified restoring H430 results after incompatible word and book filters.

- Compact Lexicon identifies sampled occurrences and places the full-entry action alongside occurrence filters and Scripture search.

- Opening the full Lexicon from a filtered compact entry carries over occurrence filters. Mac Dev verified expanding the H430 sample while retaining the 1 Chronicles filter.

- Lexicon paging controls wrap in narrow views and offer Show Fewer after a single expansion. Mac Dev verified paging and Back to a filtered entry.

- Collapsing Lexicon occurrences returns to their heading. Back retains the occurrence target through layout. Both paths were verified on Mac.

### 2026-11-17 02:33 PST — Notes typography and live table layout — BUILT, UI CHECKED
- **Starting point:** `7cc913b8`, `native/reader-notes`, draft PR #24.
- **Changes:** Mac body text uses the standard system size. Both editors align document content with the title while retaining the chosen body family and explicit code styling. Editable tables gain consistent cell insets, Markdown alignment, and fixed dividers for rows whose final cell wraps within the available width.
- **Verification:** Mac and iOS Simulator Dev builds passed. Mac scratch UI confirmed a wrapped three-column fixture and original Markdown in the editor. iPhone 18 Pro Simulator confirmed Insert → Table displays a shaded header and grid. Device testing and populated narrow-table QA remain open.
- **Data:** Synthetic scratch/Simulator notes only. See HANDOFF for the next checks.

### 2026-11-17 — Notes previews and print sizing — BUILT, MAC PRINT PREVIEW CHECKED
- **Starting point:** `64816337`, `native/reader-notes`, draft PR #24.
- **Changes:** Native note previews share the editor's delimiter parser, retain adjacent tables and give wrapped rows full-height separators. Printed tables use equal columns, source alignment and a shaded header. Mac measures the complete document before previewing it.
- **Verification:** Both Dev builds passed. Mac scratch print preview showed all rows of a populated three-column fixture. Canceled without printing. Remaining UI checks are in HANDOFF.

### 2026-11-17 — Editable Notes table boundaries — BUILT, MAC UI CHECKED
- **Starting point:** `36f56088`, `native/reader-notes`, draft PR #24.
- **Changes:** Table commands target only the recognized block at the caret. Escaped pipes in recognized rows display as literal cell content while retaining their Markdown source.
- **Verification:** Mac and iOS Simulator builds passed. Targeted Swift checks covered adjacent tables, rejected malformed rows, and checked escaped pipes in headers and inline code. Mac scratch QA verified literal pipe display, Add Column After on the second of two adjacent tables, and Undo.
- **Follow-up:** Retained command support for short rows with omitted trailing cells. Both builds passed again, and the focused Swift check covered a short row followed immediately by another table.

### 2026-11-17 — Cross Refs group navigation — BUILT, MAC AND SIMULATOR UI CHECKED
- **Starting point:** `f96bc1c1`, `native/reader-notes`, draft PR #24.
- **Changes:** Cross Refs gains bulk verse-group disclosure on Mac and iPhone. Source refreshes keep expanded verses in the current scope.
- **Verification:** Both Dev builds passed. Mac scratch Genesis 1 and iPhone 18 Pro Simulator John 3 showed reference rows after Expand All and returned to the compact verse list after Collapse All.

### 2026-11-17 — iPhone reader chapter-end clearance — BUILT, SIMULATOR UI CHECKED
- **Starting point:** `ea496bfa`, `native/reader-notes`, draft PR #24.
- **Changes:** Keep a reader at chapter end when the floating dock or selection bar changes the scroll inset.
- **Verification:** Both Dev builds passed. iPhone 18 Pro Simulator verified clear, reselect, and add adjacent verse at Obadiah's final line. Gesture-driven dock reappearance and landscape still need live checks.

### 2026-11-17 — Mac chapter-end position and Notes Unicode — BUILT, VERIFIED
- **Starting point:** `f38337d4`, `native/reader-notes`, draft PR #24.
- **Changes:** Mac locks chapter-end position across floating action inset changes. Shared Notes plain-text conversion preserves Unicode by appending contiguous source slices.
- **Verification:** Both Dev builds and 147 Swift Testing cases passed. Mac scratch QA cleared and reselected the wrapped final verse of Obadiah with the inspector open and confirmed the text stayed above the action bar.

### 2026-11-17 — Repeated-title workspace browsing — BUILT, MAC UI CHECKED
- **Starting point:** `8b8ee955`, `native/reader-notes`, draft PR #24.
- **Changes:** Both tab switchers can filter for repeated titles with matching details. iPhone numbers those copies in normal browsing. Mac remembers the active filter per workspace during the current run.
- **Verification:** Both Dev builds passed. Mac scratch QA verified two numbered Obadiah tabs in the filtered list and restoration of unrelated tabs when cleared.

### 2026-11-17 — Workspace collision hints — BUILT, MAC UI CHECKED
- **Starting point:** `643c7446`, `native/reader-notes`, draft PR #24.
- **Changes:** Workspace previews surface a distinguishing tab when labels collide, including when it is farther down the tab list.
- **Verification:** Both Dev builds passed. Focused Swift checks covered generated names, repeated titles, unique later tabs and query previews. Mac scratch QA used the Jude hint to open the intended same-name workspace.

### 2026-11-17 — iPhone workspace tab browsing — BUILT, SIMULATOR UI CHECKED
- **Starting point:** `6d290385`, `native/reader-notes`, draft PR #24.
- **Changes:** Live workspaces have a Browse Tabs action with a scoped search and direct opening of an existing tab.
- **Verification:** Both Dev builds passed. Simulator QA browsed the Study workspace from a different workspace and opened its existing John 3 tab.

### 2026-11-17 — Mac workspace tab browsing — BUILT, MAC UI CHECKED
- **Starting point:** `73c742a5`, `native/reader-notes`, draft PR #24.
- **Changes:** Mac workspace search now opens the shared scoped tab browser from live workspace rows.
- **Verification:** Both Dev builds passed. Mac scratch QA verified scoped search, two numbered matches, direct tab opening, and cross-workspace Back.

### 2026-11-17 — Workspace tab keyboard search — BUILT, MAC UI CHECKED
- **Starting point:** `4925c3d2`, `native/reader-notes`, draft PR #24.
- **Changes:** Workspace tab search supports explicit copy numbers and submits a unique result. Mac autofocuses the scoped field.
- **Verification:** Both Dev builds passed. Mac scratch QA checked initial focus, ambiguous submission, and opening the second Obadiah result using Return.

### 2026-11-17 — Repeated Scripture search returns — BUILT, MAC UI CHECKED
- **Starting point:** `b1b3ff4f`, `native/reader-notes`, draft PR #24.
- **Changes:** Scripture search keeps the clicked result centered across repeated Back and Forward and remembers subsequent manual scrolling.
- **Verification:** Both Dev builds passed. Mac scratch QA reproduced both the repeated return to Genesis 3:3 and restoring a later manual viewport after switching tabs.

### 2026-11-17 — Notes search history — BUILT, MAC UI CHECKED
- **Starting point:** `f8851fc5`, `native/reader-notes`, draft PR #24.
- **Changes:** Notes keeps a search result anchor across repeated history visits and records the source list for context-menu opens.
- **Verification:** Both Dev builds passed. Mac scratch QA used Open in New Tab from a Notes search, then verified Back, Forward and Back again.

### 2026-11-17 — Formatted iPhone note previews — BUILT, SIMULATOR UI CHECKED
- **Starting point:** `476d3a22`, `native/reader-notes`, draft PR #24.
- **Changes:** Note context previews render a formatted excerpt including tables.
- **Verification:** Both native builds passed. iPhone 18 Pro Simulator displayed a table grid in the long-press preview and opened the editable note from its menu.

### 2026-11-17 — Notes table excerpts — BUILT, MAC UI CHECKED
- **Starting point:** `e61f54aa`, `native/reader-notes`, draft PR #24.
- **Changes:** Notes excerpts read through recognized cells and omit Markdown table scaffolding.
- **Verification:** Both Dev builds passed. Mac scratch QA confirmed readable table headers, a matching cell in search, and visible literal pipe content.

### 2026-11-17 — Direct Cross Refs source notes — BUILT, SIMULATOR UI CHECKED
- **Starting point:** `a923ae80`, `native/reader-notes`, draft PR #24.
- **Changes:** My Notes cross-reference rows provide a direct link to the citing note. iPhone completes inspector dismissal before navigation.
- **Verification:** Both Dev builds passed. Simulator QA opened a synthetic note from Exodus 20:11 and used Back to restore the selected verse.

### 2026-11-17 — Lexicon filter feedback — BUILT, MAC UI CHECKED
- **Starting point:** `7b9be441`, `native/reader-notes`, draft PR #24.
- **Changes:** Occurrence pickers gain clearer counts, Scripture book order, no-match feedback, and independently clearable search and translated words.
- **Verification:** Both Dev builds passed. Mac scratch QA exercised the new book and translated-word controls with H430.

### 2026-11-17 — Compare exit transitions — BUILT, MAC AND SIMULATOR UI CHECKED
- **Starting point:** `45bf2b4e`, `native/reader-notes`, draft PR #24.
- **Changes:** Compare column close makes the exit explicit and preserves the sole passage in legacy configurations. iPhone Exit Compare can restore the visible main-translation verse.
- **Verification:** Both Dev builds passed. Mac scratch QA closed to LXX and restored both columns with Back. Simulator QA returned to selected Genesis 3:3 from Compare.

### 2026-11-17 — Compare viewport bookmarks
- Both Dev builds passed. Mac scratch QA preserved the scrolled LXX position across opening the reader and going Back. Stacked layout changes still need a live pass.

### 2026-11-17 — Mac reader keyboard and floating controls
- **Changes:** Blank sidebar double-click opens New Tab search. Command-L explicitly edits the compatible current tab. Mac Scripture Find uses a floating glass bar with type-ahead and idle dismissal. Reader cursor updates exclude the native toolbar.
- **Verification:** Both Dev builds passed. Mac scratch QA checked double-click, ordinary and pinned Command-L edits, automatic and explicit Find, match navigation and dismissal. Direct pointer-motion verification remains open.

### 2026-11-17 — Mac Find across reader display changes
- Both Dev builds passed. Mac scratch QA kept the second Romans 5 match through a Strong's toggle and advanced to the third match afterward.

### Mac Find adapts to pane width
- Mac Dev built. Scratch QA confirmed query focus and match navigation survived widening the study panel. The two compact layout thresholds remain to test live.

### Mac reader cursor ownership
- Removed the text view's overlapping AppKit cursor rectangle. Mac Dev built and scratch QA exercised the reader link and toolbar click paths. Cursor motion remains open.

### 2026-11-17 — Current-tab search scope and history

- Command-L search replacement clears old result restrictions to match the palette's requested search. Back and Forward restore filters even when the query stays the same.
- Both Dev builds passed. Mac scratch QA verified filter clearing and repeated navigation with the tab count unchanged. Compare Command-L and Back were also verified in a pinned tab.

Shared Swift regression check after `6db387e5` passed with 147 tests in 44 suites (`swift test -c release`, 36.746 seconds). Both Dev build logs are `/tmp/berean-BereanMac-location-filters.log` and `/tmp/berean-BereanIOS-location-filters.log`. Mac QA used the isolated `--qa-library` build.

### 2026-11-17 — Notes gallery and folder restoration

- Added optional adaptive Gallery in Notes Options on Mac and iPhone, sharing note-opening, selection and context actions with List.
- Fixed Notes folder location being dropped during local tab persistence.
- Both native builds passed. Mac and simulator QA verified gallery opening, return navigation and relaunch. All 148 shared Swift tests passed.

### 2026-11-17 — Collapsible Notes sections and gallery history

- Added full-width disclosure headings and retained per-folder/grouping collapse state on both platforms. Hidden selected notes retain visible counts, and Select Visible acts on expanded sections.
- Fixed returning from a lower gallery card resetting the viewport near the top.
- Both Dev builds passed. Mac verified repeated gallery history, search, selection and disclosure persistence. iPhone Simulator verified heading taps and hidden-selection feedback.

### 2026-11-17 — Notes glass and stable control cursors

- Mac Notes folders use larger native glass groups. Folder and note rows align leading, with full-width folder targets and consistent hover feedback. Simulator verified opening All Notes from the row gap.
- Mac cursor ownership now runs after event dispatch and respects explicit SwiftUI disabled state. Debug samples verified hand cursors after movement across a disclosure and enabled toolbar button, plus the arrow over disabled Back.
- Recorded the owner's requirement for original-quality Read Aloud voices. M05 remains open.

### 2026-11-17 — Floating actions and Notes home return

- Fixed the hosting-view cursor case over floating Scripture actions. The repeated Copy-button drag now produced a settled hand cursor.
- Mac Notes home retains its position across note opening, Back/Forward and tab switches. Note editors name their actual Notes list or folder return destination.
- Both Dev builds passed. Mac runtime verified repeated return to the lower recent-note card and ordinary tab-switch restoration.

### 2026-11-17 — Switch cursors and iPhone Notes return

- Extended Mac pointing-hand coverage to native switches and added enabled-state refresh for hovered SwiftUI regions. Live movement inside a Settings switch retained the hand.
- iPhone Notes home now has grouped scroll anchors and clear space above the dock. Repeated recent-note opening/return restored the lower viewport in Simulator.

### 2026-11-17 — Cross-type location editing

- Cmd+L changes the current tab across Scripture, Search, Lexicon and Notes while retaining identity, pin and sidebar position. Back/Forward restores the prior type as well as its location.
- Empty Mac sidebar space uses the arrow.
- Live QA covered mixed-type history, pinned Compare, an existing destination, Shift-Return New Tab and ordinary Cmd+K reuse. Shared tab-replacement tests cover 200 type/pin combinations.

### 2026-11-17 — Native note-title suggestions

- Added floating note-title suggestions after [[ on Mac and iPhone, with keyboard navigation on Mac and touch selection on iPhone. Existing Markdown remains literal in storage.
- Verified insertion on both platforms, dismissal/query editing on Mac and separate Undo/Redo on iPhone. Mac's following-typing undo coalescing remains a known refinement.
- Added Unicode/stale-range/code guards and a title-only query that excludes trashed notes. Five focused tests pass.

### 2026-11-17 — Search context and completion undo

- Notes Search prefills Cmd+L, query changes enter history, and Notes clears the search.
- Lexicon search replacement updates immediately; query/language restore through history and relaunch, using existing legacy state fields. Simulator verified Hebrew elohim persistence.
- Mac note completion now uses explicit reciprocal undo edits; separate typing Undo, completion Undo and Redo passed in the live editor.
- Fixed Release simulator conformance testability and a calendar-sensitive legacy test. All 156 simulator package tests and five focused legacy tests pass locally.

### 2026-11-17 — Lexicon result navigation

- Added full-row Lexicon result actions, a fixed header, and device-local offset restoration through entry navigation and relaunch.
- Made only the latest search task eligible to publish results and restored iPhone keyboard focus on Clear.
- Verified both Debug builds, focused Workspace conformance (19 tests), and iOS 27 Simulator return and rapid-query behavior. See [HANDOFF](HANDOFF.md) for remaining checks.

- Fixed an additional language-switch scroll shift caused by lazy row height estimates. Final simulator Hebrew → Greek → Hebrew retained its saved viewport; both apps rebuilt successfully.

### 2026-11-17 — Note-link suggestion previews

- Native note-link suggestions show the selected note's passage and excerpt in the glass panel. iPhone Simulator verified preview, insertion and Undo; both apps build. Mac runtime and software keyboard/accessibility checks remain.

### 2026-11-17 — Workspace snapshot selection fallback

- Restoring a public Parsed snapshot with a missing/stale active tab now chooses its first restored tab. Added remapped-identity and empty-space regressions; two focused tests pass. Normal serialized snapshot parsing already repaired these values.

### 2026-11-17 — Note reference and Strong’s block suggestions

- Added optional previews and source-validated insertion in both native editors, controlled by existing Notes preferences.
- Preserved literal dictionary text and edition-aware Scripture formatting, including numbered ranges and the LXX marker.
- Both Debug builds and 166 host Release tests passed. Simulator verified insertion, Undo, dismissal and representative input guards.

- iPhone Return accepts prepared block and note-link suggestions. Both native editors validate the current query before consuming completion keys. Simulator verified both Return paths.

### 2026-11-18 — Strong’s links in note text

Explicit Strong’s IDs in both note editors open Lexicon, including repeated dictionary references. Simulator verified G5463 navigation. Code, URLs and existing Markdown links retain ownership; fixed an unfinished-wikilink exclusion spanning later paragraphs.

### 2026-11-18 — Notes folders and native controls

- Folder trees start collapsed at each level and remember explicit expansion. Empty folder state is centered. iPhone Notes uses an explicit large title.
- Verse Notes creates attached passage notes; Daily Notes offers a date chooser and reuses existing daily notes. Simulator verified both.
- Pinned tabs have Unpin beside Close. Mac navigation stays grouped; native formatting menus declare standard shortcuts.
- Fixed reproduced hand cursor over passive Notes space by checking actual registered control bounds. Mac live positive and negative cursor checks passed.
- Both apps build;173shared Release tests pass.

### 2026-11-18 — Compare availability and text-only reader backgrounds
- Compare filters Add Translation by actual mapped chapter existence. Unavailable saved columns retain their metadata but show Choose Passage/Remove repair controls rather than empty verse cells. Add Another Passage can repair a slot. Follow Main is disabled for editions missing the anchor chapter; Open in Reader lists available columns only.
- Aligned Mac rows use explicit horizontal gutter/text alignment. Mac per-verse ellipses are removed; right-click actions and note badges remain.
- Shared TextKit background painting follows readable glyphs on each wrapped line, excludes verse gutters/Strong’s/chips and line-edge whitespace, preserves tag/hover decoration. Native source ranges, copy offsets and saved highlight data are unchanged.
- Verification: shared Release175 tests/50 suites pass; final Mac/iOS builds pass before the small all-unavailable removal guard (rebuild pending). Mac QA Romans5 invalid LXX→Isaiah52LXX repair, disabled Follow Main, Close Last→reader, Back→Compare, Forward→reader all exercised. Mac Mark13 native drag across7–9 and saved yellow partial highlights show clean gutters and wrapped edges. Offscreen real AppKit renderer checks5 wrapped lines, excluded Strong’s/numbers/trailing space and preserved tag background; added to CI. iPhone27 simulator word selection and tap-based multiple verse actions checked; long multi-line handle extension and phone Compare remain pending.
- Data: synthetic QA only. No merges, production stores, identities, sync or schema changes.

### 2026-11-18 — Daily folder discovery and quicker note formatting
- Daily Notes folder includes month navigation and existing-note day markers on both platforms. Day clicks open/reuse through the existing daily-note identity path. Native date picker remains available from month title/New.
- Mac Checklist/Table are direct toolbar actions. Formatting now has explicit independent Undo, fixing typed text being undone together with a list action. Verified Checklist Undo/Redo and subsequent typing isolation.
- iPhone Notes/folders use an explicit large heading above persistent search, avoiding a blank native reserved large-title region after navigation. Stable headings checked after folder return.
- Mac/iOS calendar builds pass; final Mac formatting build and final iOS heading build pass. Live synthetic Mac creation/reuse0→1 and iPhone existing-date reuse2→2 checked. Physical phone, VoiceOver, extreme type sizes and expanded formatting matrix remain open.

### 2026-11-18 — Deliberate chapter-edge pulls
Shared ChapterPullIntent requires a fresh gesture beginning at the appropriate edge; ordinary scrolls arriving at an edge cannot arm. Ready state uses hysteresis (iPhone68/52pt; Mac112/92precise-delta travel), retracts/cancels and commits once. Both readers wire gesture begin/update/end/cancel, preserve native scrolling and existing chapter destination rules. Deterministic actual-shared-code regression covers middle-start rejection, wrong edge, cue threshold, arming/hysteresis/retraction, unavailable destinations, cancel and single commit. CI runs it alongside reader rendering. Both builds pass /tmp/berean-chapter-pull-{mac,ios}.log; rendering regression stillpasses5lines.

iPhone27 live: fresh top pull Mark13→Mark12 arrived at chapter end; fresh bottom pull Mark12→Mark13 arrived at start. From Go Mark13:30, clear selection and drag to end stayedMark13. A later attempted bottom pull there also stayedMark13, so do not claim reliable activation/sensitivity at every settled viewport; investigate start-edge tolerance, rubber-band settling and dock/inset transitions. Intermediate cue/haptics and physical phone/real Mac trackpad notverified. Current simulator Mark13end no selection. Mac QA remains dailyNov18 note Format undo QA on pre-gesture runtime; final Mac build compiled. No production data/sync/identity changes or merges. Continue Kokoro original-quality engine and measured switching; goal active.

### 2026-11-18 — Kokoro latency/alignment foundation (M05 partial; no playback)
Added public SpokenWord/KokoroChunk/KokoroChunks in BereanText, porting src/lib/tts/kokoro/kokoroChunking.ts exactly for valid starting indices:12-token first chunk,40-token subsequent chunks, true sentence endings, clause-preferred cap cuts, continuous cross-verse queues, UTF16/negative mid-verse offsets and retained blank/replacement slots. Negative/out-of-bounds native starts returnempty safely. No platform speech backend, downloaded model, audio playback or UI claim. Inputs must already have original replacement/speech-prep applied.

scripts/golden/speechChunks.ts generates48 synthetic oracle cases from the actual original chunker, including boundary lengths, empty verses/slots, multi-word prepared slots, quotes/brackets, newlines and non-BMP/decomposed Unicode. Golden/speech-chunks.json generated via vite-node (never hand-edited), hooked into standard golden export and drift guard. Two Swift tests compare every text/index/offset and invalid starts. Focused native2tests pass; final full SwiftPM Release177tests51suites pass50.240s (/tmp/berean-kokoro-full-tests.log). TypeScript typecheck and scoped ESLint pass; Vitest speech-chunks drift guard1passes22othersskipped (/tmp/berean-kokoro-oracle-tests.log). Both native Debug builds pass /tmp/berean-kokoro-foundation-{mac,ios}.log. No new audible runtime behavior to verify.

M05 next exact work: port buildSpokenWords preparation with existing TaggedText/WordReplacer, retaining the original Strong’s replacement preceding-the blank slot and pronunciation/numeral/abbreviation pipeline (src/lib/tts/textPrep.ts); generate independent oracle fixtures. Then original voice/model manifest/cache contracts and native inference/streaming playback with cancellation/skip/backpressure, word alignment, progress/error/settings UI. Do not substitute Apple voices or claim M05 complete. Model/voice quality needs actual listening/device checks. Current UI remains Mac synthetic dailyNov18 Format undo QA, iPhoneMark13end,9/8tabs. Review stack22→23→draft24 unchanged, no merges or production/sync/identity changes.

### 2026-11-18 — Speech preparation and original plain-text alignment correction
After pushed55ae320d, BereanText adds SpeechPreparation (spoken-only pronunciation, cardinal/ordinal/decimal expansion, abbreviations, punctuation) and SpokenText.prepare→PreparedSpeech. Uses existing TaggedText and WordReplacer in the original order; retains blank preceding-the slots for adjacent Strong’s replacement and original wordIndex/UTF16 offsets. Plain verses preserve empty-space positions without manufacturing spoken word slots. No stored/displayed text changes, Apple voices or synthesis engine.

Found/fixed original src/lib/tts/extractSpokenText.ts plain fallback: it computed prepared words but returned raw.filter(Boolean).join text, bypassing replacements/pronunciation for consumers of spokenText and contradicting charStart around extra spaces. It now joins the prepared parts, including empty slots, so source text and offsets agree. Original regression checks Jesus→Yeshua→Yeshuwa,40→forty, dash normalization, leading/doubled/trailing spaces and every substring offset. Kokoro’s queue-content cache hash now reflects prepared plain speech; existing saved user records/IDs/sync unchanged.

New generated speech-preparation.json pins actual TypeScript outputs:282number,518token,36verse/rule cases (including disabled rules, grammatical/bracket-only tokens, multi-Strong’s, blank the, multi-word slots and Unicode). Existing speech-chunks fixture regenerated for changed oracle source hash. Standard golden export/drift guard includes both. Native focused4tests pass; full Release179tests52suites pass41.436s (/tmp/berean-speech-preparation-full.log). All original TTS104tests/9files pass (/tmp/berean-speech-preparation-all-tts.log). Both speech drift checks pass (22othergoldencases skipped), typecheck passes. Initial scoped ESLint warned scripts were ignored; explicit --no-ignore scoped rerun passes with no warnings/errors (/tmp/berean-speech-preparation-lint-explicit.log). Both Debug apps build /tmp/berean-speech-preparation-{mac,ios}.log. Native service-only behavior; no audible playback/runtime claim.

Important engine reuse found: ios/App/BereanNative/Sources/BereanNative/BereanVoicePackPlugin.swift already runs original fp32 Kokoro via OnnxRuntimeBindings on a serial inferenceQueue, handles memory pressure and returns24kHzmonoPCM. Its Package.swift pins microsoft/onnxruntime-swift-package-manager1.24.2. Do not start model inference from scratch or introduce Apple voices. Existing worker (src/lib/tts/kokoro/kokoro.worker.ts) bridges nativeInfer after kokoro-js tokenization/phonemization. Native migration still needs compatible phonemization, style-vector/tokenizer/model assets/manifest downloader, inference adapter, streaming/cancel/skip/word timing/audio/session controls. Inspect installed kokoro-js/phonemizer source with bounded snippets (dist is a single megabyte minified line; do not rg-print it). Preserve fp32 model and original voice IDs/quality. Research candidates only, no dependencies added: https://github.com/espeak-ng/espeak-ng-spm and Microsoft’s official package; community Kokoro wrappers were inspected but not selected. Native/physical audio quality remains entirely unverified.

UI fixture state unchanged: Mac synthetic dailyNov18 Format undo QA, iPhoneMark13end,9/8tabs. Other active UX tasks: measured tab/chrome/scroll responsiveness, settled-end pull sensitivity/dock inset diagnostics, compact Compare/drag and clean iPhone adjacent outline/native selection handle checks. CI44285760327 at55ae320d inprogress on lastcheck before this increment; check current exacthead after push. Keep review stack22→23→draft24, no merges/production/sync/identity changes.

### 2026-11-18 — Direct pan release and in-place hover metadata
After pushed69abe784 (speech preparation), iPhone chapter pulls now also measure direct pan travel and evaluate the final release. Fresh-edge eligibility still prevents long ordinary scrolls from arming. Arm/disarm112/88fingerpoints; indirect input keeps the prior68pt rubber-band equivalent as fallback. Cancel/selection/horizontal/unavailable guards retained. Temporary geometry trace removed from source. Shared actual-code gesture regression updated/passes. Final both builds pass /tmp/berean-reader-final-refinements-{mac,ios}.log; no changed shared package since179tests.

Diagnostic evidence, not complete physical sensitivity acceptance: /tmp/berean-chapter-pull-runtime.log recorded many simulator begin/end pairs with zero movement. /tmp/berean-chapter-pull-pan-runtime.log captured real successful Mark13→12end with211.67ptpan and100.33ptrubber-band, readytrue; other attempted bottom drags reported0pan/0overscroll despite allowedtrue/selection0/0. Therefore do not describe all failed attempts as a threshold defect or claim bottom activation reliability proved. Final fallback source builds but was not installed/live checked; installed simulator is the temporary traced direct-pan build atMark12end. Physical phone/realMactrackpad, intermediate cue/haptic timing and settled-end repeated activation remain open. Current CUA part completed; next UI use must refresh state.

Mac reader late Strong’s lookup previously participated in ChapterTextView.Key, forcing a full attributed-string replacement and reading-anchor restore when hover glosses arrived. Removed tooltips from the render key; updateReaderStrongsTooltips updates only link toolTip attributes in-place, tracking last metadata separately. Actual shared helper regression verifies repeated IDs, cleared fallback, preserved verse tooltip, unchanged UTF16 text and no editedCharacters notification. Existing5wrappedline background/tag/gutter regression also passes. First test attempt used UIKit’s NSTextStorage.EditActions name on Mac and failedcompile; corrected to AppKit NSTextStorageEditActions, explicit compile&&run passes. Do not claim measured whole-app tab latency solved; final live Mac metadata arrival/selection/scroll check remains open.

ReadAloud isolated probe (not an app dependency) lives /tmp/berean-kokoro-native-probe. Official espeak-ng/espeak-ng-spm pinnedfd28f6460cc4cdf631528c8e2f7bd825747aac5c compiled usingSwift6.2. Silent runtime could not initialize: resource bundle contains sources/config but missing compiled espeak-ng-data/phontab. Two initial probe resource-path attempts also failed (resolve executable symlink and use Bundle.resourceURL, not bundle root); final exact failure /tmp/berean-kokoro-native-probe-output.log. Legacy Node phonemizer emits valid IPA for the4synthetic phrases, so native resource compilation/version matching must be established before using this route. No dependencies/models/voices/audio controls added to Berean; M05 synthesis remainsunfinished. Existing original iPhone ONNX bridge remains the inference starting point.

New concrete scroll gap: scriptureReadingPositions is an ObservationIgnored in-memory map; savePosition closures write that map and teardown captures it. No persisted native viewport record is read/written. Installing/relaunching simulator returnedMark13top after it had been at the end. Existing legacy numeric scrollPosition is allow-listed local but native reader does not use/update it. Next: bounded per-tab native viewport records in local-only tab state (extend both native/TS allowlists + conformance fixtures), finite-value validation, offsets/verse/width/end/selection restoration, checkpoint on settled scroll and lifecycle/dismantle, clear current edition on explicit jump. Keep per-edition memory/flip return behavior and all legacy sync fields/IDs unchanged. Do not broaden this into production-store/schema work.

CI44287280869 on69abe784: legacy SUCCESS, native iOSconformance inprogress at lastcheck. Do not cancel/restart a live job based on observation timeout. Local reader refinements should be committed and pushed after recording current CI status; preserve owner-review22→23→draft24, no merges or production data. Goal active.

### 2026-11-18 — Native Scripture remembers its place
- Both apps restore local per-chapter/edition reading positions after relaunch and checkpoint settled scrolling.
- Explicit passage jumps clear only the destination's old viewport; bounded local records preserve legacy tab sync behavior.
-182 shared and17 original persistence tests pass; Mac/iPhone simulator relaunch checked, both apps build.


ReadAloud development18Nov: added reproducible silent native phonemizer comparison harness for Mac/iPhone simulator; no new playback controls or downloaded model.

18Nov: fixed missing exact-title Notes results during rapid floating-search/Go query changes. Both native apps fall back to current-query note lookup rather than hiding matches behind an outdated cache.


18Nov: Notes editor titles now wrap on Mac/iPhone instead of truncating a modest title. Stored titles remain single-line; Return advances to the body. Both builds and actual editing-flow checks pass.


18Nov: added native Kokoro English normalization/segments/IPA cleanup with original-oracle fixtures. Full184sharedtests and both builds pass. Expanded silent Mac/iPhone probe matches52raw+52complete cases using original resources and trace API; playback remains unfinished.

### 2026-11-18 — Reader gesture checkpoint
iPhone short-page pulls now use passive raw touch travel; deliberate chapter turns have explicit start/end arrival. Mac scroll checkpoints reuse one idle timer; short pages allow elasticity. Both builds and intent checks pass; simulator boundary cycle and Mac checkpoint/relaunch verified. Loading flash and physical gesture feel remain open. See HANDOFF latest checkpoint for evidence and continuation.

### 2026-11-18 — Prepared chapter-turn checkpoint
Added16chapter read-only preparation cache, shared in-flight loads, actual-neighbor prefetch, outgoing viewport capture and atomic destination rows/annotations/selection for explicit turns. Both native builds pass; Mac history/selection and iPhone short-page cycle checked. Removed iPhone empty system glass circle when chrome tucks. Other navigation paths can still show loading; global frame pacing remains open. See latest HANDOFF for scope, exact evidence and queued CI status.

### 2026-11-18 — iPhone viewport conversion and longest-chapter check
Hoisted UIKit text-position→offset conversion outside the verse-range scan in readingAnchor. Same position/range choice, one conversion per capture instead of up to one per candidate verse. This is a source-level reduction in repeated work; do not claim an FPS improvement from the earlier mostly-idle sample. Final iOS build PASS /tmp/berean-reader-anchor-offset-ios.log; Mac source unaffected from prior final passing build.

Installed final build:117→118→119 starts atverse1, two normal upward swipes stay in119. Read-only synthetic simulator DB confirms offset1301.3333333333333,verse21,verseOffset-50.33333333333326,width402,atEndfalse; terminate+launch restored the same visible passage (verse21tail then22–32). Current phone9 tabs/Psalm119mid; MacQA13 tabs/Mark12:2. Earlier exact-source repeat on117 body taps selected1+2 together with one outline/bar; longpress retained native word handles. Intermittent body-tap/selection overlap stays open because a repeat passing does not establish its cause or fix.

Git amend37aa9026 was briefly slow in print_commit_summary reading tree objects (sample /tmp/berean-git-amend-sample.txt). Allowed it to finish normally; no kill, lock deletion, reset, reclone, or history repair. Prior17138f2b CI attempt2 now in progress, last observed legacy Test step after native success. Let it finish; next publish should include f2160024 +37aa9026 +this checkpoint into existing draft24. Goal remains active; loading through tab/history/picker/edition still open, hardware smoothness unverified, no native Kokoro playback.

### 2026-11-18 — Direct warm Scripture presentation
Cached chapters and revision-scoped annotations now render directly for warm navigation; location-scoped selection/scroll targets prevent stale state. Native view reuse captures outgoing viewport;16entry cache protects visible chapter and coalesced waiters publish before returning. Both final native builds pass; Mac34step boundary/history test, local selection/highlight refresh, phone mapped Psalm return and tab restoration checked. Cold misses/frame pacing remain open. Prior-head CI cancelled before runner assignment due hosted macOS capacity; see HANDOFF for exact evidence and next work.

### 2026-11-18 — Working tabs first on iPhone
Tab overview now opens expanded and shows current tabs before creation/cleanup/archive controls and recent duplicates. Existing actions and optional compact detent remain. Simulator existing119→G5463→119 navigation preserves viewport; nine tabs unchanged. Final iOS build passes. See HANDOFF for exact evidence, remaining large-workspace/accessibility checks and hosted CI capacity cancellation.

### 2026-11-18 — Passage preview prepares the reader
Shared previews now reuse a bounded prepared chapter with separately retained raw rows, warming both Mac palette/CmdL and iPhoneGo destinations without changing excerpts or navigation semantics. Both builds and raw LXXPsalm 3 heading→bodyverse2 UI checks pass; current-tab reuse leaves13MacQA/9phone tabs unchanged. Fast submit before preview is ready can still be cold. See HANDOFF for oracle/evidence and remaining selection/performance work.


### 2026-11-18 — Reader selection gesture checkpoint
Keep iPhone verse-number taps and rapid taps across different verse bodies in whole-verse mode; preserve same-verse native double-tap/long-press word selection. Clear whole-verse outline/actions when native word selection begins, without removing handles/menu. Cache touch-down target so reveal/layout cannot redirect tap. No dependencies/data/schema/sync/identity changes. Clean Mac+iOS builds and isolated simulator interaction checks pass; physical/accessibility timing unverified.


### 2026-11-18 — Reader release and sidebar restoration
Reuse unchanged Scripture Notes/citation, tag and highlight groups by their own revisions. Fix iPhone chapter-pull momentum scrolling the incoming chapter: wait until tracking/dragging ends, stop residual scrolling, then navigate. Restore shown-sidebar Mac navigation placement at user request. Pin rests in close-button slot and moves left only on hover. Clean app builds and targeted Mac/simulator interactions pass; no production/schema/sync/identity changes.

### 2026-11-18 — Reader changes pending final verification
- LXX sidebar badge joins pin hover behavior: idle-right, slide left for close; stable title width.
- Mac View commands register Compare/Study shortcuts reliably; toolbar shares guarded setters.
- Slow Mac chapter pulls accumulate travel without disappearing on zero-delta packets; whole-verse selection permits pulls on both platforms. Physical trackpad smoothness still unverified.
- Per latest user clarification, Brenton Psalm titles belong to first displayed body verse1, with unchanged raw reference/storage IDs. Native marker, passage-entry, selection-label, copy-number and Compare mapping consistency work in progress; verify latest builds/tests and real UI before calling complete.

Latest verification: full Swift suite192tests/55suites PASS; focused Psalm suite8 PASS; slow-pull harness PASS. Both final ancillary-label builds PASS (/tmp/berean-psalm-label-consistency-{mac,ios}.log). Mac/simulator reader UI checks described in HANDOFF. Scope is body-first Brenton presentation with unchanged storage IDs, plus LXXbadge/native-menu/pull refinements; generic splits/cursor replacement and notes-generated reference-link semantics audit remain open.


## 2026-11-18 — location input, native cursor ownership and iPhone verse taps

- Mac ⌘L now owns keyboard focus before its field mounts, preserves early keys/paste, selects the current destination once, and replaces the current tab across Scripture, Search, Lexicon and Notes. QA verified the original tab identity, 13-tab count and unchanged note content/update time. Explicit Shift-Return creates a tab; closing it currently selects its neighbor, not necessarily its origin.
- Removed global cursor swizzles/private toolbar hooks and forced hands. Native controls, text, links and dividers own their cursors. Source audit and builds passed; physical pointer-motion/flicker coverage remains open.
- iPhone body taps use a passive touch observer: rapid verse1/2/5 accumulation, targeted deselection, native word double-tap, 400ms taps, 900ms long-press, scroll cancellation, chapter pull and inline Strong’s were exercised in the Simulator. The new pure reader-taps harness joins CI. Physical iPhone/VoiceOver and handle dragging remain unverified.
- Added a 44pt accessible Close Study Panel control; final fresh-launch Simulator check dismissed the G2962 inspector. Restored Psalm 3 LXX, Strong’s OFF, no verse selection, 9 tabs. Both final local builds PASS: `/tmp/berean-study-close-final-mac.log` and `/tmp/berean-study-close-final-ios.log`.
- Online rendering verified again: [Brenton Psalm 3](https://biblehub.com/sep/psalms/3.htm) combines the title and first body line as verse1. [Brenton Psalm51 / LXX50](https://biblehub.com/sep/psalms/51.htm) does the same for its longer title. Preserve Septuagint chapter numbering and raw stored IDs; display/copy/accessibility numbering follows the reader. Do not reinterpret persisted links or rewrite production data.
- Next: per-edition Compare selection and whole-block dragging; generic all-tab split previews; physical cursor motion and Mac scroll/pull feel; note reference formatting/preferences; M05 Kokoro playback. These remain unfinished. Owner-only merge order #22 → #23 → draft #24 remains unchanged.


## 2026-11-18 — corpus-wide Brenton rendering and combined verse compatibility

The actual 151-Psalm corpus check found that stored LXX 115:4 contains both the cup and vows sentences, with no stored verse 5. The reader now labels that record 4–5, preserves all its words/annotation identity, resolves human-entered verse 5 to stored4, and maps KJV 116:14 to that existing record in Compare/flip. Verse6 and following keep their numbers. Labels, selected references, chapter export, partial copy and accessibility use the range. Raw persisted links, tag spans and note/highlight keys are not rewritten.

Online witnesses: [Bible Hub Psalm 3](https://biblehub.com/sep/psalms/3.htm) and [MT51/LXX50](https://biblehub.com/sep/psalms/51.htm) combine superscription and first body as verse1. [eBible Brenton115](https://ebible.org/eng-Brenton/PSA115.htm) calls the second sentence4a; [Bible Hub MT116](https://biblehub.com/sep/psalms/116.htm) separates the two sentences at13–14. Reader 4–5 is the numeric presentation of that combined record, consistent with the chosen body-first convention, rather than a claim that every online edition uses identical labels. Keep actual LXX chapter numbering; do not substitute a site's MT chapter headings.

Verification: all 195 shared tests/57 suites PASS in139.323 s from a temporary native-build source snapshot; all 120 package source/test/fixture SHA256 values were checked against the repository with zero mismatches. Log `/tmp/berean-online-brenton-final-suite.log`; manifest `/tmp/berean-online-psalter-source/source-sha256.json`. Initial corpus test correctly failed on115's gap and motivated the range fix. Direct checkout test attempts were interrupted only after diagnosing cloud-backed Git/build database waits; no caches or usage were reset.

First range builds BOTH PASS: `/tmp/berean-brenton-range-final-{mac,ios}.log`. Fresh iPhone PID32126 verified Go 115:5→115:4–5, readable gutter label, both sentences selected, verse 6 unchanged and9 tabs. Selecting6 then exposed separate outlines at the missing stored5. Final source fixes drawing/reveal grouping by actual row order while still breaking at unselected rows or real rows without layout; persistence stays unchanged. Reader tap + adjacency harness PASS with immutable inputs `/tmp/berean-final-range-selection-checks` (explicit temporary module-cache path after a sandbox cache-write failure). Final grouping builds and Mac/iPhone UI checks subsequently PASS; see verified publication checkpoint below. Reference labels also coalesce adjacent displayed ranges without changing saved raw groups.

The single4–6 outline, copy/reference labels and fixture restoration are now verified on both apps. Publish only the tested source and its checkpoint. Audit combined-record cross-reference aggregation and newly generated Markdown/link display vs raw IDs; original legacy links must keep their meaning. Generic all-tab split previews, per-edition Compare selection/whole-block drag, physical pointer/flicker, Mac scroll/pull feel and M05 playback remain open.


### Verified publication checkpoint — source `8492a161`

Both final grouping builds PASS (`/tmp/berean-brenton-group-final-mac.log`, `/tmp/berean-brenton-group-final-ios.log`). iPhone fresh PID33697 showed one outline around 4–5 + 6, correct targeted deselect/reselect and native Copy→Paste containing `Psalms 115:4-6 LXX`, range label4–5 and verse 6, without extra text/rows. Restored Psalm 3 LXX, no selection, Strong’s OFF, inspector closed,9 tabs. Mac fresh QA launch verified ⌘L115:5→115:4–5, Shift-click 6→one4–6 outline, Copy Reference→immediate ⌘L paste exactly `Psalms 115:4-6 LXX`, then restored Psalm 50:1 LXX (raw 3),13 tabs. Readonly DB confirms original tabID0456641d-da15-49d2-8620-cdf2b9d1f0bd/typeBible retained and GalleryQA07 content SHA256 AND updated_at unchanged.

Full 195 shared tests/57 suites passed; after adding corpus-version coherence assertions, the 3 focused tests passed again (`/tmp/berean-brenton-corpus-coherence-final.log`). All120 package snapshot hashes matched repo. Tap + visual-adjacency harness passed. No application code changed after final builds/UI checks. Physical iPhone/VoiceOver, physical cursor-motion/flicker, full Mac scrolling performance and combined-record cross-reference aggregation remain open.

Commits: faf8589d location focus/input;3c38eb5c native cursor ownership;819f9954 iPhone body taps/CI;59bbd436 accessible inspector close;8492a161 combined Brenton records/visual adjacency. The next docs commit records this checkpoint. Publish the complete checkpoint to **github**/native/reader-notes, existing draft24; compare remote head with local HEAD and read CI for that exact PR head. Prior74aeb6c5/CI44391471644 is historical evidence only. PR22/23/24 were rechecked OPEN,24draft/base native/m6-navigation; owner-only merge order unchanged. Do not merge or inherit old green checks.


### 2026-11-19 00:19 PST — Reader Psalm presentation / edition metadata — VERIFIED within recorded scope
- **Source:**739c5e41 on native/reader-notes, atop79aa2fd4; existing draft24 only, owner merge guard retained.
- **Changes:** one number precedes Psalm title/body; aligned, slightly larger restrained titles; line separator keeps one verse paragraph; iPhone title taps participate in grouped selection. Quiet clickable LXX/KJV summaries replace explanatory paragraphs; full native popovers, Jonah/Joel boundary metadata. Legacy APIs, corpora and all annotation identities untouched.
- **Checks:**197 shared tests across2 bundles PASS107.538s; after final metadata addition13 focused PASS0.066s. Final actual-repo Mac/iOS builds PASS `/tmp/berean-psalm-title-group-final-{mac,ios}.log`; earlier iOS conditional-state error fixed. Corpus119 files+manifest matched temporary test source. Mac title1/Shift2 and iPhone title/body1–2 outlines pass; iPhone native900ms word handles retained. Metadata popovers tested onMac, Psalm50 andJoel2 onSimulator. Earlier same-feature Mac CopyReference exact `Psalms 50:1-2 LXX`.
- **Data:** isolated QA only. New sandbox QA store differs from old noncontainer fixture; all7 QA note hashes AND timestamps unchanged,4 tabs retained,Genesis1:1KJVA restored and original note selected. Simulator restoredPsalm3LXX/9 tabs/no selection. No production/sync/schema/identity/signing changes.
- **Remaining:** physical device/VoiceOver/font-size variants, native cross-reference source-number correction (runtime repeatedVerse1), Compare selection/drag, generic splits, physical cursor/scroll, Notes polish, link semantics and Kokoro playback. Full checkpoint and exact resume steps in HANDOFF.


## 2026-11-19 — native references, toolbar responsiveness and Strong’s continuity

- 42d34bbe: additive native cross-reference APIs map verified stored LXX rows to canonical sources; correct chapter grouping and combined-record aggregation. Legacy service entry points/goldens remain intact. Classic/TSKe selected and chapter UI checked on both apps; structural unverified alignments remain open.
- fce2b88e: native navigation ControlGroup replaces fixed-size HStack; measured Mac toolbar CPU loop resolved while retaining sidebar titlebar placement. Baseline99.5% CPU/AX20–40s → idle0–3.3%/AX0.1–0.4s. This supersedes prior automation-latency diagnosis; broader physical interaction checks remain.
- 3bbecdea: native readers retain the visible body line when Strong’s toggles, preferring a visible selected verse and excluding inline metadata from anchor offsets. Mac selected/unselected and iPhone mid-chapter on/off verified; physical phone and full edge/width matrix pending.
- Validation: full202 shared tests; final6 focused cross-reference checks include all151 Psalms source bounds. Fresh reader intent/reflow harness passes Unicode/metadata mapping and prior tap/adjacency checks. Both final native builds pass. See current HANDOFF for exact logs, QA restoration and remaining tasks; source corpus/production/sync/identities unchanged.

- Boundary follow-up6ae1650a: reject malformed negative ranges and keep clamped final-character anchors on complete Unicode sequences. Fresh harness and both actual-repo builds pass; UI observations above were on the preceding reflow build (native behavior otherwise unchanged).


## 2026-11-19 — Compare selection and floating actions (d6f7cced)

Each edition now owns its selectable verse numbers and action target. Additive taps/Mac Shift use actual stored row order; selection itself does not change the anchor passage or history. Adjacent visible selected rows share one faint/dashed outline; stacked interleaved editions remain outside each other’s outlines. Reduced Motion pauses animation. The adaptive glass action bar reuses reader control styling and supports copy/highlight/tag/note/reference/reader/share/clear operations. iPhone dock safe-area clearance was verified after an initial hidden-bar failure. Mac Command-C was verified after fixing a focus-routing failure. Clearing and exiting Compare does not restore an old selection. Shared title rendering uses the Scripture font and folds source title newlines.

Both local Dev builds and the expanded native reader harness pass. Mac LXX50/KJV51 copy and action destinations, Mac Shift group/Escape, and iPhone stacked selection/copy feedback/reader transfer/final dock gap/clear-exit passed. See HANDOFF for exact logs and QA restoration. No note contents/timestamps changed;4 Mac/9 iPhone tabs preserved. Prior baselinecce95bf0 CI44493859591 is green, including203 shared tests; this is not evidence for the new source’s pending CI.

Remaining before full Compare parity: view-state retention across tabs/relaunch, independent/pinned/cross-chapter/duplicate/4-column/width/accessibility matrix, actual mutation-and-undo action checks, native word-copy precedence, body-tap selection, selected-line reveal, and whole-block drag previews/grab-anywhere. Generic arbitrary-tab splitting and Kokoro playback remain separate open work.


## 2026-11-19 — Compare tab return and explicit location intent (3090db5c)

A bounded local snapshot per open tab now restores the selected Compare column/edition/chapter, selected stored rows, focus and original Shift anchor across tab switches. Close/explicit Compare arrival clear the cache. It is observation-ignored memory, with no new persisted/synced fields; restart retention remains open. Incoming explicit references override old local selection, including same-chapter and repeated identical commands. A fresh jump revision also restores the requested scroll position. Ordinary Go deduplication still uses the original one-argument isShown match, which excludes Compare.

Final Mac/iOS builds pass (`/tmp/berean-compare-intent-complete-{mac,ios}.log`), and expanded native harness passes retained-anchor and unavailable-row cases. Mac UI verified LXXGenesis12 → Notes → return retaining selection; new/repeated Go to KJVGenesis11 replaces it, and repeat Go moves from near-end offset back to verse11. iPhone verified KJVPsalm3v1 → existing G5463 → return retaining that edition/selection.4 Mac/9 iPhone tabs preserved; original QA passages restored and all7 Mac QA note contents/timestamps unchanged. Earlier repeated-command failure and intermediate method-reference compile errors were corrected, not counted as passes. Full independent/pinned/history/restart/4-column/accessibility coverage, native word-copy precedence and whole-block dragging remain open.


## 2026-11-19 — Compare passage lift and selection-preserving reorder (7d365304)

Mac Compare now offers native dragging from headers and verse-cell whitespace, plus the independent-pane surface. The source fades while lifted; valid destinations receive a subtle wash. The native rounded glass preview contains a readable passage excerpt beginning at the recorded reading anchor (up to18 rows), with edition/font/Strong’s/highlights. It is a reconstructed excerpt, not a pixel-identical full-column snapshot. Native drag-session lifecycle clears the source on completion/cancellation; payload validation remains scoped to this view and current column destinations. Reordering remaps the selected column’s local snapshot and scroll caches to the new index. Removing the selected column clears that snapshot; opening the selected surviving column transfers its selection to Reader. No new persisted fields/schema/sync behavior.

Verified on the final Mac implementation: aligned Genesis1 KJVA/LXX reordered in both directions, selected KJV1 remained with KJV, mid-chapter scroll bar stayed exactly0.3813155386081983 after reorder, and Escape cancellation restored full source opacity without moving columns. Native double-click/Command-C → Go paste returned a word (`And`) rather than the whole selected verse. Earlier native text-range drag/copy also worked, but that range check preceded the final Transferable lifecycle change and should be repeated. Mac build `/tmp/berean-compare-column-lift-lifecycle-mac.log` PASS; iOS active source build `/tmp/berean-compare-column-lift-final-ios.log` PASS (later lifecycle edits are Mac-only). Final QA: original Untitled note selected; readerGenesis1:1KJVA selected1/Strong’sOFF/CompareOFF;4 tabs; all7 note content SHA256 and updated_at values unchanged. Default column order restored. Pin/follow test metadata was restored; the explicit default column records remain stored after the successful reorder, using existing legacy format.

Important verification correction: CUA drag() returned while the native drag session was still active. A final click at the destination completed the actual drop; Escape cancelled it. The earlier apparently stuck drag is not a confirmed app failure. App screenshots showed source fade and target wash but omitted the system-owned floating drag image, so preview pixels/physical drag feel remain unverified. Attempts in pinned independent layout did not demonstrate a successful drop and once opened the passage picker; no independent drag pass is claimed. Full pinned/independent/4-column/duplicate/narrow/VoiceOver/hardware matrix and remaining selected-column removal/action mutation-and-undo checks remain open. Generic arbitrary-tab split previews are still only planned in TAB-SPLIT-DESIGN.md.

Published ec27ff5f CI44500763894 completed SUCCESS for both jobs: legacy checks/build/launch and native conformance/reader harness/iOS simulator build; hosted Mac build skipped for absentSDK27, localSDK27.2 passed. This green result predates7d365304 and must not be inherited for its new CI. Owner-only #22→#23→draft#24 merge guard unchanged. Strong’s visible-word continuity from3bbecdea remains implemented and runtime-checked on Mac and Simulator; physical edge/width/long-verse matrix remains open.


### 2026-11-19 — Additional Compare exit / Strong’s near-end verification
- Final7d365304 Mac runtime: select LXXGenesis1:2, close the KJV comparison column → readerLXX1:2 selected and CompareOFF. No note mutations.
- LXXGenesis1:26 Strong’sON/OFF screenshots retain the selected first body line at the same height near the chapter end; scroll fraction changes with content height. This supplements earlier KJVselected/unselected and iOS checks without claiming the remaining full width/end/long-verse/hardware matrix.
- Restored readerGenesis1:1KJVA/Strong’sOFF/CompareOFF and original Untitled active; CUA complete. Exact published0ab81b9a draft24 verified; its newCI44503919247 was queued when checked. Prior ec27ff5fCI44500763894 fully green.


## 2026-11-19 — Compare Strong’s reflow continuity (f0b8752e)

Compare’s aligned/stacked shared scroll previously retained a pixel offset through Strong’s reflow. Native Compare now captures the visible verse before reflow and restores that row after layout; aligned view prefers the selected focus only when it was visible, otherwise the first visible row. The chapter-start guard avoids replacing the shared view’s top position. Independent panes each retain their visible verse, while stacked independent passages use the first visible column/verse target. This is verse-level continuity; the main native reader separately retains a more precise body-word/line anchor. No persisted/synced fields were added. Deferred restoration checks Compare mode, current tab/passage, current Strong’s state and the captured explicit-jump revision so a newer location command wins.

Mac QA: aligned Genesis1 KJVA/LXX scrolled to verse8 (scrollbar0.3813155386081983), Strong’sON retained verse8 as the first visible row instead of following the previous pixel offset. Selecting visibleKJV11 then Strong’sOFF made verse11 first visible with selection retained (the earlier selectedKJV1 also remained in the nonconsecutive selection, as expected). These runtime checks used `/tmp/berean-compare-strongs-continuity-mac.log` build; subsequent navigation guards compile in final `/tmp/berean-compare-strongs-guarded-{mac,ios}.log`, both PASS. Final guarded race behavior, independent/stacked/native iPhone runtime, long rows/rapid toggles/narrow widths/hardware remain unverified. Current Mac process is the pre-guard runtime; the on-disk Dev bundle is the final guarded build for the next launch.

Pinned-drag investigation: removing nested drag modifiers compiled but did not demonstrate a successful pinned drop through CUA. The experiment was fully reverted; no drag-handler simplification is retained or claimed as a fix. Pinned native drag remains open. Published7d365304 passage-preview/reorder behavior remains intact. CUA tests restored KJVGenesis1:1 selected1/CompareOFF/Strong’sOFF and original Untitled note active. All7 QA content hashes and timestamps unchanged;4 tabs retained. iPhone runtime unchanged (9tabs), physical phone and production untouched. CUA completion summary emitted. CI44504274656 for previous published614e26d0 was in_progress when checked; recheck it and the new pushed-head run, do not inherit earlier green results. Owner-only #22→#23→draft#24 guard unchanged; goal active.


## 2026-11-19 — Source-preserving table formatting and compact note actions

**347cf74a** adds BereanNotes.NoteInlineFormat and routes the existing shared noteFormatEdit adapter through it, so Mac shortcuts and iPhone inline commands use the same edit. Confirmed table rows are formatted within selected cell text; pipes, alignment rules, padding, escaped pipes and line endings stay outside the mark. Mixed cells become uniformly formatted and the selected source region survives for a second toggle; one edit supports native undo. Whole-row, cross-cell, multiple-table and prose/table selections are supported, and separator-only/empty-cell structural selections do not create malformed rows. Existing code, links, images and other marks keep their own source/rendering while surrounding plain segments are formatted. This preserves those constructs; it does not implement arbitrary nested marks inside them. Negative/out-of-bounds ranges are rejected. Normal prose typing/wrapping keeps its existing path. No note migration, automatic repair, database/schema/sync changes.

Nine focused Swift tests PASS `/tmp/berean-table-format-tests.log`; full actual-repo package suite PASS **212 tests** (4 core plus208 conformance/60 suites), `/tmp/berean-note-table-full-suite.log`, conformance128.785s. Initial manifest build could not write the default module cache; explicit temporary cache paths plus --disable-sandbox allowed the real source to compile. A stronger readable-text invariant then exposed literal underline tags around code; protected inline runs fixed this and the final9 tests pass. Cases cover exact table round trips, mixed marks, partial cells, CRLF/multiple tables, Unicode/RTL, escaped pipes/code, link destinations and invalid selections. No golden JSON changed. Both native builds PASS `/tmp/berean-note-table-format-{mac,ios}.log`.

Mac --qa-library UI: created synthetic note5d336e95-9848-49a6-b96b-d9e3e015676d, pasted Topic/Verse table, selected all and Command-B. Read-only DB confirmed exact per-cell bold Markdown with the alignment rule untouched; screenshot retained a grid, not exposed delimiters. Undo restored the exact original table, Redo restored bold, a second whole-selection Command-B removed it. Synthetic note moved to recoverable Trash through UI. Original note d29d2127-6b3c-46ad-ab56-deabf74061ab restored in original note tab ba9073bf-c44d-40c4-bee5-de08d805dddd; all7 original hashes/updated_at unchanged, workspace still4 tabs. QA settings explicitly contain notesFontFamily=mono, explaining the monospaced QA screenshot; default remains System and no preference was overwritten. AX text includes Markdown generated from attributed font runs, so do not infer the saved source solely from its added asterisks.

**04079bdf** reduces the fixed iPhone long-press preview from360 to240points and groups Share/Print/Export into one Share submenu (same grouped actions on Mac). Previous simulator context menu clipped Move to Trash below the screen; rebuilt iPhone screenshot shows the complete primary menu including Trash, and Trash was successfully invoked. Final both-platform builds PASS `/tmp/berean-note-menu-compact-{mac,ios}.log`. Long titles/Dynamic Type/landscape/physical devices and Mac context-menu interaction remain open; the preview still has a fixed cap, not content-derived sizing.

Simulator D0CC2F4C-AC47-4648-AC5C-0DC128CFCE7D dev build PID26804. Native Topic/Verse table grid rendered after clipboard transfer, but hardware-keyboard Select All/type/paste through Device Hub changed text unexpectedly; **iPhone formatting/undo is not passed**. No app root cause was established. CUA connection expired during a TextEdit discovery call; reconnected via getState, no usage reset. Known fixture was copied through an unsaved TextEdit document, then saved only to `/private/tmp/berean-table-clipboard-qa.rtf`; no user document changed. Device Hub Edit→Send Clipboard helped transfer the fixture; capture-keyboard and asynchronous remote UI remain unreliable. A multiline Mac Go staging attempt executed a temporary Search tab; that tab was closed immediately and original4-tab state restored. Always obtain a separate settled screenshot for remote sheets: first animation frames had different card positions; dismiss note editing before tapping the dock. Do not label those input failures as confirmed app regressions.

Synthetic simulator note0df6fe56-4c60-4f8a-82b2-2b1fd32ee0cc is in recoverable Trash. All17 original note hashes/updated_at unchanged; active notes17; all47 original active tab identities retained, current Study workspace9tabs. Restored Psalm3LXX unselected/Strong’sOFF/inspectorclosed, Capture KeyboardOFF. Baselines `/tmp/berean-table-format-ios-{note,tab}-baseline.json`. Reinstall changes the simulator data-container UUID: latest962896DE-DD49-4222-BFC8-01BD2867BE7F (rediscover with simctl get_app_container next time). Final Mac baseline7 unchanged/active7, synthetic test only in Trash. All CUA parts complete/summaries emitted. Other Dev process/production/physical phone untouched.

Published e55cd3c4 CI44505678015 completed SUCCESS while this work ran;614e26d0 run44504274656 was cancelled by workflow concurrency, not a failing test. New source needs its own pushed-head checks. Draft24 remains owner-merge-only, #22→#23→#24, no retarget/merge. Remaining Notes work: reliable iPhone full-table formatting/undo, colored multi-cell highlight behavior (separate old adapter), nested/mixed rich marks, responsive/multiline tables, font/accessibility/toolbar polish. Compare pinned dragging and guarded Strong’s independent/stacked/runtime matrix remain open; general tab-to-page splits and Kokoro playback remain unfinished. Goal active.


## 2026-11-19 — Shared multi-cell/multiline note highlights (8adef50b)

Both native note adapters now use BereanNotes.NoteInlineFormat.highlightEdit for Default/color/Remove Highlight. The old line-only wrapper and separate removal regex are replaced by one source edit. Confirmed table cells and each paragraph receive their own marks; table pipes, alignment rules, line endings, heading/list/quote prefixes and code/link/other inline constructs are preserved. Existing code/links/other marks remain protected, not newly combined with the chosen color; arbitrary nested rich marks remain open. Applying a color is idempotent, mixed colors recolor without nested wrappers, default yellow toggles across eligible text, and explicit Remove handles many cells/paragraphs at once. Partial recolor/removal splits existing runs, retains outside colors/visible words and maps the selected body offsets. Removing at a caret inside a mark clears that run; caret attempts inside code/links/other marks do nothing. Invalid ranges and malformed color identifiers are rejected. No saved-note migration, automatic repair or schema/sync changes.

An escaped-pipe regression initially failed the readable-text invariant: treating its hidden backslash as unrelated markup split it from the pipe and could create a column. Fixed by keeping the escape atom together, including partial boundary selections. The same boundary correction applies to ordinary inline table formatting. Final20 focused tests (10inline+10highlight) PASS `/tmp/berean-note-highlight-tests.log`; includes table/paragraph round trips, partial recolor, mixed colors, idempotence, Unicode/RTL, CRLF, structural prefixes, code/link preservation, invalid ranges and escaped-pipe partial selections. Full actual-repo package suite PASS **223 tests** (4core +219conformance/61suites), `/tmp/berean-note-highlight-full-suite.log`,140.220s. No golden JSON changed. Both actual-repo Dev builds PASS `/tmp/berean-note-highlight-{mac,ios}.log`.

Mac --qa-library runtime: synthetic notef7424120-da38-4748-bf09-c97c70aea366 (`QA multi-cell highlight 2026-11-19`) had a Topic/Verse table and two following paragraphs. SelectAll→Format→Highlight→Blue applied6 marks while keeping the grid/rule; one Undo restored the original text and Redo restored blue. Green recolored all6 without nesting (read-only DB confirmed exact complete markup despite transient stale AX Value). Remove Highlight restored and persisted the **exact original table/prose source**; screenshot showed the retained grid. Idempotence/partial/escape/other-marker cases are pure-test evidence, not full UI passes. CUA twice reported a changed app state; refreshed AX and observed before retrying, no source/identity changes inferred. Synthetic note recoverably trashed; original d29d2127 note restored in ba9073bf tab. All7 original note SHA256 and updated_at values unchanged;4workspace tabs. CUA part complete/summary emitted. Other Dev process and production untouched.

No iPhone runtime claimed for8adef50b; simulator remains on the prior compact-menu buildPID26804 with Psalm3LXX/9workspace tabs, Capture KeyboardOFF. Its previous remote keyboard reliability problem remains unresolved. Check the new color commands through actual touch after a verified input path; physical devices, partial selection/native undo matrix, arbitrary nested styles and responsive multiline table layout remain open. Published prior6f080f02 CI44552525386 was still in_progress at the last check. New pushed head requires its own CI; do not inherit e55green. Owner-only #22→#23→draft#24 merge guard unchanged, goal active.


## 2026-11-19 — Combined note styles, bounded parsing and visible-only backgrounds

**09eb7d84** uses Foundation Markdown source-position attributes for strong/emphasis ranges in the original UTF-16 storage. It handles shared/partial delimiter boundaries (`***word***`, `***word** rest*`, `**rest *word***`), while Berean keeps underline/highlight/wiki/image syntax and raw link destinations. Extended outer marks may enclose parsed code/links/other styles without reusing their delimiters; literal code remains literal. A legacy fallback preserves the native writer’s punctuation-only marks such as `A**\|**B`, which strict CommonMark leaves literal. No serialization or saved content is changed by rendering. Design source: [Apple Markdown source positions](https://developer.apple.com/documentation/foundation/attributescopes/foundationattributes/markdownsourceposition). Installed SDK interfaces and `/tmp/berean-markdown-source-position-probe.swift` confirmed exact source ranges for emoji/combining/Hebrew, code and links.

Parsing-only release benchmark, 100-line mixed note parsed100times: old0.157235s; initial uncached implementation0.719633s; bounded cached implementation0.156760s (160000spans versus old150000). These are local synthetic parser measurements, not whole-editor typing latency. Cache is process-only, lock-protected, at most512bodies/65536UTF16 units, bypasses individual bodies>4096units and reapplies local offsets for each block. No disk/settings/sync state. Concurrent-note and body-reuse/offset tests pass. Benchmark sources/executables under `/tmp/berean-note-combined-benchmark-{old,new}`; final `/tmp/berean-note-combined-benchmark-cached.log`.

The initial6 new renderer tests failed31 assertions, demonstrating the gap. The first implementation then failed a partial escaped-pipe compatibility invariant; preserving the native punctuation-mark fallback fixed it. Another test fixture put an unescaped wiki-alias pipe into a GFM table, making its body column count invalid; corrected that fixture by testing the alias in a separate paragraph. **Do not count that invalid fixture as an app regression.** Separately queue actual legacy GFM escaped-alias metadata normalization: serializer escapes table-cell pipes and the native wiki regex may retain the escape in the target. Verify actual exported fixtures and literal-backslash titles before changing identity resolution.

Partial highlight recolor/removal through nested code/link/other style syntax could insert tags inside literal markup. Guarded those edits: a complete visible highlighted run includes its hidden delimiters and can be cleared safely; unsupported partial protected runs remain unchanged. This is not arbitrary nested rich-mark editing parity. Ordinary partial plain-highlight edits remain supported.9new combined-style/cache/safety tests; final46 focused tests/5suites PASS `/tmp/berean-note-combined-tests.log`. Full actual-repo package suite PASS **232 tests** (4core +228conformance/62suites), `/tmp/berean-note-combined-full-suite.log`,110.292s. No golden JSON changed. Both actual-repo builds PASS `/tmp/berean-note-combined-{mac,ios}.log`.

**6555fd0e** removes background-color attributes from hidden markup/destinations/table padding after styling on both native editors. Null glyphs still contributed to TextKit background geometry: real Mac fixture had a full-width blue empty strip above highlighted bold/italic text. Same saved note after rebuild paints blue behind visible words only. Final both-platform builds PASS `/tmp/berean-note-visible-background-{mac,ios}.log`. No font preference or note content rewritten. Mac QA still explicitly uses Monospace; default remains System.

Mac --qa-library fixture31e7ffac-63f1-4329-8f4d-1453c9ecf818 (`QA combined styles 2026-11-19`): screenshot shows bold+italic, trailing partial emphasis, bold+underline, highlighted bold+italic, styled link, literal code with outer bold and a retained formatted table. AX exposes the Styled link destination example.com; no external link opened. Selected first phrase→Copy as Plain Text→Go paste gave exactly `Bold and italic together`, no markers; Escape without executing. Command-B twice over that phrase removed/restored bold within italic; read-only DB confirms the entire exact original synthetic source after round trip. Background strip disappeared on the same saved source after6555 rebuild. Synthetic note recoverably trashed; original d29d2127 note in ba9073bf tab restored, workspace4tabs. All7 original note SHA/updated_at unchanged. CUA complete/summary emitted. iPhone new-source runtime not exercised; still priorPID26804/compact-menu build with Psalm3LXX/9workspace tabs and Capture KeyboardOFF. Physical/VoiceOver/large-note/editor-latency/cross-device rendering and arbitrary nested editing remain open.

Prior published9eef1630 CI44554790507 completed SUCCESS;6f080f02 run44552525386 cancelled by workflow concurrency. New source needs its own exact-head CI. Owner-only #22→#23→draft#24 merge guard unchanged, production/sync/schema/identities untouched, goal active.

## 2026-11-19 — iPhone formatting target survives Undo/Redo

All iPhone programmatic note formatting uses the existing literal-source undo path with validated text/selection bounds. This fixes Redo collapsing selection and a subsequent format button inserting empty marks at the caret. Real simulator touch Bold→Undo→Redo→Bold and Highlight→Undo→Redo→Highlight restore the exact whole original table fixture; selected Prayer retains visible handles. iOS build passes (`/tmp/berean-note-selection-undo-ios.log`). Original17 notes unchanged,47active tabs retained, synthetic notes recoverably trashed. Mac/package unchanged; previous232tests/Mac build are baseline, not fresh checks. Broader multi-cell/combined-style/color/typing/IME/accessibility parity remains open. See HANDOFF for IDs and clipboard method.

## 2026-11-19 — Combined formatting of visible note text

Shared native formatting now adds styles to existing styled text and toggles exact marked runs independently, including bold+italic shared boundaries. It verifies plain text and prior style coverage before accepting the source edit. Mac and iPhone actual UI passed a selected table word through Bold→Italic, independent Bold removal, Undo and independent Italic removal; exact saved source confirmed.236tests and both SDK27.2 builds pass (HANDOFF has logs). Partial removal inside a larger mark, whole-table combined editing and broader rich-editor parity remain open. Table wiki-link normalization is deferred because actual legacy serialization proves an identity collision; see NOTE-TABLE-LINK-COMPATIBILITY.md.

## 2026-11-19 — Remove note styles from part of a passage

Native Notes now removes a style only from selected visible text while retaining surrounding formatting, including nested emphasis. Global visible-character/semantic validation protects neighbouring styles and link/code identities. Mac and iPhone live checks passed sequential Bold/Italic removal from Bravo inside a formatted table phrase, plus exact Undo/Redo and selection retention.240tests and both final SDK27.2 builds pass; HANDOFF contains logs, initial failures and cleanup evidence. Whole-cell/table mixed hidden-syntax edits and broader rich-editor parity remain open.

## 2026-11-19 — Generic tab-split model groundwork

Added process-local pane-tree edits/geometry, atomic layout undo and scoped/versioned tab-drag payload validation.8focused tests include484ordered tab-family/edge cases. Full248tests and both SDK27.2 builds pass (`/tmp/berean-pane-layout-*` logs). No split UI, drag target/type, app command routing or persistence is enabled; TAB-SPLIT-DESIGN.md specifies the next extraction and remaining gates. Separately, actual Mac Compare independent KJV10/LXX5 reading positions survived Strong’sON/OFF; exact intra-row position and broader matrices remain open. Original notes unchanged; HANDOFF has precise evidence.

## 2026-11-19 — Explicit Mac tab content host

MacRootView now delegates its current single document to MacTabContentHost(tabID:), preserving identity/toolbar/inspector behavior and handling a stale tab explicitly. Mac build and real Scripture/Notes/Calendar/History/Tags/Lexicon/Search checks pass; exact37original tabs and7original notes preserved. Shared248tests/iOS model-build baseline unchanged. Background-pane command/focus/toolbar/editor coordination and actual drag previews/splits remain unfinished; see TAB-SPLIT-DESIGN/HANDOFF.

## 2026-11-19 — Pane selection and compact command-scope model

Added focused-document replacement, visible-tab reuse, scoped/stale command-target checks and compact focused projection retaining the full split tree.13focused model tests pass (including484family/edge cases); full253tests and both SDK27.2 builds pass (`/tmp/berean-pane-focus-*` logs). Minimums now key on TAB ID so replacements use their own document constraints. AppModel command routing, pane environment, compact picker and visible splits remain unimplemented; this is model groundwork only. HANDOFF/TAB-SPLIT-DESIGN record the exact next bridge and validation.

## 2026-11-19 — Reader annotation workflow

Readers no longer place colored verse-tag labels or note counts in running Scripture. Quiet study dots open Notes/Tags; chapter tags use a count caption. Compare removes tag rows and uses its exact-column study dot. Study Notes now groups Tags, Chapter Tags and Notes. Existing data and operations retained. Real Mac/iPhone checks and both builds pass; details/limits in READER-ANNOTATION-DESIGN.md.

## 2026-11-19 — Personal references and follow-up queue

Personal note references now share the quiet study dot instead of trailing arrows. Ordinary notes mentioning a verse also produce the dot; Related Passages opens My Notes with the correct scope. Chapter references use Chapter study instead of a separate citation row. Compare supports reference-only dots.254tests/both builds and Mac/iPhone navigation verified; no data migration.

## 2026-11-19 — Automation QA isolation

Debug-only named QA library/preferences now implemented; regular behavior/identities unchanged. Live named-suite writes and parser safety checked; full255tests/both builds pass. Use only the separate app path/profile in QA-PROFILES.md; preserve concurrent shared-QA user edits. Notes controls/viewport follow-up is validated in the worktree.

## 2026-11-19 — Study controls and viewport lifecycle

Study Notes options moved into search with flat choices; Notes section now first. Added hover fills on initial study controls. Mac restore/jump waits for attached sized native viewport, preventing verified tab-return jumps; normal release saves use idle checkpoint. Both apps build;255tests pass; Mac/iPhone interactions verified. No data schema/identity/sync changes.

## 2026-11-19 — readable study-note previews and contextual tables

- `NoteRowView` now uses the existing `noteExcerptText` semantic conversion before taking the 200-character preview, instead of exposing saved Markdown/wiki syntax. Saved note content is unchanged. iPhone All Notes preview for **Dev iPhone Citation QA** visibly reads “See Exodus 20 and Exodus 20:11.” without wiki brackets.
- Both native rich editors coalesce table-context notifications with their existing selection/completion callbacks. Context uses the retained native selection even when a toolbar menu takes focus. The shared Table menu offers insertion outside tables and row/column addition/deletion and whole-table deletion inside one. Mac has a direct toolbar menu; iPhone reaches the same menu through Format. Existing mutation/undo implementations retained.
- Mac isolated-profile UI: new disposable note `ab468514-f24a-41d8-bf6b-d5fc176d2918` (Context Table QA 2026-11-19), formatted heading/bold/wiki/table screenshot showed readable text/borders without syntax. Caret after Prayer changed Table to contextual actions; Add Row Below and Add Column After worked, two Undo operations restored the exact original source. Read-only SQLite confirmed trailing `Outside` survived (AX transiently omitted it). Moving caret to Outside changed the menu back to Insert Table. Fixture recoverably trashed; original Genesis-content Note restored and reader returned at exact scrollbar0.2734573119188504.
- Final read-only invariants: all13 baseline Mac notes retain content hashes/timestamps, exact38 active tab IDs and all tag rows unchanged. iPhone all17 original note hashes/timestamps, exact47 active IDs and all tag rows unchanged. No production/shared-human-QA interaction. iPhone restored Psalm3LXX, Strong’sOFF, selectionOFF, study sheet closed, scope Current Passage, Capture KeyboardOFF. New simulator container97AA7CDA-A08F-4457-BA49-9DE41351682D, PID75224.
- Both SDK27.2 Debug builds pass: `/tmp/berean-context-table-mac.log`, `/tmp/berean-context-table-ios.log`. No package semantic changes; preceding255-test pass remains the package baseline, not a newly rerun suite. Mac contextual mutation path is UI-verified; iPhone contextual menu/mutation interaction and full hidden-syntax/typed-shortcut/multicell matrices remain unverified. Main editors already use null glyphs for parsed syntax; this test does not prove every incomplete or malformed syntax case. Do not implement blind source stripping.
- Still OPEN: share-popup anchoring/audit, version-history polish, full auto verse/Strong’s settings and personal-tracking parity, inline Strong’s and picker hover audit, BDB RTL selection, occurrence/subword search match styling, physical Mac momentum/pull feel, generic live pane splits, Kokoro streaming. Owner-only merge order22→23→draft24 unchanged.

## 2026-11-19 — sharing, BDB selection, match styling and explicit iPhone navigation

- **Mac Notes share anchor:** NativeShareAnchor sits behind the stable toolbar Menu; uniquely identified requests present retained NSSharingServicePicker after the transient menu closes. Actual screenshot/AX confirmed picker beneath the toolbar share icon and repeated cancel/reopen. No recipient selected or external transmission performed. Ordinary editor/single/bulk Notes sharing now uses readable title/body, without YAML/frontmatter/wiki delimiters; explicit Markdown export/copy remains. Final current-title and reference-block-preview cleanup builds pass, their new edge cases are not separately UI-proven. SHARING-AUDIT.md enumerates every other still-open anchor surface.
- **Version history:** larger Mac sheet, roomier dated/kind rows with native icons and full-row shape, clearer titled snapshot preview with metadata/current-content indicator, bordered Save Version button. Mac actual existing autosave preview/Done verified, no snapshot creation/restore submitted. iPhone compact presentation and restore interaction remain open; restore safety/service logic unchanged.
- **Matches:** regular search no longer rejects display marks merely because the matched substring has adjacent letters; range finding is case/diacritic insensitive and marks the exact displayed substring. Actual Mac `ever`→every showed yellow only on ever in multiple Genesis results. Lexicon occurrence matched words retain bold/primary text and gain faint yellow background; Mac G26 love/love repeated words and Word Replacer Messiah/Yeshua context verified. iPhone G5463 rejoiced/Rejoice occurrence highlights visible. Mixed Strong’s/plain query, diacritics, quoted phrase and all-edition/multiple-hit matrices remain open.
- **BDB selection:** BdbSelectableText uses native noneditable/selectable NSTextView/UITextView, explicit left-to-right paragraph base for English prose, natural bidi Hebrew runs, unchanged expanded-token logical source, native font/abbreviation styling and find highlights. Dynamic proposed-width sizing; no inserted direction-control characters. Mac H1 English phrase selection and copy across Hebrew+number+English verified by paste into Go: exact `אָב 1101 noun, masculine father`. Find father highlighted BDB occurrences. iPhone H1 wraps at phone width and double-click father showed native selection handles and Copy/Look Up menu. iPhone full cross-bidi copy/handle-drag, long entries/narrow sidebar/Dynamic Type/dark and accessibility matrices remain open. Shared corpus BDB-article reuse DATA-01 remains unrelated/unfixed.
- **Found/fixed iPhone explicit New Tab intent loss:** initial Tabs→New Tab showed Go and replaced existing G5463 tab8583b263-b435-43f5-94e6-aadabbd09fbf with H1 (still47IDs). Replaced separate presentation bool/mode state with sheet(item:) GoRequest(id,newTab). After fix same action visibly showed New Tab, created separate H1 `ec137fd2-8860-4b4c-89e5-445b594ca00c` (Study10tabs), preserved G5463, then closing only H1 returned exact47original IDs. Ordinary Go from Scripture after that visibly showed Go and selected existing G5463 with Study9tabs. G5463's original state restored after initial reproduction. Full Scripture/Search/Notes/NewNote/Today/History command matrix still open.
- **New Mac viewport reproduction OPEN:** after temporary Search ever→CmdL G26→close temporary tab (next selection is existing Exodus32 Compare)→Genesis1 reader, scrollbar changed from0.2734573119188504 to0.3753169907016061, settled and persisted on relaunch. Subsequent Note→Reader return retained0.3753169907016061. This is a different transition from prior direct Notes/Search return proof; do not claim all viewport races resolved. No reader/Compare source edit in this increment. Current isolated Mac reader remains at this new position; investigate Compare passage/width/capture lifecycle using gated trace if needed, not blind saved-state restoration.
- **Data/cleanup:** all13original isolated Mac note hashes/timestamps, exact38active tab IDs and all3tag tables unchanged. iPhone all17original note hashes/timestamps, exact47active IDs/all3tags unchanged. Temporary Mac ever/G26 and H1 tabs closed individually; iPhone H1 test tab recoverably closed. No notes created or edited this increment. Final iPhone Psalm3LXX/unselected/Strong’sOFF/inspectorclosed, CaptureKeyboardOFF; G5463 original strongs state restored. Current simulator containerDC341112-61E7-465B-BC81-A37791F587B5, PID77177 (rediscover after install). Safe Mac copied path/profile unchanged; never interact with human-used old QA app.
- **Validation:** final SDK27.2 builds PASS `/tmp/berean-study-final-{mac,ios}.log`; iPhone intent-specific build `/tmp/berean-go-intent-ios.log` PASS. Full255tests PASS (4core Swift Testing +251conformance/64suites,127.356s), `/tmp/berean-study-final-tests.log`. New SwiftUI/native behavior is established by the UI evidence above, not inferred from package tests.
- **Open goal:** full feature parity, generic live pane splits/window commands, all share-anchor surfaces, physical Mac momentum/pull feel, picker/inline Strong’s hover, complete automatic verse/Strong’s tracking/settings, rich Notes/typed shortcut/multicell matrices, iPhone history and Kokoro assets/streaming remain unfinished. Owner-only22→23→draft24 merge guard; no identities/signing/schema/sync/production/Apple-voice changes.

## 2026-11-19 — inspector-layout restoration and complete note candidates

- **Source commits:**8f680362 reader layout-burst restoration;03697661 compatible automatic Strong’s preference; c8fbfe2e abbreviation/unbounded note-citation candidate tracking. Goal remains active.
- **Reader diagnosis:** reproduced Compare→Reader repeatedly0.3753169907016061→0.5591715976331361 and then0.8003629764065335. Trace showed offset888 restored correctly at320pt, then native widths320→756→416 and AppKit reflow changed captured offset1323. Root tab-switch transaction disabling animation did not solve it and was reverted. No root/sidebar/history button placement changes retained.
- **Reader fix:** apply the latest saved/explicit viewport intent immediately when attached/sized, retain it across actual geometry changes, release after0.5s of layout quiet. Reentrancy/geometry guards avoid repeated same-layout work. Wheel, native text mouse-down, window-local key/mouse-down and scrollbar drag cancel immediately. Idle/dismantle capture does not overwrite the saved target during initial transient restoration. Actual trace offset710 retained across320/756/416, repeated Compare roundtrips exact scrollbar0.3000845308537616 (initial AX0.3 rounded to pixel710). Scroll immediately after return moved to0.5418427726120034 and stayed there. Final source without diagnostics repeats exact0.5418427726120034 across Compare return/relaunch; toolbar ChapterActions opens/cancels and position remains. Final native input guard was launched/checked too. No claim of physical trackpad frame-pacing cure or all window/resize/race coverage. Layout quiet is bounded at0.5s; severe delayed layout/user-command races remain a test matrix.
- **Diagnostics:** temporary opt-in trace code removed from final source/launch. Retained layout-only evidence `/private/tmp/berean-codex-qa/viewport-followup.jsonl`; original copy in named profile. No normal/production logging. Safe Mac path/profile unchanged.
- **Reference preference:** Electron desktop/mobile/settingsBridge contain noteLexiconRefsEnabled but native previously ignored it. AppModel now loads/saves that original key (defaulttrue); both rich editors independently restyle automatic Strong’s links. Native Notes settings exposes Detect Strong’s References. Mac test note d549a917-bf44-4054-816b-5f5b5d5cc5b1 contained `Jn 3:17; H430; [Manual](berean-native-dev://lexicon/G26).` OFF removed only automatic H430; explicit Manual stayed. ON restored H430. Existing Mac Detect Scripture References=false was preserved. On iPhone existing Wiki iPhone QA note, OFF made plain G5485/H99999/G5463 while Scripture/wiki links stayed blue; OFF persisted after app terminate/relaunch and Settings showedOFF. ON restored links. Final stored noteLexiconRefsEnabled=true on both QA libraries; no note source changed by toggles. Suggestion settings remain independent.
- **Citation tracking gap/fix:** ordinary-note candidates used canonical book name search capped80, so abbreviated and older citations were invisible. Query now considers all live note types via exact indexed chapter-number token; existing parser validates book/ranges/editions, no new schema/cache/index/scan-all implementation. Native selected/chapter references retain direct/reverse links. Test90ordinary+abbreviated range+whole-chapter alias, different chapter exclusion, edit, Trash and restore. Initial wrong test filter ran no cases (not counted); corrected targeted33tests/8suites pass0.081s. Full256tests=4core+252conformance/64suites PASS128.931s `/tmp/berean-citation-final-tests.log`. No goldenJSON changes.
- **Actual abbreviation UI:** despite Mac automatic Scripture links disabled, ordinary test note Jn3:17 generated John3:17's neutral dot and Notes→RelatedPassages→MyNotes showed its title. This confirms display toggles do not erase personal reference relationships. Temporary John3:17 and new Notes tabs closed individually; test note recoverably trashed. Original Genesis reader restored CrossRefsTSKe/CompareOFF/Strong’sOFF/selected1, current scrollbar0.5418427726120034. Mac workspaceStudy8tabs/38totalexact original IDs, all13original note hashes/timestamps and tags unchanged.
- **iPhone cleanup/runtime:** no new note/tab created in this increment. Original17note hashes/timestamps,47exact IDs/alltags unchanged. Restored Psalm3LXX/unselected/Strong’sOFF/sheetsclosed/CaptureKeyboardOFF; detectiontrue. Current container641F095F-BF1B-439E-8439-EAA7082B13EB, PID80592; rediscover after install. Touch settings form scrolling works reliably with drag followed by a destination click; use left blank margin to avoid changing a control. Large uncompleted drags caused overshoot; no original settings except new detection key changed.
- **Builds:** final bothSDK27.2 builds PASS `/tmp/berean-citation-final-{mac,ios}.log`; latest Mac mouse-down input guard build PASS `/tmp/berean-viewport-input-final-mac.log` and actual roundtrip/toolbar checked. Full package suite preceded this Mac-only event-mask guard, which does not change package source. Earlier published ad67a2fd CI44636765653 succeeded; current new head must be checked after push.
- **Audit/next:** NOTES-REFERENCE-PARITY.md records precise settings/link/block/tracking evidence and remaining gates. Bare Strong’s IDs are not yet Lexicon MyNotes/backlinks; no arbitrary verse association invented. iPhone long Scripture More menu hides app-level Settings in the observed viewport while Notes menu exposes it; simplify menu grouping/discoverability next (no fix yet). Existing incomplete literal `Preview [[` in Wiki iPhone QA remains literal source; never strip arbitrary unmatched punctuation blindly. Other automatic-reference/grammar/library-performance/hover/share/table/live-pane/Kokoro/physical-scroll work remains open. No identities/schema/sync/production/Apple-voice changes; owner-only22→23→draft24 merge guard.

## 2026-11-19 — Personal lexicon Notes and simpler iPhone commands

Implemented shared Lexicon My Notes backlinks using normalized bare IDs and actual lexicon destinations, preserving note-title wiki identities and excluding code/images/comments/unrelated URLs. Ephemeral off-main, revision-aware index has no result cap or schema change. Mac normalized/explicit-link/edit invalidation and iPhone existing-note/open/top-Back return verified. iPhone More now groups reading/chapter/tab/study commands with Settings directly reachable; tab previews use readable excerpts. Full 258 tests and both return-fix builds passed; final disclosure polish build logs and full evidence/limits are in HANDOFF. Physical scroll/hover, compact/history/performance/reference grammar, rich tables/all sharing/live panes/Kokoro remain open. Production data/identities untouched; review guard and active goal unchanged.

## 2026-11-19 — Search/study/Compare/window follow-through

Seven focused source commits now deliver the Mac chapter share anchor (actual open/cancel twice), aligned inline search controls and grouped Options (Exact phrase/reset checked), grouped Notes inspector with compact desktop chapter scope, searchable Shortcuts (action/modifier/no-results/clear checked), iPhone Compare body selection (LXX/KJVA/number-clear checked), persistent window inspector with settled native width retention and explicit sidebar240/panel320/window1000 minimums, and local cursor-region yielding at native dividers. Both apps build; latest Mac-only limits/cursor builds pass. Physical cursor/drag/first constrained Compare reflow/all-tab history/toolbar matrices remain open. See latest HANDOFF for exact evidence, failed width experiments, source commits and safe NEW controls QA profile. All16 fresh Mac notes/37IDs and17 iPhone notes/47IDs/tags unchanged. Do not restore the now-stale prior study QA baseline.

## 2026-11-19 — Native rendered Compare lifts and stable divider regions

Mac Compare now starts a native drag with the rendered visible column, preserving pickup position and using a local move operation instead of rebuilding a differently sized passage preview. Native cancellation restores the source; late drops require the active Compare tab. Divider cursors use narrow stable native tracking regions and correctly handle main content extending beneath glass sidebars/inspectors; decoration views no longer become phantom divider regions. Both apps build; AppKit geometry regression passes; actual independent Compare reorder/cancel/passage click/verse actions checked. Continuous physical hover and the full Compare matrix remain open. Source5658bcfe/6c351503; precise evidence in HANDOFF.

### Effective divider target refinement

The existing NSSplitView delegate may provide a wider effectiveRect or a connected additional gutter. The helper now queries those public methods rather than assuming the visible line is the whole target. Connected additional areas are limited to narrow gutter handles; broad separate header drag surfaces retain their own controls/cursors. Regression fixtures add wider target, disabled target and connected handle checks. Actual final controls-profile strips remain7pt. Final Mac build /tmp/berean-native-divider-effective-final-mac.log and standalone fixture pass; actual final reader has scrollbar0/Genesis1/selected1/CrossRefs. Physical key-window hover is still open. This is a refinement of5658bcfe; exact final commit is in git log.

## 2026-11-19 — Repeated Compare drag correctness

Source bbca520f fixes stale recognizer source identity after reorder, finishes the native gesture lifetime and masks stacked drag images to the actual source fragments. Real aligned/pinned consecutive moves, invalid-drop recovery, rendered Strong’s link and temporary three-column stacked reorder/return verified; both builds pass. Temporary column removed and reading states restored;16notes/37IDs/alltags unchanged. Blue verse-control image fidelity,2x/selected/text-selection/4column/race/physical cursor matrices remain open. Exact evidence in HANDOFF/NATIVE-COMPARE-DRAG.md. Previous718d9e2e CI44665586360 is green; new head’s checks are separate.

## 2026-11-19 — Table-safe Notes and minimal iPhone keyboard controls

713bd02e protects real note tables from paragraph/list/callout/nested-table edits and disables corresponding native controls.1b9a4074 groups the iPhone accessory into6prose/5table controls, keeps formatting in a native menu, provides contextual table operations/live cell navigation, direct keyboard dismissal, Undo/Redo availability and haptics preference support. Both final builds and265tests pass. Actual Mac shortcut/table/prose/Undo and iPhone row/column/format/Undo/Redo/navigation/heading checks passed. Original16Mac/17iPhone notes,37/47IDs/tags unchanged; disposable notes trashed/tabs closed. See HANDOFF/NOTES-KEYBOARD-AND-TABLES.md for exact scopes and open device/rich-edit matrices. d6422697 adds opt-in raw Compare diagnostics; direct pixels supersede the earlier missing-number preview interpretation. Latest owner marker/hover/replacer/auto-block requests remain OPEN in FOLLOWUP.

## 2026-11-19 — Study markers and automatic dictionary blocks

Added native two-line dictionary cards without changing saved text; prevented reference blocks splitting tables; corrected LXX Psalm note blocks to include title+opening verse and reader numbering. Replaced study dots/generic chapter wording with symbols and personal-reference hover previews. Moved filter hover feedback to native controls. Added searchable Word Replacer rules in Settings. Full274tests and Mac/iPhone builds pass; see HANDOFF for actual UI and limits.

## 2026-11-19 — Aligned cited-passage previews

Fixed misleading chapter note symbols for tags/references; separated mentions from actual passage counts. Mac margin previews now show cited passage text, preserve LXX title+opening verse, anchor via native screen coordinates, resolve before showing and retain full short-verse height. Dismiss stale previews on scroll. Actual Mac checks/both builds passed; physical hover matrix remains open.

## 2026-11-19 — AI continuity documentation

Made HANDOFF the explicit entry point for all AIs, with current state, owner principles, task/evidence map and mandatory continuous checkpoint updates. Added root agent/Claude routes, preserved historical checkpoints verbatim and documented safe resume/usage handover. This is development continuity support, not a new in-app feature or completion of the migration.

## 2026-11-19 — Verified Scripture blocks and iPhone Settings (7e8142f9)

Both native editors now canonically verify and style copied Scripture without changing source, with original false/0.9 settings, cancellable/debounced bounded verification and complete LXX/range selection. iPhone Settings gains six native category routes. Full290sharedtests/finalMac+iOSbuilds PASS; actual Mac/Simulator source/Undo/settings/table/duplicate/rejection checks PASS. All owned fixtures trashed/extra tabs closed; existing19/24note-row hashes,37/47activeIDs/alltags preserved. See SCRIPTURE-BLOCKS-2026-11-19 and CURRENT-STATE for precise proof, runtime and limits. Full rich-import/read-only/index parity remainsOPEN. Next fix LXX attachment display, iPhone dock after editor removal and Mac viewport drift; no Apple voices/merge action. Broad migration remainsACTIVE.


## 2026-11-20 — Reader-aligned note labels and iPhone editor removal

Source334eafbb: native LXX Psalm attachments use reader labels/ranges while raw IDs/legacy golden formatter remain unchanged. Owner-scoped editor teardown fixes tested iPhone focused-note Trash/dock recovery without restart. Six new regressions;296shared tests/both builds PASS; real Mac+iPhone label/link checks and iPhone accessory-keyboard workflow PASS. All20/25prior notes,37/47active IDs/alltags preserved, owned fixtures recoverablytrashed. Physical/software-keyboard/multiple-editor UI matrix and Mac right-divider return drift remainOPEN. See [evidence](NOTE-LABELS-EDITOR-LIFECYCLE-2026-11-20.md) and CURRENT-STATE for live review/CI/runtime. Owner completed final Ollama shortcut removal; verified absent. Broad migrationACTIVE.


## 2026-11-20 — Inspector width investigation remains open

Published334eafbb/4e6c49fa retained. QA trace proves hidden inspector width capture during a new closed-inspector Bible tab. Custom380pt→newPsalmLXX→close→Genesis returns320pt. Three attempted fixes built but failed the identical UI regression (active/presented capture guard; conditional ideal; omit hidden content); **all removed**, exact published source/app restored without diagnostic flags. Original1148divider/0.5782918149466192scroll/Genesis1selected1/Notes restored and prior20/25notes,37/47activeIDs/alltags rechecked unchanged. No GUI phase pending. Read [precise reproduction/trace/failed approaches](READER-VIEWPORT-RESTORATION.md#2026-11-20--width-drift-reproduced-attempted-fixes-rejected); do not report width drift fixed or repeat rejected approaches as untested ideas. Prior9aCI44693533700 cancelled;4e6c49fa CI44695609238 live at latest poll, not green. Broad migrationACTIVE.


### 2026-11-20 — Presenter, Messages and iPhone visual/functional polish — bounded verification

- Before: Claude5f9b0c45 on native/reader-notes. Focused source: ebd7f913 (Messages/commands), b816ec41 (Presenter),1c8004b1 (iPhone reader/picker/Go/tabs), e5816a96 (inspector return).
- Presenter now freezes rendered content on Pause and presents rich notes; Messages gains rich content-sized bubbles, a glass composer, retained drafts, destination/search/error handling and conversation-scoped UI identities. iPhone reading extends under floating chrome; text selection is roomier, noncanonical choices visible, Go glassy, and tab previews/organization improved.
- Full339 shared tests pass; both visual-pass development builds pass; actual Mac+iPhone checks and exact committed builds/AppKit regressions are recorded in [evidence](PRESENTER-MESSAGES-POLISH-2026-11-20.md)/CURRENT-STATE. No UI automation outside CUA.
- Failures corrected before publication: wrong initial test fixture identity assumption; unsafe direct reader underlap; competing native Close shortcut; duplicate Mac search toolbar crash; mistaken BibleState annotation property during final compile. Previous failed experiments remain in the live investigation.
- Only isolated QA data touched. All21/26 prior notes, original tags/folders and exact37/47 active IDs preserved. Owned note recoverably trashed; temporary tabs closed. Clearly named local Chat fixtures retained, with exact IDs outside user libraries in documented QA evidence.
- Remaining physical/rotation/accessibility/keyboard/failure/reference/manual resize matrices remain open. Owner-only PR22→23→draft24 guard unchanged. No Apple voices. Pause by16:50Pacific; do not mark migration complete.


## 2026-11-20 15:25 Pacific — Messages reference and composing follow-up

Commit **1ec16c13** restores plain Scripture/Strong’s internal links without rewriting saved messages, uses normal destination navigation and reveals the main document. Stable declarative targets plus an initial-only bottom anchor fix reopening at older content. The iPhone native multiline composer grows to eight lines, preserves Markdown punctuation, and sends with Send/Command-Return. Actual Mac+iPhone reference, rich table/list/code, search, reopen and iPhone draft-return checks pass. Both Dev builds and344 shared tests pass. Original notes/tags/folders and exact37/47 active tab IDs unchanged. Rejected input/layout/focus attempts and remaining physical/accessibility/failure gates remain explicit in [focused evidence](PRESENTER-MESSAGES-POLISH-2026-11-20.md). No production/sync/schema/raw identity changes or merges. Publication of this follow-up is next; prior b8882e06 CI44831691582 is green.


## 2026-11-21 — Presenter, preview and settings refinement

- a4fcc429: calmer Presenter typography, grouped zoom/reset, reader preference synchronization, appearance-safe pause and reader scrolling after selection.
-16067d57: preserve prose/links and consecutive images after a leading Markdown image; no stored-content rewrite.
- da8aecce: editable custom print margins including direct fractions; per-control accessibility; reliable named native theme choices; consistent inherited custom accent.
-81938ff0: clean message/reply excerpts without image payloads, compact date labels and one conversation filtering pass; preserve legacy result fallback.
- Validation:346shared tests; both Dev builds; actual bounded Mac/iPhone interactions in focused evidence. Unknown-field/paper/physical-device/full Compare and rich-message matrices remain open. New evidence is durable under ignored build/apple/qa-evidence/20261121 after restart removed old temp paths. Original QA row hashes retained; new owned preferences/Chat fixture explicitly recorded. No production data or sync changes. Review remains draft24/owner-only merges.


### Nov21 Presenter follow-up — source1e9eeed7+6a50adc6
Settled reopen now uses the retained reader viewport; live observation remains subscribed and grouped zoom controls expose distinct names/actions. Mac build and actual reopened13→19/livefollow/zoom actions pass. Cold startup with restored audience still starts at top before reader settles: explicitly OPEN; source seeding alone did not fix it. Compare active-secondary projection and explicit same-chapter jump matrix remainOPEN. Detailed next implementation packet in PRESENTER-REFINEMENT-2026-11-21.md. Original QA rows and exact37/47activeIDs preserved. Broad goalACTIVE.


### Nov21 startup correction — ada385b1
Supersedes reproduced startup selection-overwrite above: transient highlight snapshots no longer request focus; deliberate verse selection/clear/destination still does. Both builds PASS; actual fresh startup stays at savedverse7/selected1, explicitverse8 focuses8; original state restored. No persisted format/schema changes. Wider multi-window/paused/edition/history matrix remainsOPEN. Focused evidence has exact scope and next steps.

### 2026-11-21 — Scripture Back and Forward, diagnostics, and native presentation

- `e3845c9b` restores Scripture history viewport and selection together. Mac and iPhone Simulator verified same-chapter round trips. Mac also verified subsequent user scrolling and Presenter follow/pause. Cross-type initial-layout drift was subsequently repaired in 7118fff8 and checked with repeated Mac round trips.
- `da77a14c` keeps full readable crash diagnostics, acknowledges dismissed reports locally, and records content-free save timing. The physical iPhone exit-watchdog cause remains open.
- `0d6c0ad3` keeps iPhone Scripture clear between the glass controls on supported iOS versions and widens Scripture by reducing the phone inset. `40fb2923` presents Mac floating search immediately with matching title-bar and content dimming.
- Both final Dev builds passed. Shared tests passed 349. Scoped interaction evidence and remaining cases are in the [history record](HISTORY-VIEWPORT-RESTORATION-2026-11-21.md) and [watchdog record](IOS-WATCHDOG-2026-11-21.md). Source through `7118fff8` is local. CI 44894290052 covers the prior published `ec6138cd`.


2026-11-21 follow-up — `7118fff8`: rebuilt Mac actual Scripture → G5485 → Back, then Forward/Back, restores the exact 446-point viewport through first native layout. User scrolling remains free. Cross-chapter Back also passed. See the focused history record for scope; missing-viewport/rapid/edition and first-frame matrices remain open. No desktop margin change.


### 2026-11-21 — Compare focused-column audience (8ae5e4a6)

Mac Presenter now uses a validated, atomic transient projection of the selected comparison column, including its actual edition/chapter, highlights and reading focus. Both platforms build; actual LXX Exodus 32:2 audience wording and pause → switch tab → resume pass. Shared layout/anchor decisions are consistent across available columns and widths. No persistence/schema changes. Mapped/availability/reorder/removal/clear/scroll matrices and full multi-column mirroring remain open. A separate tab-switch/pane-reflow drift remains open; do not claim all tab transitions preserve first-frame geometry. See PRESENTER-REFINEMENT-2026-11-21.md and CURRENT-STATE for exact QA state/evidence.


### 2026-11-21 — Inspector lifetime and final history settling

8252c91c validates the live inspector target across same-ID tab replacement and updates only its open state. Mac actual Lexicon/Search replacements retain the UUID and contain no leaked Scripture fields; inspector toggle works. 852a4767 corrects the final AppKit origin-only shift during newly mounted history restoration: repeated actual Search round trips preserve446 points, immediate user scrolling wins, and its new position survives history. Final Mac build passes; temporary diagnostics removed. Later changes are Mac-only; shared package unchanged since349-test pass. See TAB-LIFECYCLE-2026-11-21.md for trace, bounded evidence, current QA geometry and remaining accessibility/first-frame/history/Compare matrix. Earlier geometry readings were affected by AX divider adjustment; controlled no-write tab switching was stable. Do not close the broad reflow requirement from that narrow check.


### 2026-11-21 — Actual verse rows in iPhone picker and active-tab chrome on Mac

- `c39ca828` uses prepared Scripture rows and raw verse IDs in the compact iPhone picker. It exposes combined verse labels and enlarges the iOS clear and dismiss targets to 44 points. Simulator verified Exodus 32 omits 9 and opens 35, 1 Kings 14 shows 21–31 and opens 31, Psalm 115 shows 4–5 and opens stored verse 4, and Psalm 3 display verse 1 opens stored verse 2.
- `d9da6c36` gives the active Mac Scripture tab ownership of the window title and toolbar. Return selected Jonah from the Compare popover. After Back and switching to Genesis, the window showed Genesis 1, one principal toolbar and no old Manage Translations control. A same-ID Strong’s query and Back also retained the Genesis viewport and toolbar.
- Both final Dev builds passed. The final QA comparison preserved original note hashes, all 37 Mac and 47 iPhone active tab IDs, and the original Exodus Compare sync state. The recorded totals were 22 Mac and 26 iPhone notes. [Picker and toolbar evidence](PICKER-CHROME-2026-11-21.md)


### 2026-11-21 — Compare remembers each visit’s selection

- `50f00c76` preserves each Compare visit’s selection within the bounded navigation history. Mac restored the previous column selection after swap and close, distinguished two visits to the same layout with verse 3 versus verse 5, and restored the LXX selection after an explicit KJV verse jump and Back.
- iPhone Simulator restored selected KJVA verse 3 in both orders through swap and Back/Forward, then returned to the original unselected Psalm 3 LXX reader. No notes or tabs were created in either run.
- Both Dev builds and the actual reader selection regression passed. The shared package is unchanged since its previous 349-test run. Selection history is session-local. Narrow viewport transfer and persisted Compare viewport remain open. [Compare history evidence](COMPARE-HISTORY-2026-11-21.md)


## 2026-11-21 — Paused Compare columns checkpoint

Local source6fbba670 keeps iPhone Compare side by side with horizontal overflow, compact matching headers/cells, tighter inline verse numbers, no per-verse ellipsis, and complete compact-row selection bounds. Global Close Column is e31b8d87. Shared layout arrivals preserve verified raw verse/source-grid identity instead of stale incompatible offsets. Final Mac+iOS builds pass. Actual iPhone horizontal/vertical scrolling, Sync off/on near10, close3→2, survivor retention and joined text-tap selection verified in bounded scope; final compact selection includes its first number. Mac final runtime, pinned→following and explicit-jump/rapid/accessibility checks remain open. Owner requested pause; not pushed. Next design request is Compare grouped naturally with passage picker. [Precise checkpoint](COMPARE-VIEWPORT-2026-11-21.md).


## 2026-11-21 — Discoverable iPhone reading controls

Source0819f846 adds direct Strong’s left of passage picker and Compare/Manage in the existing top row, removing the extra44pt Compare band. Both chapter arrows always remain; long names wrap in two lines, LXX appears on the edition-switch button. Actual Simulator Song of Solomon1LXX full-title/Strong’s on-off/lexicon lookup/CompareExit passes; build scopes and remaining375pt/VoiceOver/physical checks are in [focused evidence](IOS-READER-CONTROLS-2026-11-21.md). The ordinary changing foreground gap remains OPEN (measured AEL case stable; no inset hack). Source3bb05740 further widens iPhone-only text with6/10/22pt insets; desktop widths unchanged. Rejected arrow-hiding and separate-LXX-row candidates were not committed. Broad migration active.

## 2026-11-21 — Verse-copy layout and LXX Psalm titles

Reader and Compare copy, Scripture search hits, and applicable cross-reference and highlight copy paths use the shared verse clipboard formatter. A single verse puts its reference and body on one line. Multiple verses put the reference range first, followed by each selected verse on its own numbered line. Whole-verse LXX Psalm copy retains the attached superscription. Both Dev builds and six focused tests passed. Actual clipboard checks covered reader single/range/gapped copy on both platforms, Mac Compare and Scripture search, and iPhone Simulator Psalm 3. [Verse-copy evidence](VERSE-COPY-PARITY-2026-11-21.md).

## 2026-11-22 — Compare follows closed-reader navigation

Shared CompareColumn now updates following saved columns on real reader passage changes even while Compare is closed. Pins, independent legacy columns, explicit replacements and history snapshots retain their behavior. Both builds, red-before/green-after isolated state probe, Mac close/navigation/reentry with Back/Forward, and iPhone mixed follower/independent reentry pass. Already-stranded ambiguous records remain preserved; use explicit Follow Main Passage. Physical/relaunch/expanded UI matrix and durable viewport work remain open. [Evidence and compatibility](COMPARE-REENTRY-2026-11-22.md).

## 2026-11-22 — Rich note previews on both platforms

Source7ccbc3ca replaces flat snippets with rich attributed rows and bounded document thumbnails for gallery/iPhone tabs. Valid Markdown stays hidden; headings, links, wiki aliases, underlines, highlights, lists/callouts and table grids render; code remains literal. No note storage/editor rewrite. Final both builds and10focused parser checks pass. Actual Mac gallery/history and iPhone peek/table-tab/tap verified; final iPhone thumbnail retains button role. Original row hashes/37+47IDs/22+26notes pass. Physical/VoiceOver/large-type/imported-dialect/performance matrix remains open. [Detailed evidence](NOTE-PREVIEWS-2026-11-22.md).

Final rich-thumbnail refinement26dfced7: both builds pass; actual iPhone table card retains button role and reads Item/Value/Testrow/42 rather than repeated generic Table labels. Native VoiceOver remains unverified. See rich-preview evidence.

### 2026-11-22 23:30 PST — Parity + QA session (Claude Code) — VERIFIED (sim/Mac QA), PUSHED
- **Agent/session context:** Claude Code continuing the HANDOFF goal on `native/reader-notes` (draft PR #24), alongside Codex's commits (rich previews, compare alignment, verse copy) which were pulled first.
- **Repository/worktree/branch and SHA before:** `/Users/roywe/Berean-native` `native/reader-notes` at `1b58c644`; after: `13e25712`.
- **Code changed / behavior delivered (each commit verified before the next):**
  - Owner requests: instant Strong's taps on iPhone (reader tap owns `strongs:` links); one-row equal-spacing iPhone reader top bar; compact 3-column iPhone book picker. Owner's iPhone 16e has Berean Native Dev installed via `npm run native:ios:device`.
  - Study Trail: merge / split (mergeSessions/splitSession), Move to Trail + topic breaks (moveNodes/setNodeTopicBreak), multi-stop Select → Move, Map folding on shared `trail_collapse` keys.
  - Notes: Board layout (status lanes, drag to change status); slash-command menu (original SLASH_COMMANDS with native equivalents; Mac arrow/Return routing fix); wide tables shrink-to-fit / no-wrap grid (was breaking); substituted-marker resume across TextKit glyph chunks (stray "]" after task boxes).
  - PDFs: bookmark label prompt ("Page N") + Rename. Spotlight: tab sessions indexed (Debug `--spotlight-selftest` query verified).
  - Lexicon: Mac BDB Notes no longer overlap Derived Terms; entry sections are VoiceOver headings.
  - Chat: VoiceOver reads who/when first + Reply/Copy/Delete actions; plain-language `SQLiteError` descriptions; delete failures reported.
- **Commands and results:** `npm run native:build:ios` / `native:build:mac` exit 0 after every change; `swift test -c release` 357 tests / 92 suites pass (new: StudyTrail merge/split/move/fold, NoteSlashCompletion, PdfService rename).
- **Data touched:** isolated Dev only — sim E8B01B22 (`com.berean.native.ios.dev`) and Mac QA profile `claude-20261120`; every QA fixture (trails, notes, PDF, highlights, chat message, statuses, layout pref) removed or restored afterwards. No production data, no iCloud.
- **Known failures, regressions and their fixes:** YouTube in-app mini player (M02 stand-in) trapped in `_WebKit_SwiftUI` when re-hosting a `WebPage` → fully reverted and documented (YOUTUBE-TAB doc).
- **Branch / commit / PR / CI link:** `native/reader-notes` → draft PR #24 (owner merges).
- **Documentation/parity rows updated:** FULL-FEATURE-PARITY S02, S04, S11, S14, H02, N03, N04, N05, N11, Q04, U14, U17, U18, A04, A05; OWNER-DECISIONS-BRIEF-2026-11-22.md; APP-INTENTS, NOTE-IMAGES, PRESENTER-MESSAGES-POLISH, S14 and YOUTUBE-TAB docs; HANDOFF bullets.
- **Next exact action and its prerequisites:** owner device checklist (Psalm 119, VoiceOver, Siri/Shortcuts) and the six decisions in OWNER-DECISIONS-BRIEF-2026-11-22.md; Read Aloud remains Codex's.

## 2026-11-23 — Claude audit fixes and verification

- KJVA’s picker opens in Books with the current book highlighted and Old Testament, New Testament, and Apocrypha sections. Mac and iPhone Simulator exercised New Testament, Apocrypha, and the Sirach prologue. Both also opened Study Trail and Messages from their visible app controls without adding tabs.
- Lexicon result excerpts center on the first matched word. Six matching-window regression tests passed. Spotlight refreshes session results when indexed titles or destinations change.
- Study Trail moves and splits carry recursive connected stops and anchored sticky notes. All-stale moves are no-ops. Move, split, and merge guard the active recording anchor. Merge preserves tags and manual recaps. Failed bulk moves keep the selection.
- Notes slash commands validate and apply each substitution as a single undoable edit. iPhone routes hardware keyboard input in the slash menu. Board bulk actions use visible cards, and wide tables wrap to keep cell content visible.
- The PDF bookmark label sheet retains its draft and displays save errors. Messages preserves the scope and displayed content on failed reads, reports delete failures, and exposes Edit as an accessibility action for editable messages.
- Final local Mac and iPhone Simulator builds and 370 package tests passed (366 conformance and 4 core Swift Testing tests). Runtime checks still include lexicon excerpts, Notes keyboard and Undo, Board interactions, PDF failure recovery, and Study Trail and Messages mutations and accessibility. See [audit evidence](CLAUDE-AUDIT-2026-11-23.md).


Nov23 final follow-up: owner rejected excerpts with too little context. Final source `6fc04d7e` keeps bounded surrounding phrases; actual rebuilt Mac H776 confirms readable context and visible matches. Final Mac/iOS context builds and372package tests passed. iPhone snippet and broader interaction checks remain open; see CLAUDE-AUDIT-2026-11-23.md.


## Nov23 — per-visit Compare reading positions

Source `d349bf41` records immutable passage-scoped viewport maps in in-tab history, reruns same-mounted restoration and protects saved bookmarks from early/stale callbacks. Both native builds and extracted snapshot probe pass. Actual Mac independent Compare→lexicon→Back retains logical verses; two separate visits to the same Exodus32 comparison remain distinct through Back/Forward. Exact independent intra-row pixels, durable restart storage, iPhone history runtime and aligned/stacked/rapid/selection matrices remain OPEN. See COMPARE-VIEWPORT-2026-11-21.md and COMPARE-PERSISTENCE-NEXT-2026-11-23.md. No sync/schema/identity changes; original QA rows and37/47active tab IDs preserved. Broad migration ACTIVE.
