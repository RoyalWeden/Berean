// @vitest-environment jsdom
/** NOTES-CH-001 — the chapter-notes banner: on (desktop) by default, off on the iPhone reader. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useAppStore } from '@/store'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const verses = [1, 2, 3].map((v) => ({ book_id: 'MAT', chapter: 10, verse_num: v, text: `Verse ${v} text`, text_tagged: null }))
const notes = [
  { id: 'cite', title: 'Luke parallel', content: 'Compare Matthew 10 as a whole.', verseRef: 'LUK.9.1', type: 'verse', createdAt: 0, updatedAt: 0 },
  { id: 'v5', title: 'Verse note', content: 'Only verse 2', verseRef: 'MAT.10.2', type: 'verse', createdAt: 0, updatedAt: 0 },
]
beforeEach(() => {
  const w = window as unknown as Record<string, unknown>
  w.bible = { queryChapter: async () => verses, queryVerse: async () => null }
  w.highlights = { getChapter: async () => ({}), remove: async () => {}, toggle: async () => ({}) }
  w.notes = { getChapterNotes: async () => notes.filter((n) => n.verseRef.startsWith('MAT.10')), getChapterCounts: async () => ({ 2: 1 }), getNotes: async () => notes, createNote: async () => ({}) }
  w.verseTags = { getForChapter: async () => [], list: async () => [] }
  useAppStore.setState({ noteChangeToken: (useAppStore.getState().noteChangeToken ?? 0) + 1 })
})
let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null })

async function render(props: Record<string, unknown>) {
  const { default: ChapterView } = await import('../ChapterView')
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root!.render(<ChapterView bookId="MAT" chapter={10} textId="kjva" showStrongs={false} {...props} />) })
  await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
  return host
}
const hasBanner = (h: HTMLElement) => /Luke parallel|1 note|notes? reference|whole chapter/i.test(h.textContent ?? '')

describe('ChapterView chapter-notes banner', () => {
  it('desktop default: a note citing the whole chapter shows the banner', async () => {
    const h = await render({})
    expect(h.textContent).toContain('Verse 1 text')
    expect(hasBanner(h)).toBe(true)
  })
  it('iPhone reader (chapterNotesBanner=false): no banner over the text; verse text still renders', async () => {
    const h = await render({ chapterNotesBanner: false })
    expect(h.textContent).toContain('Verse 1 text')
    expect(hasBanner(h)).toBe(false)
  })
})
