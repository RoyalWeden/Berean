import { describe, it, expect, beforeEach } from 'vitest'
import type { DatabaseAdapter } from '../../db/DatabaseAdapter'
import { makeContext, migratedUserDb, recordingEvents } from '../../db/__tests__/testDb'
import { createPlaylistsService } from '../playlistsService'

describe('playlistsService', () => {
  let clock: number
  let userDb: DatabaseAdapter
  let svc: ReturnType<typeof createPlaylistsService>
  let changes: ReturnType<typeof recordingEvents>['changes']

  beforeEach(async () => {
    clock = 1_700_000_000_000
    userDb = await migratedUserDb()
    const rec = recordingEvents()
    changes = rec.changes
    svc = createPlaylistsService(makeContext({ userDb, events: rec.events, now: () => clock }))
  })

  it('save creates a new playlist with sequential positions and startVerse/endVerse defaults', async () => {
    const saved = await svc.save('Evening Reading', [
      { bookId: 'GEN', chapter: 1, textId: 'kjva' },
      { bookId: 'GEN', chapter: 2, startVerse: 5, endVerse: 10, textId: 'kjva' },
    ])
    expect(saved.name).toBe('Evening Reading')
    expect(saved.createdAt).toBe(1_700_000_000_000)
    expect(saved.updatedAt).toBe(1_700_000_000_000)
    expect(saved.items.map((i) => ({ position: i.position, bookId: i.bookId, chapter: i.chapter, startVerse: i.startVerse, endVerse: i.endVerse }))).toEqual([
      { position: 0, bookId: 'GEN', chapter: 1, startVerse: 1, endVerse: null },
      { position: 1, bookId: 'GEN', chapter: 2, startVerse: 5, endVerse: 10 },
    ])

    // NOTE (playlistsService.ts:75): save()'s own return value stamps every item's `id` as ''
    // rather than the real DB-generated uuid — only a subsequent list()/DB read has real ids.
    expect(saved.items.every((i) => i.id === '')).toBe(true)
    const [listed] = await svc.list()
    expect(listed.items).toHaveLength(2)
    expect(listed.items[0].id).not.toBe('')
    expect(listed.items[1].id).not.toBe('')
  })

  it('save with existingId overwrites items + updated_at and keeps the original created_at (in the DB row)', async () => {
    const first = await svc.save('Queue', [{ bookId: 'GEN', chapter: 1, textId: 'kjva' }])
    clock = 1_700_000_050_000
    const second = await svc.save('Queue Renamed', [{ bookId: 'EXO', chapter: 20, textId: 'kjva' }], first.id)
    expect(second.id).toBe(first.id)

    const [row] = await svc.list()
    expect(row.id).toBe(first.id)
    expect(row.name).toBe('Queue Renamed')
    expect(row.createdAt).toBe(1_700_000_000_000) // untouched by the overwrite
    expect(row.updatedAt).toBe(1_700_000_050_000)
    expect(row.items.map((i) => i.bookId)).toEqual(['EXO'])

    // K9 fix: the overwrite's return value reports the row's real created_at, not `now`.
    expect(second.createdAt).toBe(1_700_000_000_000)
  })

  it('list orders by updated_at DESC', async () => {
    const a = await svc.save('A', [{ bookId: 'GEN', chapter: 1, textId: 'kjva' }])
    clock = 1_700_000_001_000
    const b = await svc.save('B', [{ bookId: 'GEN', chapter: 2, textId: 'kjva' }])
    clock = 1_700_000_002_000
    // Touch `a` again so it becomes the most recently updated.
    await svc.save('A', [{ bookId: 'GEN', chapter: 3, textId: 'kjva' }], a.id)
    expect((await svc.list()).map((p) => p.id)).toEqual([a.id, b.id])
  })

  it('rename updates name and updated_at', async () => {
    const p = await svc.save('Original', [{ bookId: 'GEN', chapter: 1, textId: 'kjva' }])
    clock = 1_700_000_005_000
    expect(await svc.rename(p.id, 'Renamed')).toEqual({ success: true })
    const [row] = await svc.list()
    expect(row).toMatchObject({ name: 'Renamed', updatedAt: 1_700_000_005_000 })
  })

  it('delete cascades playlist_items via the ON DELETE CASCADE foreign key', async () => {
    const p = await svc.save('To Delete', [
      { bookId: 'GEN', chapter: 1, textId: 'kjva' },
      { bookId: 'GEN', chapter: 2, textId: 'kjva' },
    ])
    expect(await userDb.all('SELECT * FROM playlist_items WHERE playlist_id = ?', [p.id])).toHaveLength(2)

    expect(await svc.delete(p.id)).toEqual({ success: true })
    expect(await svc.list()).toEqual([])
    expect(await userDb.all('SELECT * FROM playlist_items WHERE playlist_id = ?', [p.id])).toEqual([])
  })

  it('emits data:changed(playlist) for save/rename/delete', async () => {
    const p = await svc.save('P', [{ bookId: 'GEN', chapter: 1, textId: 'kjva' }])
    await svc.rename(p.id, 'P2')
    await svc.delete(p.id)
    expect(changes.map((c) => ({ entity: c.entity, op: c.op, id: c.id }))).toEqual([
      { entity: 'playlist', op: 'upsert', id: p.id },
      { entity: 'playlist', op: 'upsert', id: p.id },
      { entity: 'playlist', op: 'delete', id: p.id },
    ])
  })
})
