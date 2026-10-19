// @vitest-environment jsdom
/** TEST 2026-10-17 — a text selection spanning several verses opens ChapterView's multi-verse
 *  toolbar; it must NOT offer the (always-disabled) "Add note (select a single verse)" item. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useAppStore } from '@/store'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const verses = [
  { book_id: 'GEN', chapter: 1, verse_num: 1, text: 'In the beginning God created the heaven and the earth.', text_tagged: null },
  { book_id: 'GEN', chapter: 1, verse_num: 2, text: 'And the earth was without form, and void.', text_tagged: null },
]
let root: Root | null = null
let host: HTMLDivElement | null = null
beforeEach(() => {
  const w = window as unknown as Record<string, unknown>
  w.bible = { queryChapter: async () => verses, queryVerse: async () => null }
  w.highlights = { getChapter: async () => ({}), remove: async () => {}, toggle: async () => ({}) }
  w.notes = { getChapterNotes: async () => [], getChapterCounts: async () => ({}), getNotes: async () => [], createNote: async () => ({}) }
  w.verseTags = { getForChapter: async () => [], list: async () => [] }
  useAppStore.setState({ noteChangeToken: (useAppStore.getState().noteChangeToken ?? 0) + 1 })
})
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; window.getSelection()?.removeAllRanges() })

describe('multi-verse text selection toolbar', () => {
  it('omits Add note but keeps the other actions', async () => {
    const { default: ChapterView } = await import('../ChapterView')
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    await act(async () => { root!.render(<ChapterView bookId="GEN" chapter={1} textId="kjva" showStrongs={false} />) })
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })

    const texts = host.querySelectorAll<HTMLElement>('[data-verse-text]')
    expect(texts.length).toBe(2)
    // Real text-node endpoints (what a mouse drag produces): mid verse 1 → mid verse 2.
    const textNodes = (el: HTMLElement) => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const out: Text[] = []; while (w.nextNode()) out.push(w.currentNode as Text); return out }
    const startNode = textNodes(texts[0])[0]
    const endNode = textNodes(texts[1]).at(-1)!
    const range = document.createRange()
    range.setStart(startNode, 1)
    range.setEnd(endNode, Math.max(1, endNode.length - 1))
    const sel = window.getSelection()!
    sel.removeAllRanges(); sel.addRange(range)

    await act(async () => { texts[1].dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 200, clientY: 200 })) })

    const items = [...document.body.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent ?? '')
    expect(items.some((t) => t.includes('Copy verses'))).toBe(true)
    expect(items.some((t) => t.includes('Select verses 1–2'))).toBe(true)
    expect(document.body.textContent).not.toContain('Add note')
  })
})
