/**
 * Read Aloud (TTS) — pure cache-bookkeeping logic for the Kokoro synthesized-audio cache.
 * No fs/IPC here on purpose: `electron/ipc/ttsAudioCache.ts` is the only thing that actually
 * touches disk (writing WAV blobs under `{userData}/tts-audio-cache/`), and it delegates the
 * "which entries should survive" decision to `planEviction` below so that decision is testable
 * without spinning up Electron at all.
 */

/** One cached chunk of synthesized audio: a chapter+voice+backend combination, keyed by
 *  `cacheKeyFor` below — same for text (chapter/textId), and the backend id itself so a future
 *  second neural backend can't collide with Kokoro's own cache entries.
 *
 *  Deliberately has NO rate field. Kokoro always synthesizes at its own best (1x) quality —
 *  user-facing playback speed is applied afterward via `HTMLAudioElement.playbackRate` +
 *  `preservesPitch`, not baked into synthesis (see kokoroBackend.ts's file header for why) — so
 *  the SAME cached audio is correct at every rate; a rate dimension here would only fragment the
 *  cache with duplicate, byte-identical entries. */
export interface AudioCacheKeyParts {
  backendId: string
  textId: string
  bookId: string
  chapter: number
  voiceURI: string
  /** A cheap (non-cryptographic) hash of the actual spoken text — see `hashText`. Included so
   *  changing a word-replacer rule (e.g. "LORD" → "Yehovah") naturally invalidates any
   *  previously-cached audio for that chapter instead of silently serving stale narration that
   *  no longer matches what's on screen. */
  contentHash: string
}

/** Cheap, deterministic, non-cryptographic string hash (djb2 variant) — good enough to bust a
 *  cache key when spoken text changes; NOT a security/integrity hash. Kept tiny and dependency-
 *  free rather than pulling in a real hash library for what's just cache-key fragmentation
 *  avoidance. */
export function hashText(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** Deterministic, filesystem-safe cache key. Voice/text ids are lowercased+sanitized so the key
 *  is safe to use directly as a filename component on every OS Berean ships for. */
export function cacheKeyFor(parts: AudioCacheKeyParts): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, '_')
  return [
    safe(parts.backendId),
    safe(parts.textId),
    safe(parts.bookId),
    String(parts.chapter),
    safe(parts.voiceURI),
    safe(parts.contentHash),
  ].join('__')
}

export interface AudioCacheEntry {
  key: string
  sizeBytes: number
  lastAccessedAt: number
}

/**
 * Decide which existing entries to evict (oldest `lastAccessedAt` first) so that, after adding
 * `incomingSizeBytes` worth of new audio, total cache size stays at or under `capBytes`.
 *
 * Pure and side-effect-free: returns the list of keys the caller should delete, in eviction
 * order. Does NOT mutate `entries`. If `incomingSizeBytes` alone exceeds `capBytes`, every
 * existing entry is returned for eviction (the new entry still won't fit, which is the caller's
 * problem — e.g. skip caching a chapter larger than the whole cap rather than thrash).
 */
export function planEviction(
  entries: AudioCacheEntry[],
  incomingSizeBytes: number,
  capBytes: number,
): string[] {
  if (capBytes <= 0) return entries.map((e) => e.key)
  const currentTotal = entries.reduce((sum, e) => sum + e.sizeBytes, 0)
  let overBy = currentTotal + incomingSizeBytes - capBytes
  if (overBy <= 0) return []

  const byAge = [...entries].sort((a, b) => a.lastAccessedAt - b.lastAccessedAt)
  const evict: string[] = []
  for (const entry of byAge) {
    if (overBy <= 0) break
    evict.push(entry.key)
    overBy -= entry.sizeBytes
  }
  return evict
}

/**
 * Serializes one synthesized chunk's raw audio for disk storage: a 4-byte little-endian
 * sample-rate header followed by the raw float32 PCM bytes, verbatim. Deliberately not a real
 * WAV/RIFF container — see ttsAudioCache.ts's file header for why a full format would be
 * needless overhead for a cache nothing outside Berean ever reads.
 */
export function encodeCachedChunk(samplingRate: number, samples: Float32Array): ArrayBuffer {
  const out = new ArrayBuffer(4 + samples.byteLength)
  new DataView(out).setUint32(0, samplingRate, true)
  new Float32Array(out, 4).set(samples)
  return out
}

/** Inverse of `encodeCachedChunk`. */
export function decodeCachedChunk(buffer: ArrayBuffer): { samplingRate: number; samples: Float32Array } {
  const samplingRate = new DataView(buffer).getUint32(0, true)
  // Float32Array's constructor requires its byteOffset to be a multiple of 4, which offset 4
  // always is — safe to view directly over the same buffer without copying.
  const samples = new Float32Array(buffer, 4)
  return { samplingRate, samples }
}

/** Default cache cap: 500MB. A handful of full chapters at a time — plenty for normal reading
 *  sessions without silently eating a meaningful chunk of the user's disk. Exported so
 *  AudioSection.tsx's "clear audio cache" UI and the eviction planner agree on the same number
 *  without either hardcoding it separately. */
export const DEFAULT_AUDIO_CACHE_CAP_BYTES = 500 * 1024 * 1024
