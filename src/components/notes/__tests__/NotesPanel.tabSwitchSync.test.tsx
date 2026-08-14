import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act, StrictMode } from 'react'
import NotesPanel from '../NotesPanel'
import { useAppStore } from '@/store'
import { setCachedNote } from '@/lib/noteCache'
import type { Note, Tab, NoteTabState } from '@/types'

// Regression coverage for the tab-switch flashing fix (a2cc922 / ae77401) and the
// scroll/cursor persistence fixes (4aa7b26 / 9a8cea1) now that NotesPanel stays mounted
// across note-tab switches (ActivePanel.tsx keys note tabs as a constant 'panel:note',
// not tab.id — see its own comment). Also covers the new note-status feature resyncing
// correctly on tab switch, which shares the exact same risk class.
//
// These tests mount the REAL NotesPanel against the REAL store (useAppStore) — only the
// Electron IPC surface (window.notes/window.settings/window.vault) is mocked, matching how
// NotesPanel is actually driven in the app: switching tabs via useAppStore.getState().setActiveTab,
// exactly like TabHeaderPortal/Sidebar do, so the real 'berean:saveScrollBeforeTabChange' dispatch
// and the real per-tab persisted state round-trip are exercised, not reimplemented.

function makeNote(overrides: Partial<Note> & { id: string; title: string }): Note {
  return {
    content: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tags: [],
    ...overrides,
  } as Note
}

function makeNoteTab(id: string, noteId: string, extraState: Partial<NoteTabState> = {}): Tab {
  return {
    id,
    spaceId: 'notes',
    type: 'note',
    title: id,
    state: { noteId, isNew: false, ...extraState },
  } as Tab
}

let container: HTMLDivElement | null = null
let root: Root | null = null

function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  // `floating` renders its own PanelHeader directly rather than portaling into the shared
  // TopBar's slot (TabHeaderPortal's useTopBarSlot() context, which isn't provided outside
  // the real app shell) — this is what makes the header buttons (More menu, status dropdown)
  // actually present in the DOM for these tests.
  act(() => root!.render(<NotesPanel floating />))
  return container
}

function unmount() {
  if (root) act(() => root!.unmount())
  container?.remove()
  container = null
  root = null
}

