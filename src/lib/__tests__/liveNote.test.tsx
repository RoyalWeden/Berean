// @vitest-environment jsdom
/** DATA-LIVE-001 — an OPEN note follows changes made elsewhere without reopening; typing is safe. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useAppStore } from '@/store'
import type { Note } from '@/types'
import { decideExternal, useLiveNote } from '../notes/liveNote'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('decideExternal', () => {
  const local = { id: 'n', content: 'mine', title: 'T' }
  it('the rule', () => {
    expect(decideExternal({ id: 'n', content: 'mine', title: 'T' }, local, { dirty: false })).toBe('ignore')
    expect(decideExternal({ id: 'x', content: 'other', title: 'T' }, local, { dirty: false })).toBe('ignore')
    expect(decideExternal({ id: 'n', content: 'theirs', title: 'T' }, local, { dirty: false })).toBe('apply')
    expect(decideExternal({ id: 'n', content: 'mine', title: 'New title' }, local, { dirty: false })).toBe('apply')
    expect(decideExternal({ id: 'n', content: 'theirs', title: 'T' }, local, { dirty: true })).toBe('defer')
    expect(decideExternal({ id: 'n', content: 'older mine', title: 'T' }, local, { dirty: false, ownEcho: true })).toBe('ignore')
  })
})

let stored: Note
const createNoteVersion = vi.fn(async () => ({ success: true }))
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  stored = { id: 'n', title: 'T', content: 'mine', type: 'general', createdAt: 0, updatedAt: 0 } as Note
  createNoteVersion.mockClear()
  ;(window as unknown as { notes: unknown }).notes = { getNote: async () => ({ ...stored }), createNoteVersion }
})
let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; vi.useRealTimers() })

function Host({ dirty, onShown }: { dirty: { current: boolean }; onShown: (n: Note) => void }) {
  const [note, setNote] = React.useState<Note>({ ...stored })
  const ref = React.useRef(note); ref.current = note
  useLiveNote({ noteId: 'n', getLocal: () => ref.current, isDirty: () => dirty.current, onApply: (n) => { setNote(n); onShown(n) } })
  return <div data-testid="shown">{note.title}|{note.content}</div>
}
const bump = () => act(() => useAppStore.getState().bumpNoteToken())
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 5)) })

describe('useLiveNote (the Mac panels)', () => {
  it('a CLEAN open note shows the remote text and title in place — no reopen', async () => {
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    const dirty = { current: false }
    act(() => root!.render(<Host dirty={dirty} onShown={() => {}} />))
    stored = { ...stored, content: 'DEVICE B TEST 002', title: 'Renamed' }
    bump(); await settle()
    expect(host.textContent).toBe('Renamed|DEVICE B TEST 002')
  })

  it('a DIRTY note is not overwritten; the remote text is kept as a version and shown after the pause', async () => {
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    const dirty = { current: true }
    act(() => root!.render(<Host dirty={dirty} onShown={() => {}} />))
    stored = { ...stored, content: 'remote while typing' }
    bump(); await settle()
    expect(host.textContent).toBe('T|mine')
    expect(createNoteVersion).toHaveBeenCalledWith('n', 'T', 'remote while typing', 'external')
    bump(); await settle()
    expect(createNoteVersion).toHaveBeenCalledTimes(1)          // kept once, not on every event
    dirty.current = false
    await act(async () => { vi.advanceTimersByTime(2300) }); await settle()
    expect(host.textContent).toBe('T|remote while typing')
  })

  it('duplicate change events apply once', async () => {
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    const shown = vi.fn()
    act(() => root!.render(<Host dirty={{ current: false }} onShown={shown} />))
    stored = { ...stored, content: 'once' }
    bump(); bump(); bump(); await settle()
    expect(shown).toHaveBeenCalledTimes(1)
  })
})
