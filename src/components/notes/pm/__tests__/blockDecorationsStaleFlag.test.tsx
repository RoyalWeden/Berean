import { describe, it, expect, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import NoteEditorPM from '../NoteEditorPM'
import { useAppStore } from '@/store'

// Regression: buildBlockDecorations reads useAppStore.getState().noteScriptureBlock as a plain
// snapshot, only re-evaluated when ProseMirror actually redraws (i.e. on a dispatched
// transaction). Real-world case: the store's persist middleware rehydrates asynchronously, so
// a note that mounts before rehydration finishes bakes in noteScriptureBlock's default (false)
// value — if the setting then flips true on rehydration with no transaction in between, the
// verse block silently stayed unformatted until some unrelated interaction (a click producing
// a selection transaction) forced a redraw. Reported by the user as "formatting doesn't apply
// until I click/interact." Fixed by subscribing to the setting inside the plugin's view()
// lifecycle hook and forcing a refresh transaction on change (blockDecorations.ts).
let container: HTMLDivElement | null = null
let root: Root | null = null

function mount(props: Parameters<typeof NoteEditorPM>[0]) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(<NoteEditorPM {...props} />))
  return container
}

describe('block decoration repaints when noteScriptureBlock flips without a transaction', () => {
  afterEach(() => {
    useAppStore.getState().setNoteScriptureBlock?.(false)
    if (root) act(() => root!.unmount())
    container?.remove()
    container = null
    root = null
  })

  it('flipping noteScriptureBlock true AFTER mount repaints the verse block on its own', () => {
    useAppStore.getState().setNoteScriptureBlock?.(false)
    const el = mount({
      noteId: 'n1',
      content: 'Genesis 1:1 In the beginning God created the heaven and the earth',
      onChange: () => {},
    })
    // Verse block should NOT be present yet (flag was false at mount/decoration time).
    expect(el.querySelector('.pm-verse-block')).toBeNull()

    // Flip the flag directly via the store (simulates persist rehydration finishing, or a
    // Settings toggle) — deliberately NOT dispatching any ProseMirror transaction ourselves;
    // the plugin's own subscription is what should force the redraw.
    act(() => { useAppStore.getState().setNoteScriptureBlock?.(true) })

    expect(el.querySelector('.pm-verse-block')).toBeTruthy()
  })
})
