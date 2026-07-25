/**
 * Verse-anchored scroll position, for syncing scroll between two Bible reading panes
 * showing the SAME chapter in DIFFERENT translations (Compare mode's "sync scroll"
 * toggle). Raw pixel scrollTop isn't usable for this — translations wrap differently,
 * so the same pixel offset lands on a different verse in each column. Encoding as
 * "verse N, `frac` of the way through verse N's own row height" and decoding against
 * a DIFFERENT column's own row heights is what keeps the sync verse-accurate instead
 * of just visually approximate.
 *
 * Generalizes the one-shot verse-anchor technique BiblePanel.tsx's
 * captureStrongsAnchor()/restoreStrongsAnchor() already use for the Strong's-toggle
 * and KJV↔LXX-swap transitions into something continuous (encode/decode on every
 * scroll event, not just once per transition).
 *
 * Kept as a standalone pure module (no DOM globals beyond what's passed in) so it's
 * unit-testable with jsdom + manually-mocked getBoundingClientRect, without mounting
 * the full CompareView.
 */

export interface ScrollPosition {
  verseNum: number
  /** 0-1: how far scrolled through `verseNum`'s own row height. */
  frac: number
}

/** Finds the verse element whose top is at-or-just-above the container's own top edge
 *  (same "topmost visible" rule captureStrongsAnchor uses), returning its index within
 *  `verseEls`. */
function findAnchorIndex(verseEls: HTMLElement[], containerTop: number): number {
  for (let i = 0; i < verseEls.length; i++) {
    const top = verseEls[i].getBoundingClientRect().top - containerTop
    if (top >= -4) {
      // Found the first verse at-or-below the top edge — but if its top is well below
      // (not right at) the edge, the PREVIOUS verse is the one actually crossing it.
      if (top > 4 && i > 0) return i - 1
      return i
    }
  }
  return verseEls.length - 1
}

/** Row height for the verse at `idx`, using the gap to the next verse (accounts for
 *  the actual rendered height, including any wrapping) — falls back to the verse
 *  element's own height for the last verse in the column. */
function rowHeightAt(verseEls: HTMLElement[], idx: number, containerTop: number): number {
  const anchor = verseEls[idx]
  const anchorTop = anchor.getBoundingClientRect().top - containerTop
  const next = verseEls[idx + 1]
  if (next) return (next.getBoundingClientRect().top - containerTop) - anchorTop
  return anchor.getBoundingClientRect().height
}

/** Encodes a scroll container's current position as a verse + fractional progress
 *  through that verse's row. Returns null if the container has no verse rows. */
export function encodeScrollPosition(container: HTMLElement): ScrollPosition | null {
  const verseEls = Array.from(container.querySelectorAll<HTMLElement>('[data-verse]'))
  if (verseEls.length === 0) return null
  const containerTop = container.getBoundingClientRect().top
  const idx = findAnchorIndex(verseEls, containerTop)
  const anchor = verseEls[idx]
  const verseNum = Number(anchor.dataset.verse)
  if (!Number.isFinite(verseNum)) return null
  const anchorTop = anchor.getBoundingClientRect().top - containerTop
  const rowHeight = rowHeightAt(verseEls, idx, containerTop)
  const frac = rowHeight > 0 ? Math.max(0, Math.min(1, -anchorTop / rowHeight)) : 0
  return { verseNum, frac }
}

/** Given a target container (a DIFFERENT column, possibly a different translation with
 *  different row heights) and a previously-encoded position, computes the scrollTop
 *  that places that same verse+fraction at the container's own top edge. Returns null
 *  if the verse doesn't exist in this container (e.g. a versification mismatch). */
export function decodeScrollPosition(container: HTMLElement, pos: ScrollPosition): number | null {
  const verseEls = Array.from(container.querySelectorAll<HTMLElement>('[data-verse]'))
  const idx = verseEls.findIndex((el) => Number(el.dataset.verse) === pos.verseNum)
  if (idx === -1) return null
  const containerTop = container.getBoundingClientRect().top
  const anchorTop = verseEls[idx].getBoundingClientRect().top - containerTop
  const rowHeight = rowHeightAt(verseEls, idx, containerTop)
  return container.scrollTop + anchorTop + pos.frac * rowHeight
}
