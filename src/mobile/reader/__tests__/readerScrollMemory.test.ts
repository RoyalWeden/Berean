// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { captureReaderAnchor } from '../readerScrollMemory'

function setup(rowsTop: number[], rowH = 40, viewportTop = 100) {
  const el = document.createElement('div')
  el.getBoundingClientRect = () => ({ top: viewportTop, bottom: viewportTop + 600 } as DOMRect)
  let reads = 0
  rowsTop.forEach((t, i) => {
    const r = document.createElement('div')
    r.setAttribute('data-verse-row', '')
    r.dataset.chapter = '3'
    r.dataset.verse = String(i + 1)
    r.getBoundingClientRect = () => { reads++; return { top: t, bottom: t + rowH } as DOMRect }
    el.appendChild(r)
  })
  return { el, reads: () => reads }
}

describe('captureReaderAnchor', () => {
  it('finds the top-most visible verse and its offset', () => {
    const { el } = setup(Array.from({ length: 50 }, (_, i) => -900 + i * 40))
    // verse k top = -900 + (k-1)*40; first bottom > 101 → k where -860+(k-1)*40 > 101 → k = 26 (top 100)
    expect(captureReaderAnchor(el)).toEqual({ chapter: 3, verse: 26, offset: 0 })
  })
  it('reports a negative offset for a verse straddling the top', () => {
    const { el } = setup([50, 90, 130])
    expect(captureReaderAnchor(el)).toEqual({ chapter: 3, verse: 2, offset: -10 })
  })
  it('reads O(log n) rows, not one per verse', () => {
    const { el, reads } = setup(Array.from({ length: 2000 }, (_, i) => -70000 + i * 40))
    captureReaderAnchor(el)
    expect(reads()).toBeLessThan(20)
  })
  it('returns null when every row is above the viewport', () => {
    const { el } = setup([-200, -150])
    expect(captureReaderAnchor(el)).toBeNull()
  })
})
