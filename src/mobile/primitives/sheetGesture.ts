/**
 * Sheet body gesture model (SEP25 SHEET-GESTURE) — the PURE part of the boundary-driven hand-off
 * between a sheet's scrolling content and the sheet itself, modelled on UISheetPresentationController:
 *
 *   • content scrolled to its TOP + finger moving DOWN  → the sheet follows the finger (lower detent / close)
 *   • content at its BOTTOM (or nothing to scroll) + finger moving UP → the sheet rises (next detent),
 *     unless it already sits at its highest detent
 *   • anywhere else → the content scrolls
 *
 * While the CONTENT owns the touch the decision is re-evaluated on every touchmove, so a scroll that
 * reaches its boundary mid-gesture hands over continuously from that point — the sheet never jumps.
 * TEST25-SHEET-001 (gesture ownership): once the SHEET is moving it owns the rest of that touch —
 * reversing direction keeps moving the sheet (up and down, between its detents) until the finger
 * lifts; only the next touch is interpreted afresh. Below the highest detent an upward drag expands
 * the sheet first (like UISheetPresentationController's scrolling-expands-at-edge), whatever the
 * content's scroll position.
 */

export interface ScrollBounds { scrollTop: number; scrollHeight: number; clientHeight: number }

/** Sub-pixel tolerance (WebKit reports fractional scroll positions). */
const EPS = 1

export function atScrollTop(b: ScrollBounds): boolean { return b.scrollTop <= EPS }
export function atScrollBottom(b: ScrollBounds): boolean { return b.scrollTop + b.clientHeight >= b.scrollHeight - EPS }

/** Should this finger movement (dy > 0 = down, per move) be taken over by the sheet? */
export function sheetTakesOver(dy: number, bounds: ScrollBounds, atTopDetent: boolean, nested = false): boolean {
  if (dy > 0) return atScrollTop(bounds)
  // A scroller NESTED inside the sheet body (e.g. the several-verse Strong's block at the compact
  // position, SEP27-VERSE-003) scrolls first; the sheet takes over at its bottom.
  if (dy < 0) return !atTopDetent && (!nested || atScrollBottom(bounds))
  return false
}

/** Sheet y while it follows the finger: rubber-bands (5 %) above the highest detent, never below the screen. */
export function followY(baseY: number, fingerDelta: number, minY: number, maxY: number): number {
  const raw = baseY + fingerDelta
  if (raw < minY) return minY - (minY - raw) * 0.05
  return Math.min(raw, maxY)
}

/**
 * Once the sheet owns a touch it keeps it until release (TEST25-SHEET-001) — the content never
 * takes a gesture back mid-touch. Kept as a function so the rule is explicit and tested.
 */
export function handsBackToContent(_direction: 1 | -1, _baseY: number, _y: number): boolean {
  return false
}

/** Release velocity (px/s, + = down) from recent samples, over the last ~100 ms. */
export function releaseVelocity(samples: Array<{ t: number; y: number }>): number {
  if (samples.length < 2) return 0
  const last = samples[samples.length - 1]
  let first = samples[0]
  for (let i = samples.length - 2; i >= 0; i--) {
    first = samples[i]
    if (last.t - samples[i].t >= 100) break
  }
  const dt = last.t - first.t
  return dt > 0 ? ((last.y - first.y) / dt) * 1000 : 0
}

/** Dismiss the keyboard — called the moment the sheet starts moving so it never fights the drag. */
export function blurActiveEditable(doc: Document = document): boolean {
  const el = doc.activeElement as HTMLElement | null
  if (!el || el === doc.body) return false
  const editable = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable || el.getAttribute?.('contenteditable') === 'true'
  if (!editable) return false
  el.blur()
  return true
}

/** The element whose vertical scroll a touch on `target` would move: the nearest scrollable ancestor up to (and including) `root`. */
export function scrollOwner(target: Element | null, root: HTMLElement): HTMLElement {
  let el: Element | null = target
  while (el && el !== root) {
    if (el instanceof HTMLElement && el.scrollHeight > el.clientHeight + EPS) {
      const oy = getComputedStyle(el).overflowY
      if (oy === 'auto' || oy === 'scroll') return el
    }
    el = el.parentElement
  }
  return root
}
