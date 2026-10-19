/**
 * Find in the current conversation (⌘F on the Mac, Find in the iPhone's conversation menu).
 *
 * Searches the RENDERED text of each message body (`[data-find-body]` — the bubble or Berean's
 * answer column; quotes of other messages, timestamps and buttons outside it are not message
 * text) and paints matches with the CSS Custom Highlight API: no DOM is rewritten, so Markdown,
 * HTML-looking input and special characters are only ever matched as plain text, and a match may
 * span formatting (bold inside a word). Where the API is missing (older WebKit) matches are
 * still counted and scrolled to, just not painted.
 */

export interface FindMatch { range: Range; messageId: string }

const SKIP = '.chat-reply-quote, [data-find-skip], [aria-hidden="true"]'

/** Case-insensitive matches of `query` inside every message body under `root`, in reading order. */
export function collectFindMatches(root: ParentNode, query: string): FindMatch[] {
  const q = query.toLocaleLowerCase()
  if (!q.trim()) return []
  const out: FindMatch[] = []
  for (const body of Array.from(root.querySelectorAll<HTMLElement>('[data-find-body]'))) {
    const messageId = body.closest<HTMLElement>('[data-message-id]')?.dataset.messageId
    if (!messageId) continue
    // One string per body, with a map back to its text nodes (so a match can cross nodes).
    const nodes: Text[] = []
    const starts: number[] = []
    let text = ''
    const walker = body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        const skip = n.parentElement?.closest(SKIP)
        return skip && body.contains(skip) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
      },
    })
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n as Text
      starts.push(text.length)
      nodes.push(t)
      text += t.data
    }
    if (!text) continue
    // Lower-case per character so offsets never shift (a few characters change length when
    // lower-cased; those keep their original form).
    let lower = ''
    for (const ch of text) { const l = ch.toLocaleLowerCase(); lower += l.length === ch.length ? l : ch }
    const locate = (offset: number, end: boolean): [Text, number] => {
      // The text node holding `offset` (an end offset belongs to the node it ends in).
      let i = nodes.length - 1
      while (i > 0 && (end ? starts[i] >= offset : starts[i] > offset)) i--
      return [nodes[i], offset - starts[i]]
    }
    for (let at = lower.indexOf(q); at >= 0; at = lower.indexOf(q, at + q.length)) {
      const range = body.ownerDocument.createRange()
      const [sn, so] = locate(at, false)
      const [en, eo] = locate(at + q.length, true)
      range.setStart(sn, so)
      range.setEnd(en, eo)
      out.push({ range, messageId })
    }
  }
  return out
}

type HighlightRegistry = { set: (k: string, v: unknown) => void; delete: (k: string) => void }
const registry = (): HighlightRegistry | null => {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS
  return css?.highlights && typeof (globalThis as { Highlight?: unknown }).Highlight === 'function' ? css.highlights : null
}
export const findHighlightSupported = () => !!registry()

/** Paint every match, and the current one distinctly (`::highlight(chat-find…)` in chat.css). */
export function paintFindMatches(matches: readonly FindMatch[], current: number): void {
  const reg = registry()
  if (!reg) return
  const H = (globalThis as unknown as { Highlight: new (...r: Range[]) => unknown }).Highlight
  reg.set('chat-find', new H(...matches.filter((_, i) => i !== current).map((m) => m.range)))
  const cur = matches[current]
  if (cur) reg.set('chat-find-current', new H(cur.range))
  else reg.delete('chat-find-current')
}

export function clearFindHighlights(): void {
  const reg = registry()
  reg?.delete('chat-find')
  reg?.delete('chat-find-current')
}

/** Scroll `scroller` so the match is comfortably in view — only if it is not already. */
export function revealMatch(scroller: HTMLElement, match: FindMatch | undefined): void {
  if (!match) return
  const host = match.range.startContainer.parentElement
  const r = typeof match.range.getBoundingClientRect === 'function' ? match.range.getBoundingClientRect() : null
  const box = scroller.getBoundingClientRect()
  if (!r || (r.height === 0 && r.width === 0)) {
    host?.scrollIntoView?.({ block: 'center' })
    return
  }
  const margin = Math.min(80, box.height / 4)
  if (r.top >= box.top + margin && r.bottom <= box.bottom - margin) return
  scroller.scrollTop += r.top - box.top - box.height / 3
}
