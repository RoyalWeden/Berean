/**
 * DOM helpers for mirroring the main Bible panel's text selection and cursor ("laser
 * pointer") into the presenter window. Both are expressed as a verse number plus a character
 * offset within that verse's *visible word* text. Strong's-number chips and alignment
 * placeholders are skipped when counting/measuring offsets, so the coordinates match the
 * presenter (which never shows Strong's) even when inline Strong's numbers are toggled on.
 */

export interface OverlaySelRange { verseNum: number; startChar: number; endChar: number }
// Laser carries EITHER a char offset + sub-char fractions (accurate AND continuous, when the
// cursor is over text) OR a verse-relative fraction (fallback, when over a margin/gap so the
// dot doesn't disappear). `dxFrac`/`dyFrac` are how far across/down that character the cursor
// sits, so the dot glides sub-letter — horizontally AND vertically — while staying anchored.
export interface OverlayLaser { verseNum: number; charOffset?: number; dxFrac?: number; dyFrac?: number; xFrac?: number; yFrac?: number }
/** pointToLaser also returns a stable key for the word under the cursor, used for dwell logic. */
export type LaserHit = OverlayLaser & { wordKey: string }

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const clampRange = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

/** True if `node` lives inside a Strong's chip or an aria-hidden alignment placeholder. */
function isHiddenFromDisplay(node: Node, root: HTMLElement): boolean {
  let el = node.parentElement
  while (el && el !== root) {
    if (el.hasAttribute('data-strongs-chip') || el.getAttribute('aria-hidden') === 'true') return true
    el = el.parentElement
  }
  return false
}

/** TreeWalker over `root`'s text nodes, skipping Strong's chips / placeholders. */
function visibleTextWalker(root: HTMLElement): TreeWalker {
  return document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return isHiddenFromDisplay(node, root) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    },
  })
}

/** Character offset of (node, offset) within `el`, counting only visible (non-chip) text. */
export function charOffsetInElement(node: Node, offset: number, el: HTMLElement): number {
  if (node.nodeType !== Node.TEXT_NODE) {
    let count = 0
    const kids = node.childNodes
    for (let i = 0; i < offset && i < kids.length; i++) count += (kids[i].textContent ?? '').length
    return textLengthBefore(node, el) + count
  }
  let pos = 0
  const walker = visibleTextWalker(el)
  let curr: Text | null
  while ((curr = walker.nextNode() as Text | null)) {
    if (curr === node) return pos + offset
    pos += curr.length
  }
  return pos
}

function textLengthBefore(node: Node, el: HTMLElement): number {
  let pos = 0
  const walker = visibleTextWalker(el)
  let curr: Text | null
  while ((curr = walker.nextNode() as Text | null)) {
    if (node.contains(curr)) return pos
    if (curr.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING) return pos
    pos += curr.length
  }
  return pos
}

/** Length of the visible (non-chip) text within `el`. */
function visibleTextLength(el: HTMLElement): number {
  let pos = 0
  const walker = visibleTextWalker(el)
  while (walker.nextNode()) pos += (walker.currentNode as Text).length
  return pos
}

/** Visible (non-chip) text string of `el`. */
function visibleTextString(el: HTMLElement): string {
  let s = ''
  const walker = visibleTextWalker(el)
  let curr: Text | null
  while ((curr = walker.nextNode() as Text | null)) s += curr.data
  return s
}

/** The [data-verse-text] element for a verse row, or the row itself as a fallback. */
function verseTextEl(verseEl: HTMLElement): HTMLElement {
  return (verseEl.querySelector('[data-verse-text]') as HTMLElement) ?? verseEl
}

/**
 * Compute the per-verse selected character ranges for a selection Range that may span several
 * verse rows inside `container`. Returns ranges in visible-display char coords.
 */
export function computeSelectionRanges(container: HTMLElement, range: Range): OverlaySelRange[] {
  const out: OverlaySelRange[] = []
  const verseEls = Array.from(container.querySelectorAll('[data-verse]')) as HTMLElement[]
  for (const ve of verseEls) {
    let intersects = false
    try { intersects = range.intersectsNode(ve) } catch { intersects = false }
    if (!intersects) continue
    const tEl = verseTextEl(ve)
    const len = visibleTextLength(tEl)
    if (len === 0) continue
    let start = 0
    let end = len
    if (tEl.contains(range.startContainer)) start = charOffsetInElement(range.startContainer, range.startOffset, tEl)
    if (tEl.contains(range.endContainer)) end = charOffsetInElement(range.endContainer, range.endOffset, tEl)
    start = Math.max(0, Math.min(start, len))
    end = Math.max(0, Math.min(end, len))
    if (end > start) out.push({ verseNum: Number(ve.dataset.verse), startChar: start, endChar: end })
  }
  return out
}

/**
 * Map a viewport point to the laser anchor for the presenter.
 *  - Over verse text → a precise CHARACTER offset + sub-char fractions (accurate to the exact
 *    word/letter regardless of how the two windows wrap, and Strong's-aware).
 *  - Otherwise (margin / gap) → a verse-relative FRACTION for the nearest verse, so the
 *    pointer still tracks the cursor and doesn't disappear.
 */
