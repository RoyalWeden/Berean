// Online research (spec §7.4, decisions 19, 23). Two keyless, free sources: Wikipedia for
// background and Sefaria for primary Jewish texts. Everything here is pure; the main process does
// the fetching. Three boundaries hold regardless of the page content:
//  - only the search words leave the device, never notes, conversation or profile text;
//  - results go to the user as labelled cards and are NEVER put into a model prompt, so a page
//    can't inject instructions;
//  - with Commentary off a card shows its title and link only, because an excerpt may interpret.

export interface ExternalSource {
  provider: 'wikipedia' | 'sefaria'
  site: string
  title: string
  url: string
  excerpt: string
  retrievedAt: string
  /** What kind of source this is, so nobody mistakes it for Scripture. */
  limitation: string
}

const WANTS_WEB_RE = /\b(?:search|look(?:\s+\S+)?\s+up|check|find)\s+(?:\S+\s+){0,3}(?:online|on\s+the\s+web|the\s+web|the\s+internet|wikipedia|sefaria)\b|\b(?:wikipedia|sefaria)\b/i

export function wantsWeb(question: string): boolean {
  return WANTS_WEB_RE.test(question)
}

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'and', 'or', 'for', 'about', 'what', 'who', 'when', 'where', 'why', 'how', 'is', 'are', 'was', 'were', 'did', 'does', 'do', 'can', 'you', 'please', 'tell', 'me', 'my', 'i', 'search', 'look', 'up', 'find', 'check', 'online', 'web', 'internet', 'wikipedia', 'sefaria', 'verses', 'verse', 'passages', 'show'])

/** The minimal public query: content words of the question only. Addresses, links and long
 *  numbers are dropped, since a question can carry something the user didn't mean to publish. */
export function webQuery(question: string): string | null {
  const scrubbed = question.replace(/\S+@\S+/g, ' ').replace(/https?:\/\/\S+/g, ' ').replace(/\b\d{5,}\b/g, ' ')
  const words = (scrubbed.match(/[\p{L}\p{N}'-]+/gu) ?? []).filter((w) => !STOP.has(w.toLowerCase()))
  return words.length > 0 ? words.slice(0, 8).join(' ') : null
}

/** Plain text from untrusted markup: tags and control characters gone, bounded length. */
export function cleanExcerpt(html: string): string {
  const text = html.replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').replace(/&(?:lt|gt|nbsp);/g, ' ')
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240)
}

const ALLOWED_HOSTS = new Set(['en.wikipedia.org', 'www.sefaria.org'])

/** A link is shown only if it is https on a host Berean asked. */
export function safeSourceUrl(url: string): string | null {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname) ? u.toString() : null
  } catch {
    return null
  }
}

export const wikipediaSearchUrl = (query: string) =>
  `https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=3&format=json&utf8=1&srsearch=${encodeURIComponent(query)}`

export const SEFARIA_SEARCH_URL = 'https://www.sefaria.org/api/search-wrapper'
export const sefariaSearchBody = (query: string) => JSON.stringify({ query, type: 'text', size: 3, field: 'exact' })

const card = (s: Omit<ExternalSource, 'url'> & { url: string }): ExternalSource[] => {
  const url = safeSourceUrl(s.url)
  return url && s.title ? [{ ...s, url }] : []
}

export function parseWikipedia(raw: unknown, retrievedAt: string): ExternalSource[] {
  const hits = (raw as { query?: { search?: Array<{ title?: unknown; pageid?: unknown; snippet?: unknown }> } })?.query?.search
  if (!Array.isArray(hits)) return []
  return hits.flatMap((h) => (typeof h.title === 'string' && typeof h.pageid === 'number' ? card({
    provider: 'wikipedia', site: 'Wikipedia', title: cleanExcerpt(h.title), url: `https://en.wikipedia.org/?curid=${h.pageid}`,
    excerpt: typeof h.snippet === 'string' ? cleanExcerpt(h.snippet) : '', retrievedAt,
    limitation: 'Encyclopedia article, edited by volunteers. Secondary source.',
  }) : []))
}

export function parseSefaria(raw: unknown, retrievedAt: string): ExternalSource[] {
  const hits = (raw as { hits?: { hits?: Array<{ _id?: unknown; highlight?: { exact?: unknown[] } }> } })?.hits?.hits
  if (!Array.isArray(hits)) return []
  return hits.flatMap((h) => {
    if (typeof h._id !== 'string') return []
    const ref = h._id.replace(/\s*\(.*$/, '').trim()
    const path = ref.replace(/:/g, '.').replace(/ (\d)/g, '.$1').replace(/ /g, '_')
    const first = h.highlight?.exact?.[0]
    return card({
      provider: 'sefaria', site: 'Sefaria', title: cleanExcerpt(ref), url: `https://www.sefaria.org/${encodeURI(path)}`,
      excerpt: typeof first === 'string' ? cleanExcerpt(first) : '', retrievedAt,
      limitation: 'Jewish text library. Translations and later rabbinic works, not Berean’s Scripture text.',
    })
  })
}

/** With Commentary off a source is a pointer, not text: excerpts may carry interpretation. */
export function forCommentaryOff(sources: readonly ExternalSource[]): ExternalSource[] {
  return sources.map((s) => ({ ...s, excerpt: '' }))
}
