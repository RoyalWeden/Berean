import { net } from 'electron'
import { getEmbeddingsDb } from './db/embeddingsDb'
import { dequantizeEmbedding, cosineSimilarity } from './embeddingQuantize'

// Query-time semantic (embedding) retrieval — the runtime counterpart to
// scripts/build-embedding-index.js, which builds electron/db-generated/verse_embeddings.db ahead
// of time. This file only ever READS that index (brute-force cosine scan, see semanticSearch
// below) and embeds the user's OWN question text via local Ollama — it never writes to the index.
//
// Model must match whatever the index was built with (see EMBEDDING_MODEL below and the build
// script's own header for the nomic-embed-text vs mxbai-embed-large comparison that picked it) —
// a query embedded with a different model lives in an unrelated vector space and cosine similarity
// against it is meaningless, not just "less accurate."
const OLLAMA_BASE = 'http://localhost:11434'

// nomic-embed-text won the head-to-head comparison against mxbai-embed-large on the eval harness's
// own modern-wording/thematic fixture questions — smaller (274MB vs 670MB), ~2.4x faster to embed
// with, AND better recall (see scripts/build-embedding-index.js's header for the actual measured
// numbers, including the honest caveat that BOTH models' raw recall on this task is modest).
export const EMBEDDING_MODEL = 'nomic-embed-text'

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await net.fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** Embeds a single string via Ollama's /api/embed endpoint. Throws on any failure (Ollama not
 *  running, model not pulled, network hiccup, timeout) — every caller in this file treats semantic
 *  search as best-effort and catches around it (see gatherSemanticCandidates in aiLookup.ts), the
 *  same trust model runOllamaJson/runOllamaText already use for the rest of AI Lookup. */
export async function embedQuery(text: string, model = EMBEDDING_MODEL, timeoutMs = 10_000): Promise<Float32Array> {
  const res = await fetchWithTimeout(`${OLLAMA_BASE}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: text }),
  }, timeoutMs)
  if (!res.ok) throw new Error(`Ollama embed request failed: ${res.status}`)
  const data = await res.json() as { embeddings: number[][] }
  const vec = data.embeddings?.[0]
  if (!vec) throw new Error('Ollama embed response had no embedding')
  return Float32Array.from(vec)
}

export interface SemanticHit {
  textId: string
  bookId: string
  chapter: number
  verseNum: number
  score: number
}

interface LoadedIndex {
  textId: string[]
  bookId: string[]
  chapter: Int32Array
  verseNum: Int32Array
  vectors: Float32Array[] // dequantized once at load time — see the comment below on why
}

// Cached in memory for the lifetime of the main process — dequantizing ~137k int8 rows into
// Float32Array up front (once) is far cheaper overall than re-dequantizing on every query, and the
// dequantized footprint (~137k * 768 * 4 bytes ≈ 420MB) comfortably fits this app's existing memory
// budget on the target 32GB dev machine (see the mission brief's machine facts). Lazily built on
// first use, not at module load — most app sessions never touch AI Lookup at all, let alone the
// semantic path specifically, so paying this cost eagerly at startup would be pure waste for them.
let cachedIndex: LoadedIndex | null | undefined // undefined = not yet attempted

function loadIndex(): LoadedIndex | null {
  if (cachedIndex !== undefined) return cachedIndex
  const db = getEmbeddingsDb()
  if (!db) { cachedIndex = null; return null }
  try {
    const rows = db.prepare('SELECT text_id, book_id, chapter, verse_num, scale, vector FROM embeddings').all() as Array<{
      text_id: string; book_id: string; chapter: number; verse_num: number; scale: number; vector: Buffer
    }>
    const n = rows.length
    const textId = new Array<string>(n)
    const bookId = new Array<string>(n)
    const chapter = new Int32Array(n)
    const verseNum = new Int32Array(n)
    const vectors = new Array<Float32Array>(n)
    for (let i = 0; i < n; i++) {
      const r = rows[i]
      textId[i] = r.text_id
      bookId[i] = r.book_id
      chapter[i] = r.chapter
      verseNum[i] = r.verse_num
      // Buffer -> Int8Array over the SAME underlying bytes (no copy) — quantizeEmbedding on the
      // build side wrote raw two's-complement int8 bytes, which is exactly what Int8Array reads.
      const bytes = new Int8Array(r.vector.buffer, r.vector.byteOffset, r.vector.byteLength)
      vectors[i] = dequantizeEmbedding(bytes, r.scale)
    }
    cachedIndex = { textId, bookId, chapter, verseNum, vectors }
  } catch {
    cachedIndex = null
  }
  return cachedIndex
}

/** Brute-force cosine-similarity top-K search over the whole in-memory index (or, when
 *  `restrictToTextId` is set, only that one text's rows — used when a focus text is already known,
 *  e.g. a question that named "Jubilees" by name, to both cut scan time and avoid a semantically-
 *  similar-but-wrong-text false positive). Returns null (not an empty array) when the index isn't
 *  built yet, so callers can distinguish "ran and found nothing" from "unavailable."
 *
 *  `restrictToBookIds`, when set, additionally drops any row whose `bookId` isn't in the set — the
 *  same book-list scoping aiLookup.ts's keyword search already supports for a named book/testament
 *  (e.g. "old testament"), now available on the semantic side too since `bookId` is already stored
 *  per row here. */
export function semanticSearch(queryVec: Float32Array, topK: number, restrictToTextId?: string, restrictToBookIds?: string[]): SemanticHit[] | null {
  const index = loadIndex()
  if (!index) return null
  const { textId, bookId, chapter, verseNum, vectors } = index
  const bookFilter = restrictToBookIds && restrictToBookIds.length > 0 ? new Set(restrictToBookIds) : null
  const scored: SemanticHit[] = []
  for (let i = 0; i < vectors.length; i++) {
    if (restrictToTextId && textId[i] !== restrictToTextId) continue
    if (bookFilter && !bookFilter.has(bookId[i])) continue
    scored.push({ textId: textId[i], bookId: bookId[i], chapter: chapter[i], verseNum: verseNum[i], score: cosineSimilarity(queryVec, vectors[i]) })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK)
}

/** True once the index has been built and successfully loaded — lets a caller skip the embedding
 *  API call entirely when there's nothing to search against, rather than paying for a network
 *  round-trip whose result can never be used. */
export function hasEmbeddingIndex(): boolean {
  return loadIndex() !== null
}

/** Test-only escape hatch, mirroring resetEmbeddingsDbCache. */
export function resetEmbeddingIndexCache(): void {
  cachedIndex = undefined
}
