# Berean — session handoff (2026-08-14)

Branch `feature/read-aloud`, being merged to `main` at this checkpoint. This file records what
landed, what's verified, and what's still open — written at a deliberate pause point, not a
finished state. Delete this file once its contents are stale or actioned.

**Verified at pause time:** `npx tsc --noEmit -p tsconfig.json` → 0 errors. `npx tsc --noEmit -p
tsconfig.node.json` → 3 pre-existing errors (`bgImport.ts`, `main.ts`, `preload.ts` — predate this
session, unrelated to anything below). `npx vitest run` → **108 files / 3530 tests passing.**

---

## What's done and working

### Read Aloud (Kokoro neural TTS)
- Real neural voices via `kokoro-js`, fully offline once the ~360MB voice pack (fp32 — not the
  original q8, which mumbled) is downloaded. System (Web Speech) voices removed entirely — Kokoro
  is now the only engine, per explicit direction.
- Two voices (Adam, Santa) excluded — Kokoro's own model card grades them lowest and Adam produced
  garbled audio in testing.
- Divine name pronunciation respelling (`Yehovah` → phonetic `Yehovuh`) — tuned twice against real
  listening feedback; the middle "h" turned out to be load-bearing (removing it merges two
  syllables into an unwanted diphthong). Comment in `src/lib/tts/textPrep.ts` records both dead
  ends so they aren't retried.
- Word-highlight timing switched from naive linear interpolation to a weighted model (word length +
  fixed onset + punctuation-pause cost) — closer to real speech cadence, still an approximation
  (true forced alignment would need the `Kokoro-82M-v1.0-ONNX-timestamped` variant, not integrated).
- Progress-bar seek bug fixed — seeking while paused/stopped now actually restarts playback at the
  target verse instead of silently no-opping.
- **Offline-load bug found and fixed**: transformers.js was defaulting to a CDN for the ONNX WASM
  runtime, which CSP correctly blocked. Root cause was `env.backends.onnx.wasm.wasmPaths` never
  being cleared — fixed without loosening CSP at all; the runtime now ships inside the voice pack
  and is served through the existing `berean-model://` protocol.

### Berean Chat (AI Lookup) retrieval — the big one
Baseline this session started from (measured, not assumed): **recall@1 29.8%, MRR 0.319** on a
47-case, then 72-case, hand-verified fixture set. Two real, reproducing bugs were root-caused and
fixed (not just "tuned"):

1. **A double-counting bug in `keywordOverlapScore`** — an archaic-vocabulary bridge (Testament of
   Jacob) was getting credited once per near-synonymous keyword instead of once per underlying
   match, letting an unrelated verse outrank a verbatim KJV answer.
2. **The reported "love"-deletion bug** — `OVERLY_GENERIC_SINGLE_WORDS` was deleting the question's
   only real search term outright. Fixed in two layers: stopped deleting it, then found and fixed a
   *second*, deeper bug — a lone common word could still never mathematically clear the score
   threshold required for canonical (KJV) results, so it kept returning nothing from the primary
   text specifically. Added a fallback so the primary corpus is never silently voiceless.
3. **A real bug in the actual Lexicon search tab**, not just this pipeline: SQL `LIKE` can't match
   diacritics, so "agape" never found "agápē" (G26). Fixed with a JS-side normalized comparison.
   Strong's word-meaning resolution went from ~unmeasured/broken to a newly-added, honest **63%
   (5/8)** metric, with the 3 remaining misses each documented with their specific real cause.
4. Cross-reference reverse indexes added to `cross_references.db`/`tske_refs.db` (confirmed via
   `EXPLAIN QUERY PLAN` — was a full table scan, now uses the index).

