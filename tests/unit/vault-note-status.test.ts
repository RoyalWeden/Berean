import { describe, it, expect } from 'vitest'
import { noteToMarkdown, extractNoteBody, type NoteRow } from '../../electron/ipc/vault'

function baseNote(overrides: Partial<NoteRow> = {}): NoteRow {
  return {
    id: 'abc123',
    type: 'general',
    title: 'My Note',
    content: 'Some note content.',
    verse_ref: null,
    color: 'blue',
    status: null,
    created_at: Date.parse('2026-01-01T00:00:00.000Z'),
    updated_at: Date.parse('2026-01-02T00:00:00.000Z'),
    tags: '[]',
    folder_id: null,
    ...overrides,
  }
}

describe('vault note status frontmatter', () => {
  it('includes a status line only when status is set', () => {
    const withStatus = noteToMarkdown(baseNote({ status: 'in-progress' }))
    const withoutStatus = noteToMarkdown(baseNote({ status: null }))
    expect(withStatus).toContain('status: in-progress')
    expect(withoutStatus).not.toContain('status:')
  })

  it('a status-only change never alters the extracted body', () => {
    // Mirrors the real diff-before-write path: vault:reconcile / vault:watch's
    // 'change' handler only ever compare/import the post-frontmatter body, so a
    // note whose *only* change is its status (frontmatter-only) must produce an
    // identical body — otherwise a status edit would spuriously look like an
    // external content edit on the next reconcile/watch pass.
    const md1 = noteToMarkdown(baseNote({ status: null }))
    const md2 = noteToMarkdown(baseNote({ status: 'complete' }))
    expect(extractNoteBody(md1)).toBe(extractNoteBody(md2))
    // Sanity: the two files are NOT identical overall (frontmatter differs).
    expect(md1).not.toBe(md2)
  })

  it('extractNoteBody trims consistently regardless of trailing whitespace after frontmatter', () => {
    // Regression: vault:watch's live 'change' handler used to skip trimEnd(),
    // while vault:reconcile and runImportAll did trim it — so the same file could
    // produce a different stored body depending on which code path read it.
    const contentNoTrailingWs = '---\ntype: general-note\nberean_id: abc123\n---\n\nHello world'
    const contentWithTrailingWs = '---\ntype: general-note\nberean_id: abc123\n---\n\nHello world\n\n  '
    expect(extractNoteBody(contentNoTrailingWs)).toBe('Hello world')
    expect(extractNoteBody(contentWithTrailingWs)).toBe('Hello world')
  })

  it('strips the generated highlight-preview block from the body', () => {
    const content =
      '---\ntype: verse-note\nberean_id: abc123\n---\n\n' +
      '<!-- berean:highlight-preview -->\n> quoted verse\n<!-- /berean:highlight-preview -->\n\n' +
      'User note text'
    expect(extractNoteBody(content)).toBe('User note text')
  })
})
