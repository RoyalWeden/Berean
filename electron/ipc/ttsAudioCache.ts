/**
 * Read Aloud (TTS) — persistent cache of Kokoro-synthesized chapter audio, keyed by
 * `cacheKeyFor()` (src/lib/tts/kokoro/audioCacheStore.ts): re-reading the same chapter in the
 * same voice/rate never re-synthesizes. Eviction policy itself (LRU, size-capped) is the pure
 * `planEviction()` from that same file — this module's only job is the actual disk I/O and
 * feeding it real entry metadata.
 *
 * Stored under `{userData}/tts-audio-cache/<key>.pcm` as a tiny custom container — a 4-byte
 * little-endian sample-rate header followed by raw float32 PCM samples (see
 * kokoroBackend.ts's `encodeCachedChunk`/`decodeCachedChunk`) — rather than a real WAV file:
 * the renderer already has the exact Float32Array Kokoro produced (from the worker, see
 * kokoro.worker.ts) and just needs it back byte-for-byte to feed straight into
 * `AudioBuffer.copyToChannel`, so a full RIFF/WAV header would be pure overhead here with no
 * consumer that needs it (nothing outside Berean ever reads these files). A single `index.json`
 * sidecar tracks size/lastAccessedAt per key.
 */
import type { IpcMain } from 'electron'
import { app } from 'electron'
import { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'fs'
import { join } from 'path'
import { planEviction, DEFAULT_AUDIO_CACHE_CAP_BYTES, type AudioCacheEntry } from '../../src/lib/tts/kokoro/audioCacheStore'

function cacheDir(): string {
  return join(app.getPath('userData'), 'tts-audio-cache')
}
function indexPath(): string {
  return join(cacheDir(), 'index.json')
}
function fileFor(key: string): string {
  return join(cacheDir(), `${key}.pcm`)
}

function readIndex(): AudioCacheEntry[] {
  try { return JSON.parse(readFileSync(indexPath(), 'utf8')) as AudioCacheEntry[] } catch { return [] }
}
function writeIndex(entries: AudioCacheEntry[]): void {
  writeFileSync(indexPath(), JSON.stringify(entries))
}

export function registerTTSAudioCacheHandlers(ipcMain: IpcMain): void {
  try { mkdirSync(cacheDir(), { recursive: true }) } catch { /* best-effort */ }

  ipcMain.handle('ttsAudioCache:get', (_e, key: string) => {
    const path = fileFor(key)
    if (!existsSync(path)) return null
    const entries = readIndex()
    const entry = entries.find((en) => en.key === key)
    // Bump lastAccessedAt on read so LRU eviction actually reflects recency of USE, not just
    // recency of synthesis — a chapter re-read every day should never be the one evicted just
    // because it was originally cached weeks ago.
    if (entry) {
      entry.lastAccessedAt = Date.now()
      writeIndex(entries)
    }
    return readFileSync(path).buffer
  })

  ipcMain.handle('ttsAudioCache:put', (_e, key: string, data: ArrayBuffer) => {
    const bytes = Buffer.from(data)
    writeFileSync(fileFor(key), bytes)
    let entries = readIndex().filter((en) => en.key !== key)
    const toEvict = planEviction(entries, bytes.byteLength, DEFAULT_AUDIO_CACHE_CAP_BYTES)
    for (const evictKey of toEvict) {
      try { unlinkSync(fileFor(evictKey)) } catch { /* already gone */ }
    }
    entries = entries.filter((en) => !toEvict.includes(en.key))
    entries.push({ key, sizeBytes: bytes.byteLength, lastAccessedAt: Date.now() })
    writeIndex(entries)
    return true
  })

  ipcMain.handle('ttsAudioCache:clear', () => {
    const entries = readIndex()
    for (const entry of entries) {
      try { unlinkSync(fileFor(entry.key)) } catch { /* already gone */ }
    }
    writeIndex([])
    return true
  })

  ipcMain.handle('ttsAudioCache:stats', () => {
    const entries = readIndex()
    return {
      entryCount: entries.length,
      totalBytes: entries.reduce((sum, e) => sum + e.sizeBytes, 0),
      capBytes: DEFAULT_AUDIO_CACHE_CAP_BYTES,
    }
  })
}

// Best-effort startup integrity pass: drop any index entry whose file no longer exists on disk
// (e.g. the user deleted the cache dir by hand) so stats()/eviction math never counts phantom
// entries. Exported for tests; not auto-run at import time (mirrors ttsModel.ts's pattern of
// doing fs setup inside the register function, once `app` is guaranteed ready).
export function pruneMissingEntries(): void {
  const entries = readIndex().filter((e) => {
    try { statSync(fileFor(e.key)); return true } catch { return false }
  })
  writeIndex(entries)
}
