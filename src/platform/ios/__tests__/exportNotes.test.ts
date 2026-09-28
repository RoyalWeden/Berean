/** DATA-SAFE-100 — the emergency export writes every note (Trash included) as Markdown. */
import { describe, it, expect, vi } from 'vitest'

const written: Array<{ path: string; data: string }> = []
const shared: unknown[] = []
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' }, Encoding: { UTF8: 'utf8' },
  Filesystem: {
    writeFile: async (o: { path: string; data: string }) => { written.push(o) },
    getUri: async (o: { path: string }) => ({ uri: `file:///cache/${o.path}` }),
  },
}))
vi.mock('@capacitor/share', () => ({ Share: { share: async (o: unknown) => { shared.push(o) } } }))

import { exportAllNotesAsMarkdown } from '../exportNotes'

const note = (id: string, title: string, extra: Record<string, unknown> = {}) => ({ id, type: 'general', title, content: `Body of ${title}`, createdAt: 1, updatedAt: 2, tags: [], ...extra })

describe('exportAllNotesAsMarkdown', () => {
  it('exports live and trashed notes with unique names and shares one folder', async () => {
    ;(window as unknown as { notes: unknown }).notes = {
      getNotes: async () => [note('1', 'Same'), note('2', 'Same'), note('3', 'Other')],
      listTrash: async () => [note('4', 'Old', { deletedAt: 5 })],
    }
    const r = await exportAllNotesAsMarkdown()
    expect(r.count).toBe(4)
    const names = written.map((w) => w.path.replace(/^exports\/[^/]+\//, ''))
    expect(names).toEqual(['Same.md', 'Same (2).md', 'Other.md', 'Trash/Old.md'])
    expect(written[0].data).toContain('berean_id')
    expect(written[0].data).toContain('Body of Same')
    expect(shared).toHaveLength(1)
  })
})
