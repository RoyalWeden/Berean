// @vitest-environment jsdom
/** NOTES-CH-001 — the Scripture caret's My Notes: the chapter's notes with no verse selected,
 *  the selected verses' notes otherwise; each note once; live. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useAppStore } from '@/store'
import type { SheetApi } from '../primitives/Sheet'
import { ChapterNotesView } from '../study/ChapterNotesView'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@capacitor/haptics', () => ({ Haptics: { impact: () => Promise.resolve(), selectionChanged: () => Promise.resolve(), notification: () => Promise.resolve() }, ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' }, NotificationType: { Success: 'SUCCESS', Warning: 'WARNING' } }))

let notes: Array<Record<string, unknown>>
beforeEach(() => {
  notes = [
    { id: 'ch', title: 'Sending of the twelve', content: 'Chapter overview', verseRef: 'MAT.10', type: 'verse' },
    { id: 'cite', title: 'Luke parallel', content: 'Compare Matthew 10 and Matt 10 again', verseRef: 'LUK.9.1', type: 'verse' },
    { id: 'v', title: 'Verse 5 note', content: 'Gentiles', verseRef: 'MAT.10.5', type: 'verse' },
  ]
  ;(window as unknown as { notes: unknown }).notes = { getNotes: async () => notes, getVerseNotes: async () => [] }
  useAppStore.setState({ noteChangeToken: (useAppStore.getState().noteChangeToken ?? 0) + 1 })
})
let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null })
const api = { close: () => {}, push: vi.fn(), pop: () => {}, setDetent: () => {}, detent: 0 } as unknown as SheetApi
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)) })
async function render(selected: number[]) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => root!.render(<ChapterNotesView bookId="MAT" chapter={10} textId="kjva" selectedVerses={selected} api={api} onOpenInNotes={() => {}} />))
  await settle()
  return host
}
const rows = (h: HTMLElement) => [...h.querySelectorAll('.m-chapter-notes .mobile-newtab-row')].map((r) => r.querySelector('.mobile-newtab-row-text > span')?.textContent)

describe('My Notes (Scripture caret)', () => {
  it('no verse selected: the chapter note and the note citing the chapter, each once; verse-specific notes not listed', async () => {
    const h = await render([])
    expect(rows(h)).toEqual(['Sending of the twelve', 'Luke parallel'])
  })

  it('updates live when a note changes elsewhere (no reopening)', async () => {
    const h = await render([])
    notes = [...notes, { id: 'new', title: 'From the Mac', content: 'Matthew 10 study', verseRef: 'ROM.1.1', type: 'verse' }]
    act(() => useAppStore.getState().bumpNoteToken()); await settle()
    expect(rows(h)).toContain('From the Mac')
  })

  it('tapping a note opens it for editing in the same sheet', async () => {
    const h = await render([])
    act(() => (h.querySelector('.m-chapter-notes .mobile-newtab-row') as HTMLButtonElement).click())
    expect(api.push).toHaveBeenCalledWith(expect.objectContaining({ key: 'note-ch' }))
  })

  it('verses selected: the existing selected-verse My Notes, not the chapter list', async () => {
    const h = await render([5])
    expect(h.querySelector('.m-chapter-notes')).toBeNull()
    expect(h.querySelector('.mobile-crossrefs')).toBeTruthy()
  })
})
