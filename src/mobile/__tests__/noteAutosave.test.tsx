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
afterEach(() => { if (root) act(() => root!.unmount()); root = null; vi.useRealTimers(); container?.remove() })

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

/**
 * NOTES-IOS-004 — external updates (iCloud / desktop / another editor) never overwrite active
 * typing: echoes of our own saves are ignored, an outside change while editing is preserved as a
 * version and NOT applied, and an outside change while idle replaces the editor content.
 */
describe('useNoteAutosave external-update policy', () => {
  let stored = 'start'
  const createNoteVersion = vi.fn(async () => ({ success: true }))
  beforeEach(async () => {
    stored = 'start'
    createNoteVersion.mockClear()
    ;(window as unknown as { notes: unknown }).notes = {
      getNote: async (id: string) => ({ id, title: 'T', content: stored, updatedAt: 0, createdAt: 0, type: 'general' }),
      updateNote: vi.fn(async (_id: string, p: { content?: string }) => { if (p.content != null) stored = p.content; return { success: true } }),
      createNoteVersion,
    }
    const { useAppStore } = await import('@/store')
    bump = () => useAppStore.getState().bumpNoteToken()
  })
  let bump = () => {}
  const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

  it('ignores the echo of its own save', async () => {
    await mount()
    act(() => { api!.persist({ content: 'start typed' }) })
    await act(async () => { vi.advanceTimersByTime(600) })
    await settle()
    act(() => bump()); await settle()
    expect(renders.at(-1)).toBe('start')
    expect(createNoteVersion).not.toHaveBeenCalled()
  })

  it('while the user is typing, an outside change is preserved as a version, not applied', async () => {
    await mount()
    act(() => { api!.persist({ content: 'start local' }) })
    stored = 'changed on the Mac'
    act(() => bump()); await settle()
    expect(renders.at(-1)).toBe('start')
    expect(api!.note?.content).toBe('start local')
    expect(createNoteVersion).toHaveBeenCalledWith('n1', 'T', 'changed on the Mac', 'external')
  })

  it('when idle, an outside change replaces the editor content', async () => {
    await mount()
    await act(async () => { vi.advanceTimersByTime(3000) })
    stored = 'changed on the Mac'
    act(() => bump()); await settle()
    expect(renders.at(-1)).toBe('changed on the Mac')
    expect(createNoteVersion).not.toHaveBeenCalledWith('n1', 'T', 'changed on the Mac', 'external')
  })

  it('the unmount flush keeps every pending field', async () => {
    await mount()
    act(() => { api!.persist({ content: 'x', tags: ['a'] } as never) })
    act(() => { root!.unmount() })
    root = null
    expect((window as unknown as { notes: { updateNote: ReturnType<typeof vi.fn> } }).notes.updateNote).toHaveBeenCalledWith('n1', { content: 'x', tags: ['a'], title: 'T' })
  })
})
