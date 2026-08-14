# Zero-result case investigation (Team B, read-only round)

Investigation only — no `electron/` or `src/` files touched. Snapshot timestamps matter here:
`electron/ipc/aiLookup.ts` is being actively edited by `chat-retrieval-2` in this same shared
worktree while this was written, so the numbers below moved substantially *during* this
investigation — see the timeline at the bottom before trusting any single snapshot.

## Method

Added a debug hook to `scripts/eval/runRetrievalEval.ts` (my own file, not product code):
`EVAL_DEBUG=ZERO` prints `keywords` + full `results[]` for any fixture case that returns zero
results; `EVAL_DEBUG_SCORES=1` turns on a debug block that was **already present** in
`aiLookup.ts` itself (`searchKeywords`'s raw-candidate score dump) — I didn't add it, just used
it. For each zero-result case, cross-checked the fixture's `keywords` directly against the real
`kjva.db` FTS5 index with `node:sqlite` (same phrase-mode query `safeFtsQuery` builds) to tell
apart "candidate generation never found it" from "something downstream discarded it."

## Timeline (why the numbers below don't agree with each other)

1. **First snapshot** (right after growing the fixture to 70, before this investigation):
   harness's own miss-list reported 12 cases at 0 results: `mw-gossip`, `th-tithing`,
   `th-circumcision`, `th-false-witness`, `st-agape-greek`, `rg-king`, `mw-laziness`,
   `th-shatnez`, `th-clean-fish`, `th-passover`, `th-unleavened-bread`, `ref-deut64`. (This
   supersedes my earlier message to team-lead, which under-counted at 11 — it omitted
   `mw-gossip`, which was already 0 in the very first 47-case baseline too.)
2. Direct FTS verification at that snapshot: **every one of those 12 keyword phrases hits its
   correct verse exactly** via a raw phrase-mode FTS5 query against `kjva.db` (e.g.
   `"bring ye all the tithes into the storehouse"` → MAL 3:10, 1 hit; `"the king's heart is in
   the hand of the Lord"` → PRO 21:1, 1 hit). So at that snapshot this was NOT a candidate-
   generation failure — the raw FTS layer could find every one of them. The cause had to be
   somewhere in `searchKeywords`'s per-text filtering, `scoreCandidates`/`keywordOverlapScore`,
   or a similar downstream gate — I did not get further before the code moved (see below).
3. **Second snapshot**, minutes later, running the identical harness command with no fixture or
   harness changes on my end: only **2 of the 12** remained at zero (`st-agape-greek`,
   `ref-deut64`). Overall recall@1 had jumped from 32.9% → 75.7%, recall@10 35.7% → 82.9%, MRR
   0.343 → 0.791. Confirmed via 3 repeated runs that this new state is now stable/deterministic
   (not flaky) — the harness itself never introduces nondeterminism (fixed mocked keywords, no
   live Ollama). The only explanation is that `chat-retrieval-2`'s concurrent edits to
   `aiLookup.ts` (2b/2c/2d work) landed on disk between snapshot 1 and snapshot 2 and fixed 10 of
   the 12 cases as a side effect.

**Practical implication:** the 12→2 list I was asked to hand off is already stale by the time
you read this. Re-run `npx vitest run --config scripts/eval/vitest.eval.config.ts` for the
current truth before acting on anything below except the 2 cases diagnosed in detail.

## The 2 cases still at zero as of the second snapshot

### `st-agape-greek` — not a pipeline bug, a bad fixture keyword (see also the `strongs`
category methodology note at the top of `retrievalFixtures.ts`)

Keywords: `['agape', 'love']`. "agape" is a bare Greek transliteration — confirmed zero FTS hits
against `kjva.db`, because the KJV English text never spells it that way. "love" is deleted
outright by `OVERLY_GENERIC_SINGLE_WORDS`. So after filtering, there is no keyword left capable
of matching anything via literal search — by design, this question is only answerable through
`strongsNum` resolution (G26 → gloss "love"), a path this harness's mocked extraction doesn't
feed at all (see the methodology note). Not something to "fix" in the ranking code.

### `ref-deut64` — the KNOWN missing zero-model reference path, not a new bug

Keywords: `[]` (deliberately empty — `ref-*` fixture cases assume a literal-reference question
like "Deut 6:4" should hit a deterministic, zero-Ollama-call parse path, per the mission brief's
Step 3 item "restore the zero-model-call path for references"). That path doesn't exist yet for
a bare reference outside the `QUOTE_TRIGGER` flow (confirmed by reading `runLookup`: the only
zero-model shortcuts before the extraction call are `QUOTE_TRIGGER` and the explicit-note/video
triggers — a plain "Deut 6:4" matches none of them, so it falls through to ordinary keyword
search with an empty keyword list and finds nothing). `ref-john316` (4 results, correct answer
not at top) and `ref-1cor13-range` (4 results, same) are the same underlying gap, just with
enough coincidental non-empty keyword overlap elsewhere to return *something* — `ref-deut64` and
`ref-gen11`/`ref-exodus20` show the two ends of the same missing-path problem (Gen 1:1/Exodus 20
happen to still resolve today, apparently via `cleanWords` picking up the raw question text as
an incidental keyword fallback; Deut 6:4 doesn't). Team-lead already flagged this class of issue
(Step 3) — this is confirmation it's real and reproducible, not a new finding.

## Still open regardless of snapshot: `ref-matt24-quotes` (497 results)

Confirmed present at every snapshot, unaffected by whatever chat-retrieval-2 changed. "what does
Matthew 24 quote" is meant to hit `QUOTE_TRIGGER` → `findReferenceInText` → `runQuoteLookup`
(a bounded, deterministic quote-source lookup), not open-ended keyword search. 497 results
strongly suggests the trigger isn't firing at all and the question falls through to ordinary
(here, essentially keyword-less) search across every text, which for a generic phrase like
"Matthew 24" would flood on partial matches. Worth checking `QUOTE_TRIGGER`'s regex against this
exact phrasing directly before assuming the fix belongs in scoring.

## Current standing (second snapshot, for reference — re-run before trusting)

```
recall@1: 75.7%  recall@3: 82.9%  recall@5: 82.9%  recall@10: 82.9%   MRR: 0.791
modern-wording  n=15 recall@1=93%  recall@10=100%
thematic        n=25 recall@1=92%  recall@10=96%
pseudepigrapha  n=8  recall@1=88%  recall@10=100%
strongs         n=8  recall@1=13%  recall@10=25%   <- see methodology note, half this category
                                                        can't score correctly by design yet
reference       n=7  recall@1=43%  recall@10=43%   <- zero-model reference path still missing
regression      n=7  recall@1=71%  recall@10=86%
```

Remaining misses concentrate almost entirely in `strongs` (6/8) and `reference` (4/7) — thematic,
modern-wording, pseudepigrapha, and regression are now largely solved.
