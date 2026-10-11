import { describe, it, expect, afterEach, vi } from 'vitest'
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

// The gutter's "+" moved into the block menu ("Add Block Below", TEST 2026-10-10). Same
// integration concern as before: the whole stack (every plugin, serialization, onChange → parent
// re-render) must complete the insert without hanging — exercised here through the real menu.
function clickMenuItem(label: string) {
  const item = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((b) => b.textContent?.includes(label))
  expect(item, `menu item "${label}"`).toBeTruthy()
  vi.useFakeTimers()
  try {
    act(() => { item!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
    // "Add Block Below" runs once the menu has unmounted (a 0 ms timer — NoteEditorPM).
    act(() => { vi.advanceTimersByTime(1) })
  } finally {
    vi.useRealTimers()
  }
}

function openBlockMenu(el: HTMLElement, index: number) {
  const grip = el.querySelectorAll<HTMLButtonElement>('.pm-block-handle-grip')[index]
  act(() => {
    grip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    grip.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
    grip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

describe('block menu "Add Block Below" — full NoteEditorPM integration', () => {
  it('adds a block under the chosen one without hanging', () => {
    const content = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.'
    const el = mount({ noteId: 'note-plus-1', content, onChange: () => {} })
    const before = el.querySelectorAll('.pm-block-handle-grip').length
    expect(before).toBe(3)
    openBlockMenu(el, 1)
    clickMenuItem('Add Block Below')
    expect(el.querySelectorAll('.pm-block-handle-grip').length).toBe(before + 1)
    const paras = Array.from(el.querySelectorAll('.ProseMirror > p')).map((p) => p.textContent)
    expect(paras[1]).toBe('Second paragraph.')
    expect(paras[2]).toBe('')
  })

  it('repeated adds complete without hanging', () => {
    const el = mount({ noteId: 'note-plus-2', content: 'A.\n\nB.\n\nC.', onChange: () => {} })
    for (let i = 0; i < 5; i++) {
      openBlockMenu(el, 0)
      clickMenuItem('Add Block Below')
      // Close the / menu the add opened before the next round.
      act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    }
    expect(el.querySelectorAll('.pm-block-handle-grip').length).toBe(8)
  })

  it('the grip selects the block — no text gets selected and its content is untouched', () => {
    const el = mount({ noteId: 'note-plus-3', content: 'First.\n\nSecond.', onChange: () => {} })
    openBlockMenu(el, 1)
    expect(el.querySelector('.berean-pm-editor')!.classList.contains('pm-block-selected')).toBe(true)
    expect(el.querySelector('.ProseMirror-selectednode')?.textContent).toBe('Second.')
  })
})
