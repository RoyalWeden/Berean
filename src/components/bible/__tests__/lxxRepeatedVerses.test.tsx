// @vitest-environment jsdom
/** Rahlfs LXX stores lettered additions as repeated verse numbers (1 Kings 2:35 ×15). Every row
 *  must render, labelled 35, 35a, 35b … (keying by verse_num alone collapsed them to one). */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useAppStore } from '@/store'
import { lxxLetter } from '../ChapterView'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const verses = [
  { book_id: '1KI', chapter: 2, verse_num: 34, text: 'row 34', text_tagged: null },
  { book_id: '1KI', chapter: 2, verse_num: 35, text: 'row 35', text_tagged: null },
  { book_id: '1KI', chapter: 2, verse_num: 35, text: 'row 35a', text_tagged: null },
  { book_id: '1KI', chapter: 2, verse_num: 35, text: 'row 35b', text_tagged: null },
  { book_id: '1KI', chapter: 2, verse_num: 36, text: 'row 36', text_tagged: null },
]
beforeEach(() => {
  const w = window as unknown as Record<string, unknown>
  w.bible = { queryChapter: async () => verses, queryVerse: async () => null }
  w.highlights = { getChapter: async () => ({}), remove: async () => {}, toggle: async () => ({}) }
  w.notes = { getChapterNotes: async () => [], getChapterCounts: async () => ({}), getNotes: async () => [], createNote: async () => ({}) }
  w.verseTags = { getForChapter: async () => [], list: async () => [] }
  useAppStore.setState({ noteChangeToken: (useAppStore.getState().noteChangeToken ?? 0) + 1 })
})
let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null })

describe('LXX repeated verse numbers', () => {
  it('letters: 1 → a, 26 → z, 27 → aa', () => {
    expect([1, 2, 14, 26, 27].map(lxxLetter)).toEqual(['a', 'b', 'n', 'z', 'aa'])
  })
  it('renders every row with lettered labels', async () => {
    const { default: ChapterView } = await import('../ChapterView')
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    await act(async () => { root!.render(<ChapterView bookId="1KI" chapter={2} textId="lxx" showStrongs={false} />) })
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    for (const t of ['row 34', 'row 35', 'row 35a', 'row 35b', 'row 36']) expect(host.textContent).toContain(t)
    const labels = [...host.querySelectorAll('[data-verse-badge]')].map((b) => b.textContent?.trim())
    expect(labels).toEqual(expect.arrayContaining(['35', '35a', '35b']))
  })
})
