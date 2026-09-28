import { describe, it, expect } from 'vitest'
import type { Note } from '@/types'
import { systemFolderOf, noteIsMovable } from '@/lib/noteMovability'

const note = (p: Partial<Note>): Note => ({ id: 'n', type: 'general', title: 'T', content: '', createdAt: 0, updatedAt: 0, tags: [], ...p } as Note)

describe('noteMovability', () => {
  it('classifies system folders', () => {
    expect(systemFolderOf(note({ tags: ['biblegateway'] }))).toBe('biblegateway')
    expect(systemFolderOf(note({ tags: ['esword'] }))).toBe('esword')
    expect(systemFolderOf(note({ type: 'daily' }))).toBe('daily')
    expect(systemFolderOf(note({ title: 'Journal — 2026-01-01' }))).toBe('daily')
    expect(systemFolderOf(note({ type: 'verse' }))).toBe('verse')
    expect(systemFolderOf(note({ verseRef: 'Gen.1.1' }))).toBe('verse')
    expect(systemFolderOf(note({}))).toBeNull()
  })
  it('only non-system notes are movable', () => {
    expect(noteIsMovable(note({}))).toBe(true)
    expect(noteIsMovable(note({ type: 'topic' as Note['type'] }))).toBe(true)
    expect(noteIsMovable(note({ type: 'daily' }))).toBe(false)
    expect(noteIsMovable(note({ verseRef: 'Gen.1.1' }))).toBe(false)
  })
})
