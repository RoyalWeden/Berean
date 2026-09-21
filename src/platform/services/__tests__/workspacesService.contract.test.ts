import { describe, it, expect, beforeEach } from 'vitest'
import { makeContext, migratedUserDb, recordingEvents } from '../../db/__tests__/testDb'
import { createWorkspacesService } from '../workspacesService'

describe('workspacesService', () => {
  let clock: number
  let svc: ReturnType<typeof createWorkspacesService>
  let changes: ReturnType<typeof recordingEvents>['changes']

  beforeEach(async () => {
    clock = 1_700_000_000_000
    const rec = recordingEvents()
    changes = rec.changes
    svc = createWorkspacesService(makeContext({ userDb: await migratedUserDb(), events: rec.events, now: () => clock }))
  })

  it('save/load round trip incl. state_json, and save return shape', async () => {
    const saved = await svc.save('Reading Mode', '{"layout":"a"}', '{"state":"a"}')
    expect(saved).toEqual({ id: saved.id, name: 'Reading Mode', created_at: 1_700_000_000_000 })
    expect(await svc.load(saved.id)).toEqual({
      id: saved.id, name: 'Reading Mode', created_at: 1_700_000_000_000,
      layout_json: '{"layout":"a"}', state_json: '{"state":"a"}',
    })
  })

  it('load of a missing id returns null', async () => {
    expect(await svc.load('does-not-exist')).toBeNull()
  })

  it('list orders by created_at DESC', async () => {
    const a = await svc.save('Reading Mode', '{}', '{}')
    clock = 1_700_000_001_000
    const b = await svc.save('Study Mode', '{}', '{}')
    clock = 1_700_000_002_000
    const c = await svc.save('Compare Mode', '{}', '{}')
    expect((await svc.list()).map((w) => w.id)).toEqual([c.id, b.id, a.id])
  })

  it('rename updates the name in place', async () => {
    const a = await svc.save('Reading Mode', '{}', '{}')
    expect(await svc.rename(a.id, 'Renamed')).toEqual({ success: true })
    expect((await svc.load(a.id))?.name).toBe('Renamed')
  })

  it('delete removes the workspace', async () => {
    const a = await svc.save('Reading Mode', '{}', '{}')
    const b = await svc.save('Study Mode', '{}', '{}')
    expect(await svc.delete(a.id)).toEqual({ success: true })
    expect(await svc.load(a.id)).toBeNull()
    expect((await svc.list()).map((w) => w.id)).toEqual([b.id])
  })

  it('emits data:changed(workspace) for save/rename/delete', async () => {
    const a = await svc.save('Reading Mode', '{}', '{}')
    await svc.rename(a.id, 'Renamed')
    await svc.delete(a.id)
    expect(changes.map((c) => ({ entity: c.entity, op: c.op, id: c.id }))).toEqual([
      { entity: 'workspace', op: 'upsert', id: a.id },
      { entity: 'workspace', op: 'upsert', id: a.id },
      { entity: 'workspace', op: 'delete', id: a.id },
    ])
  })
})
