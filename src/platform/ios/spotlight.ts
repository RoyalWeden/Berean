import { BereanSpotlight } from './plugins'
import { iosServiceContext, iosServices } from './services'
import { formatDeepLink } from '../../lib/deepLinks'
import { openIosDeepLink } from './deepLinks'
import { stripMarkdownFormatting } from '../../lib/notePreviewText'
import { bookName, normalizeBookName } from '../../lib/parseRef'
import { TRANSLATIONS } from '../../lib/bibleTexts'
import { useAppStore } from '../../store'

/**
 * Keeps Core Spotlight in step with the user's data (R093): notes, tab sessions, saved
 * workspaces, and the books + chapters of the default translation (not verses — that would be
 * ~40,000 items for one text and Spotlight is for jumping, not searching scripture; the app's
 * own search does that). Full index once per launch, then incremental updates on `data:changed`
 * (debounced). Every result is a deep link routed through the shared router.
 */
type Item = { url: string; title: string; text?: string; keywords?: string[]; updatedAt?: number }

let timer: ReturnType<typeof setTimeout> | null = null
const dirtyNotes = new Set<string>()
let notesBulk = false
let sessionsDirty = false
let workspacesDirty = false
let indexedTranslation: string | null = null

async function indexInChunks(items: Item[]): Promise<void> {
  for (let i = 0; i < items.length; i += 250) await BereanSpotlight.index({ items: items.slice(i, i + 250) })
}

async function indexNotes(ids?: string[]): Promise<void> {
  const notes = await iosServices().notes.getAll(2000, 0)
  const wanted = ids ? notes.filter((n) => ids.includes(n.id)) : notes
  const items: Item[] = wanted.filter((n) => !n.deletedAt).map((n) => ({
    url: formatDeepLink({ kind: 'note', noteId: n.id }),
    title: n.title || 'Untitled note',
    text: stripMarkdownFormatting(n.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 600),
    keywords: ['Berean', 'note', ...(n.tags ?? []), ...(n.verseRef ? [n.verseRef.replace(/\./g, ' ')] : [])],
    updatedAt: n.updatedAt,
  }))
  await indexInChunks(items)
  if (ids) {
    const gone = ids.filter((id) => !wanted.some((n) => n.id === id) || wanted.find((n) => n.id === id)?.deletedAt)
    if (gone.length) await BereanSpotlight.remove({ urls: gone.map((id) => formatDeepLink({ kind: 'note', noteId: id })) })
  }
}

/** Tab sessions: title = session name, text = its tab titles (what the user remembers). */
async function indexSessions(): Promise<void> {
  const svc = iosServices().sessions
  const [sessions, tabs] = await Promise.all([svc.listSessions(), svc.listTabs()])
  const live = sessions.filter((s) => !s.deleted_at)
  const items: Item[] = live.map((s) => {
    const titles = tabs.filter((t) => t.session_id === s.id && !t.deleted_at).map((t) => t.title).filter(Boolean)
    return {
      url: formatDeepLink({ kind: 'session', sessionId: s.id }),
      title: s.name || 'Session',
      text: titles.length ? `Tabs: ${titles.slice(0, 12).join(' · ')}` : 'Tab session',
      keywords: ['Berean', 'session', 'tabs', ...titles.slice(0, 12)],
      updatedAt: s.updated_at,
    }
  })
  await indexInChunks(items)
  const gone = sessions.filter((s) => s.deleted_at).map((s) => formatDeepLink({ kind: 'session', sessionId: s.id }))
  if (gone.length) await BereanSpotlight.remove({ urls: gone })
}

/** Saved workspaces open by name (the same route App Intents use). */
async function indexWorkspaces(): Promise<void> {
  const list = await iosServices().workspaces.list()
  await indexInChunks(list.map((w) => ({
    url: formatDeepLink({ kind: 'workspace', name: w.name }),
    title: w.name,
    text: 'Saved workspace',
    keywords: ['Berean', 'workspace', 'layout'],
    updatedAt: w.created_at,
  })))
}

/** Books and chapters of the default translation (re-indexed when the default changes). */
async function indexBooks(textId: string): Promise<void> {
  if (indexedTranslation === textId) return
  const books = await iosServices().bible.getBooks(textId)
  const label = TRANSLATIONS.find((t) => t.id === textId)?.label ?? textId.toUpperCase()
  const items: Item[] = []
  for (const b of books) {
    const name = normalizeBookName(b.name) || bookName(b.id)
    items.push({
      url: formatDeepLink({ kind: 'verse', bookId: b.id, chapter: 1, textId }),
      title: name,
      text: `${label} — ${b.chapters_count} chapter${b.chapters_count === 1 ? '' : 's'}`,
      keywords: ['Berean', 'Bible', 'book', name, b.short_name, b.testament].filter(Boolean),
    })
    for (let c = 1; c <= b.chapters_count; c++) {
      items.push({
        url: formatDeepLink({ kind: 'verse', bookId: b.id, chapter: c, textId }),
        title: `${name} ${c}`,
        text: `${label} — ${name}, chapter ${c}`,
        keywords: ['Berean', name, `${b.short_name} ${c}`],
      })
    }
  }
  await indexInChunks(items)
  indexedTranslation = textId
}

async function fullIndex(): Promise<void> {
  await indexNotes()
  await indexSessions()
  await indexWorkspaces()
  await indexBooks(useAppStore.getState().defaultBibleTranslation || 'kjva')
}

export async function installIosSpotlight(): Promise<void> {
  try {
    const { available } = await BereanSpotlight.isAvailable()
    if (!available) return
  } catch { return }
  await BereanSpotlight.addListener('open', ({ url }) => { openIosDeepLink(url) }).catch(() => {})
  void fullIndex().catch((err) => console.warn('[spotlight] initial index failed', err))
  // Default translation changed → chapters of the new text (the old ones stay valid links).
  useAppStore.subscribe((s, prev) => {
    if (s.defaultBibleTranslation !== prev.defaultBibleTranslation) void indexBooks(s.defaultBibleTranslation).catch(() => {})
  })
  iosServiceContext().events.on('data:changed', (c) => {
    if (c.entity === 'note') { if (c.op === 'bulk' || !c.id) notesBulk = true; else dirtyNotes.add(c.id) }
    else if (c.entity === 'session' || c.entity === 'tab' || c.entity === 'archived_group') sessionsDirty = true
    else if (c.entity === 'workspace') workspacesDirty = true
    else return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      const noteIds = notesBulk ? undefined : [...dirtyNotes]
      const doNotes = notesBulk || dirtyNotes.size > 0
      const doSessions = sessionsDirty, doWorkspaces = workspacesDirty
      dirtyNotes.clear(); notesBulk = false; sessionsDirty = false; workspacesDirty = false
      void (async () => {
        if (doNotes) await (noteIds ? indexNotes(noteIds) : indexNotes())
        if (doSessions) await indexSessions()
        if (doWorkspaces) await indexWorkspaces()
      })().catch(() => {})
    }, 2000)
  })
}
