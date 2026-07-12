import { describe, it, expect, beforeEach, vi } from 'vitest'
import { migrateAllNotes } from '../noteMigration'
import type { Note } from '@/types'

function mockNote(overrides: Partial<Note>): Note {
  return {
    id: 'id', type: 'general', title: 'Untitled', content: '', color: 'blue',
    createdAt: 0, updatedAt: 0, tags: [], folderId: null, textId: 'kjva',
    ...overrides,
  } as Note
}

describe('migrateAllNotes', () => {
  let updateNote: ReturnType<typeof vi.fn>
  let createNoteVersion: ReturnType<typeof vi.fn>
  let getNotes: ReturnType<typeof vi.fn>

  beforeEach(() => {
    updateNote = vi.fn().mockResolvedValue({ success: true })
    createNoteVersion = vi.fn().mockResolvedValue({ success: true })
    getNotes = vi.fn()
    // @ts-expect-error partial window.notes mock, sufficient for this test
    global.window = { ...global.window, notes: { getNotes, updateNote, createNoteVersion } }
  })

  it('leaves already-normalized notes untouched (idempotent)', async () => {
    getNotes.mockResolvedValue([mockNote({ id: 'a', content: 'Plain paragraph text.' })])
    const result = await migrateAllNotes()
    expect(result.changed).toBe(0)
    expect(result.unchanged).toBe(1)
    expect(updateNote).not.toHaveBeenCalled()
    expect(createNoteVersion).not.toHaveBeenCalled()
  })

  it('normalizes a note with an un-migrated soft line break and snapshots the original first', async () => {
    getNotes.mockResolvedValue([mockNote({ id: 'b', title: 'My Note', content: 'Line one\nLine two' })])
    const result = await migrateAllNotes()
    expect(result.changed).toBe(1)
    expect(result.unchanged).toBe(0)
    // Original content snapshotted BEFORE the overwrite, tagged 'pre-migration'.
    expect(createNoteVersion).toHaveBeenCalledWith('b', 'My Note', 'Line one\nLine two', 'pre-migration')
    expect(updateNote).toHaveBeenCalledWith('b', { content: 'Line one\\\nLine two' })
  })

  it('treats a null/undefined content field as empty rather than throwing', async () => {
    getNotes.mockResolvedValue([mockNote({ id: 'c', content: null as unknown as string })])
    const result = await migrateAllNotes()
    expect(result.failed).toBe(0)
    expect(result.total).toBe(1)
  })

  it('catches per-note failures without aborting the batch', async () => {
    getNotes.mockResolvedValue([
      mockNote({ id: 'd', content: 'fine text' }),
      mockNote({ id: 'e', content: 'also fine' }),
    ])
    createNoteVersion.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ success: true })
    // Force note 'd' to look changed so createNoteVersion is invoked for it.
    getNotes.mockResolvedValue([
      mockNote({ id: 'd', content: 'multi\nline' }),
      mockNote({ id: 'e', content: 'also fine' }),
    ])
    const result = await migrateAllNotes()
    expect(result.failed).toBe(1)
    expect(result.failedNoteIds).toEqual(['d'])
    expect(result.unchanged).toBe(1) // note 'e' still processed normally
  })

  it('reports progress via the callback', async () => {
    getNotes.mockResolvedValue([mockNote({ id: 'f' }), mockNote({ id: 'g' })])
    const progress: Array<{ done: number; total: number }> = []
    await migrateAllNotes((p) => progress.push(p))
    expect(progress).toEqual([{ done: 1, total: 2 }, { done: 2, total: 2 }])
  })
})
