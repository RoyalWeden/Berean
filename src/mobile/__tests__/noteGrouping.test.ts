import { describe, it, expect } from 'vitest'
import type { Note, NoteFolder } from '@/types'
import { groupNotes, sortNotes, noteHomeView } from '../notes/noteGrouping'

const n = (id: string, p: Partial<Note> = {}): Note => ({ id, title: id, content: '', createdAt: 0, updatedAt: 0, ...p } as Note)

describe('noteGrouping', () => {
  const notes = [
    n('a', { status: 'complete', updatedAt: 3, createdAt: 1, type: 'verse', folderId: 'f2' }),
    n('b', { status: 'started', updatedAt: 1, createdAt: 3, type: 'daily' }),
    n('c', { updatedAt: 2, createdAt: 2, type: 'general', folderId: 'f1', tags: ['video'] }),
  ]
  const folders = [{ id: 'f1', name: 'Zeta', parentId: null }, { id: 'f2', name: 'Child', parentId: 'f1' }] as unknown as NoteFolder[]

  it('sorts by last edited, created or title', () => {
    expect(sortNotes(notes, 'modified').map((x) => x.id)).toEqual(['a', 'c', 'b'])
    expect(sortNotes(notes, 'created').map((x) => x.id)).toEqual(['b', 'c', 'a'])
    expect(sortNotes([n('b2', { title: 'beta' }), n('a2', { title: 'Alpha' })], 'name').map((x) => x.id)).toEqual(['a2', 'b2'])
  })
  it('"By status" follows the board column order, no-status last', () => {
    const g = groupNotes([...notes, n('d', { status: 'in-progress' })], 'status', 'modified')
    expect(g.map((x) => x.title)).toEqual(['Started', 'In Progress', 'Complete', 'No status'])
  })
  it('"By folder" labels nested folders and puts unfiled last', () => {
    const g = groupNotes(notes, 'folder', 'modified', folders)
    expect(g.map((x) => x.title)).toEqual(['Zeta', 'Zeta / Child', 'No folder'])
  })
  it('"By type" mirrors the filter chips; "Recent" is one list', () => {
    expect(groupNotes(notes, 'type', 'modified').map((x) => x.title)).toEqual(['Scripture', 'Daily', 'Video'])
    expect(groupNotes(notes, 'none', 'modified')).toHaveLength(1)
    expect(groupNotes([], 'status', 'modified')).toEqual([])
  })
  it('the session view choice is observable', () => {
    let calls = 0
    const off = noteHomeView.subscribe(() => { calls++ })
    noteHomeView.set({ grouping: 'status' })
    expect(noteHomeView.get()).toEqual({ grouping: 'status', sort: 'modified' })
    off(); noteHomeView.set({ grouping: 'none' })
    expect(calls).toBe(1)
  })
})
