/** NOTES-REF-001 — verse-note titles are shown in the Scripture form: Book Chapter:Verse. */
import { describe, it, expect } from 'vitest'
import { displayNoteTitle, storedNoteTitle } from '../noteTitle'

describe('displayNoteTitle', () => {
  it('vault file-name form → colon', () => {
    expect(displayNoteTitle('Matthew 5.3')).toBe('Matthew 5:3')
    expect(displayNoteTitle('1 Chronicles 16.22')).toBe('1 Chronicles 16:22')
    expect(displayNoteTitle('Song of Solomon 2.4')).toBe('Song of Solomon 2:4')
  })
  it('ranges and LXX keep their form', () => {
    expect(displayNoteTitle('Romans 5.6-8')).toBe('Romans 5:6-8')
    expect(displayNoteTitle('Genesis 1.1 LXX')).toBe('Genesis 1:1 LXX')
  })
  it('already correct, non-references and empty titles are untouched', () => {
    expect(displayNoteTitle('Matthew 5:3')).toBe('Matthew 5:3')
    expect(displayNoteTitle('Version 1.2 notes')).toBe('Version 1.2 notes')
    expect(displayNoteTitle('Chapter 3.4')).toBe('Chapter 3.4')
    expect(displayNoteTitle('Budget 2026.5')).toBe('Budget 2026.5')
    expect(displayNoteTitle('')).toBe('Untitled')
    expect(displayNoteTitle(null, 'x')).toBe('x')
  })
  it('editor fields store the vault period form back for an unchanged reference title', () => {
    expect(storedNoteTitle('Matthew 5:3', 'Matthew 5.3')).toBe('Matthew 5.3')
    expect(storedNoteTitle('Matthew 5:3-5', 'Matthew 5.3-5')).toBe('Matthew 5.3-5')
    expect(storedNoteTitle('Matthew 5:3 study', 'Matthew 5.3')).toBe('Matthew 5:3 study')
    expect(storedNoteTitle('Matthew 5:3', 'Matthew 5:3')).toBe('Matthew 5:3')
    expect(storedNoteTitle('My note', 'Old')).toBe('My note')
  })
})
