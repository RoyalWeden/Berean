/** TEST 2026-09-29 — keyboard dismissal rules (Notes, Search): on drag, swipe down, inert tap. */
import { describe, it, expect } from 'vitest'
import { shouldDismissOnMove, isInertTapTarget } from '../primitives/keyboardDismiss'

const base = { dx: 0, ownsFocus: false, startScrollTop: 200, y: 300, keyboardTop: 500 }

describe('shouldDismissOnMove', () => {
  it('dragging a list that does not hold the focused field dismisses (search results)', () => {
    expect(shouldDismissOnMove({ ...base, dy: -20 })).toBe(true)
    expect(shouldDismissOnMove({ ...base, dy: 20 })).toBe(true)
  })
  it('tiny jitters and horizontal swipes never dismiss', () => {
    expect(shouldDismissOnMove({ ...base, dy: 6 })).toBe(false)
    expect(shouldDismissOnMove({ ...base, dy: 20, dx: 60 })).toBe(false)
  })
  it('scrolling inside the note being edited keeps the keyboard', () => {
    expect(shouldDismissOnMove({ ...base, ownsFocus: true, dy: -120 })).toBe(false)
    expect(shouldDismissOnMove({ ...base, ownsFocus: true, dy: 120 })).toBe(false)
  })
  it('swiping down from the top of the note, or down to the keyboard edge, dismisses', () => {
    expect(shouldDismissOnMove({ ...base, ownsFocus: true, dy: 80, startScrollTop: 0 })).toBe(true)
    expect(shouldDismissOnMove({ ...base, ownsFocus: true, dy: 80, y: 470 })).toBe(true)
  })
})

describe('isInertTapTarget', () => {
  it('controls, text and marked elements are not inert', () => {
    document.body.innerHTML = '<div id="bg"><button id="b"><span id="s">x</span></button><div data-keep-keyboard><i id="k"></i></div><input id="i"></div>'
    expect(isInertTapTarget(document.getElementById('bg'))).toBe(true)
    expect(isInertTapTarget(document.getElementById('s'))).toBe(false)
    expect(isInertTapTarget(document.getElementById('k'))).toBe(false)
    expect(isInertTapTarget(document.getElementById('i'))).toBe(false)
  })
})
