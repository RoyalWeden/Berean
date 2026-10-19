// @vitest-environment jsdom
/** TEST 2026-10-17 — the Scripture verse right-click menu: portaled to <body> (escaping the
 *  chapter's zoom + view-transition stacking context), anchored at the cursor, compact layout
 *  (icon row + grouped rows + 2-row swatch grid), every action kept, and it dismisses cleanly. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import VerseRow from '../VerseRow'
import { HIGHLIGHT_COLORS } from '../verseRowStyles'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const GEN_1_1 = { book_id: 'GEN', chapter: 1, verse_num: 1, text: 'In the beginning God created the heaven and the earth.', text_tagged: null }

let root: Root | null = null
let host: HTMLDivElement | null = null
beforeEach(() => {
  const w = window as unknown as Record<string, unknown>
  w.highlights = { getChapter: async () => ({}), remove: async () => {}, toggle: async () => ({}), add: async () => ({}) }
  w.notes = { getChapterNotes: async () => [], getNotes: async () => [], createNote: async () => ({}) }
  w.verseTags = { getForChapter: async () => [], list: async () => [] }
  host = document.createElement('div')
  // The reader's real ancestors: CSS zoom (PanelLayout) + view-transition-name (ChapterView).
  host.style.setProperty('zoom', '1.25')
  host.style.setProperty('view-transition-name', 'chapter-test')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root!.render(<VerseRow verse={GEN_1_1 as never} showStrongs={false} textId="kjva" />) })
})
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null })

const menu = () => document.querySelector<HTMLElement>('[role="menu"][aria-label$="actions"]')
const positioner = () => menu()?.closest<HTMLElement>('[data-menu-positioner]') ?? null

function rightClick(el: Element, x: number, y: number) {
  act(() => { el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 })) })
}

describe('verse context menu', () => {
  it('opens portaled to document.body, at the cursor, with every action', () => {
    const text = host!.querySelector('[data-verse-text]')!
    rightClick(text, 140, 160)
    const m = menu()
    expect(m).toBeTruthy()
    expect(host!.contains(m)).toBe(false)
    expect(positioner()!.parentElement).toBe(document.body)
    expect(positioner()!.style.left).toBe('140px')
    expect(positioner()!.style.top).toBe('160px')

    // Quick actions: icon-only menu items with accessible names + native tooltips.
    for (const label of ['Copy verse', 'Copy reference', 'Add note']) {
      const b = m!.querySelector<HTMLElement>(`[role="menuitem"][aria-label="${label}"]`)
      expect(b, label).toBeTruthy()
      expect(b!.getAttribute('title')).toBe(label)
      expect(b!.textContent).toBe('')
    }
    // Labelled rows.
    for (const label of ['Show all notes', 'Show cross references', 'Play audio from here', 'Tag verse…']) {
      expect([...m!.querySelectorAll('[role="menuitem"]')].some((el) => el.textContent?.includes(label)), label).toBe(true)
    }
    // Highlight grid: every colour + the remove swatch, laid out in 2 rows (not one long line).
    const radios = m!.querySelectorAll('[role="radio"]')
    expect(radios.length).toBe(HIGHLIGHT_COLORS.length + 1)
    expect(m!.querySelector('[aria-label="Remove highlight"]')).toBeTruthy()
    // No visible "Highlight" section label (Michael, TEST 2026-10-17) — only an accessible name.
    expect(m!.querySelector('[role="group"][aria-label="Highlight"] [role="radiogroup"]')).toBeTruthy()
    expect([...m!.querySelectorAll('*')].some((el) => el.children.length === 0 && el.textContent?.trim() === 'Highlight')).toBe(false)
    const grid = m!.querySelector<HTMLElement>('[role="radiogroup"]')!
    expect(grid.style.gridTemplateColumns).toBe(`repeat(${Math.ceil((HIGHLIGHT_COLORS.length + 1) / 2)}, 16px)`)
  })

  it('a second right-click re-anchors the same menu instead of stacking another', () => {
    const text = host!.querySelector('[data-verse-text]')!
    rightClick(text, 100, 100)
    act(() => { text.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 2, clientX: 300, clientY: 220 })) })
    rightClick(text, 300, 220)
    expect(document.querySelectorAll('[role="menu"][aria-label$="actions"]').length).toBe(1)
    expect(positioner()!.style.left).toBe('300px')
    expect(positioner()!.style.top).toBe('220px')
  })

  it('closes on Escape, outside mousedown, wheel and window resize', () => {
    const text = host!.querySelector('[data-verse-text]')!
    const reopen = () => { rightClick(text, 50, 50); expect(menu()).toBeTruthy() }

    reopen()
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(menu()).toBeNull()

    reopen()
    act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
    expect(menu()).toBeNull()

    reopen()
    act(() => { host!.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 40 })) })
    expect(menu()).toBeNull()

    reopen()
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(menu()).toBeNull()
  })

  it('clicking inside the portaled menu does not count as an outside click', () => {
    rightClick(host!.querySelector('[data-verse-text]')!, 50, 50)
    const row = [...menu()!.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) => el.textContent?.includes('Tag verse'))!
    act(() => { row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
    expect(menu()).toBeTruthy()
  })

  it('Shift+F10 on the verse number opens it below the number', () => {
    const badge = host!.querySelector<HTMLElement>('[data-verse-badge]')!
    act(() => { badge.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true })) })
    expect(menu()).toBeTruthy()
  })
})
