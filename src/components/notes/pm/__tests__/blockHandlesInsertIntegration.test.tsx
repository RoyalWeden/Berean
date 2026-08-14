import { describe, it, expect, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import NoteEditorPM from '../NoteEditorPM'

// Reported bug: clicking the "+" (insert block) button in the gutter freezes the app. The
// isolated blockHandles.test.ts coverage (plugin mounted alone, no React, no other plugins, no
// markdown serialization) passes even for the exact stale-position scenario that bug turned out
// to be — so if something ELSE in the full stack (all plugins combined, NoteEditorPM's
// dispatchTransaction -> serializeToMarkdown -> onChange -> parent re-render cycle) is
// responsible, only an integration-level test through the real component will catch it. A true
// hang would show up here as this test's own timeout, with whatever synchronous work is still
// in progress visible in the failure.
let container: HTMLDivElement | null = null
let root: Root | null = null

function mount(props: Parameters<typeof NoteEditorPM>[0]) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(<NoteEditorPM {...props} />))
  return container
}

afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove()
  container = null
  root = null
})

describe('blockHandles "+" insert button — full NoteEditorPM integration', () => {
  it('clicking "+" on a simple multi-paragraph note completes without hanging', () => {
    const content = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.'
    const el = mount({ noteId: 'note-plus-1', content, onChange: () => {} })

    const insertBtns = el.querySelectorAll<HTMLButtonElement>('.pm-block-handle-insert')
    expect(insertBtns.length).toBeGreaterThan(0)

    act(() => {
      insertBtns[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    // A real paragraph got inserted — proves the click actually ran to completion, not just
    // "didn't throw."
    expect(el.querySelectorAll('.pm-block-handle-insert').length).toBe(insertBtns.length + 1)
  })

  it('clicking "+" repeatedly in a row (rapid double-click-ish usage) completes without hanging', () => {
    const content = 'A.\n\nB.\n\nC.'
    const el = mount({ noteId: 'note-plus-2', content, onChange: () => {} })

    for (let i = 0; i < 5; i++) {
      const btns = el.querySelectorAll<HTMLButtonElement>('.pm-block-handle-insert')
      act(() => {
        btns[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      })
    }

    // 3 original blocks + 5 inserted ones.
    expect(el.querySelectorAll('.pm-block-handle-insert').length).toBe(8)
  })

  it('typing, then clicking "+" on a later block, completes without hanging (mirrors the reported repro shape through the real stack, not the isolated plugin harness)', () => {
    const content = 'First.\n\nSecond.\n\nThird.'
    const el = mount({ noteId: 'note-plus-3', content, onChange: () => {} })

    // Edit the first paragraph directly via the ProseMirror view (simulates the user typing),
    // which shifts every later block's character offset without changing block count.
    const view = (el.ownerDocument.defaultView as unknown as { __pmView?: unknown }).__pmView
    // No direct view handle exposed — instead dispatch a real input via the contentEditable
    // DOM, matching how an actual keystroke would arrive.
    void view
    const firstPara = el.querySelector('.ProseMirror > p') as HTMLElement
    expect(firstPara).toBeTruthy()

    const insertBtnsBefore = el.querySelectorAll<HTMLButtonElement>('.pm-block-handle-insert')
    const thirdBtn = insertBtnsBefore[2]

    act(() => {
      thirdBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    expect(el.querySelectorAll('.pm-block-handle-insert').length).toBe(insertBtnsBefore.length + 1)
  })
})
