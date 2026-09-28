/**
 * TEST25-NOTES-001 — typed text must never be replaced by a stale echo of the editor's own
 * output. On iPhone every keystroke saves and re-renders the editor with `content` = what it
 * just emitted; when the next keystroke (or an iOS autocorrect / composition flush) lands before
 * that render, the prop is an OLDER copy of the editor's own text. The editor used to treat it
 * as an external edit and replace the document — the typed text "disappeared".
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import NoteEditorPM from '../NoteEditorPM'

let container: HTMLDivElement | null = null
let root: Root | null = null
afterEach(() => { if (root) act(() => root!.unmount()); container?.remove(); container = null; root = null })

async function typeInto(el: HTMLElement, text: string) {
  const p = el.querySelector('.ProseMirror p') as HTMLElement
  const node = p.firstChild as Text
  node.data = text
  // Let ProseMirror's DOMObserver (MutationObserver) read the change and dispatch.
  await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
}

describe('NoteEditorPM stale echo guard', () => {
  it('ignores an older copy of its own output for the same note', async () => {
    const emitted: string[] = []
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const render = (content: string) => act(() => root!.render(<NoteEditorPM noteId="n1" content={content} onChange={(c) => emitted.push(c)} />))
    render('Hello')
    await typeInto(container, 'Hello w')
    await typeInto(container, 'Hello world')
    expect(emitted.at(-1)).toBe('Hello world')
    // The re-render for the FIRST keystroke arrives late, carrying the older text.
    render(emitted[0])
    expect(container.querySelector('.ProseMirror')?.textContent).toBe('Hello world')
    // …and the in-order echo is of course a no-op too.
    render('Hello world')
    expect(container.querySelector('.ProseMirror')?.textContent).toBe('Hello world')
  })

  it('still applies a genuinely external change and a different note', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root!.render(<NoteEditorPM noteId="n1" content="Hello" onChange={() => {}} />))
    act(() => root!.render(<NoteEditorPM noteId="n1" content="Edited in Octarine" onChange={() => {}} />))
    expect(container.querySelector('.ProseMirror')?.textContent).toBe('Edited in Octarine')
    act(() => root!.render(<NoteEditorPM noteId="n2" content="Another note" onChange={() => {}} />))
    expect(container.querySelector('.ProseMirror')?.textContent).toBe('Another note')
  })
})
