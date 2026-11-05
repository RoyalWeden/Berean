import { describe, it, expect } from 'vitest'
import { noteToMarkdownFile, parseNoteMarkdownFile } from '../noteMarkdownFile'
import type { Note } from '@/types'

describe('AI exclusion survives markdown export/import (spec §4.4)', () => {
  const base = { id: 'n1', type: 'general', title: 'Private', content: 'body', verseRef: null, color: 'blue', createdAt: 1, updatedAt: 2, tags: [], folderId: null, textId: 'kjva' } as unknown as Note
  it('writes ai_excluded only when set, and reads it back', () => {
    const md = noteToMarkdownFile({ ...base, aiExcluded: true })
    expect(md).toContain('ai_excluded: true')
    expect(parseNoteMarkdownFile(md).aiExcluded).toBe(true)
    const plain = noteToMarkdownFile(base)
    expect(plain).not.toContain('ai_excluded')
    expect(parseNoteMarkdownFile(plain).aiExcluded).toBeUndefined()
  })
})
