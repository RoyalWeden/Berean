import { describe, it, expect } from 'vitest'
import { makeContext, migratedUserDb } from '../../db/__tests__/testDb'
import { createHistoryService } from '../historyService'

describe('historyService', () => {
  it('adds, pages newest-first, maps nulls to undefined, prunes to maxEntries, deletes and clears', async () => {
    const svc = createHistoryService(makeContext({ userDb: await migratedUserDb() }))
    for (let i = 1; i <= 5; i++) {
      await svc.add({ id: `h${i}`, type: 'bible', title: `Gen ${i}`, timestamp: i * 1000, bookId: 'GEN', chapter: i })
    }
    const all = await svc.getAll()
    expect(all.map((e) => e.id)).toEqual(['h5', 'h4', 'h3', 'h2', 'h1'])
    expect(all[0]).toMatchObject({ id: 'h5', bookId: 'GEN', chapter: 5, verse: undefined, noteId: undefined, sessionId: undefined })
    expect((await svc.getPage(3000, 10)).map((e) => e.id)).toEqual(['h2', 'h1'])
    expect((await svc.getAll(2)).map((e) => e.id)).toEqual(['h5', 'h4'])
    // INSERT OR REPLACE on the same id updates in place
    await svc.add({ id: 'h5', type: 'bible', title: 'Gen 5 again', timestamp: 6000 })
    expect((await svc.getAll())[0].title).toBe('Gen 5 again')
    expect(await svc.getAll()).toHaveLength(5)
    // prune keeps the newest N
    await svc.add({ id: 'h6', type: 'note', title: 'n', timestamp: 7000, noteId: 'abc' }, 3)
    expect((await svc.getAll()).map((e) => e.id)).toEqual(['h6', 'h5', 'h4'])
    expect(await svc.delete('h5')).toEqual({ success: true })
    expect((await svc.getAll()).map((e) => e.id)).toEqual(['h6', 'h4'])
    expect(await svc.clear()).toEqual({ success: true })
    expect(await svc.getAll()).toEqual([])
  })
})
