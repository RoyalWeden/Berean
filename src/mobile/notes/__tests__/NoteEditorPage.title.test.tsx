// @vitest-environment jsdom
/**
 * TEST 2026-09-29 (iPhone Notes): spaces could not be typed in the note title (the field showed a
 * trimmed copy of the stored title), Enter in the title did nothing, and the page had no Done.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import type { Note } from '@/types'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('../../navigation/NavigationStack', () => ({ useNavigation: () => ({ push: vi.fn(), pop: vi.fn() }) }))
vi.mock('../../primitives/Sheet', () => ({ useSheets: () => ({ open: vi.fn() }) }))
vi.mock('../../primitives/ActionSheet', () => ({ useActionSheet: () => vi.fn(), ChoiceList: () => null }))
vi.mock('../../commands/caretRegistry', () => ({ useCaretCommands: () => {}, fromSheetActions: () => [] }))
vi.mock('../../commands/CaretGoTo', () => ({ CaretGoTo: () => null }))
vi.mock('@/components/notes/PrintPreviewModal', () => ({ default: () => null }))
vi.mock('../../primitives/haptics', () => ({ haptic: new Proxy({}, { get: () => () => Promise.resolve() }) }))
vi.mock('@capacitor/keyboard', () => ({ Keyboard: { hide: vi.fn(async () => {}) } }))

import { NoteEditorPage } from '../NoteEditorPage'

let stored: Note
const updateNote = vi.fn(async (_id: string, p: Partial<Note>) => { stored = { ...stored, ...p }; return { success: true } })
let root: Root
let host: HTMLDivElement
beforeEach(() => {
  stored = { id: 'n1', title: 'Test', content: 'Body text', type: 'general', createdAt: 0, updatedAt: 0 } as Note
  updateNote.mockClear()
  ;(window as unknown as { notes: unknown }).notes = {
    getNote: async () => ({ ...stored }), updateNote, createNoteVersion: async () => ({ success: true }),
    getNotes: async () => [], getCollapsedHeadings: async () => [], getCollapsedThreads: async () => [],
  }
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)) })
function type(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}

describe('iPhone note page title', () => {
  it('keeps a typed trailing space and stores multi-word titles', async () => {
    act(() => root.render(<NoteEditorPage noteId="n1" onBack={() => {}} />))
    await settle(); await settle()
    const title = host.querySelector<HTMLTextAreaElement>('.m-note-title')!
    expect(title.value).toBe('Test')
    act(() => title.focus())
    type(title, 'Test ')
    expect(title.value).toBe('Test ')
    type(title, 'Test note')
    expect(title.value).toBe('Test note')
    await act(async () => { await new Promise((r) => setTimeout(r, 700)) })
    expect(stored.title).toBe('Test note')
  })

  it('Enter in the title moves focus into the note body and never inserts a line break', async () => {
    act(() => root.render(<NoteEditorPage noteId="n1" onBack={() => {}} />))
    await settle(); await settle()
    const title = host.querySelector<HTMLTextAreaElement>('.m-note-title')!
    act(() => title.focus())
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    act(() => { title.dispatchEvent(ev) })
    expect(ev.defaultPrevented).toBe(true)
    expect(document.activeElement?.classList.contains('ProseMirror')).toBe(true)
    expect(title.value).toBe('Test')
  })

  it('shows Done while editing and it ends editing', async () => {
    act(() => root.render(<NoteEditorPage noteId="n1" onBack={() => {}} />))
    await settle(); await settle()
    expect(host.querySelector('[aria-label="Done"]')).toBeNull()
    const title = host.querySelector<HTMLTextAreaElement>('.m-note-title')!
    act(() => title.focus())
    const done = host.querySelector<HTMLButtonElement>('[aria-label="Done"]')!
    expect(done).toBeTruthy()
    act(() => done.click())
    expect(host.querySelector('[aria-label="Done"]')).toBeNull()
    expect(document.activeElement).not.toBe(title)
  })

  it('the title lives in the editor scroller (scrolls with the text), not in the header', async () => {
    act(() => root.render(<NoteEditorPage noteId="n1" onBack={() => {}} />))
    await settle(); await settle()
    expect(host.querySelector('.berean-pm-editor .pm-header-slot .m-note-title')).toBeTruthy()
    expect(host.querySelector('.mobile-page-header .m-note-title')).toBeNull()
    expect(host.querySelector('.mobile-back')?.getAttribute('aria-label')).toBe('Back to Notes')
  })
})
