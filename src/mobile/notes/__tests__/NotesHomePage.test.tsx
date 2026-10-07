/** NOTES-HOME-001…009 — the folder-first Notes Home, rendered with the native bridges mocked. */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import type { Note, NoteFolder } from '@/types'

const nav = { push: vi.fn(), pop: vi.fn() }
const sheetOpen = vi.fn()
const actionSheet = vi.fn()
const openDestination = vi.fn()
vi.mock('../../navigation/NavigationStack', () => ({ useNavigation: () => nav }))
vi.mock('../../primitives/Sheet', () => ({ useSheets: () => ({ open: sheetOpen }) }))
vi.mock('../../primitives/ActionSheet', () => ({ useActionSheet: () => actionSheet, ChoiceList: () => null }))
vi.mock('../../commands/caretRegistry', () => ({ useCaretCommands: () => {}, fromSheetActions: () => [] }))
vi.mock('../../calendar/CalendarOverlay', () => ({ useCalendarOverlay: () => () => {} }))
vi.mock('../../commands/CaretGoTo', () => ({ CaretGoTo: () => null }))
vi.mock('../NoteEditorPage', () => ({ NoteEditorPage: () => null }))
vi.mock('../TrashPage', () => ({ TrashPage: () => null }))
vi.mock('@/components/notes/PrintPreviewModal', () => ({ default: () => null }))
vi.mock('@/platform/ios/location', () => ({ ensureDailyNoteLocation: async () => {} }))
vi.mock('@/lib/dailyNotes', () => ({ openDailyNoteInCurrentTab: async () => {} }))
vi.mock('@/lib/navigation/destination', () => ({ openDestination: (...a: unknown[]) => openDestination(...a) }))
vi.mock('../../primitives/haptics', () => ({ haptic: new Proxy({}, { get: () => () => Promise.resolve() }) }))

import { useAppStore } from '@/store'
import { NotesHomePage } from '../NotesHomePage'
import { notesHomePrefs, sectionCollapse } from '../notesHomeModel'

const now = Date.now()
const day = 86_400_000
const mk = (p: Partial<Note>): Note => ({ type: 'general', content: '', createdAt: now - day, updatedAt: now - day, tags: [], folderId: null, pinned: false, ...p } as Note)
let notes: Note[]
let folders: NoteFolder[]
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let api: Record<string, ReturnType<typeof vi.fn<any[], any>>>
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  localStorage.clear(); notesHomePrefs.__reset(); sectionCollapse.__reset()
  vi.clearAllMocks()
  notes = [
    mk({ id: 'n1', title: 'Matthew 5.3', type: 'verse', verseRef: 'MAT.5.3', content: 'Blessed are the poor', updatedAt: now - 60_000 }),
    mk({ id: 'n2', title: 'Feast calendar', folderId: 'a', content: 'Passover and Unleavened Bread', updatedAt: now - 3 * day }),
    mk({ id: 'n3', title: 'Pinned study', pinned: true, folderId: 'b', content: 'Sabbath' }),
    mk({ id: 'n4', title: 'Old thought', updatedAt: now - 400 * day, createdAt: now - 400 * day }),
  ]
  folders = [{ id: 'a', name: 'Sermons', parentId: null, createdAt: 0 }, { id: 'b', name: 'Torah', parentId: 'a', createdAt: 0 }]
  api = {
    getNotes: vi.fn(async () => notes), getFolders: vi.fn(async () => folders), listTrash: vi.fn(async () => [mk({ id: 't1' }), mk({ id: 't2' })]),
    searchNotes: vi.fn(async (q: string) => notes.filter((n) => (n.content ?? '').toLowerCase().includes(q.toLowerCase()))),
    createNote: vi.fn(async () => ({ success: true, note: mk({ id: 'new', title: '' }) })), setNoteFolder: vi.fn(async () => ({ success: true })),
    setNotePinned: vi.fn(async () => ({ success: true })), deleteNote: vi.fn(async () => ({ success: true })), createFolder: vi.fn(async () => ({ success: true })),
  }
  ;(window as unknown as { notes: unknown }).notes = api
  const tabs = useAppStore.getState().tabs
  useAppStore.setState({ tabs: { ...tabs, notes: [{ id: 'nt', spaceId: 'notes', type: 'note', title: 'Notes', state: {} } as never] }, activeTabId: { ...useAppStore.getState().activeTabId, notes: 'nt' } })
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const mount = async () => { act(() => { root.render(<NotesHomePage />) }); await flush() }
const loc = () => (useAppStore.getState().tabs.notes[0].state as { listFolderId?: string | null }).listFolderId ?? null
const click = (el: Element | null | undefined) => act(() => { (el as HTMLElement).click() })
const byText = (sel: string, text: string) => [...container.querySelectorAll(sel)].find((e) => e.textContent?.includes(text))
const titles = () => [...container.querySelectorAll('.m-notes-section-title')].map((h) => h.textContent)

