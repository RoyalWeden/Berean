import { describe, it, expect, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import NoteEditorPM from '../NoteEditorPM'
import { SAVE_FLASH_HOLD_MS } from '../Toolbar'

// Fluid-feel polish #2.3 — the "Saved" indicator only exists to confirm a REAL completed
// autosave (NotesPanel.tsx chains it onto the actual save IPC promise resolving), never a
// raw keystroke, and it should fade rather than pop away — this covers the show/fade
// contract at the NoteEditorPM → Toolbar boundary (`lastSavedAt` prop in, visible "Saved"
// text + its opacity transition out), independent of NotesPanel's own save-timing logic
// (already covered elsewhere by the autosave/lastSelfSaveRef machinery's own tests).
let container: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove()
  container = null
  root = null
  vi.useRealTimers()
})

function mount(props: Parameters<typeof NoteEditorPM>[0]) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(<NoteEditorPM {...props} />))
  return container
}

function findSavedSpan(el: HTMLDivElement): HTMLElement | null {
  return Array.from(el.querySelectorAll('span')).find((s) => s.textContent?.trim() === 'Saved') ?? null
}

describe('autosave "Saved" indicator', () => {
  it('does not render before any save has ever completed (lastSavedAt undefined)', () => {
    const el = mount({ content: 'Hello', onChange: () => {} })
    expect(findSavedSpan(el)).toBeNull()
  })

  it('appears at full opacity the moment lastSavedAt is set', () => {
    const el = mount({ content: 'Hello', onChange: () => {}, lastSavedAt: null })
    expect(findSavedSpan(el)).toBeNull()

    act(() => {
      root!.render(<NoteEditorPM content="Hello" onChange={() => {}} lastSavedAt={Date.now()} />)
    })

    const span = findSavedSpan(el)
    expect(span).toBeTruthy()
    expect(span!.style.opacity).toBe('1')
  })

  it('fades (opacity 0) after SAVE_FLASH_HOLD_MS without unmounting, and re-shows on the next save', () => {
    vi.useFakeTimers()
    const el = mount({ content: 'Hello', onChange: () => {}, lastSavedAt: null })

    act(() => {
      root!.render(<NoteEditorPM content="Hello" onChange={() => {}} lastSavedAt={1000} />)
    })
    expect(findSavedSpan(el)!.style.opacity).toBe('1')

    act(() => { vi.advanceTimersByTime(SAVE_FLASH_HOLD_MS + 10) })
    // Still mounted (so the CSS opacity transition can actually animate), just faded.
    expect(findSavedSpan(el)).toBeTruthy()
    expect(findSavedSpan(el)!.style.opacity).toBe('0')

    // A later, distinct save timestamp re-triggers the full-opacity flash — not a one-shot.
    act(() => {
      root!.render(<NoteEditorPM content="Hello" onChange={() => {}} lastSavedAt={2000} />)
    })
    expect(findSavedSpan(el)!.style.opacity).toBe('1')
  })

  it('a re-render with the SAME lastSavedAt value does not re-flash (no dependency on unrelated re-renders)', () => {
    vi.useFakeTimers()
    const el = mount({ content: 'Hello', onChange: () => {}, lastSavedAt: 5000 })
    expect(findSavedSpan(el)!.style.opacity).toBe('1')

    act(() => { vi.advanceTimersByTime(SAVE_FLASH_HOLD_MS + 10) })
    expect(findSavedSpan(el)!.style.opacity).toBe('0')

    // Same timestamp, different unrelated prop (content) changing — should stay faded.
    act(() => {
      root!.render(<NoteEditorPM content="Hello world" onChange={() => {}} lastSavedAt={5000} />)
    })
    expect(findSavedSpan(el)!.style.opacity).toBe('0')
  })
})
