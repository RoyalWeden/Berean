import { describe, it, expect } from 'vitest'
import { noteToMarkdownFile, parseNoteMarkdownFile, noteFileName } from '../noteMarkdownFile'
import type { Note } from '@/types'

const base: Note = { id: 'n-1', type: 'general', title: 'Creation study', content: 'In the beginning [[Exod 20:11]]', createdAt: 1700000000000, updatedAt: 1700003600000, tags: ['creation'], color: 'green', icon: '📖', status: 'active' as Note['status'], folderId: 'f-1' }

describe('note markdown files', () => {
  it('round-trips a general note through the vault frontmatter dialect', () => {
    const md = noteToMarkdownFile(base)
    expect(md).toContain('type: general-note')
    expect(md).toContain('title: "Creation study"')
    expect(md).toContain('color: 🟢')
    expect(md).toContain('berean_id: n-1')
    expect(md).toContain('  - "[[Exod 20:11]]"')
    const parsed = parseNoteMarkdownFile(md)
    expect(parsed).toMatchObject({ bereanId: 'n-1', type: 'general', title: 'Creation study', content: base.content, tags: ['creation'], color: 'green', icon: '📖', status: 'active', folderId: 'f-1' })
  })
  it('titles a verse note by its reference and keeps ref/source', () => {
    const md = noteToMarkdownFile({ ...base, type: 'verse', verseRef: 'GEN.1.1', title: '' })
    expect(md).toContain('type: verse-note')
    expect(md).toContain('ref: GEN.1.1')
    expect(md).toContain('title: "Genesis 1:1"')
    expect(parseNoteMarkdownFile(md)).toMatchObject({ type: 'verse', verseRef: 'GEN.1.1' })
    expect(parseNoteMarkdownFile(noteToMarkdownFile({ ...base, type: 'esword', verseRef: 'GEN.1.1' })).type).toBe('esword')
  })
  it('imports plain markdown as a general note titled from the first heading', () => {
    const p = parseNoteMarkdownFile('# Shalom\n\nBody text\n')
    expect(p).toMatchObject({ bereanId: null, type: 'general', title: 'Shalom', content: 'Body text' })
    expect(parseNoteMarkdownFile('just a line').title).toBe('just a line')
  })
  it('strips the vault highlight preview block on import', () => {
    const md = '---\ntype: general-note\ntitle: "x"\nberean_id: a\n---\n\n<!-- berean:highlight-preview -->\n> quoted\n<!-- /berean:highlight-preview -->\n\nreal body'
    expect(parseNoteMarkdownFile(md).content).toBe('real body')
  })
  it('makes a safe file name', () => {
    expect(noteFileName({ title: 'Gen 1:1 / "notes"?', id: 'abc' })).toBe('Gen 1 1 notes.md')
    expect(noteFileName({ title: '', id: 'abcdef123' })).toBe('abcdef12.md')
  })
})
