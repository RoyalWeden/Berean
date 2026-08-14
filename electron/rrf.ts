// Reciprocal Rank Fusion — the standard, hand-tuning-free way to merge two or more ranked lists
// that live on incomparable scales (FTS5 bm25-ish keyword-overlap scores vs. cosine similarity)
// into one combined ordering. Deliberately generic over an item's own type via a caller-supplied
// key function, rather than baked to AiLookupResult, so this stays a pure, independently-testable
// unit with no dependency on aiLookup.ts's own types (see electron/ipc/aiLookup.ts's call site
// for how it's actually used to fuse keyword- and semantic-ranked verse lists).
//
// Formula (from Cormack, Clarke & Buettcher 2009, "Reciprocal Rank Fusion outperforms Condorcet
// and individual Rank Learning Methods"): for each item, sum 1/(k + rank) over every ranked list
// it appears in (1-indexed rank; an item absent from a list contributes 0 for that list). k=60 is
// the paper's own empirically-chosen default — large enough that rank 1 vs rank 2 in a single list
// isn't wildly more valuable than appearing at all in a SECOND list, which is the whole point of
// fusing two differently-reliable signals instead of trusting either alone.
const DEFAULT_K = 60

/** One ranked list to fuse — order matters (index 0 = most relevant); ties within a single list
 *  aren't represented, so pre-sort each list by whatever that list's own relevance metric is
 *  before passing it in. */
export type RankedList<T> = T[]

/** Fuses any number of ranked lists into a single combined ordering via Reciprocal Rank Fusion.
 *  `keyOf` extracts the identity used to recognize "the same item" across lists (e.g. a verse's
 *  dedupe key) — lists may use structurally different item types as long as `keyOf` normalizes
 *  them to the same key space; callers needing every item back (not just its key) can look up the
 *  original items after fusing via a Map keyed the same way. Returns entries sorted by descending
 *  fused score, one entry per distinct key. */
export function reciprocalRankFusion<T>(
  lists: Array<RankedList<T>>,
  keyOf: (item: T) => string,
  k = DEFAULT_K,
): Array<{ key: string; score: number }> {
  const scores = new Map<string, number>()
  for (const list of lists) {
    list.forEach((item, i) => {
      const key = keyOf(item)
      const rank = i + 1 // 1-indexed, per the standard RRF formula
      scores.set(key, (scores.get(key) ?? 0) + 1 / (k + rank))
    })
  }
  return [...scores.entries()]
    .map(([key, score]) => ({ key, score }))
    .sort((a, b) => b.score - a.score)
}
