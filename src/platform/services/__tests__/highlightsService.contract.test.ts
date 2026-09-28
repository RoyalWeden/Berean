import { describe, it, expect, beforeEach } from 'vitest'
import { makeContext, migratedUserDb, recordingEvents } from '../../db/__tests__/testDb'
import { createHighlightsService } from '../highlightsService'

describe('highlightsService', () => {
  let svc: ReturnType<typeof createHighlightsService>
  let changes: ReturnType<typeof recordingEvents>['changes']

  beforeEach(async () => {
    const rec = recordingEvents()
    changes = rec.changes
    svc = createHighlightsService(makeContext({ userDb: await migratedUserDb(), events: rec.events }))
  })

  it('toggle creates, recolours, then removes a verse-level highlight', async () => {
    const created = await svc.toggle({ bookId: 'GEN', chapter: 1, verseNum: 1, color: 'yellow' })
    expect(created).toMatchObject({ created: true, color: 'yellow' })
    expect(await svc.getChapter('GEN', 1)).toEqual({ 1: [{ id: (created as { id: string }).id, color: 'yellow', startWord: null, endWord: null, startChar: null, endChar: null }] })
    const updated = await svc.toggle({ bookId: 'GEN', chapter: 1, verseNum: 1, color: 'red' })
    expect(updated).toMatchObject({ updated: true, color: 'red', id: (created as { id: string }).id })
    const removed = await svc.toggle({ bookId: 'GEN', chapter: 1, verseNum: 1, color: 'red' })
    expect(removed).toMatchObject({ removed: true })
    expect(await svc.getChapter('GEN', 1)).toEqual({})
    expect(changes.map((c) => c.op)).toEqual(['upsert', 'upsert', 'delete'])
  })

  it('word-level and char-level ranges are independent rows and never match verse-level', async () => {
    await svc.toggle({ bookId: 'GEN', chapter: 1, verseNum: 2, color: 'green', startWord: 1, endWord: 3 })
    await svc.toggle({ bookId: 'GEN', chapter: 1, verseNum: 2, color: 'blue', startChar: 5, endChar: 9 })
    await svc.toggle({ bookId: 'GEN', chapter: 1, verseNum: 2, color: 'purple' })
    const rows = (await svc.getChapter('GEN', 1))[2]
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => [r.color, r.startWord, r.endWord, r.startChar, r.endChar])).toEqual([
      ['green', 1, 3, null, null], ['blue', null, null, 5, 9], ['purple', null, null, null, null],
    ])
    // same word range + same colour toggles off only that row
    await svc.toggle({ bookId: 'GEN', chapter: 1, verseNum: 2, color: 'green', startWord: 1, endWord: 3 })
    expect((await svc.getChapter('GEN', 1))[2]).toHaveLength(2)
  })

  it('is text-specific and remove clears every highlight on a verse for that text', async () => {
    await svc.toggle({ bookId: 'JHN', chapter: 3, verseNum: 16, color: 'yellow', textId: 'kjva' })
    await svc.toggle({ bookId: 'JHN', chapter: 3, verseNum: 16, color: 'yellow', textId: 'lxx', startWord: 0, endWord: 1 })
    expect(Object.keys(await svc.getChapter('JHN', 3, 'kjva'))).toEqual(['16'])
    expect(Object.keys(await svc.getChapter('JHN', 3, 'lxx'))).toEqual(['16'])
    expect(await svc.remove('JHN', 3, 16, 'kjva')).toEqual({ success: true })
    expect(await svc.getChapter('JHN', 3, 'kjva')).toEqual({})
    expect(Object.keys(await svc.getChapter('JHN', 3, 'lxx'))).toEqual(['16'])
  })
})
