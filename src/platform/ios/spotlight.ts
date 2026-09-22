import { BereanSpotlight } from './plugins'
import { iosServiceContext, iosServices } from './services'
import { formatDeepLink } from '../../lib/deepLinks'
import { openIosDeepLink } from './deepLinks'
import { stripMarkdownFormatting } from '../../lib/notePreviewText'

/**
 * Keeps Core Spotlight in step with the notes table (R093): a full index at boot (throttled to
 * once per launch), then incremental updates on `data:changed` for notes (debounced). Tapping a
 * result is a deep link (`berean://note/<id>`) routed through the shared router.
 */
let timer: ReturnType<typeof setTimeout> | null = null
const dirty = new Set<string>()
let removeAll = false

async function indexNotes(ids?: string[]): Promise<void> {
  const notes = await iosServices().notes.getAll(2000, 0)
  const wanted = ids ? notes.filter((n) => ids.includes(n.id)) : notes
  const items = wanted.filter((n) => !n.deletedAt).map((n) => ({
    url: formatDeepLink({ kind: 'note', noteId: n.id }),
    title: n.title || 'Untitled note',
    text: stripMarkdownFormatting(n.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 600),
    keywords: ['Berean', 'note', ...(n.tags ?? []), ...(n.verseRef ? [n.verseRef.replace(/\./g, ' ')] : [])],
    updatedAt: n.updatedAt,
  }))
  if (items.length) await BereanSpotlight.index({ items })
  if (ids) {
    const gone = ids.filter((id) => !wanted.some((n) => n.id === id) || wanted.find((n) => n.id === id)?.deletedAt)
    if (gone.length) await BereanSpotlight.remove({ urls: gone.map((id) => formatDeepLink({ kind: 'note', noteId: id })) })
  }
}

export async function installIosSpotlight(): Promise<void> {
  try {
    const { available } = await BereanSpotlight.isAvailable()
    if (!available) return
  } catch { return }
  await BereanSpotlight.addListener('open', ({ url }) => { openIosDeepLink(url) }).catch(() => {})
  void indexNotes().catch((err) => console.warn('[spotlight] initial index failed', err))
  iosServiceContext().events.on('data:changed', (c) => {
    if (c.entity !== 'note') return
    if (c.op === 'bulk' || !c.id) removeAll = true; else dirty.add(c.id)
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      const ids = removeAll ? undefined : [...dirty]
      dirty.clear(); removeAll = false
      void (ids ? indexNotes(ids) : BereanSpotlight.clear().then(() => indexNotes())).catch(() => {})
    }, 2000)
  })
}
