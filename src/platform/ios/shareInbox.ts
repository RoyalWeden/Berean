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

export async function drainShareInbox(): Promise<number> {
  let items: ShareInboxItem[] = []
  try { items = (await BereanShareInbox.take()).items } catch { return 0 }
  for (const it of items) await routeItem(it).catch((err) => console.warn('[share-inbox] item failed', err))
  return items.length
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
