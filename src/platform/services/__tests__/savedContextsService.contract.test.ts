import { describe, it, expect } from 'vitest'
import { makeContext, migratedUserDb, recordingEvents } from '../../db/__tests__/testDb'
import { createSavedContextsService, savedContextTurn } from '../savedContextsService'
import { resolveFollowUp, stateFromTurns } from '../../../lib/research/conversationState'

describe('savedContextsService (spec §7.2: explicit, visible, deletable)', () => {
  it('saves only verified-shaped refs and real-shaped Strong\'s ids, lists and deletes', async () => {
    const origLog = console.log; console.log = () => {}
    const userDb = await migratedUserDb()
    console.log = origLog
    const ev = recordingEvents()
    const s = createSavedContextsService(makeContext({ userDb, events: ev.events, uuid: () => 'c1' }))
    const c = await s.save('Grace study', { topic: 'grace', refs: ['TIT 2:11', 'not a ref', 'EPH 2:8'], strongs: ['g5485', 'nonsense', 'H2580'], summary: 'Titus and Ephesians on grace' })
    expect(c.content).toEqual({ topic: 'grace', refs: ['TIT 2:11', 'EPH 2:8'], strongs: ['G5485', 'H2580'], summary: 'Titus and Ephesians on grace' })
    expect((await s.list()).map((x) => x.title)).toEqual(['Grace study'])
    expect(await s.remove('c1')).toEqual({ success: true })
    expect(await s.list()).toEqual([])
    expect(ev.changes.map((x) => x.op)).toEqual(['upsert', 'delete'])
  })

  it('a reused context feeds follow-up resolution in a new chat', () => {
    const turn = savedContextTurn({ id: 'c1', title: 'Grace', createdAt: '', updatedAt: '', content: { topic: 'grace', refs: ['TIT 2:11', 'EPH 2:8'], strongs: ['G5485'], summary: '' } })
    const f = resolveFollowUp('show the context of the second passage', stateFromTurns([turn]))
    expect(f?.question).toBe('Ephesians 2:5-11')
  })
})