**Latest measured harness state** (`npx vitest run --config scripts/eval/vitest.eval.config.ts`,
79 cases — 7 new deliberately-hard "zero-overlap" cases were added late in the session, which is
why the headline number reads lower than earlier in the session despite nothing regressing —
every pre-existing category's per-category number is unchanged):
```
recall@1: 75.9%   recall@3: 83.5%   recall@5: 83.5%   recall@10: 84.8%   MRR: 0.792
modern-wording 94%/100%   thematic 96%/96%   pseudepigrapha 88%/100%
strongs 25%/38%   reference 86%/86%   regression 75%/100%   zero-overlap 0%/29%
```
Re-run that command after any further retrieval change and compare — don't guess.

### Data integrity fixes
- **`enoch.db` chapter 90**: one row held verses 15–42 concatenated, with verses 16 and 19
  *entirely missing* (not just merged — dropped). Re-split against the real Charles translation
  (Wikisource copy, since sacred-texts.com's own file-to-chapter numbering is offset). Verified,
  FTS-integrity-checked.
- **`hermas_taylor.db`**: the *entire last chapter* of both the Mandates (`HER_MAN` ch.24, 32 rows)
  and Similitudes (`HER_SIM` ch.65, 38 rows) divisions were 100% publisher back-matter, not
  scripture at all. Fixed using the actual source PDFs Michael supplied
  (`~/Downloads/shepherd-of-hermas_vol-{1,2}_taylor.pdf`) — page-mapped precisely against the DB's
  continuous chapter numbering. One transcription error (accidentally duplicating one book's
  ending into the other) was caught and corrected during the same session.
- Both main-checkout `data/*.db` files were backed up to `~/Desktop/berean-data-backup-<date>/`
  before any write.

### Notes editor & shell
- Block-drag renderer crash (exit code 6) root-caused to an infinite MutationObserver loop and
  fixed — see `src/components/notes/pm/blockHandles.ts` header comment for the full mechanism.
- Notes editor: code block language/syntax highlighting/copy button, `+` gutter button opens the
  slash menu, bullet glyph live-repaint, expanded Turn-into, keyboard block movement, persisted
  heading collapse.
- **Tab context menu bug** ("duplicate/floating/archive don't work"): root-caused via a real
  render-and-click integration test (`src/components/shell/__tests__/TabBarContextMenu.test.tsx`)
  that proved the React logic was never the problem. Actual cause: Electron's native drag-region
  hit-testing racing against a freshly-portaled menu's own after-the-fact `no-drag` styling. Fixed
  at the root — `body` is now statically `no-drag` from first paint (inherited by every future
  portal, no race possible) — rather than patching the one menu.

---

## Explicitly deferred / open

### 1. Embedding index — partially built, safe to resume
`nomic-embed-text` won a head-to-head vs `mxbai-embed-large` on both recall and speed. Wired as an
additive RRF-fused candidate source, never touching the existing scoring functions. **Honest
result: standalone embedding recall is modest** (~9-17% on the hardest zero-overlap cases), not the
strong lever the motivating "anxiety → Matthew 6:25" example implied — worth having as one more
signal, not a silver bullet.

**The background build process died** (`database is locked` — most likely a collision with a
concurrent harness run reading the same file) after fully finishing `kjva` (36,890/36,890 verses,
the app's default text) and partially finishing `kjv` (4,224/31,102). It did **not** touch `lxx`,
`lxx_brenton`, or the 15 pseudepigrapha texts. The feature degrades cleanly to a no-op when the
index is incomplete/missing, so this isn't a merge blocker — but to finish it:
```
npm run embeddings:build
```
This resumes from where it left off (skips already-embedded verses) rather than starting over.
Expect roughly another 25-30 minutes at the observed rate. **Do not run it at the same time as the
retrieval eval harness** — that's the likely cause of the crash.

Also not done: a full-corpus recall re-measurement (only partial/sample numbers exist right now —
rerun `scripts/eval/semanticEval.ts` once the index is complete), and wiring the finished index
into the shipped app's distribution pipeline (deliberately deferred — that's a product decision,
not a code gap).

### 2. TSKE headings / cross-reference active retrieval — DONE, confirmed after merge
Update: the working agent's final report arrived after the merge described at the top of this
file, but its changes were already captured (they landed in the same worktree commit before the
worktree was removed) — confirmed present on `main`. Status is now fully resolved, not open:
- `searchTskeHeadingCandidates` (TSKE `heading`-column search, `source: 'tske'`) and
  `selectCrossRefAnchors` / `pickTopVotedNeighbors` / `expandCrossRefNeighbors` (vote-weighted
  `cross_references.db` seed-and-expand, depth-1, capped 2/anchor + 6 total, 20-vote floor,
  `source: 'cross-ref-seed'`) are both written and wired into `runLookup`'s `guessCandidates`
  bucket. Neither touches `scoreCandidates`/`keywordOverlapScore`/`canonicalTieRank`/
  `mergeAdjacent`.
- Two real bugs were found and fixed during that work: a structural-lead regression (TSKE/cross-ref
  candidates were briefly able to out-rank real keyword-scored evidence outright, dropping recall@1
  to 63.9%, before being confined to backfill-only room after the real pool is ranked), and a
  vote-double-counting bug (the same edge appears as two DB rows, one per direction; fixed by
  deduping by verse before ranking).
- On the original 72-case fixture set, harness numbers are byte-identical to the pre-existing
  baseline (recall@1 83.3%, MRR 0.860) — this work is additive, not a regression. Two new
  zero-overlap fixtures (`tske-prince-of-peace`, `xref-stripes-healed`) were added and pass; the
  79-case aggregate number quoted earlier in this file is lower only because of the unrelated
  semantic-only zero-overlap cases, not because of anything here.
- Dedicated unit tests exist for the consuming logic:
  `electron/ipc/__tests__/aiLookup.tskeCrossRefWidening.test.ts` (15 tests). **One real, small gap
  remains**: `searchTskeHeadingsByKeywords` itself (`electron/ipc/crossrefs.ts`) — the raw
  LIKE-query/word-boundary filter — has no isolated unit test, only indirect coverage via the eval
  harness and via the (mocked) consuming-logic tests above. Worth adding a small in-memory-table
  test asserting the word-boundary filter rejects a substring-only match (e.g. "do" inside
  "wisdom").
- Judgment calls made, not yet acted on: depth-1 cross-ref expansion only (no evidence gathered on
  deeper hops); TSKE/cross-ref-seed candidates are pure backfill and don't compete for a top-3 slot
  on their own merit — giving them real scoring weight would need a deliberate new input into
  `scoreCandidates`, deferred pending sign-off.

### 3. Retrieval items not started this session
- `guessHasEvidence` fix (a correct verse can still be demoted to score 0 for lacking the model's
  own extracted keywords) — a fixture case for this may already exist; check `zero-overlap`/
  `modern-wording` misses in the harness output.
- Any further ranking-function changes should go through the same discipline used all session:
  reproduce the baseline first, change one thing, remeasure, report the delta including negative
  results. `scoreCandidates`/`keywordOverlapScore`/`canonicalTieRank`/`mergeAdjacent` all carry
  extensive comments documenting past regressions — read them before touching anything there.

### 4. Data — needs Michael, not code
- `enoch.db` chapters 5, 22, 39, 89, 91, 106 have the same class of corruption as chapter 90 (rows
  merged/truncated, and some involve lettered sub-verses like "6a"/"6b" that the current
  `verse_num INTEGER` schema can't represent at all — a schema decision, not a data fix). Not
  touched this session; needs either a reliable verbatim source or a product decision on lettered
  verses before attempting.

### 5. Manual verification still needed (nothing here can be tested without a human)
- **Packaged build end-to-end**: `npm run build:local`, then launch the real `.app`, download the
  Kokoro voice pack, confirm audio actually plays and highlighting tracks correctly. Everything
  above is dev/test-verified only.
- **Tab context menu fix**: confirm Duplicate/Archive/Open-in-floating-tab actually work by hand —
  the root cause (Electron drag-region timing) can't be reproduced in jsdom, only reasoned about
  and fixed at the CSS-inheritance level.
- Cross-reference reverse indexes were applied directly to the **shared** `data/*.db` files (not
  worktree-local) — confirm `main` and the installed app still behave correctly, though this should
  be a pure, idempotent performance improvement with no behavior change.
