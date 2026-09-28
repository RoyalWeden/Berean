// @vitest-environment jsdom
/**
 * DATA-LIVE-001 — an open note updates from a change made on another device WITHOUT closing,
 * reopening or remounting: the iPhone Scripture-sheet note editor and the Notes-tab editor host
 * (both on useNoteAutosave) observe the same database change; formatting and Scripture references
 * survive; a composition is never overwritten.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useAppStore } from '@/store'
import type { Note } from '@/types'
import type { EditorView } from 'prosemirror-view'
import NoteEditorPM from '@/components/notes/pm/NoteEditorPM'
import { SheetNoteEditor } from '../study/VerseNotesSheet'
import { useNoteAutosave } from '../notes/useNoteAutosave'
import type { SheetApi } from '../primitives/Sheet'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@capacitor/haptics', () => ({ Haptics: { impact: () => Promise.resolve(), selectionChanged: () => Promise.resolve(), notification: () => Promise.resolve() }, ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' }, NotificationType: { Success: 'SUCCESS', Warning: 'WARNING' } }))

let stored: Note
const createNoteVersion = vi.fn(async () => ({ success: true }))
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  stored = { id: 'n1', title: 'Matthew 10:5', content: 'Go not into the way of the Gentiles', type: 'verse', createdAt: 0, updatedAt: 0 } as Note
  createNoteVersion.mockClear()
  ;(window as unknown as { notes: unknown }).notes = {
    getNote: async () => ({ ...stored }),
    updateNote: vi.fn(async (_id: string, p: Partial<Note>) => { stored = { ...stored, ...p }; return { success: true } }),
    createNoteVersion,
    getNotes: async () => [], getCollapsedHeadings: async () => [], getCollapsedThreads: async () => [],
  }
})
let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; vi.useRealTimers(); document.body.innerHTML = '' })

const api = { close: () => {}, push: () => {}, pop: () => {}, popToRoot: () => {}, expand: () => {}, setDetent: () => {}, detent: 1, atLow: false } as unknown as SheetApi
function NotesTabHost() {
  const { editorContent, note, persist, deferredWhileComposing } = useNoteAutosave('n1')
  if (!note) return null
  return <div className="tab-host"><NoteEditorPM content={editorContent} noteId={note.id} onChange={(c) => persist({ content: c })} onExternalDeferred={deferredWhileComposing} /></div>
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 10)) })
const remote = async (patch: Partial<Note>) => { stored = { ...stored, ...patch }; act(() => useAppStore.getState().bumpNoteToken()); await settle(); await settle() }

describe('open note, remote change', () => {
  it('the Scripture sheet editor AND the Notes-tab editor both update in place — same mounted editor, no reopen', async () => {
    await act(async () => { vi.advanceTimersByTime(3000) })
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    act(() => root!.render(<><div className="sheet-host"><SheetNoteEditor noteId="n1" api={api} onOpenInNotes={() => {}} /></div><NotesTabHost /></>))
    await settle(); await settle()
    const sheetPm = host.querySelector('.sheet-host .ProseMirror')!
    const tabPm = host.querySelector('.tab-host .ProseMirror')!
    expect(sheetPm.textContent).toBe('Go not into the way of the Gentiles')
    await remote({ content: '**DEVICE B TEST 002** — see [[Matthew 10:5]]', title: 'Renamed on the Mac' })
    // same DOM nodes (no remount), new text, formatting and the Scripture reference preserved
    expect(host.querySelector('.sheet-host .ProseMirror')).toBe(sheetPm)
    expect(host.querySelector('.tab-host .ProseMirror')).toBe(tabPm)
    for (const pm of [sheetPm, tabPm]) {
      expect(pm.textContent).toContain('DEVICE B TEST 002')
      expect(pm.querySelector('strong')?.textContent).toBe('DEVICE B TEST 002')
      expect(pm.textContent).toContain('Matthew 10:5')
    }
    expect((host.querySelector('.mobile-sheet-note-title') as HTMLInputElement).value).toBe('Renamed on the Mac')
    // a duplicate event changes nothing
    const html = sheetPm.innerHTML
    act(() => useAppStore.getState().bumpNoteToken()); await settle()
    expect(sheetPm.innerHTML).toBe(html)
  })
})

describe('NoteEditorPM, same mounted editor', () => {
  function mount(content: string, extra: Partial<React.ComponentProps<typeof NoteEditorPM>> = {}) {
    let view: EditorView | null = null
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    const render = (c: string) => act(() => root!.render(<NoteEditorPM noteId="n1" content={c} onChange={() => {}} onEditorReady={(v) => { if (v) view = v }} {...extra} />))
    render(content)
    return { render, get view() { return view! } }
  }

  it('an outside change during a composition is handed back, not dropped, and not applied over it', () => {
    const deferred = vi.fn()
    const ed = mount('Hello', { onExternalDeferred: deferred })
    ;(ed.view as unknown as { input: { composing: boolean } }).input.composing = true
    ed.render('Hello from the Mac')
    expect(ed.view.dom.textContent).toBe('Hello')
    expect(deferred).toHaveBeenCalledWith('Hello from the Mac')
    ;(ed.view as unknown as { input: { composing: boolean } }).input.composing = false
  })

  it('after an outside change, a later outside change back to an old local text is applied (no stale echo)', async () => {
    const ed = mount('A')
    // the user types → the editor emits "AB"
    act(() => { ed.view.dispatch(ed.view.state.tr.insertText('B', 2)) })
    expect(ed.view.dom.textContent).toBe('AB')
    ed.render('C from the Mac')
    expect(ed.view.dom.textContent).toBe('C from the Mac')
    ed.render('AB')                       // the Mac reverts to the text we once typed
    expect(ed.view.dom.textContent).toBe('AB')
  })

  it('the cursor stays at the same offset when an outside change lands', () => {
    const ed = mount('Hello world')
    act(() => { ed.view.dispatch(ed.view.state.tr.setSelection((ed.view.state.selection.constructor as unknown as { near: (p: unknown) => never }).near(ed.view.state.doc.resolve(6)))) })
    ed.render('Hello world, again')
    expect(ed.view.state.selection.from).toBe(6)
  })
})
