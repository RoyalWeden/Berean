import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import NoteEditorPM from '../NoteEditorPM'
import { useAppStore } from '@/store'

// Regression: switching to a different note (re-rendering with a new noteId/content, the
// exact path used when the user clicks a different note in the sidebar) must paint verse-ref/
// lexicon-ref/block decorations immediately, with no further interaction (click/keystroke)
// needed to force a repaint.
let container: HTMLDivElement | null = null
let root: Root | null = null

function mount(props: Parameters<typeof NoteEditorPM>[0]) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(<NoteEditorPM {...props} />))
  return container
}

describe('note switch: instant formatting without interaction', () => {
  beforeEach(() => { useAppStore.getState().setNoteScriptureBlock?.(true) })
  afterEach(() => {
    useAppStore.getState().setNoteScriptureBlock?.(false)
    if (root) act(() => root!.unmount())
    container?.remove()
    container = null
    root = null
  })

  it('switching notes (re-render with new noteId) shows pm-verse-ref/pm-lexicon-ref immediately', () => {
    const el = mount({ noteId: 'note-1', content: 'First note, nothing special.', onChange: () => {} })
    expect(el.querySelector('.pm-verse-ref')).toBeNull()
    expect(el.querySelector('.pm-lexicon-ref')).toBeNull()

    act(() => {
      root!.render(
        <NoteEditorPM noteId="note-2" content="See Gen 1:1 and H7225." onChange={() => {}} />,
      )
    })

    expect(el.querySelector('.pm-verse-ref')).toBeTruthy()
    expect(el.querySelector('.pm-lexicon-ref')).toBeTruthy()
  })

  it('switching notes shows a lexicon BLOCK (Strong\'s) immediately, no click', () => {
    mount({ noteId: 'note-1', content: 'First note.', onChange: () => {} })
    act(() => {
      root!.render(
        <NoteEditorPM
          noteId="note-2"
          content={'G5463 χαίρω chaírō;\na primary verb; to be cheerful'}
          onChange={() => {}}
        />,
      )
    })
    const html = container!.querySelector('.ProseMirror')?.innerHTML ?? ''
    expect(html).toContain('pm-lexicon-block')
  })
})
