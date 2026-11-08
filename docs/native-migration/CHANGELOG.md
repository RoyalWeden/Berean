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
