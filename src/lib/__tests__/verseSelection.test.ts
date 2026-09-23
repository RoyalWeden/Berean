/**
 * TEST-001 / TEST-007 (docs/mobile/testing-backlog-2026-09-22.md): the shared verse-selection
 * model and the drag-to-select lifecycle, including the real pointer gesture for a mouse
 * (desktop) and a touch pointer (iPhone).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useAppStore, type SelectedVerseRef } from '@/store'
import { verseRange, selectionKind, selectionAllows, selectionLabel, versesSpanned } from '@/lib/verseSelection'
import { startVerseDrag, consumeDragClick } from '@/components/bible/verseDragSelect'

const v = (verse: number, chapter = 1, bookId = 'GEN', textId = 'kjva'): SelectedVerseRef => ({ bookId, chapter, verse, textId })
const nums = (sel: SelectedVerseRef[] | undefined) => (sel ?? []).map((x) => x.verse)

describe('verse selection model', () => {
  it('forward range', () => expect(nums(verseRange(v(3), v(7)))).toEqual([3, 4, 5, 6, 7]))
  it('backward range is still ascending', () => expect(nums(verseRange(v(7), v(3)))).toEqual([3, 4, 5, 6, 7]))
  it('single verse', () => expect(nums(verseRange(v(4), v(4)))).toEqual([4]))
  it('skips verses the chapter does not have', () => expect(nums(verseRange(v(1), v(5), [1, 2, 4, 5]))).toEqual([1, 2, 4, 5]))
  it('never crosses into another chapter or text', () => {
    expect(nums(verseRange(v(3), v(2, 2)))).toEqual([3])
    expect(nums(verseRange(v(3), v(5, 1, 'GEN', 'lxx')))).toEqual([3])
  })
  it('kinds', () => {
    expect(selectionKind([])).toBe('none')
    expect(selectionKind([v(1)])).toBe('single')
    expect(selectionKind([v(3), v(2), v(4)])).toBe('range')
    expect(selectionKind([v(1), v(3)])).toBe('multiple')
    expect(selectionKind([v(1), v(2, 2)])).toBe('multiple')
  })
  it('add-note / notes / cross refs only for a single verse (TEST-007)', () => {
    for (const a of ['add-note', 'verse-notes', 'cross-refs'] as const) {
      expect(selectionAllows([v(1)], a)).toBe(true)
      expect(selectionAllows([v(1), v(2)], a)).toBe(false)
    }
    expect(selectionAllows([v(1), v(2)], 'copy')).toBe(true)
    expect(selectionAllows([v(1), v(2)], 'highlight')).toBe(true)
    expect(selectionAllows([], 'copy')).toBe(false)
  })
  it('labels', () => {
    expect(selectionLabel([v(3), v(4), v(5)])).toBe('Genesis 1:3–5')
    expect(selectionLabel([v(3)])).toBe('Genesis 1:3')
    expect(selectionLabel([v(1), v(9)])).toBe('2 verses')
  })
  it('text selection across verses converts to the spanned verses', () => expect(nums(versesSpanned(v(2), v(4)))).toEqual([2, 3, 4]))
})

describe('store drag lifecycle', () => {
  beforeEach(() => useAppStore.setState({ selectedVersesByTab: {}, verseDrag: null }))
  it('writes the live range while dragging and commits on release', () => {
    const s = useAppStore.getState()
    s.beginVerseDrag('t', v(2))
    expect(nums(useAppStore.getState().selectedVersesByTab.t)).toEqual([2])
    useAppStore.getState().updateVerseDrag(v(5))
    expect(nums(useAppStore.getState().selectedVersesByTab.t)).toEqual([2, 3, 4, 5])
    expect(useAppStore.getState().verseDrag).not.toBeNull()
    useAppStore.getState().endVerseDrag(true)
    expect(useAppStore.getState().verseDrag).toBeNull()
    expect(nums(useAppStore.getState().selectedVersesByTab.t)).toEqual([2, 3, 4, 5])
  })
  it('cancel restores the selection that existed before the drag', () => {
    useAppStore.setState({ selectedVersesByTab: { t: [v(9)] } })
    useAppStore.getState().beginVerseDrag('t', v(2))
    useAppStore.getState().updateVerseDrag(v(4))
    useAppStore.getState().endVerseDrag(false)
    expect(nums(useAppStore.getState().selectedVersesByTab.t)).toEqual([9])
  })
  it('cancel with no previous selection clears it', () => {
    useAppStore.getState().beginVerseDrag('t', v(2))
    useAppStore.getState().updateVerseDrag(v(4))
    useAppStore.getState().endVerseDrag(false)
    expect(useAppStore.getState().selectedVersesByTab.t).toBeUndefined()
  })
  it('backward drag', () => {
    useAppStore.getState().beginVerseDrag('t', v(6))
    useAppStore.getState().updateVerseDrag(v(3))
    expect(nums(useAppStore.getState().selectedVersesByTab.t)).toEqual([3, 4, 5, 6])
  })
})

describe('pointer gesture on verse numbers', () => {
  let rows: HTMLElement[] = []
  const origFromPoint = document.elementFromPoint
  beforeEach(() => {
    useAppStore.setState({ selectedVersesByTab: {}, verseDrag: null })
    rows = [1, 2, 3, 4, 5].map((n) => {
      const r = document.createElement('div')
      Object.assign(r.dataset, { verse: String(n), verseRow: '', book: 'GEN', chapter: '1', text: 'kjva' })
      const b = document.createElement('button'); r.appendChild(b)
      document.body.appendChild(r)
      return r
    })
    // jsdom has no layout: row n "sits" at y = n * 100.
    document.elementFromPoint = ((_x: number, y: number) => rows[Math.min(4, Math.max(0, Math.floor(y / 100) - 1))]) as typeof document.elementFromPoint
  })
  afterEach(() => { rows.forEach((r) => r.remove()); document.elementFromPoint = origFromPoint })

  const press = (row: number, pointerType: string) => {
    const badge = rows[row - 1].querySelector('button')!
    const e = { clientX: 10, clientY: row * 100 + 10, pointerId: 1, pointerType, button: 0, currentTarget: badge } as unknown as React.PointerEvent
    startVerseDrag(e, 'tab', v(row))
  }
  const move = (y: number) => window.dispatchEvent(Object.assign(new Event('pointermove', { cancelable: true }), { clientX: 10, clientY: y, pointerId: 1 }))
  const up = () => window.dispatchEvent(Object.assign(new Event('pointerup'), { pointerId: 1 }))
  const cancel = () => window.dispatchEvent(Object.assign(new Event('pointercancel'), { pointerId: 1 }))

  for (const pointerType of ['mouse', 'touch'] as const) {
    it(`${pointerType}: drag from verse 2 to verse 4 selects 2–4, indicator state live during the drag`, () => {
      press(2, pointerType)
      move(260); move(410)
      expect(document.documentElement.dataset.verseDragging).toBe('')
      expect(useAppStore.getState().verseDrag?.pointer).toEqual({ x: 10, y: 410 })
      expect(nums(useAppStore.getState().selectedVersesByTab.tab)).toEqual([2, 3, 4])
      up()
      expect(document.documentElement.dataset.verseDragging).toBeUndefined()
      expect(nums(useAppStore.getState().selectedVersesByTab.tab)).toEqual([2, 3, 4])
      expect(consumeDragClick()).toBe(true) // the release click must not toggle verse 2 off
    })
  }
  it('a press without travel stays a click (no drag, no suppression)', () => {
    press(3, 'mouse')
    move(312)
    up()
    expect(useAppStore.getState().verseDrag).toBeNull()
    expect(consumeDragClick()).toBe(false)
  })
  it('pointercancel mid-drag restores the previous selection', () => {
    useAppStore.setState({ selectedVersesByTab: { tab: [v(5)] } })
    press(1, 'touch')
    move(320)
    cancel()
    expect(nums(useAppStore.getState().selectedVersesByTab.tab)).toEqual([5])
  })
})