describe('Folders home', () => {
  it('folder-first: large Folders title, All Notes, system folders, the folder tree with counts, Trash', async () => {
    await mount()
    expect(container.querySelector('.m-notes-large-title')!.textContent).toBe('Folders')
    const names = [...container.querySelectorAll('.m-folder-name')].map((e) => e.textContent)
    expect(names).toEqual(['All Notes', 'Verse Notes', 'Sermons', 'Trash'])
    expect(byText('.m-folder-main', 'All Notes')!.querySelector('.m-folder-count')!.textContent).toBe('4')
    expect(byText('.m-folder-main', 'Sermons')!.querySelector('.m-folder-count')!.textContent).toBe('2')   // includes Torah's note
    expect(byText('.m-folder-main', 'Trash')!.querySelector('.m-folder-count')!.textContent).toBe('2')
    expect(container.querySelector('[aria-label="New Folder"]')).not.toBeNull()
    expect(byText('button', 'Edit')).toBeTruthy()
  })
  it('nested folders expand in place; the expansion is remembered', async () => {
    await mount()
    click(container.querySelector('[aria-label="Expand Sermons"]'))
    expect([...container.querySelectorAll('.m-folder-name')].map((e) => e.textContent)).toContain('Torah')
    expect(notesHomePrefs.get().expandedFolders).toEqual(['a'])
  })
  it('All Notes has no folder actions (it cannot be renamed or deleted); Edit shows actions only on your folders', async () => {
    await mount()
    click(byText('button', 'Edit'))
    expect(container.querySelector('[aria-label="All Notes actions"]')).toBeNull()
    click(container.querySelector('[aria-label="Sermons actions"]'))
    expect(actionSheet.mock.calls[0][2].map((a: { label: string }) => a.label)).toEqual(['Rename…', 'New Subfolder…', 'Move…', 'Delete Folder…'])
  })
})

