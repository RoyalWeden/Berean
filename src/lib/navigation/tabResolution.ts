import type { BibleTabState, LexiconTabState, NoteTabState, SearchTabState, SpaceId, Tab } from '@/types'
import { resolveTextForBook } from '@/lib/textCoverage'
import type { Destination } from './destination'

/**
 * Which open tab already shows a destination (QO-001, docs/navigation-contract.md "Reuse").
 *
 * ONE identity rule for every surface that wants to avoid an accidental duplicate (the iPhone
 * Quick Open, its recent places, the tab list's cross-session matches) — compared by RESOURCE, never
 * by title, and never by tab id (tab ids differ between devices / restored workspaces; the resource
 * fields — note id, book + chapter + text, Strong's number, video id — are what sync carries).
 *
 *   passage  same text (translation) AND same book AND the chapter is the tab's chapter (or inside
 *            its endChapter span). Verses don't split identity: Romans 13:4 reuses a Romans 13 tab
 *            and scrolls it. Compare and Advanced-Search Scripture tabs are never a match — they are
 *            other tools that happen to hold a book/chapter.
 *   note     same note id (two notes with one title stay two notes; a Notes LIST tab is no match).
 *   strongs  same Strong's number (case-insensitive).
 *   search   same query (trimmed, case-insensitive) and scope.
 *   video    same video id.
 */

export interface TabMatch {
  space: SpaceId
  tab: Tab
  /** Session the tab lives in. */
  sessionId: string
  sessionName: string
  /** True when it is in the session on screen. */
  current: boolean
}

export interface ResolutionState {
  tabs: Record<SpaceId, Tab[]>
  currentSessionId: string
  sessions: Array<{ id: string; name: string; tabs: Record<SpaceId, Tab[]> }>
  defaultBibleTranslation?: string
}

const SPACES: SpaceId[] = ['scripture', 'notes', 'lexicon', 'youtube', 'search']
const FALLBACK = 'kjva'

/** The text a passage destination will be shown in when it opens as a NEW tab (createTab → the
 *  default translation, then the shared text-coverage rule) — or its explicit text. */
export function passageTextFor(d: Extract<Destination, { kind: 'passage' }>, defaultTranslation = FALLBACK): string {
  if (d.textId) return d.textId.toLowerCase()
  const def = defaultTranslation.toLowerCase()
  return (resolveTextForBook(def, d.bookId) ?? def).toLowerCase()
}

/** Does `tab` show `d`? See the file comment for the rules. */
export function tabShowsDestination(tab: Tab, d: Destination, defaultTranslation = FALLBACK): boolean {
  switch (d.kind) {
    case 'passage': {
      if (tab.type !== 'bible') return false
      const st = tab.state as BibleTabState
      if (st.compareMode || (st as { searchMode?: boolean }).searchMode) return false
      if (st.bookId !== d.bookId) return false
      const end = st.endChapter && st.endChapter > st.chapter ? st.endChapter : st.chapter
      if (d.chapter < st.chapter || d.chapter > end) return false
      return (st.translation ?? '').toLowerCase() === passageTextFor(d, defaultTranslation)
    }
    case 'note':
      return tab.type === 'note' && (tab.state as NoteTabState).noteId === d.noteId
    case 'strongs':
      return tab.type === 'lexicon' && ((tab.state as LexiconTabState).strongsNum ?? '').toUpperCase() === d.num.toUpperCase()
    case 'search': {
      if (tab.type !== 'search') return false
      const st = tab.state as SearchTabState
      return (st.query ?? '').trim().toLowerCase() === d.query.trim().toLowerCase() && (st.scope ?? 'all') === (d.scope ?? 'all')
    }
    case 'video':
      return tab.type === 'youtube' && (tab.state as { videoId?: string | null }).videoId === d.videoId
  }
}

/** Every tab of every session, the live session first (its live `tabs`, never its stale snapshot). */
export function allSessionTabs(s: ResolutionState): TabMatch[] {
  const out: TabMatch[] = []
  const curName = s.sessions.find((x) => x.id === s.currentSessionId)?.name ?? 'Session'
  for (const space of SPACES) for (const tab of s.tabs[space] ?? []) out.push({ space, tab, sessionId: s.currentSessionId, sessionName: curName, current: true })
  for (const ses of s.sessions) {
    if (ses.id === s.currentSessionId) continue
    for (const space of SPACES) for (const tab of ses.tabs?.[space] ?? []) out.push({ space, tab, sessionId: ses.id, sessionName: ses.name, current: false })
  }
  return out
}

/** Open tabs showing `d`: the current session's first (in space order), then other sessions'. */
export function findOpenTabs(d: Destination, s: ResolutionState, opts: { preferTabIds?: readonly string[] } = {}): TabMatch[] {
  const def = s.defaultBibleTranslation ?? FALLBACK
  const hits = allSessionTabs(s).filter((m) => tabShowsDestination(m.tab, d, def))
  // Within the current session, the most recently used copy wins when there are several.
  const rank = new Map((opts.preferTabIds ?? []).map((id, i) => [id, i]))
  return hits.sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1
    return (rank.get(a.tab.id) ?? Infinity) - (rank.get(b.tab.id) ?? Infinity)
  })
}

/** The tab a "reuse" open lands in: only ever one of the CURRENT session (never a silent session switch). */
export function reusableTab(d: Destination, s: ResolutionState, opts: { preferTabIds?: readonly string[] } = {}): TabMatch | null {
  const m = findOpenTabs(d, s, opts)[0]
  return m?.current ? m : null
}

/** Open tabs whose title / kind matches a typed query (the tab list's search, Quick Open's "Open tabs"). */
export function tabsMatchingText(q: string, s: ResolutionState, label: (t: Tab) => string): TabMatch[] {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  return allSessionTabs(s).filter((m) => {
    const hay = `${label(m.tab)} ${m.tab.title}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

/** What a tab shows, as a destination (to open a COPY of a tab elsewhere); null for tool tabs. */
export function tabDestination(tab: Tab): Destination | null {
  switch (tab.type) {
    case 'bible': {
      const st = tab.state as BibleTabState
      if (st.compareMode || (st as { searchMode?: boolean }).searchMode || !st.bookId) return null
      return { kind: 'passage', bookId: st.bookId, chapter: st.chapter, textId: st.translation?.toLowerCase() }
    }
    case 'note': { const id = (tab.state as NoteTabState).noteId; return id ? { kind: 'note', noteId: id } : null }
    case 'lexicon': { const n = (tab.state as LexiconTabState).strongsNum; return n ? { kind: 'strongs', num: n } : null }
    case 'search': { const st = tab.state as SearchTabState; return st.query?.trim() ? { kind: 'search', query: st.query, scope: st.scope } : null }
    case 'youtube': { const v = (tab.state as { videoId?: string | null }).videoId; return v ? { kind: 'video', videoId: v } : null }
    default: return null
  }
}
