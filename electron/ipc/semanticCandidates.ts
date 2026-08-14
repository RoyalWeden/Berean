import { embedQuery, semanticSearch, hasEmbeddingIndex } from '../embeddings'
import { reciprocalRankFusion } from '../rrf'

// Query-time glue between the embedding index (electron/embeddings.ts) and aiLookup.ts's existing
// keyword-search pipeline — deliberately its own small file, not folded into aiLookup.ts's own
// ~3000 lines, both for testability (mocking embeddings.ts here is trivial) and to keep the actual
// edit inside aiLookup.ts's runLookup to the smallest possible footprint (see that file's own
// integration point, right after keywordCandidates is gathered) — other work is concurrently
// touching that file this round.

export interface SemanticCandidateRef {
  textId: string
  bookId: string
  chapter: number
  verseNum: number
}

function keyOf(h: { textId: string; bookId: string; chapter: number; verseNum: number }): string {
  return `${h.textId}|${h.bookId}|${h.chapter}|${h.verseNum}`
}

/** Embeds the question, runs a brute-force cosine top-K over the pre-built index, and fuses that
 *  ranking with the ALREADY-COMPUTED keyword-search ranking (`keywordRankedKeys`, in whatever
 *  order aiLookup.ts's own searchKeywords returned them — a reasonable relevance-ordered proxy
 *  even though it's not a formally scored list) via Reciprocal Rank Fusion (see electron/rrf.ts).
 *  Returns bare references only — NOT full AiLookupResult objects — in fused order, already
 *  filtered against `alreadySeenKeys` and capped at `resultCap`; the caller re-fetches real verse
 *  text for whichever of these it keeps (same "never trust a reference without re-verifying
 *  against the real DB" principle every other candidate source in aiLookup.ts already follows —
 *  this file has no DB access of its own by design).
 *
 * Embeds the RAW QUESTION text, not the extracted keywords. The extraction prompt
 * (extractionPrompt in aiLookup.ts) deliberately biases keywords toward literal KJV-era wording
 * ("Jesus" not "Yeshua", "Holy Ghost" not "Holy Spirit", archaic phrasing for pseudepigrapha) —
 * exactly right for FTS5 phrase search, exactly wrong for an embedding: re-encoding an
 * already-literal-biased phrase would just rediscover what keyword search already finds, missing
 * the entire class of question this feature exists to catch (modern wording with NO literal
 * overlap at all, e.g. "anxiety" -> Matthew 6:25's "take no thought", zero shared words). The raw
 * question carries the user's actual semantic intent; the keyword layer's KJV-wording bias is a
 * lexical-search-only concern that has no business also constraining the embedding.
 *
 * Best-effort throughout — returns [] (never throws) whenever the index isn't built yet, Ollama
 * isn't running, the embedding model isn't pulled, or the call times out. Semantic search is an
 * ADDITIVE signal on top of an already-working keyword pipeline, never a hard dependency of AI
 * Lookup succeeding at all. */
export async function gatherSemanticCandidates(
  question: string,
  keywordRankedKeys: string[],
  alreadySeenKeys: Set<string>,
  opts: { restrictToTextId?: string | null; topK?: number; resultCap?: number } = {},
): Promise<SemanticCandidateRef[]> {
  if (!hasEmbeddingIndex()) return []

  let queryVec: Float32Array
  try {
    queryVec = await embedQuery(question)
  } catch {
    return []
  }

  const hits = semanticSearch(queryVec, opts.topK ?? 20, opts.restrictToTextId ?? undefined)
  if (!hits || hits.length === 0) return []

  const semanticRankedKeys = hits.map(keyOf)
  const fused = reciprocalRankFusion([keywordRankedKeys, semanticRankedKeys], (k: string) => k)
  const byKey = new Map(hits.map((h) => [keyOf(h), h]))

  const resultCap = opts.resultCap ?? 5
  const out: SemanticCandidateRef[] = []
  for (const { key } of fused) {
    if (out.length >= resultCap) break
    if (alreadySeenKeys.has(key)) continue
    const hit = byKey.get(key)
    // A fused key with no entry in `byKey` came from `keywordRankedKeys` only (fusion sees BOTH
    // lists) — nothing new to surface for it here, the keyword pipeline already has it.
    if (!hit) continue
    out.push({ textId: hit.textId, bookId: hit.bookId, chapter: hit.chapter, verseNum: hit.verseNum })
  }
  return out
}
