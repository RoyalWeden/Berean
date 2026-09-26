/** TEST25-NOTES-001/002 — the iPhone note save path never drops typed text. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { useNoteAutosave } from '../notes/useNoteAutosave'

type Api = ReturnType<typeof useNoteAutosave>
let api: Api | null = null
let renders: string[] = []
function Harness({ id }: { id: string }) {
  api = useNoteAutosave(id)
  renders.push(api.editorContent)
  return null
}

let root: Root | null = null
let container: HTMLDivElement | null = null
const updateNote = vi.fn(async () => ({ success: true }))

beforeEach(() => {
  vi.useFakeTimers()
  renders = []
  updateNote.mockClear()
  ;(window as unknown as { notes: unknown }).notes = {
    getNote: async (id: string) => ({ id, title: 'T', content: 'start', updatedAt: 0, createdAt: 0, type: 'general' }),
    updateNote,
    createNoteVersion: async () => ({ success: true }),
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => { vi.useRealTimers(); container?.remove() })

async function mount() {
  await act(async () => { root!.render(<Harness id="n1" />) })
  await act(async () => { await Promise.resolve() })
}

describe('useNoteAutosave', () => {
  it('content then title within the debounce saves BOTH', async () => {
    await mount()
    act(() => { api!.persist({ content: 'start and more' }) })
    act(() => { api!.persist({ title: 'New title' }) })
    await act(async () => { vi.advanceTimersByTime(600) })
    expect(updateNote).toHaveBeenCalledTimes(1)
    expect(updateNote).toHaveBeenCalledWith('n1', { content: 'start and more', title: 'New title' })
  })

  it('never hands keystrokes back to the editor (editorContent changes only on load / restore)', async () => {
    await mount()
    const afterLoad = renders.at(-1)
    expect(afterLoad).toBe('start')
    act(() => { api!.persist({ content: 'start typing fast' }) })
    act(() => { api!.persist({ content: 'start typing faster' }) })
    expect(renders.at(-1)).toBe('start')
    expect(api!.note?.content).toBe('start typing faster')
    act(() => { api!.replace({ ...api!.note!, content: 'restored version' }) })
    expect(renders.at(-1)).toBe('restored version')
  })

  it('unmount before the debounce flushes the latest text', async () => {
    await mount()
    act(() => { api!.persist({ content: 'last words' }) })
    act(() => { root!.unmount() })
    expect(updateNote).toHaveBeenCalledWith('n1', { title: 'T', content: 'last words' })
    root = null
  })
})