export function pointToLaser(container: HTMLElement, x: number, y: number): LaserHit | null {
  const doc = container.ownerDocument
  const el = doc.elementFromPoint(x, y) as HTMLElement | null
  const textEl = (el?.closest('[data-verse-text]') as HTMLElement | null) ?? null
  if (textEl) {
    const verseEl = textEl.closest('[data-verse]') as HTMLElement | null
    const caret = (doc as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null })
      .caretRangeFromPoint?.(x, y)
    if (verseEl && caret && textEl.contains(caret.startContainer)) {
      const o = charOffsetInElement(caret.startContainer, caret.startOffset, textEl)
      let charOffset = o
      let dxFrac = 0
      let chosen = charOffsetToRect(textEl, o)
      const rO = chosen
      if (rO && x >= rO.left && x <= rO.right && rO.width > 0) {
        charOffset = o; dxFrac = (x - rO.left) / rO.width
      } else if (o > 0) {
        const rPrev = charOffsetToRect(textEl, o - 1)
        if (rPrev && x >= rPrev.left && x <= rPrev.right && rPrev.width > 0) {
          charOffset = o - 1; dxFrac = (x - rPrev.left) / rPrev.width; chosen = rPrev
        } else if (rO) {
          dxFrac = x < rO.left ? 0 : 1
        }
      }
      const dyFrac = chosen && chosen.height > 0 ? clampRange((y - chosen.top) / chosen.height, -0.4, 1.4) : 0.5
      const verseNum = Number(verseEl.dataset.verse)
      // Word index = number of spaces before the offset in the visible text.
      const before = visibleTextString(textEl).slice(0, charOffset)
      const wordIndex = (before.match(/ /g) || []).length
      return { verseNum, charOffset, dxFrac: clamp01(dxFrac), dyFrac, wordKey: `${verseNum}:${wordIndex}` }
    }
  }
  // Fallback: nearest verse, fractional position (keeps the dot visible off-text).
  const verseEls = Array.from(container.querySelectorAll('[data-verse]')) as HTMLElement[]
  if (verseEls.length === 0) return null
  let best: HTMLElement | null = null
  let bestRect: DOMRect | null = null
  let bestDist = Infinity
  for (const ve of verseEls) {
    const rect = ve.getBoundingClientRect()
    if (y >= rect.top && y <= rect.bottom) { best = ve; bestRect = rect; break }
    const dist = y < rect.top ? rect.top - y : y - rect.bottom
    if (dist < bestDist) { bestDist = dist; best = ve; bestRect = rect }
  }
  if (!best || !bestRect) return null
  const tEl = verseTextEl(best)
  const tRect = tEl.getBoundingClientRect()
  const xFrac = clamp01(tRect.width > 0 ? (x - tRect.left) / tRect.width : 0)
  const yFrac = clamp01(bestRect.height > 0 ? (y - bestRect.top) / bestRect.height : 0.5)
  const verseNum = Number(best.dataset.verse)
  return { verseNum, xFrac, yFrac, wordKey: `${verseNum}:frac` }
}

/** Resolve a laser anchor (char offset OR fraction) to a content-relative pixel point. */
export function laserToPoint(container: HTMLElement, laser: OverlayLaser): { left: number; top: number } | null {
  const ve = container.querySelector(`[data-verse="${laser.verseNum}"]`) as HTMLElement | null
  if (!ve) return null
  const tEl = verseTextEl(ve)
  const cRect = container.getBoundingClientRect()

  if (typeof laser.charOffset === 'number') {
    const rect = charOffsetToRect(tEl, laser.charOffset)
    if (rect) {
      const dx = laser.dxFrac ?? 0
      const dy = laser.dyFrac ?? 0.5
      return {
        left: rect.left - cRect.left + container.scrollLeft + dx * rect.width,
        top: rect.top - cRect.top + container.scrollTop + dy * rect.height,
      }
    }
  }

  const rRect = ve.getBoundingClientRect()
  const tRect = tEl.getBoundingClientRect()
  const xFrac = laser.xFrac ?? 0
  const yFrac = laser.yFrac ?? 0.5
  return {
    left: tRect.left - cRect.left + container.scrollLeft + xFrac * tRect.width,
    top: rRect.top - cRect.top + container.scrollTop + yFrac * rRect.height,
  }
}

/** Viewport rect of a single visible-char offset within a verse-text element. */
function charOffsetToRect(verseTextElement: HTMLElement, charOffset: number): DOMRect | null {
  let pos = 0
  const walker = visibleTextWalker(verseTextElement)
  let curr: Text | null
  while ((curr = walker.nextNode() as Text | null)) {
    if (charOffset <= pos + curr.length) {
      const local = Math.max(0, Math.min(charOffset - pos, curr.length))
      const r = document.createRange()
      try {
        r.setStart(curr, local)
        r.setEnd(curr, Math.min(local + 1, curr.length))
        const rect = r.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) { r.setStart(curr, local); r.collapse(true); return r.getBoundingClientRect() }
        return rect
      } catch { return null }
    }
    pos += curr.length
  }
  return null
}
