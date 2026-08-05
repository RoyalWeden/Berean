import { describe, it, expect, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import NotesBoardView from '../NotesBoardView'
import type { Note } from '@/types'

let container: HTMLDivElement | null = null
let root: Root | null = null

function mount(notes: Note[]) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(<NotesBoardView notes={notes} onSelect={() => {}} onSetStatus={() => {}} />))
  return container
}

function makeNote(overrides: Partial<Note> & { id: string; title: string }): Note {
  return { content: '', createdAt: Date.now(), updatedAt: Date.now(), tags: [], ...overrides } as Note
}

describe('NotesBoardView', () => {
  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    container = null
    root = null
  })

  it('renders exactly the 5 status columns, no "No status" column', () => {
    const el = mount([])
    const headers = Array.from(el.querySelectorAll('.text-xs.font-medium')).map((n) => n.textContent)
    expect(headers).toEqual(['Started', 'In Progress', 'Complete', 'Make Video', 'Archive'])
  })

  it('a note with no status does not appear on the board at all', () => {
    const notes = [
      makeNote({ id: 'n1', title: 'Has status', status: 'started' }),
      makeNote({ id: 'n2', title: 'No status note' }),
    ]
    const el = mount(notes)
    expect(el.textContent).toContain('Has status')
    expect(el.textContent).not.toContain('No status note')
  })

  it('strips markdown/HTML formatting from the card preview text', () => {
    const notes = [
      makeNote({ id: 'n1', title: 'Note', status: 'started', content: '**bold** and <mark>marked</mark> and ==highlighted==' }),
    ]
    const el = mount(notes)
    expect(el.textContent).toContain('bold and marked and highlighted')
    expect(el.textContent).not.toContain('**bold**')
    expect(el.textContent).not.toContain('<mark>')
    expect(el.textContent).not.toContain('==highlighted==')
  })
})
