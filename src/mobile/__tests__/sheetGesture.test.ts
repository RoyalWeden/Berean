// @vitest-environment jsdom
/** SEP25 SHEET-GESTURE: the boundary-driven hand-off between sheet content and the sheet. */
import { describe, it, expect } from 'vitest'
import { sheetTakesOver, followY, handsBackToContent, releaseVelocity, blurActiveEditable, scrollOwner, atScrollBottom } from '../primitives/sheetGesture'

const b = (scrollTop: number, scrollHeight = 2000, clientHeight = 600) => ({ scrollTop, scrollHeight, clientHeight })

describe('sheet body hand-off', () => {
  it('content at its top + dragging down → the sheet moves', () => {
    expect(sheetTakesOver(4, b(0), false)).toBe(true)
    expect(sheetTakesOver(4, b(0), true)).toBe(true) // from the top detent too (lower detent / close)
  })
  it('content at its bottom + dragging up → the sheet rises, except at the highest detent', () => {
    expect(sheetTakesOver(-4, b(1400), false)).toBe(true)
    expect(sheetTakesOver(-4, b(1400), true)).toBe(false)
  })
  it('nothing to scroll counts as both boundaries', () => {
    expect(atScrollBottom(b(0, 300, 600))).toBe(true)
    expect(sheetTakesOver(-4, b(0, 300, 600), false)).toBe(true)
    expect(sheetTakesOver(4, b(0, 300, 600), false)).toBe(true)
  })
  it('content scrolled to the middle → dragging down scrolls the content; at the top detent dragging up scrolls it too', () => {
    expect(sheetTakesOver(4, b(700), false)).toBe(false)
    expect(sheetTakesOver(-4, b(700), true)).toBe(false)
  })
  it('below the highest detent an upward drag expands the sheet first, whatever the scroll position (TEST25-SHEET-001)', () => {
    expect(sheetTakesOver(-4, b(700), false)).toBe(true)
  })
  it('the hand-off is continuous: dragging down from the top of a scrolled list only takes over once the top is reached', () => {
    let top = 30
    const took: boolean[] = []
    for (let i = 0; i < 5; i++) { took.push(sheetTakesOver(10, b(top), false)); if (!took[i]) top = Math.max(0, top - 10) }
    expect(took).toEqual([false, false, false, true, true])
  })
  it('the sheet follows the finger 1:1, rubber-bands above the top detent, never leaves the screen', () => {
    expect(followY(300, 40, 64, 800)).toBe(340)
    expect(followY(64, -100, 64, 800)).toBeCloseTo(59)
    expect(followY(700, 400, 64, 800)).toBe(800)
  })
  it('once the sheet moves it owns the touch: reversing direction never hands it back to the content (TEST25-SHEET-001)', () => {
    expect(handsBackToContent(1, 300, 299)).toBe(false)
    expect(handsBackToContent(1, 300, 120)).toBe(false)
    expect(handsBackToContent(-1, 300, 301)).toBe(false)
  })
  it('release velocity is measured over the last ~100 ms', () => {
    expect(releaseVelocity([{ t: 0, y: 0 }])).toBe(0)
    expect(releaseVelocity([{ t: 0, y: 0 }, { t: 100, y: 50 }, { t: 150, y: 150 }, { t: 200, y: 250 }])).toBe(2000)
  })
})

describe('keyboard dismissal on sheet-move start', () => {
  it('blurs a focused input / textarea, leaves other focus alone', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    expect(document.activeElement).toBe(input)
    expect(blurActiveEditable()).toBe(true)
    expect(document.activeElement).not.toBe(input)
    const btn = document.createElement('button')
    document.body.appendChild(btn)
    btn.focus()
    expect(blurActiveEditable()).toBe(false)
    expect(document.activeElement).toBe(btn)
    const ta = document.createElement('textarea')
    document.body.appendChild(ta)
    ta.focus()
    expect(blurActiveEditable()).toBe(true)
  })
})

describe('scroll owner', () => {
  it('is the sheet body unless a nested vertical scroller can scroll', () => {
    const root = document.createElement('div')
    const inner = document.createElement('div')
    const leaf = document.createElement('span')
    inner.appendChild(leaf); root.appendChild(inner); document.body.appendChild(root)
    expect(scrollOwner(leaf, root)).toBe(root)
    inner.style.overflowY = 'auto'
    Object.defineProperty(inner, 'scrollHeight', { value: 900 })
    Object.defineProperty(inner, 'clientHeight', { value: 300 })
    expect(scrollOwner(leaf, root)).toBe(inner)
  })
})
