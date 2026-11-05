import { describe, it, expect } from 'vitest'
import { migratedUserDb } from '../../../platform/db/__tests__/testDb'
import { aiVisibleNotesSql, EXCLUDED_FOLDERS_CTE } from '../noteExclusion'

const COLS = { aiExcluded: true, folderId: true, folderAiExcluded: true }

describe('AI note exclusion (spec §4.4, scenario 12)', () => {
  it('hides excluded notes and every note under an excluded folder, inherited down the tree', async () => {
    const db = await migratedUserDb()
    const origLog = console.log
    await db.run("INSERT INTO note_folders (id, name, parent_id, created_at, ai_excluded) VALUES ('private', 'Private', NULL, 1, 1), ('child', 'Inside', 'private', 1, 0), ('open', 'Open', NULL, 1, 0)")
    const note = (id: string, folder: string | null, excluded = 0) =>
      db.run('INSERT INTO notes (id, title, content, created_at, updated_at, folder_id, ai_excluded) VALUES (?, ?, ?, 1, 1, ?, ?)', [id, id, 'body', folder, excluded])
    await note('visible', null)
    await note('marked', null, 1)
    await note('inPrivate', 'private')
    await note('deepInPrivate', 'child')
    await note('inOpen', 'open')
    const rows = await db.all<{ id: string }>(`${EXCLUDED_FOLDERS_CTE}\nSELECT id FROM notes WHERE 1 = 1${aiVisibleNotesSql('', COLS)} ORDER BY id`)
    expect(rows.map((r) => r.id)).toEqual(['inOpen', 'visible'])
    console.log = origLog
  })

  it('is a no-op on a database without the columns', () => {
    expect(aiVisibleNotesSql('n', { aiExcluded: false, folderId: true, folderAiExcluded: false })).toBe('')
  })
})
