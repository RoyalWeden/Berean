// Int8 linear quantization for embedding vectors — shared by the build script
// (scripts/build-embedding-index.js) and the runtime query path (electron/embeddings.ts), so both
// sides agree on exactly the same encode/decode math. Pure functions, no I/O, easy to unit test.
//
// Why quantize at all: a float32 embedding is 4 bytes/dimension; nomic-embed-text is 768-dim, so
// float32 storage for the full ~137k-verse corpus is ~137,000 * 768 * 4 bytes ≈ 420MB. Int8 cuts
// that to ~105MB (dimensions) + a few KB of per-vector scale floats — a meaningful size win for a
// dev-machine artifact with no accuracy cost worth caring about here: cosine similarity is scale-
// invariant per vector (each vector carries its OWN scale, dequantized before the dot product), and
// embedding models are used for nearest-neighbor RANKING, not exact reproduction — the ordering
// this produces is empirically indistinguishable from float32 for retrieval purposes at this
// precision (8 bits gives ~1/127 relative resolution per component, far finer than the similarity
// margins that actually flip a ranking).
//
// Why per-vector scale (not one global scale for the whole index): embedding component magnitudes
// vary verse-to-verse (a short one-clause verse vs. a long compound one can have different overall
// vector norms) — a single global scale would either clip the largest vectors or waste resolution
// on the smallest ones. A per-vector max-abs scale keeps every vector using its full int8 range.

/** Quantizes a float32 embedding to Int8 using a symmetric per-vector max-abs scale. Returns the
 *  quantized bytes plus the scale needed to dequantize them back to (approximately) the original
 *  values. A zero vector (all-zero, degenerate) gets scale=1 to avoid a divide-by-zero — its
 *  quantized bytes are all zero either way, so the scale value is moot for it. */
export function quantizeEmbedding(vector: Float64Array | number[]): { bytes: Int8Array; scale: number } {
  let maxAbs = 0
  for (const v of vector) { const a = Math.abs(v); if (a > maxAbs) maxAbs = a }
  const scale = maxAbs === 0 ? 1 : maxAbs / 127
  const bytes = new Int8Array(vector.length)
  for (let i = 0; i < vector.length; i++) {
    bytes[i] = Math.max(-127, Math.min(127, Math.round(vector[i] / scale)))
  }
  return { bytes, scale }
}

/** Inverse of quantizeEmbedding — reconstructs an approximate float vector from quantized bytes
 *  and their scale. Returns a plain Float32Array (not Float64) since the runtime dot product only
 *  ever needs single-precision here, one array class shared by every dequantized vector. */
export function dequantizeEmbedding(bytes: Int8Array, scale: number): Float32Array {
  const out = new Float32Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] * scale
  return out
}

/** Cosine similarity between two dequantized (or otherwise same-length float) vectors. Pure math,
 *  no allocation beyond the return value — called once per candidate in a brute-force scan, so
 *  kept allocation-free in the hot loop (the caller loops over many candidates; this function
 *  itself only touches its two input arrays). */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}
