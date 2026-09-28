import { describe, it, expect, beforeEach } from 'vitest'
import { makeContext, migratedUserDb, recordingEvents } from '../../db/__tests__/testDb'
import { createAiChatsService, type AiChatMessage } from '../aiChatsService'

describe('aiChatsService', () => {
  let svc: ReturnType<typeof createAiChatsService>
  let changes: ReturnType<typeof recordingEvents>['changes']
  let tick = 0

  const msgs = (): AiChatMessage[] => [
    { role: 'user', content: 'What does John 3:16 say?', createdAt: '2026-01-01T00:00:00.000Z' },
    { role: 'assistant', content: 'For Yehovah so loved the world...', results: [], visibleCount: 0, keywords: ['love'], createdAt: '2026-01-01T00:00:01.000Z' },
  ]

  beforeEach(async () => {
    const rec = recordingEvents()
    changes = rec.changes
    tick = 0
    let uuidSeq = 0
    svc = createAiChatsService(makeContext({
      userDb: await migratedUserDb(),
      events: rec.events,
      now: () => Date.parse('2026-01-01T00:00:00.000Z') + tick++,
      uuid: () => `generated-uuid-${uuidSeq++}`,
    }))
  })

  it('saveChat without an id inserts a new row using ctx.uuid()/ctx.now() and returns its id', async () => {
    const { id } = await svc.saveChat({ title: 'Study session', messages: msgs() })
    expect(id).toBe('generated-uuid-0')
    expect(changes).toEqual([{ entity: 'ai_chat', id: 'generated-uuid-0', op: 'upsert' }])

    const chat = await svc.getChat(id)
    expect(chat).toMatchObject({ id, title: 'Study session', messages: msgs() })
    expect(chat!.createdAt).toBe(chat!.updatedAt)
  })

  it('saveChat with an id updates title/messages/updated_at in place, leaving created_at untouched', async () => {
    const { id } = await svc.saveChat({ title: 'First title', messages: msgs() })
    const before = await svc.getChat(id)

    const updatedMessages = [...msgs(), { role: 'user' as const, content: 'Follow-up', createdAt: '2026-01-01T00:00:02.000Z' }]
    const result = await svc.saveChat({ id, title: 'Renamed', messages: updatedMessages })
    expect(result).toEqual({ id })

    const after = await svc.getChat(id)
    expect(after!.title).toBe('Renamed')
    expect(after!.messages).toHaveLength(3)
    expect(after!.createdAt).toBe(before!.createdAt)
    expect(after!.updatedAt).not.toBe(before!.updatedAt)
    expect(changes.map((c) => c.op)).toEqual(['upsert', 'upsert'])
  })

  it('getChat returns null for an unknown id', async () => {
    expect(await svc.getChat('does-not-exist')).toBeNull()
  })

  it('listChats returns summaries ordered by updated_at DESC without the messages payload', async () => {
    const a = await svc.saveChat({ title: 'Older', messages: msgs() })
    const b = await svc.saveChat({ title: 'Newer', messages: msgs() })
    const list = await svc.listChats()
    expect(list.map((c) => c.id)).toEqual([b.id, a.id])
    expect(list[0]).toMatchObject({ id: b.id, title: 'Newer' })
    expect((list[0] as unknown as { messages?: unknown }).messages).toBeUndefined()
  })

  it('listChats returns [] when there are no chats', async () => {
    expect(await svc.listChats()).toEqual([])
  })

  it('deleteChat removes the row, emits a delete, and is a no-op for an unknown id', async () => {
    const { id } = await svc.saveChat({ title: 'To delete', messages: msgs() })
    expect(await svc.deleteChat(id)).toEqual({ success: true })
    expect(await svc.getChat(id)).toBeNull()
    expect(await svc.deleteChat('never-existed')).toEqual({ success: true })
    expect(changes.map((c) => c.op)).toEqual(['upsert', 'delete', 'delete'])
  })
})
