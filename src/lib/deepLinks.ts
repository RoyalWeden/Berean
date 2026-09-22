import { parseRef, bookName, resolveBookToken, type ParsedRef } from '@/lib/parseRef'

/**
 * Deep links — one central, platform-agnostic router (developer decision Q5, docs/mobile/*):
 * every entry point that receives a URL (Electron `open-url` / second-instance argv, the iOS
 * `appUrlOpen` event, a `berean:` link clicked inside a note, and later Universal Links) parses it
 * here and executes it through `routeDeepLink`, so adding a transport never touches routing.
 *
 * Grammar (`berean://` today; an https URL whose path starts with `/berean/` — the future
 * Universal Link form — parses identically):
 *
 *   berean://verse/<book>/<chapter>[/<verse>[-<endVerse>]][?text=<textId>]
 *   berean://open?ref=<any reference parseRef understands, e.g. "Gen 1:1-5">
 *   berean://note/<noteId>
 *   berean://lexicon/<H7225|G3056>
 *   berean://video/<youtubeId>[?t=<seconds>]
 *   berean://pdf/<pdfId>[/<page>]           (also the legacy berean-pdf://<pdfId>/<page> form
 *                                            that PDF "Copy link" has written into notes)
 *   berean://search?q=<query>
 *   berean://trail/<trailSessionId>
 *   berean://daily                        (today's daily note — App Intents)
 *   berean://workspace?name=<name>        (open a saved workspace by name — App Intents)
 *   …&play=1 on a verse/open link starts Read Aloud at that passage
 */
export type DeepLinkRoute =
  | { kind: 'verse'; bookId: string; chapter: number; verse?: number; endVerse?: number; textId?: string; play?: boolean }
  | { kind: 'note'; noteId: string }
  | { kind: 'lexicon'; strongsNum: string }
  | { kind: 'video'; videoId: string; startTime?: number }
  | { kind: 'pdf'; pdfId: string; page?: number }
  | { kind: 'search'; query: string }
  | { kind: 'trail'; trailSessionId: string }
  | { kind: 'daily' }
  | { kind: 'workspace'; name: string }
  /** `berean://share` — the Share Extension left items in the inbox; the platform drains it. */
  | { kind: 'share' }

export const DEEP_LINK_SCHEME = 'berean'
const LEGACY_PDF_SCHEME = 'berean-pdf'

/** True when the string is something this router understands (used by link click handlers). */
export function isDeepLink(href: string): boolean {
  return /^(berean|berean-pdf):/i.test(href.trim()) || /^https?:\/\/[^/]+\/berean\//i.test(href.trim())
}