describe('NotesPanel tab-switch state sync', () => {
  const noteA = makeNote({ id: 'note-a', title: 'Note A', content: 'Content A', status: 'in-progress' })
  const noteB = makeNote({ id: 'note-b', title: 'Note B', content: 'Content B' }) // no status

  beforeEach(() => {
    ;(window as unknown as { notes: unknown }).notes = {
      getNotes: vi.fn(async () => [noteA, noteB]),
      getFolders: vi.fn(async () => []),
      searchNotes: vi.fn(async () => []),
      listIdioms: vi.fn(async () => []),
      getNote: vi.fn(async (id: string) => (id === noteA.id ? noteA : id === noteB.id ? noteB : null)),
      getNoteVersions: vi.fn(async () => []),
      createNoteVersion: vi.fn(async () => ({ success: true })),
      restoreNoteVersion: vi.fn(async () => ({ success: true })),
      updateNote: vi.fn(async () => ({ success: true })),
      createNote: vi.fn(async () => ({ success: true })),
      deleteNote: vi.fn(async () => ({ success: true })),
      setNoteFolder: vi.fn(async () => ({ success: true })),
      createFolder: vi.fn(async () => ({ success: true, id: 'f1' })),
      renameFolder: vi.fn(async () => ({ success: true })),
      deleteFolder: vi.fn(async () => ({ success: true })),
      deleteFolderDeep: vi.fn(async () => ({ success: true })),
      setFolderParent: vi.fn(async () => ({ success: true })),
      onChanged: vi.fn(),
    }
    ;(window as unknown as { settings: unknown }).settings = {
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => undefined),
    }
    ;(window as unknown as { vault: unknown }).vault = {
      syncNote: vi.fn(async () => undefined),
    }
    ;(window as unknown as { app: unknown }).app = {
      openFloatingTab: vi.fn(),
      pushViewerContent: vi.fn(),
    }

    setCachedNote(noteA)
    setCachedNote(noteB)

    const tabA = makeNoteTab('tab-a', noteA.id)
    const tabB = makeNoteTab('tab-b', noteB.id)
    useAppStore.setState({
      tabs: { scripture: [], notes: [tabA, tabB], lexicon: [], youtube: [], search: [] },
      activeTabId: { scripture: null, notes: 'tab-a', lexicon: null, youtube: null, search: null },
      activeSpace: 'notes',
      continuousDailyScroll: false,
    })
  })

  afterEach(() => {
    unmount()
  })

  it('switching note tabs does not blank/reset to the list view (no full remount)', async () => {
    const el = mount()
    // Note A's editor content should be visible immediately (synchronous cache fast path).
    expect(el.querySelector('.ProseMirror')?.textContent).toContain('Content A')

    await act(async () => {
      useAppStore.getState().setActiveTab('notes', 'tab-b')
      await Promise.resolve()
    })

    // Should go straight to Note B's editor — never show the bare notes list ("restoringSpecificNote"
    // blank placeholder, or the full NotesList) in between, since both notes are cache-warm.
    expect(el.querySelector('.ProseMirror')?.textContent).toContain('Content B')
    expect(el.textContent).not.toContain('Click a note to open it')
  })

  it('opening the version-history modal for note A closes it on switching to note B (not left open acting on the wrong note)', async () => {
    mount()

    // Open the "More" overflow menu, then click "Version history" — reaches the exact code
    // path (setVersionHistoryOpen(true)) the a2cc922 fix's note-scoped-modal-reset effect guards.
    const moreBtn = Array.from(document.querySelectorAll('button')).find((b) => b.title === 'More') as HTMLButtonElement
    expect(moreBtn).toBeTruthy()
    await act(async () => {
      moreBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    const historyItem = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Version history') as HTMLButtonElement
    expect(historyItem).toBeTruthy()
    await act(async () => {
      historyItem.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    expect(document.body.textContent).toContain('Version history')

    // Now switch to note B — the modal must close, not keep showing/acting on note A.
    await act(async () => {
      useAppStore.getState().setActiveTab('notes', 'tab-b')
      await Promise.resolve()
    })
    // The portal-rendered modal heading must be gone.
    const stillOpen = Array.from(document.querySelectorAll('span')).some((s) => s.textContent === 'Version history')
    expect(stillOpen).toBe(false)
  })

  it('scroll position survives switching away and back to a note', async () => {
    const el = mount()
    const editorScroller = el.querySelector('.berean-pm-editor') as HTMLElement
    expect(editorScroller).toBeTruthy()

    // Simulate the user scrolling note A.
    act(() => {
      editorScroller.scrollTop = 222
      editorScroller.dispatchEvent(new Event('scroll'))
    })

    // Switch to note B (fires 'berean:saveScrollBeforeTabChange' synchronously via setActiveTab,
    // which NotesPanel listens for to persist lastScrollTopRef into tab A's state).
    await act(async () => {
      useAppStore.getState().setActiveTab('notes', 'tab-b')
      await Promise.resolve()
    })
    expect(el.querySelector('.ProseMirror')?.textContent).toContain('Content B')

    // Switch back to note A — its persisted scrollTop should be restored (via the note-switch
    // effect's initialScrollTopRef-driven double-rAF restore in NoteEditorPM).
    await act(async () => {
      useAppStore.getState().setActiveTab('notes', 'tab-a')
      await Promise.resolve()
    })
    // Flush the double-requestAnimationFrame restore.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    })

    const tabAState = useAppStore.getState().tabs.notes.find((t) => t.id === 'tab-a')?.state as NoteTabState
    expect(tabAState.scrollTop).toBe(222)
    const scrollerAfter = el.querySelector('.berean-pm-editor') as HTMLElement
    expect(scrollerAfter.scrollTop).toBe(222)
  })

  it('switching to a tab whose note is NOT cache-warm (cold fetch) still loads it, not the home list', async () => {
    // noteC deliberately never goes through setCachedNote — forces the restore effect's async
    // window.notes.getNote() branch instead of the synchronous cache fast path.
    const noteC = makeNote({ id: 'note-c', title: 'Note C', content: 'Content C' })
    ;(window.notes.getNote as ReturnType<typeof vi.fn>).mockImplementation(
      async (id: string) => (id === noteA.id ? noteA : id === noteB.id ? noteB : id === noteC.id ? noteC : null),
    )
    const tabC = makeNoteTab('tab-c', noteC.id)
    useAppStore.setState({
      tabs: { scripture: [], notes: [...useAppStore.getState().tabs.notes, tabC], lexicon: [], youtube: [], search: [] },
    })

    const el = mount()
    expect(el.querySelector('.ProseMirror')?.textContent).toContain('Content A')

    await act(async () => {
      useAppStore.getState().setActiveTab('notes', 'tab-c')
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(el.querySelector('.ProseMirror')?.textContent).toContain('Content C')
    expect(el.textContent).not.toContain('Click a note to open it')
  })

  it('a fresh (StrictMode double-effect) mount onto a tab whose note is NOT cache-warm loads it, not the home list — mirrors switching INTO the Notes space from elsewhere, where ActivePanel.tsx remounts NotesPanel from scratch', async () => {
    const noteC = makeNote({ id: 'note-c', title: 'Note C', content: 'Content C' })
    ;(window.notes.getNote as ReturnType<typeof vi.fn>).mockImplementation(
      async (id: string) => (id === noteA.id ? noteA : id === noteB.id ? noteB : id === noteC.id ? noteC : null),
    )
    const tabC = makeNoteTab('tab-c', noteC.id)
    useAppStore.setState({
      tabs: { scripture: [], notes: [tabC], lexicon: [], youtube: [], search: [] },
      activeTabId: { scripture: null, notes: 'tab-c', lexicon: null, youtube: null, search: null },
    })

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(<StrictMode><NotesPanel floating /></StrictMode>)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.querySelector('.ProseMirror')?.textContent).toContain('Content C')
    expect(container.textContent).not.toContain('Click a note to open it')
  })

  it('resyncs the status dropdown to the newly active note instead of showing the previous note\'s status', async () => {
    const el = mount()
    // Note A has status 'in-progress'.
    let statusBtn = Array.from(el.querySelectorAll('button')).find((b) => (b.title || '').startsWith('Status:')) as HTMLButtonElement
    expect(statusBtn?.title).toBe('Status: In Progress')

    await act(async () => {
      useAppStore.getState().setActiveTab('notes', 'tab-b')
      await Promise.resolve()
    })

    // Note B has no status — must show the "Set status" trigger, NOT a stale "In Progress".
    statusBtn = Array.from(el.querySelectorAll('button')).find((b) => b.title === 'Set status' || (b.title || '').startsWith('Status:')) as HTMLButtonElement
    expect(statusBtn?.title).toBe('Set status')
  })

  // Regression test for the "wrong content in a Notes tab" bug: the noteChangeToken
  // "external change" refetch effect fires for ANY note change anywhere in the app, captures
  // whichever note is active AT THAT MOMENT, and does an async window.notes.getNote() round
  // trip for it. If the user switches to a different tab before that resolves, the resolved
  // handler used to compare the fetch only against content/updatedAt — never the note's id —
  // so a stale response for the OLD note would look like a legitimate external edit of the NEW
  // note and silently overwrite it. Exercises that exact out-of-order-resolution race.
  it('does not clobber the newly active tab\'s note when a stale external-change getNote() resolves after switching tabs', async () => {
    const noteAStale = makeNote({ id: noteA.id, title: 'Note A', content: 'STALE EXTERNAL CONTENT', updatedAt: Date.now() + 99999 })
    let resolveGetNote: ((note: Note | null) => void) | null = null
    ;(window.notes.getNote as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
      if (id === noteA.id) {
        return new Promise<Note | null>((resolve) => { resolveGetNote = resolve })
      }
      if (id === noteB.id) return Promise.resolve(noteB)
      return Promise.resolve(null)
    })

    const el = mount()
    expect(el.querySelector('.ProseMirror')?.textContent).toContain('Content A')

    // Fire the external-change refetch effect while note A is still active — this captures
    // `current = note A` and kicks off the deferred getNote('note-a') above.
    await act(async () => {
      useAppStore.getState().bumpNoteToken()
      await Promise.resolve()
    })
    expect(resolveGetNote).toBeTruthy()

    // Before that fetch resolves, the user switches to tab B (cache-warm, so this resolves
    // synchronously within the act()).
    await act(async () => {
      useAppStore.getState().setActiveTab('notes', 'tab-b')
      await Promise.resolve()
    })
    expect(el.querySelector('.ProseMirror')?.textContent).toContain('Content B')

    // Now the stale fetch for note A resolves. Pre-fix, this overwrote whatever's currently
    // displayed (note B) with note A's stale content because the handler never checked that the
    // fetched note's id still matched the active one.
    await act(async () => {
      resolveGetNote!(noteAStale)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(el.querySelector('.ProseMirror')?.textContent).toContain('Content B')
    expect(el.textContent).not.toContain('STALE EXTERNAL CONTENT')
  })
})

// c7f6898 — "stop deleting titled notes on back-nav": goBack() only kept empty-body notes when
// they were idioms or had idiom term/meaning data, so a plain note with just a title typed (no
// body) was silently deleted navigating back to the list. Fixed to keep ANY note with a title.
// Covers both halves: a titled-but-empty-body note must survive, a truly blank note must still
// be pruned (that half of the behavior is intentional and must not regress either).
describe('NotesPanel goBack() note pruning', () => {
  const titledEmptyNote = makeNote({ id: 'note-titled-empty', title: 'Has A Title', content: '' })
  const blankNote = makeNote({ id: 'note-blank', title: '', content: '' })

  function setupNotesIpc(notes: Note[]) {
    ;(window as unknown as { notes: unknown }).notes = {
      getNotes: vi.fn(async () => notes),
      getFolders: vi.fn(async () => []),
      searchNotes: vi.fn(async () => []),
      listIdioms: vi.fn(async () => []),
      getNote: vi.fn(async (id: string) => notes.find((n) => n.id === id) ?? null),
      getNoteVersions: vi.fn(async () => []),
      createNoteVersion: vi.fn(async () => ({ success: true })),
      restoreNoteVersion: vi.fn(async () => ({ success: true })),
      updateNote: vi.fn(async () => ({ success: true })),
      createNote: vi.fn(async () => ({ success: true })),
      deleteNote: vi.fn(async () => ({ success: true })),
      setNoteFolder: vi.fn(async () => ({ success: true })),
      createFolder: vi.fn(async () => ({ success: true, id: 'f1' })),
      renameFolder: vi.fn(async () => ({ success: true })),
      deleteFolder: vi.fn(async () => ({ success: true })),
      deleteFolderDeep: vi.fn(async () => ({ success: true })),
      setFolderParent: vi.fn(async () => ({ success: true })),
      onChanged: vi.fn(),
    }
    ;(window as unknown as { settings: unknown }).settings = {
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => undefined),
    }
    ;(window as unknown as { vault: unknown }).vault = { syncNote: vi.fn(async () => undefined) }
    ;(window as unknown as { app: unknown }).app = { openFloatingTab: vi.fn(), pushViewerContent: vi.fn() }
  }

  afterEach(() => unmount())

  it('a titled note with an empty body survives back-nav (not deleted)', async () => {
    setupNotesIpc([titledEmptyNote])
    setCachedNote(titledEmptyNote)
    const tab = makeNoteTab('tab-titled', titledEmptyNote.id)
    useAppStore.setState({
      tabs: { scripture: [], notes: [tab], lexicon: [], youtube: [], search: [] },
      activeTabId: { scripture: null, notes: 'tab-titled', lexicon: null, youtube: null, search: null },
      activeSpace: 'notes',
      continuousDailyScroll: false,
      notesHomeToken: 0,
    })
    mount()
    await act(async () => { await Promise.resolve() })

    await act(async () => {
      useAppStore.getState().bumpNotesHomeToken()
      await Promise.resolve()
    })

    expect((window.notes.deleteNote as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })

  it('a truly blank note (no title, no body) is still deleted on back-nav', async () => {
    setupNotesIpc([blankNote])
    setCachedNote(blankNote)
    const tab = makeNoteTab('tab-blank', blankNote.id)
    useAppStore.setState({
      tabs: { scripture: [], notes: [tab], lexicon: [], youtube: [], search: [] },
      activeTabId: { scripture: null, notes: 'tab-blank', lexicon: null, youtube: null, search: null },
      activeSpace: 'notes',
      continuousDailyScroll: false,
      notesHomeToken: 0,
    })
    mount()
    await act(async () => { await Promise.resolve() })

    await act(async () => {
      useAppStore.getState().bumpNotesHomeToken()
      await Promise.resolve()
    })

    expect((window.notes.deleteNote as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(blankNote.id)
  })
})
