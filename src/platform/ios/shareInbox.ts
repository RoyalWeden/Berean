import { BereanShareInbox, type ShareInboxItem } from './plugins'
import { parseRef } from '../../lib/parseRef'
import { formatDeepLink } from '../../lib/deepLinks'
import { openIosDeepLink } from './deepLinks'
import { iosServiceContext, iosServices } from './services'
import { Filesystem, Directory } from '@capacitor/filesystem'

/**
 * "Open in Berean" (R092): drains the Share Extension inbox when the app is opened with
 * `berean://share` or returns to the foreground, and routes each item:
 *   - text that parses as a scripture reference → the passage
 *   - a YouTube link → the video
 *   - other text / links → a new note holding it
 *   - a PDF → imported into the library (SHA-256 matched like every other import)
 */
const YT = /(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/

/** Ids handled already (a kill between handling and ack must not create the note twice). */
const DONE_KEY = 'shareInboxHandled'
const DONE_MAX = 200
/** An item that keeps failing is given up (and acked) after this many drains. */
const MAX_ATTEMPTS = 3
const attempts = new Map<string, number>()
let draining: Promise<number> | null = null

/**
 * Drain the inbox (DATA-SHARE-001): each item is handled, recorded as handled, then acknowledged
 * (removed from the App Group). A failure leaves the item for the next drain; an app kill at any
 * point loses nothing and never handles an item twice.
 */
export function drainShareInbox(): Promise<number> {
  if (draining) return draining
  draining = (async () => {
    let items: ShareInboxItem[] = []
    try { items = (await BereanShareInbox.take()).items } catch { return 0 }
    if (!items.length) return 0
    const settings = iosServices().settings
    const done = new Set<string>(((await settings.get(DONE_KEY).catch(() => null)) as string[] | null) ?? [])
    const ack: string[] = [], files: string[] = []
    for (const it of items) {
      const id = it.id ?? `${it.kind}-${it.receivedAt ?? 0}`
      if (!done.has(id)) {
        try {
          await routeItem(it)
        } catch (err) {
          const n = (attempts.get(id) ?? 0) + 1
          attempts.set(id, n)
          console.warn(`[share-inbox] item failed (attempt ${n})`, err instanceof Error ? err.message : String(err))
          if (n < MAX_ATTEMPTS) continue
        }
        done.add(id)
        await settings.set(DONE_KEY, [...done].slice(-DONE_MAX)).catch(() => {})
      }
      ack.push(id)
      if (it.file) files.push(it.file)
    }
    if (ack.length) await BereanShareInbox.ack({ ids: ack, files }).catch(() => {})
    return ack.length
  })().finally(() => { draining = null })
  return draining
}

async function routeItem(it: ShareInboxItem): Promise<void> {
  if (it.kind === 'url' && it.url) {
    const m = it.url.match(YT)
    if (m) { openIosDeepLink(formatDeepLink({ kind: 'video', videoId: m[1] })); return }
    const ref = parseRef(it.url)
    if (ref) { openIosDeepLink(formatDeepLink({ kind: 'verse', bookId: ref.bookId, chapter: ref.chapter, verse: ref.verse, endVerse: ref.endVerse })); return }
    await noteFrom('Shared link', it.url); return
  }
  if (it.kind === 'text' && it.text) {
    const t = it.text.trim()
    const ref = parseRef(t)
    if (ref && t.length < 40) { openIosDeepLink(formatDeepLink({ kind: 'verse', bookId: ref.bookId, chapter: ref.chapter, verse: ref.verse, endVerse: ref.endVerse })); return }
    const m = t.match(YT)
    if (m && t.length < 120) { openIosDeepLink(formatDeepLink({ kind: 'video', videoId: m[1] })); return }
    await noteFrom(t.split('\n')[0].slice(0, 80), t); return
  }
  if (it.kind === 'pdf' && it.file) {
    const { base64, bytes } = await BereanShareInbox.readFile({ file: it.file })
    const raw = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    const digest = await crypto.subtle.digest('SHA-256', raw)
    const fileHash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
    const ctx = iosServiceContext()
    const pdf = iosServices().pdf
    const existing = await pdf.findByHash(fileHash)
    const id = existing?.id ?? ctx.uuid()
    const filename = `${id}.pdf`
    await Filesystem.writeFile({ path: `Berean/pdfs/${filename}`, directory: Directory.Library, data: base64, recursive: true })
    if (existing) await pdf.attachFile(existing.id, filename, bytes, fileHash)
    else await pdf.insert({ id, title: it.name || 'Shared PDF', filename, fileSize: bytes, importedAt: ctx.now(), fileHash })
    openIosDeepLink(formatDeepLink({ kind: 'pdf', pdfId: id }))
  }
}

async function noteFrom(title: string, body: string): Promise<void> {
  const r = await iosServices().notes.create({ type: 'general', title, content: body })
  if (r.success && r.note) openIosDeepLink(formatDeepLink({ kind: 'note', noteId: r.note.id }))
}

export function installIosShareInbox(): void {
  void drainShareInbox()
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void drainShareInbox() })
}