function segmentsOf(url: URL): string[] {
  // berean://verse/Gen/1/1 → host "verse", pathname "/Gen/1/1"; https://x/berean/verse/Gen/1 → pathname
  const path = url.protocol === 'https:' || url.protocol === 'http:'
    ? url.pathname.replace(/^\/berean\//i, '')
    : `${url.host}${url.pathname}`
  return path.split('/').map((s) => { try { return decodeURIComponent(s) } catch { return s } }).filter(Boolean)
}

export function parseDeepLink(href: string): DeepLinkRoute | null {
  const raw = href.trim()
  if (!raw) return null
  let url: URL
  try { url = new URL(raw) } catch { return null }
  const scheme = url.protocol.replace(/:$/, '').toLowerCase()
  if (scheme === LEGACY_PDF_SCHEME) {
    const [pdfId, page] = segmentsOf(url)
    return pdfId ? { kind: 'pdf', pdfId, ...(num(page) ? { page: num(page) } : {}) } : null
  }
  if (scheme !== DEEP_LINK_SCHEME && !isDeepLink(raw)) return null
  const [head, ...rest] = segmentsOf(url)
  const q = url.searchParams
  switch ((head ?? '').toLowerCase()) {
    case 'verse': {
      const [book, chapter, verseSpec] = rest
      const bookId = book ? resolveBookToken(book) : null
      const ch = num(chapter)
      if (!bookId || !ch) return null
      const m = verseSpec ? /^(\d+)(?:-(\d+))?$/.exec(verseSpec) : null
      const route: DeepLinkRoute = { kind: 'verse', bookId, chapter: ch }
      if (m) { route.verse = Number(m[1]); if (m[2]) route.endVerse = Number(m[2]) }
      const text = q.get('text'); if (text) route.textId = text
      if (q.get('play') === '1') route.play = true
      return route
    }
    case 'open': {
      const ref = q.get('ref') ?? rest.join(' ')
      const parsed: ParsedRef | null = ref ? parseRef(ref) : null
      if (!parsed) return null
      const route: DeepLinkRoute = { kind: 'verse', bookId: parsed.bookId, chapter: parsed.chapter }
      if (parsed.verse) route.verse = parsed.verse
      if (parsed.endVerse) route.endVerse = parsed.endVerse
      const text = q.get('text'); if (text) route.textId = text
      if (q.get('play') === '1') route.play = true
      return route
    }
    case 'note': return rest[0] ? { kind: 'note', noteId: rest[0] } : null
    case 'lexicon': {
      const id = (rest[0] ?? '').toUpperCase()
      return /^[HG]\d{1,5}[A-Z]?$/.test(id) ? { kind: 'lexicon', strongsNum: id } : null
    }
    case 'video': {
      if (!rest[0]) return null
      const t = num(q.get('t'))
      return { kind: 'video', videoId: rest[0], ...(t != null ? { startTime: t } : {}) }
    }
    case 'pdf': {
      if (!rest[0]) return null
      const page = num(rest[1] ?? q.get('page'))
      return { kind: 'pdf', pdfId: rest[0], ...(page ? { page } : {}) }
    }
    case 'search': {
      const query = (q.get('q') ?? rest.join(' ')).trim()
      return query ? { kind: 'search', query } : null
    }
    case 'trail': return rest[0] ? { kind: 'trail', trailSessionId: rest[0] } : null
    case 'daily': return { kind: 'daily' }
    case 'share': return { kind: 'share' }
    case 'workspace': { const name = (q.get('name') ?? rest.join(' ')).trim(); return name ? { kind: 'workspace', name } : null }
    default: return null
  }
}

export function formatDeepLink(route: DeepLinkRoute): string {
  const e = encodeURIComponent
  switch (route.kind) {
    case 'verse': {
      const v = route.verse ? `/${route.verse}${route.endVerse ? `-${route.endVerse}` : ''}` : ''
      const qs = [route.textId ? `text=${e(route.textId)}` : '', route.play ? 'play=1' : ''].filter(Boolean).join('&')
      return `${DEEP_LINK_SCHEME}://verse/${e(route.bookId)}/${route.chapter}${v}${qs ? `?${qs}` : ''}`
    }
    case 'note': return `${DEEP_LINK_SCHEME}://note/${e(route.noteId)}`
    case 'lexicon': return `${DEEP_LINK_SCHEME}://lexicon/${e(route.strongsNum)}`
    case 'video': return `${DEEP_LINK_SCHEME}://video/${e(route.videoId)}${route.startTime ? `?t=${Math.floor(route.startTime)}` : ''}`
    case 'pdf': return `${DEEP_LINK_SCHEME}://pdf/${e(route.pdfId)}${route.page ? `/${route.page}` : ''}`
    case 'search': return `${DEEP_LINK_SCHEME}://search?q=${e(route.query)}`
    case 'trail': return `${DEEP_LINK_SCHEME}://trail/${e(route.trailSessionId)}`
    case 'daily': return `${DEEP_LINK_SCHEME}://daily`
    case 'share': return `${DEEP_LINK_SCHEME}://share`
    case 'workspace': return `${DEEP_LINK_SCHEME}://workspace?name=${e(route.name)}`
  }
}

/** Human label for a route (window titles, toasts, "Copied link to …"). */
export function describeDeepLink(route: DeepLinkRoute): string {
  switch (route.kind) {
    case 'verse': return `${bookName(route.bookId)} ${route.chapter}${route.verse ? `:${route.verse}${route.endVerse ? `-${route.endVerse}` : ''}` : ''}`
    case 'note': return 'note'
    case 'lexicon': return route.strongsNum
    case 'video': return 'video'
    case 'pdf': return `PDF${route.page ? ` p.${route.page}` : ''}`
    case 'search': return `search "${route.query}"`
    case 'trail': return 'study trail'
    case 'daily': return "today's daily note"
    case 'share': return 'shared items'
    case 'workspace': return `workspace "${route.name}"`
  }
}

/**
 * The actions a route needs. Kept as an interface (not a store import) so the router is
 * testable and so the iPhone shell can supply its own navigation (Phase 10) while sharing every
 * parser above.
 */
export interface DeepLinkTarget {
  openVerse: (r: Extract<DeepLinkRoute, { kind: 'verse' }>) => void
  openNote: (noteId: string) => void
  openLexicon: (strongsNum: string) => void
  openVideo: (videoId: string, startTime?: number) => void
  openPdf: (pdfId: string, page?: number) => void | Promise<void>
  openSearch: (query: string) => void
  openTrail: (trailSessionId: string) => void
  openDaily: () => void
  openWorkspace: (name: string) => void
  /** Platform hook for `berean://share` (iOS drains the Share Extension inbox). */
  openShareInbox?: () => void
}

export function routeDeepLink(route: DeepLinkRoute, target: DeepLinkTarget): void {
  switch (route.kind) {
    case 'verse': target.openVerse(route); break
    case 'note': target.openNote(route.noteId); break
    case 'lexicon': target.openLexicon(route.strongsNum); break
    case 'video': target.openVideo(route.videoId, route.startTime); break
    case 'pdf': void target.openPdf(route.pdfId, route.page); break
    case 'search': target.openSearch(route.query); break
    case 'trail': target.openTrail(route.trailSessionId); break
    case 'daily': target.openDaily(); break
    case 'workspace': target.openWorkspace(route.name); break
    case 'share': target.openShareInbox?.(); break
  }
}

/** Parse + route in one call; returns false when the URL is not a Berean link. */
export function handleDeepLink(href: string, target: DeepLinkTarget): boolean {
  const route = parseDeepLink(href)
  if (!route) return false
  routeDeepLink(route, target)
  return true
}

function num(v: string | null | undefined): number | undefined {
  if (v == null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}
