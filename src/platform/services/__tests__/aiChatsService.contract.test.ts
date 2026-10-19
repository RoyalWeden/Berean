import { describe, it, expect, beforeEach } from 'vitest'
import { makeContext, migratedUserDb, recordingEvents } from '../../db/__tests__/testDb'
import { createAiChatsService, dayKeyOf, type AiChatMessage } from '../aiChatsService'

const dayKey = (iso: string) => dayKeyOf(Date.parse(iso))

describe('aiChatsService', () => {
  let svc: ReturnType<typeof createAiChatsService>
  let changes: ReturnType<typeof recordingEvents>['changes']
  let tick = 0
  let userDb: Awaited<ReturnType<typeof migratedUserDb>>

  const msgs = (): AiChatMessage[] => [
    { role: 'user', content: 'What does John 3:16 say?', createdAt: '2026-01-01T00:00:00.000Z' },
    { role: 'assistant', content: 'For Yehovah so loved the world...', results: [], visibleCount: 0, keywords: ['love'], createdAt: '2026-01-01T00:00:01.000Z' },
  ]

  beforeEach(async () => {
    const rec = recordingEvents()
    changes = rec.changes
    tick = 0
    let uuidSeq = 0
    userDb = await migratedUserDb()
    svc = createAiChatsService(makeContext({
      userDb,
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

  // ── Berean Chat redesign ──────────────────────────────────────────────────────────────────

  it('getChat normalizes legacy messages (no id/kind) without changing what is stored', async () => {
    const { id } = await svc.saveChat({ title: 'Legacy', messages: msgs() })
    const chat = await svc.getChat(id)
    expect(chat!.messages.map((m) => [m.id, m.kind])).toEqual([[`${id}:0`, 'ai-request'], [`${id}:1`, 'ai-reply']])
    // Reading never rewrites: the stored row is still exactly what the older client wrote.
    const row = await userDb.get<{ messages: string }>('SELECT messages FROM ai_chats WHERE id = ?', [id])
    expect(JSON.parse(row!.messages)).toEqual(msgs())
  })

  it('upsertMessages creates a conversation, then merges by id: same id replaces, new ids append', async () => {
    const note = { id: 'n1', role: 'user' as const, kind: 'note' as const, content: 'Remember Leviticus 23', createdAt: '2026-01-02T09:00:00.000Z' }
    const first = await svc.upsertMessages({ messages: [note] })
    expect(first.title).toBe('Remember Leviticus 23')
    expect(first.messages.map((m) => m.id)).toEqual(['n1'])

    const second = { id: 'n2', role: 'user' as const, kind: 'note' as const, content: 'and Numbers 28', createdAt: '2026-01-02T09:01:00.000Z' }
    await svc.upsertMessages({ chatId: first.id, messages: [second] })
    const edited = await svc.upsertMessages({ chatId: first.id, messages: [{ ...note, content: 'Remember Leviticus 23 (feasts)', editedAt: '2026-01-02T09:02:00.000Z' }] })
    expect(edited.messages.map((m) => [m.id, m.content])).toEqual([['n1', 'Remember Leviticus 23 (feasts)'], ['n2', 'and Numbers 28']])
    expect(edited.title).toBe('Remember Leviticus 23') // title is kept once set

    const removed = await svc.upsertMessages({ chatId: first.id, messages: [], removeIds: ['n1'] })
    expect(removed.messages.map((m) => m.id)).toEqual(['n2'])
    expect(changes.every((c) => c.entity === 'ai_chat' && c.op === 'upsert')).toBe(true)
  })

  it('upsertMessages merges against the row as stored now — two writers never drop each other', async () => {
    const a = await svc.upsertMessages({ messages: [{ id: 'a', role: 'user', kind: 'note', content: 'from window A', createdAt: '2026-01-02T09:00:00.000Z' }] })
    // Window B appends without having seen anything A wrote after its own load.
    await svc.upsertMessages({ chatId: a.id, messages: [{ id: 'b', role: 'user', kind: 'note', content: 'from window B', createdAt: '2026-01-02T09:00:01.000Z' }] })
    await svc.upsertMessages({ chatId: a.id, messages: [{ id: 'c', role: 'user', kind: 'note', content: 'A again', createdAt: '2026-01-02T09:00:02.000Z' }] })
    expect((await svc.getChat(a.id))!.messages.map((m) => m.id)).toEqual(['a', 'b', 'c'])
  })

  it('upsertMessages into a conversation deleted meanwhile starts a new one instead of failing', async () => {
    const a = await svc.upsertMessages({ messages: [{ id: 'a', role: 'user', kind: 'note', content: 'x', createdAt: '2026-01-02T09:00:00.000Z' }] })
    await svc.deleteChat(a.id)
    const b = await svc.upsertMessages({ chatId: a.id, messages: [{ id: 'b', role: 'user', kind: 'note', content: 'y', createdAt: '2026-01-02T09:01:00.000Z' }] })
    expect(b.id).not.toBe(a.id)
    expect(b.messages.map((m) => m.id)).toEqual(['b'])
  })

  it('stored JSON stays readable by older clients: extra fields only, legacy shape intact', async () => {
    const { id } = await svc.upsertMessages({ messages: [{ id: 'n1', role: 'user', kind: 'note', content: 'hello', createdAt: '2026-01-02T09:00:00.000Z' }] })
    const row = await userDb.get<{ messages: string }>('SELECT messages FROM ai_chats WHERE id = ?', [id])
    const [stored] = JSON.parse(row!.messages)
    // The legacy fields an older client reads are all there and well-formed…
    expect(stored).toMatchObject({ role: 'user', content: 'hello', createdAt: '2026-01-02T09:00:00.000Z' })
    // …and everything else is additive.
    expect(Object.keys(stored).sort()).toEqual(['content', 'createdAt', 'id', 'kind', 'role'])
  })

  it('renameChat updates the title (and refuses an empty one)', async () => {
    const { id } = await svc.saveChat({ title: 'Old', messages: msgs() })
    expect(await svc.renameChat(id, '  Feasts study  ')).toEqual({ success: true })
    expect((await svc.getChat(id))!.title).toBe('Feasts study')
    expect(await svc.renameChat(id, '   ')).toEqual({ success: false })
  })

  it('listChats adds messageCount / lastMessageAt / preview', async () => {
    await svc.upsertMessages({ messages: [
      { id: 'q', role: 'user', kind: 'ai-request', content: 'verses about the Sabbath', createdAt: '2026-01-03T10:00:00.000Z' },
      { id: 'r', role: 'assistant', kind: 'ai-reply', content: '', results: [{} as never, {} as never], createdAt: '2026-01-03T10:00:05.000Z' },
    ] })
    const [s] = await svc.listChats()
    expect(s).toMatchObject({ messageCount: 2, lastMessageAt: '2026-01-03T10:00:05.000Z', preview: '2 passages' })
  })

  it('queryMessages pages the cross-conversation stream newest-first, oldest→newest within a page', async () => {
    const mk = (id: string, iso: string) => ({ id, role: 'user' as const, kind: 'note' as const, content: id, createdAt: iso })
    const a = await svc.upsertMessages({ messages: [mk('a1', '2026-01-01T08:00:00.000Z'), mk('a2', '2026-01-03T08:00:00.000Z')] })
    await svc.upsertMessages({ messages: [mk('b1', '2026-01-02T08:00:00.000Z'), mk('b2', '2026-01-04T08:00:00.000Z')] })

    const p1 = await svc.queryMessages({ limit: 2 })
    expect(p1.items.map((i) => i.message.id)).toEqual(['a2', 'b2'])
    expect(p1.hasMore).toBe(true)
    const p2 = await svc.queryMessages({ limit: 2, before: p1.cursor! })
    expect(p2.items.map((i) => i.message.id)).toEqual(['a1', 'b1'])
    expect(p2.hasMore).toBe(false)
    expect(p2.items[0]).toMatchObject({ chatId: a.id, chatTitle: 'a1' })

    const search = await svc.queryMessages({ search: 'B2' })
    expect(search.items.map((i) => i.message.id)).toEqual(['b2'])
  })

  it('listDays groups messages by local day with note / AI counts; queryMessages filters by day', async () => {
    const local = (d: number, h: number) => new Date(2026, 0, d, h, 0, 0).toISOString()
    await svc.upsertMessages({ messages: [
      { id: 'n1', role: 'user', kind: 'note', content: 'morning note', createdAt: local(5, 7) },
      { id: 'q1', role: 'user', kind: 'ai-request', content: 'question', createdAt: local(5, 23) },
      { id: 'r1', role: 'assistant', kind: 'ai-reply', content: 'answer', createdAt: local(5, 23) },
      { id: 'n2', role: 'user', kind: 'note', content: 'next day', createdAt: local(6, 0) },
    ] })
    expect(await svc.listDays()).toEqual([
      { dayKey: '2026-01-06', count: 1, notes: 1, ai: 0 },
      { dayKey: '2026-01-05', count: 3, notes: 1, ai: 2 },
    ])
    const day = await svc.queryMessages({ dayKey: '2026-01-05' })
    expect(day.items.map((i) => i.message.id)).toEqual(['n1', 'q1', 'r1'])
  })

  it('legacy rows as the Mac stores them (ISO text timestamps, no id/kind, structured results) list newest first and read back', async () => {
    const legacy = (q: string, at: string) => JSON.stringify([
      { role: 'user', content: q, createdAt: at },
      { role: 'assistant', content: '', results: [{ bookId: 'REV', bookName: 'Revelation', chapter: 9, verse: 6, text: 'And in those days shall men seek death', textId: 'kjva', source: 'fts' }], visibleCount: 1, keywords: ['death'], related: [], createdAt: at },
    ])
    const rows = [
      ['old', 'where is it that people will seek death', '2026-08-09T15:01:02.003Z'],
      ['newer', 'where does it talk about desiring death', '2026-08-14T00:56:48.328Z'],
      ['mid', 'sabbath sign', '2026-08-13T22:55:36.100Z'],
    ]
    for (const [id, title, at] of rows) {
      await userDb.run('INSERT INTO ai_chats (id, title, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [id, title, legacy(title, at), at, at])
    }
    const note = await svc.upsertMessages({ messages: [{ id: 'n', role: 'user', kind: 'note', content: 'test message', createdAt: '2026-10-17T20:44:03.107Z' }] })
    // (the test clock is January — stamp the row the way the real write on Oct 17 did)
    await userDb.run('UPDATE ai_chats SET created_at = ?, updated_at = ? WHERE id = ?', ['2026-10-17T20:44:03.117Z', '2026-10-17T20:44:03.117Z', note.id])
    const list = await svc.listChats()
    expect(list.map((c) => c.id)).toEqual([note.id, 'newer', 'mid', 'old'])
    expect(list[1]).toMatchObject({ messageCount: 2, lastMessageAt: '2026-08-14T00:56:48.328Z', preview: '1 passage' })
    const chat = await svc.getChat('old')
    expect(chat!.messages.map((m) => m.kind)).toEqual(['ai-request', 'ai-reply'])
    expect(chat!.messages[1].results?.[0].bookName).toBe('Revelation')
    expect((await svc.listDays()).map((d) => d.dayKey)).toEqual([
      dayKey('2026-10-17T20:44:03.107Z'), dayKey('2026-08-14T00:56:48.328Z'), dayKey('2026-08-13T22:55:36.100Z'), dayKey('2026-08-09T15:01:02.003Z'),
    ].filter((k, i, a) => a.indexOf(k) === i))
    const page = await svc.queryMessages({ limit: 3 })
    expect(page.items.map((i) => i.chatId)).toEqual(['newer', 'newer', note.id])
    expect(page.hasMore).toBe(true)
  })

  it('a remote (sync) rewrite of a row is never served from the parsed-message cache', async () => {
    const { id } = await svc.upsertMessages({ messages: [{ id: 'a', role: 'user', kind: 'note', content: 'a', createdAt: '2026-01-02T09:00:00.000Z' }] })
    await svc.listChats() // warm the cache
    const row = await userDb.get<{ updated_at: string }>('SELECT updated_at FROM ai_chats WHERE id = ?', [id])
    // Same updated_at (bookkeeping merged last-writer-wins), messages grew via the sync merge:
    await userDb.run('UPDATE ai_chats SET messages = ? WHERE id = ?', [JSON.stringify([
      { id: 'a', role: 'user', kind: 'note', content: 'a', createdAt: '2026-01-02T09:00:00.000Z' },
      { id: 'b', role: 'user', kind: 'note', content: 'b', createdAt: '2026-01-02T09:00:01.000Z' },
    ]), id])
    expect((await userDb.get<{ updated_at: string }>('SELECT updated_at FROM ai_chats WHERE id = ?', [id]))!.updated_at).toBe(row!.updated_at)
    expect((await svc.getChat(id))!.messages.map((m) => m.id)).toEqual(['a', 'b'])
    expect((await svc.listChats())[0].messageCount).toBe(2)
  })
})


describe('plainChatText (titles / previews)', () => {
  it('drops the chat markdown', async () => {
    const { plainChatText, deriveChatTitle } = await import('../aiChatsService')
    expect(plainChatText('Read **John 3:16** and <u>H7225</u>, *grace* ~~old~~ ==key== `x` [site](https://a.b)')).toBe('Read John 3:16 and H7225, grace old key x site')
    expect(plainChatText('- one\n1. two\n> three')).toBe('one\ntwo\nthree')
    expect(plainChatText('2 * 3 * 4 and snake_case_name')).toBe('2 * 3 * 4 and snake_case_name')
    // A table's delimiter row never leaks into a preview, whatever its alignment colons (GFM allows one dash).
    expect(plainChatText('| Passage | Reason |\n| :-- | :-: |\n| Exodus 20:8 | Creation |').replace(/\n+/g, ' / ')).toBe('Passage · Reason / Exodus 20:8 · Creation')
    expect(deriveChatTitle([{ role: 'user', content: '**Grace** study' }])).toBe('Grace study')
    expect(plainChatText('## Two tellings\n\n| Passage | Reason |\n| :-- | :-- |\n| Exodus 20:8 | Creation |\n```ts\ncode()\n```').replace(/\s+/g, ' ').trim())
      .toBe('Two tellings Passage · Reason Exodus 20:8 · Creation code()')
  })
})
