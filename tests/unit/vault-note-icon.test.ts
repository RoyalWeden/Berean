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
    icon: null,
    status: null,
    created_at: Date.parse('2026-01-01T00:00:00.000Z'),
    updated_at: Date.parse('2026-01-02T00:00:00.000Z'),
    tags: '[]',
    folder_id: null,
    ...overrides,
  }
}

// Mirrors the exact frontmatter-line regex runImportAll uses to read `icon:` back out of a
// vault .md file (electron/ipc/vault.ts's bulk-import loop) — not itself exported (it's inline
// in that function alongside color/folder_id/etc.), so the round trip is verified end-to-end
// here: noteToMarkdown() writes the line, this regex reads it back, same as a real import would.
function parseIconFromMarkdown(md: string): string | null {
  return md.match(/^icon:\s*(.+)$/m)?.[1]?.trim() ?? null
}

describe('vault note icon frontmatter', () => {
  it('includes an icon line only when icon is set', () => {
    const withIcon = noteToMarkdown(baseNote({ icon: '📖' }))
    const withoutIcon = noteToMarkdown(baseNote({ icon: null }))
    expect(withIcon).toContain('icon: 📖')
    expect(withoutIcon).not.toContain('icon:')
  })

  it('round-trips: icon: 📖 survives export -> reimport', () => {
    const exported = noteToMarkdown(baseNote({ icon: '📖' }))
    expect(parseIconFromMarkdown(exported)).toBe('📖')
  })

  it('an icon-only change never alters the extracted body (frontmatter-only diff)', () => {
    const md1 = noteToMarkdown(baseNote({ icon: null }))
    const md2 = noteToMarkdown(baseNote({ icon: '📖' }))
    expect(extractNoteBody(md1)).toBe(extractNoteBody(md2))
    expect(md1).not.toBe(md2)
  })
})
