/**
 * Leaving a note (TEST 2026-10-05): an abandoned empty note is deleted; an untitled note with
 * content is named from the user's format; titled, system and idiom notes are untouched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Note } from '@/types'
import { finalizeActionFor, finalizeLeftNote, hasMeaningfulBody, untitledNoteName } from '../finalizeNote'

const note = (p: Partial<Note>): Note => ({ id: 'n1', title: '', content: '', type: 'general', createdAt: new Date(2026, 9, 5).getTime(), updatedAt: 0, ...p }) as Note

describe('untitled note names', () => {
  it('formats the creation date in the chosen format', () => {
    const d = new Date(2026, 9, 5)
    expect(untitledNoteName(d, 'iso')).toBe('2026-10-05')
    expect(untitledNoteName(d, 'long', 'en-US')).toBe('October 5, 2026')
    expect(untitledNoteName(d, 'medium', 'en-US')).toBe('Oct 5, 2026')
    expect(untitledNoteName(d, 'numeric', 'en-US')).toBe('10/5/2026')
  })
})

describe('what leaving a note does', () => {
  it('empty (or only markdown punctuation) → delete', () => {
    expect(finalizeActionFor(note({}), 'iso')).toEqual({ kind: 'delete' })
    expect(finalizeActionFor(note({ content: '  \n# \n- \n1. ' }), 'iso')).toEqual({ kind: 'delete' })
    expect(hasMeaningfulBody('---\ntype: general-note\n---\n')).toBe(false)
  })
  it('content without a title → named after its creation day', () => {
    expect(finalizeActionFor(note({ content: 'Notes on Isaiah 29' }), 'iso')).toEqual({ kind: 'name', title: '2026-10-05' })
  })
  it('a titled note, a system note and an idiom note are never touched', () => {
    expect(finalizeActionFor(note({ title: 'Study', content: '' }), 'iso')).toEqual({ kind: 'none' })
    expect(finalizeActionFor(note({ type: 'daily' }), 'iso')).toEqual({ kind: 'none' })
    expect(finalizeActionFor(note({ type: 'idiom' }), 'iso')).toEqual({ kind: 'none' })
  })
})

describe('finalizeLeftNote (through the notes bridge)', () => {
  const api = { getNote: vi.fn(), deleteNote: vi.fn(async () => ({ success: true })), updateNote: vi.fn(async () => ({ success: true })) }
  beforeEach(() => { vi.clearAllMocks(); (globalThis as unknown as { window: unknown }).window = { notes: api } })
  it('deletes an abandoned empty note', async () => {
    api.getNote.mockResolvedValue(note({}))
    expect(await finalizeLeftNote('n1', 'iso')).toEqual({ kind: 'delete' })
    expect(api.deleteNote).toHaveBeenCalledWith('n1')
  })
  it('names an untitled note with content', async () => {
    api.getNote.mockResolvedValue(note({ content: 'body' }))
    await finalizeLeftNote('n1', 'iso')
    expect(api.updateNote).toHaveBeenCalledWith('n1', { title: '2026-10-05' })
  })
  it('leaves a note already in Trash alone', async () => {
    api.getNote.mockResolvedValue({ ...note({}), deletedAt: 1 })
    expect(await finalizeLeftNote('n1', 'iso')).toEqual({ kind: 'none' })
    expect(api.deleteNote).not.toHaveBeenCalled()
  })
})
