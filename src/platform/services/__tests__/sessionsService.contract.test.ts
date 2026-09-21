import { describe, it, expect, beforeEach } from 'vitest'
import { makeContext, migratedUserDb, recordingEvents } from '../../db/__tests__/testDb'
import { createSessionsService } from '../sessionsService'

describe('sessionsService', () => {
  let svc: ReturnType<typeof createSessionsService>
  let changes: ReturnType<typeof recordingEvents>['changes']
  let clock = 1000

  beforeEach(async () => {
    const rec = recordingEvents()
    changes = rec.changes
    clock = 1000
    svc = createSessionsService(makeContext({ userDb: await migratedUserDb(), events: rec.events, now: () => clock }))
  })

  const tab = (id: string, session: string, over: Partial<Parameters<typeof svc.upsertTab>[0]> = {}) => ({
    id, session_id: session, space_id: 'scripture', type: 'bible', title: 'Gen 1', is_pinned: 0, order_key: 'a0', display_order_key: 'a0',
    origin_tab_id: null, origin_space_id: null, sync_state_json: '{"bookId":"GEN","chapter":1}', ...over,
  })

  it('applySnapshot upserts, is a no-op when nothing changed, and tombstones missing rows', async () => {
    const snap = {
      sessions: [{ id: 's1', name: 'Session 1', icon: null, tab_filter: null, order_key: 'a0' }, { id: 's2', name: 'Study', icon: '📖', tab_filter: 'bible', order_key: 'a1' }],
      tabs: [tab('t1', 's1'), tab('t2', 's1', { order_key: 'a1', display_order_key: 'a1', local_state_json: '{"scrollPosition":50}' }), tab('t3', 's2', { type: 'note', space_id: 'notes', sync_state_json: '{"noteId":"n"}' })],
      archivedGroups: [{ id: 'g1', label: 'Gen 1', archived_at: 500, tabs_json: '[]' }],
    }
    const d1 = await svc.applySnapshot(snap)
    expect(d1).toEqual({ upserted: { sessions: 2, tabs: 3, archivedGroups: 1 }, tombstoned: { sessions: 0, tabs: 0, archivedGroups: 0 } })
    expect(await svc.hasAny()).toBe(true)
    expect((await svc.listSessions()).map((s) => s.id)).toEqual(['s1', 's2'])
    expect((await svc.listTabs('s1')).map((t) => t.id)).toEqual(['t1', 't2'])
    expect((await svc.listTabs('s1'))[1].local_state_json).toBe('{"scrollPosition":50}')

    clock = 2000
    const d2 = await svc.applySnapshot(snap)
    expect(d2.upserted).toEqual({ sessions: 0, tabs: 0, archivedGroups: 0 })
    expect((await svc.listTabs('s1'))[0].updated_at).toBe(1000)

    // close t2, delete s2 (and its tab), drop the archived group
    clock = 3000
    const d3 = await svc.applySnapshot({ sessions: [snap.sessions[0]], tabs: [snap.tabs[0]], archivedGroups: [] })
    expect(d3.tombstoned).toEqual({ sessions: 1, tabs: 2, archivedGroups: 1 })
    expect((await svc.listSessions()).map((s) => s.id)).toEqual(['s1'])
    expect((await svc.listTabs()).map((t) => t.id)).toEqual(['t1'])
    expect(await svc.listArchivedGroups()).toEqual([])
    const rows = await svc['listTabs']()
    expect(rows.length).toBe(1)
    expect(changes.filter((c) => c.entity === 'tab' && c.op === 'delete').map((c) => c.id).sort()).toEqual(['t2', 't3'])
  })

  it('a local-only tab change does not bump updated_at; a sync change does; re-adding revives a tombstone', async () => {
    await svc.upsertTab(tab('t1', 's1'))
    clock = 2000
    await svc.upsertTab(tab('t1', 's1', { local_state_json: '{"scrollPosition":9}' }))
    let row = (await svc.listTabs())[0]
    expect(row.updated_at).toBe(1000)
    expect(row.local_state_json).toBe('{"scrollPosition":9}')
    clock = 3000
    await svc.upsertTab(tab('t1', 's1', { title: 'Gen 2', sync_state_json: '{"bookId":"GEN","chapter":2}' }))
    row = (await svc.listTabs())[0]
    expect(row.updated_at).toBe(3000)
    expect(row.local_state_json).toBe('{"scrollPosition":9}')   // kept when not supplied
    clock = 4000
    await svc.deleteTab('t1')
    expect(await svc.listTabs()).toEqual([])
    clock = 5000
    await svc.upsertTab(tab('t1', 's1'))
    row = (await svc.listTabs())[0]
    expect(row.deleted_at).toBeNull()
    expect(row.created_at).toBe(1000)
  })

  it('deleteSession tombstones its tabs; local state round-trips; purgeTombstones removes old rows', async () => {
    await svc.upsertSession({ id: 's1', name: 'S', icon: null, tab_filter: null, order_key: 'a0' })
    await svc.upsertTab(tab('t1', 's1'))
    await svc.setLocalState('s1', { scripture: 't1', notes: null })
    expect(await svc.getLocalState('s1')).toEqual({ scripture: 't1', notes: null })
    expect(await svc.getLocalState('nope')).toEqual({})
    clock = 2000
    await svc.deleteSession('s1')
    expect(await svc.listSessions()).toEqual([])
    expect(await svc.listTabs()).toEqual([])
    clock = 2000 + 100_000
    expect(await svc.purgeTombstones(50_000)).toBe(2)
    expect(changes.some((c) => c.entity === 'session' && c.op === 'delete')).toBe(true)
  })
})
