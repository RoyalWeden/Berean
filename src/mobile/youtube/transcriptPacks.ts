import { BereanDownloads } from '@/platform/ios/plugins'
import { mergeTranscriptPack } from '@/platform/services/youtubeIndexMerge'
import { iosServiceContext } from '@/platform/ios/services'

/**
 * Transcript packs on the phone (D-007): the bundled manifest lists one pack per channel; a pack
 * is downloaded on demand (native, resumable, cancellable), verified against the manifest's
 * SHA-256, merged into berean.db through the same tables and FTS triggers as desktop, then the
 * file is deleted. Never touches iCloud. The base URL is a setting (`transcriptPacksBaseUrl`);
 * the default points at the GitHub release the developer publishes with
 * scripts/data/publish-transcripts.sh.
 */
export interface PackManifest {
  format: number
  seedVersion: number
  generatedAt: string
  index: { file: string; bytes: number; sha256: string }
  packs: Array<{ channelHandle: string; channelName: string; file: string; bytes: number; sha256: string; videos: number; segments: number }>
}
export type PackState =
  | { kind: 'idle' }
  | { kind: 'downloading'; received: number; total: number }
  | { kind: 'verifying' }
  | { kind: 'merging' }
  | { kind: 'done'; videos: number; segments: number }
  | { kind: 'error'; message: string; resumable: boolean }

const DEFAULT_BASE = (seedVersion: number) => `https://github.com/RoyalWeden/Berean/releases/download/transcripts-v${seedVersion}/`

let manifestCache: PackManifest | null | undefined
export async function loadPackManifest(): Promise<PackManifest | null> {
  if (manifestCache !== undefined) return manifestCache
  try {
    const r = await fetch('./youtube_transcripts.manifest.json')
    manifestCache = r.ok ? (await r.json()) as PackManifest : null
  } catch { manifestCache = null }
  return manifestCache
}

export async function packsBaseUrl(seedVersion: number): Promise<string> {
  const row = await iosServiceContext().userDb.get<{ value: string }>("SELECT value FROM settings WHERE key = 'transcriptPacksBaseUrl'")
  const custom = row ? (JSON.parse(row.value) as string | null) : null
  const base = custom && custom.trim() ? custom.trim() : DEFAULT_BASE(seedVersion)
  return base.endsWith('/') ? base : `${base}/`
}

type Listener = (state: PackState) => void
const listeners = new Map<string, Set<Listener>>()
const states = new Map<string, PackState>()
let installed = false

function setState(id: string, s: PackState) {
  states.set(id, s)
  for (const cb of listeners.get(id) ?? []) cb(s)
}
export function packState(id: string): PackState { return states.get(id) ?? { kind: 'idle' } }
export function subscribePack(id: string, cb: Listener): () => void {
  const set = listeners.get(id) ?? new Set()
  set.add(cb); listeners.set(id, set)
  return () => { set.delete(cb) }
}

const expected = new Map<string, { sha256: string; name: string }>()

async function install(): Promise<void> {
  if (installed) return
  installed = true
  await BereanDownloads.addListener('progress', (e) => setState(e.id, { kind: 'downloading', received: e.received, total: e.total }))
  await BereanDownloads.addListener('error', (e) => setState(e.id, { kind: 'error', message: e.message, resumable: !!e.resumable }))
  await BereanDownloads.addListener('cancelled', (e) => setState(e.id, e.resumable ? { kind: 'error', message: 'Paused', resumable: true } : { kind: 'idle' }))
  await BereanDownloads.addListener('done', async (e) => {
    const exp = expected.get(e.id)
    setState(e.id, { kind: 'verifying' })
    if (exp && exp.sha256 !== e.sha256) {
      await BereanDownloads.remove({ name: e.name }).catch(() => {})
      setState(e.id, { kind: 'error', message: 'Integrity check failed (the file did not match the manifest) — try again', resumable: false })
      return
    }
    setState(e.id, { kind: 'merging' })
    try {
      const r = await mergeTranscriptPack(iosServiceContext().userDb, e.path)
      await BereanDownloads.remove({ name: e.name }).catch(() => {})
      iosServiceContext().events.emit('data:changed', { entity: 'youtube_transcript', op: 'bulk' })
      setState(e.id, { kind: 'done', videos: r.videos, segments: r.segments })
    } catch (err) {
      setState(e.id, { kind: 'error', message: `Merge failed: ${err instanceof Error ? err.message : String(err)}`, resumable: false })
    }
  })
}

export async function downloadPack(m: PackManifest, pack: PackManifest['packs'][number]): Promise<void> {
  await install()
  const id = `pack-${pack.channelHandle}`
  expected.set(id, { sha256: pack.sha256, name: pack.file })
  setState(id, { kind: 'downloading', received: 0, total: pack.bytes })
  const base = await packsBaseUrl(m.seedVersion)
  try {
    await BereanDownloads.start({ id, url: `${base}${encodeURIComponent(pack.file)}`, name: pack.file })
  } catch (err) {
    setState(id, { kind: 'error', message: err instanceof Error ? err.message : String(err), resumable: false })
  }
}
export async function cancelPack(pack: PackManifest['packs'][number]): Promise<void> {
  await install()
  await BereanDownloads.cancel({ id: `pack-${pack.channelHandle}` }).catch(() => {})
}
