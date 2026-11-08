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