describe('folder view', () => {
  it('All Notes: back to Folders, count line, Pinned first, then date sections, verse-note titles with a colon', async () => {
    await mount()
    click(byText('.m-folder-main', 'All Notes'))
    expect(loc()).toBe('all')
    await flush()
    expect(container.querySelector('.m-notes-large-title')!.textContent).toBe('All Notes')
    expect(container.querySelector('.m-notes-large-sub')!.textContent).toBe('4 Notes')
    expect(container.querySelector('.mobile-back')!.getAttribute('aria-label')).toContain('Folders')
    const t = titles()
    expect(t[0]).toMatch(/^Pinned/)
    expect(t.some((x) => /^Today/.test(x ?? ''))).toBe(true)
    expect(t.some((x) => /^Previous 7 Days/.test(x ?? ''))).toBe(true)
    expect(container.textContent).toContain('Matthew 5:3')
    expect(container.textContent).not.toContain('Matthew 5.3')
  })
  it('a folder: subfolders first, "N Notes · M Folders", compose files the new note there', async () => {
    useAppStore.getState().updateTabState('notes', 'nt', { listFolderId: 'a' })
    await mount()
    expect(container.querySelector('.m-notes-large-sub')!.textContent).toBe('1 Note · 1 Folder')
    expect(titles()[0]).toMatch(/^Folders/)
    click(container.querySelector('.m-notes-compose'))
    await flush()
    expect(api.createNote).toHaveBeenCalled()
    expect(api.setNoteFolder).toHaveBeenCalledWith('new', 'a')
    expect(nav.push).toHaveBeenCalled()
  })
  it('sections collapse and expand', async () => {
    useAppStore.getState().updateTabState('notes', 'nt', { listFolderId: 'all' })
    await mount()
    const n = container.querySelectorAll('.m-note-row').length
    click(byText('.m-notes-section-title button', 'Today'))
    expect(container.querySelectorAll('.m-note-row').length).toBe(n - 1)
    expect(byText('.m-notes-section-title button', 'Today')!.getAttribute('aria-expanded')).toBe('false')
  })
  it('gallery layout uses the card presentation, persisted', async () => {
    notesHomePrefs.set({ layout: 'gallery' })
    useAppStore.getState().updateTabState('notes', 'nt', { listFolderId: 'all' })
    await mount()
    expect(container.querySelectorAll('.m-note-card .mobile-tab-preview.is-note').length).toBe(4)
    expect(container.querySelector('.m-note-row')).toBeNull()
  })
  it('Edit: select notes, then Delete sends them to Trash', async () => {
    useAppStore.getState().updateTabState('notes', 'nt', { listFolderId: 'all' })
    await mount()
    click(byText('button', 'Edit'))
    const rows = container.querySelectorAll('.m-note-row')
    click(rows[0]); click(rows[1])
    expect(container.querySelector('.m-notes-editbar-count')!.textContent).toBe('2 Selected')
    click(byText('.m-notes-editbar button', 'Delete'))
    await flush()
    expect(api.deleteNote).toHaveBeenCalledTimes(2)
  })
  it('swipe right pins; a vertical drag does not move the row', async () => {
    useAppStore.getState().updateTabState('notes', 'nt', { listFolderId: 'all' })
    await mount()
    const content = container.querySelectorAll('.m-swipe-content')[1] as HTMLElement
    const ev = (type: string, x: number, y: number) => new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'touch' } as PointerEventInit)
    act(() => { content.dispatchEvent(ev('pointerdown', 100, 100)); content.dispatchEvent(ev('pointermove', 102, 140)); content.dispatchEvent(ev('pointerup', 102, 140)) })
    expect(content.style.transform).toBe('')
    act(() => { content.dispatchEvent(ev('pointerdown', 100, 100)) })
    act(() => { content.dispatchEvent(ev('pointermove', 160, 102)) })
    act(() => { content.dispatchEvent(ev('pointermove', 200, 102)) })
    act(() => { content.dispatchEvent(ev('pointerup', 200, 102)) })
    click(byText('.m-swipe-action', 'Pin'))
    await flush()
    expect(api.setNotePinned).toHaveBeenCalledWith(expect.any(String), true)
  })
})

describe('search', () => {
  it('one field finds folders and notes', async () => {
    await mount()
    const input = container.querySelector('.m-notes-searchfield input') as HTMLInputElement
    act(() => { input.focus() })
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => { setter.call(input, 'tor'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => { await new Promise((r) => setTimeout(r, 250)) })
    expect(byText('.m-folder-main', 'Sermons / Torah')).toBeTruthy()
    expect(api.searchNotes).toHaveBeenCalledWith('tor', 200)
    expect(byText('button', 'Cancel')).toBeTruthy()
  })
})

describe('one way to create (TEST 2026-10-03)', () => {
  it('no in-list New Folder / centred New Note; the bar New Folder and floating compose remain', async () => {
    folders = []
    await mount()
    expect([...container.querySelectorAll('.m-notes-hint.is-button')].some((b) => /New Folder/.test(b.textContent ?? ''))).toBe(false)
    expect(container.querySelector('[aria-label="New Folder"]')).toBeTruthy()
    expect(container.querySelector('.m-notes-compose')).toBeTruthy()
    notes = []
    useAppStore.getState().updateTabState('notes', 'nt', { listFolderId: 'all' })
    await mount()
    expect([...container.querySelectorAll('.m-notes-empty button')].some((b) => /New Note/.test(b.textContent ?? ''))).toBe(false)
    expect(container.querySelector('.m-notes-compose')).toBeTruthy()
  })
})
