import { describe, it, expect } from 'vitest'
import {
  normalizeForUi, aiHistoryFor, mergeServerMessages, mergeStreamItems, buildTranscriptRows, pickNewMessageTarget,
  mentionsCurrentTab, formatDayHeading, dayKeyOf, deriveChatTitle, aiModeCaption, type ChatMsg, type TranscriptItem,
} from '../chatModel'
import { groupDays, normalizeChatMessages, mergeMessagesById } from '@/platform/services/aiChatsService'

const local = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m, 0).toISOString()
const note = (id: string, iso: string, content = id): ChatMsg => ({ id, role: 'user', kind: 'note', content, createdAt: iso })
const req = (id: string, iso: string, content = id): ChatMsg => ({ id, role: 'user', kind: 'ai-request', content, createdAt: iso })
const reply = (id: string, iso: string, extra: Partial<ChatMsg> = {}): ChatMsg => ({ id, role: 'assistant', kind: 'ai-reply', content: 'ans', createdAt: iso, ...extra })
const item = (chatId: string | null, m: ChatMsg, title = 'T'): TranscriptItem => ({ key: `${String(Date.parse(m.createdAt)).padStart(15, '0')}|${chatId}|${m.id}`, chatId, chatTitle: title, message: m })

describe('message normalization / back-compat', () => {
  it('legacy messages get kind from role and a stable index id; new fields are kept', () => {
    const out = normalizeChatMessages([
      { role: 'user', content: 'q', createdAt: '2026-01-01T00:00:00.000Z' },
      { role: 'assistant', content: 'a', createdAt: '2026-01-01T00:00:01.000Z' },
      { role: 'user', content: 'n', createdAt: '2026-01-01T00:00:02.000Z', kind: 'note', id: 'keep' },
    ], { id: 'chat1', createdAt: '2026-01-01T00:00:00.000Z' })
    expect(out.map((m) => [m.id, m.kind])).toEqual([['chat1:0', 'ai-request'], ['chat1:1', 'ai-reply'], ['keep', 'note']])
  })

  it('a missing / bad createdAt falls back to the previous message, else the chat creation time', () => {
    const out = normalizeChatMessages([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'x', createdAt: '2026-01-05T00:00:00.000Z' },
      { role: 'user', content: 'y', createdAt: 'not a date' },
    ], { id: 'c', createdAt: '2026-01-01T00:00:00.000Z' })
    expect(out.map((m) => m.createdAt)).toEqual(['2026-01-01T00:00:00.000Z', '2026-01-05T00:00:00.000Z', '2026-01-05T00:00:00.000Z'])
  })

  it('tolerates junk (non-array, null entries, duplicate ids) without throwing', () => {
    expect(normalizeChatMessages('nope', { id: 'c', createdAt: '' })).toEqual([])
    const out = normalizeChatMessages([null, { role: 'user', content: 'a', id: 'x', createdAt: '2026-01-01T00:00:00.000Z' }, { role: 'user', content: 'b', id: 'x', createdAt: '2026-01-01T00:00:00.000Z' }], { id: 'c', createdAt: '' })
    expect(new Set(out.map((m) => m.id)).size).toBe(2)
  })

  it('normalizeForUi is the same rule', () => {
    expect(normalizeForUi([{ role: 'assistant', content: '', createdAt: '2026-01-01T00:00:00.000Z' }], { id: 'c', createdAt: '' })[0].kind).toBe('ai-reply')
  })

  it('mergeMessagesById replaces in place, appends new, drops removed', () => {
    const cur = [note('a', local(1, 9)), note('b', local(1, 10))]
    const out = mergeMessagesById(cur, [note('b', local(1, 10), 'B!'), note('c', local(1, 11))], ['a'])
    expect(out.map((m) => [m.id, m.content])).toEqual([['b', 'B!'], ['c', 'c']])
  })
})

describe('AI history: the conversation as context', () => {
  it('settled AI turns plus the user\'s notes (marked), last N', () => {
    const msgs = [note('n1', local(1, 9), 'private note'), req('q1', local(1, 10), 'q1'), reply('r1', local(1, 10)), note('n2', local(1, 11), 'another'), reply('p', local(1, 12), { pending: true })]
    expect(aiHistoryFor(msgs)).toEqual([
      { role: 'user', content: '(my note) private note' }, { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'ans' }, { role: 'user', content: '(my note) another' },
    ])
    expect(aiHistoryFor([req('a', local(1, 1)), req('b', local(1, 2)), req('c', local(1, 3))], 2).map((h) => h.content)).toEqual(['b', 'c'])
  })
})

describe('mergeServerMessages', () => {
  it('server wins; unsaved local messages and the live placeholder are kept once', () => {
    const server = [note('a', local(1, 9))]
    const local1 = [note('a', local(1, 9), 'stale'), note('b', local(1, 10)), reply('p', local(1, 11), { pending: true }), note('gone', local(1, 8))]
    const out = mergeServerMessages(server, local1, new Set(['b']))
    expect(out.map((m) => [m.id, m.content])).toEqual([['a', 'a'], ['b', 'b'], ['p', 'ans']])
  })
})

describe('day grouping', () => {
  it('groupDays counts per local day, newest first, notes vs AI', () => {
    const days = groupDays([
      { message: note('a', local(3, 23, 59)) }, { message: req('b', local(4, 0, 1)) }, { message: reply('c', local(4, 0, 2)) },
    ] as never)
    expect(days).toEqual([
      { dayKey: '2026-10-04', count: 2, notes: 0, ai: 2 },
      { dayKey: '2026-10-03', count: 1, notes: 1, ai: 0 },
    ])
  })

  it('transcript rows: a separator per day, runs grouped by side, conversation tags in stream views', () => {
    const items = [
      item('c1', note('a', local(3, 9, 0)), 'Feasts'),
      item('c1', note('b', local(3, 9, 1)), 'Feasts'),
      item('c1', reply('r', local(3, 9, 2)), 'Feasts'),
      item('c2', note('d', local(3, 9, 3)), 'Sabbath'),
      item('c2', note('e', local(4, 8, 0)), 'Sabbath'),
    ]
    const rows = buildTranscriptRows(items, { crossConversation: true, now: new Date(2026, 9, 4, 12).getTime() })
    expect(rows.map((r) => (r.type === 'day' ? `day:${r.label}` : `${r.item.message.id}${r.groupStart ? '^' : ''}${r.groupEnd ? '$' : ''}${r.showConversation ? '#' : ''}`)))
      .toEqual(['day:Yesterday', 'a^#', 'b$', 'r^$', 'd^$#', 'day:Today', 'e^$#'])
  })

  it('a long pause inside one day gets a time stamp; an empty AI placeholder renders no row', () => {
    const rows = buildTranscriptRows([
      item('c', note('a', local(3, 9))),
      item('c', note('b', local(3, 11))),
      item('c', reply('p', local(3, 11, 1), { content: '', pending: true })),
    ], { crossConversation: false })
    const msgRows = rows.filter((r) => r.type === 'message')
    expect(msgRows.map((r) => r.type === 'message' && r.item.message.id)).toEqual(['a', 'b'])
    expect(msgRows[1].type === 'message' && msgRows[1].timeLabel).toBeTruthy()
    expect(msgRows.every((r) => r.type === 'message' && !r.showConversation)).toBe(true)
  })

  it('formatDayHeading: Today / Yesterday / weekday / date', () => {
    const now = new Date(2026, 9, 17, 12).getTime()
    expect(formatDayHeading('2026-10-17', now)).toBe('Today')
    expect(formatDayHeading('2026-10-16', now)).toBe('Yesterday')
    expect(formatDayHeading('2026-10-13', now)).toBe(new Date(2026, 9, 13).toLocaleDateString([], { weekday: 'long' }))
    expect(formatDayHeading('2026-09-01', now)).toBe(new Date(2026, 8, 1).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }))
    expect(dayKeyOf(new Date(2026, 0, 2, 23, 59).getTime())).toBe('2026-01-02')
  })
})

describe('stream merge (All Messages / a day)', () => {
  const loaded = [item('other', note('o1', local(3, 9))), item('other', note('o2', local(3, 12)))]
  it('interleaves the active conversation by time, without duplicating its loaded copy', () => {
    const out = mergeStreamItems([...loaded, item('act', note('x', local(3, 10)))], { chatId: 'act', chatTitle: 'A', messages: [note('x', local(3, 10)), note('y', local(3, 13))] }, { hasMore: false })
    expect(out.map((i) => i.message.id)).toEqual(['o1', 'x', 'o2', 'y'])
  })
  it('hides active messages older than the oldest loaded page while older pages remain', () => {
    const out = mergeStreamItems(loaded, { chatId: 'act', chatTitle: 'A', messages: [note('old', local(2, 9)), note('new', local(3, 13))] }, { hasMore: true })
    expect(out.map((i) => i.message.id)).toEqual(['o1', 'o2', 'new'])
  })
  it('a day view only shows that day', () => {
    const out = mergeStreamItems([], { chatId: null, chatTitle: 'New', messages: [note('a', local(3, 9)), note('b', local(4, 9))] }, { dayKey: '2026-10-04', hasMore: false })
    expect(out.map((i) => i.message.id)).toEqual(['b'])
  })
})

describe('new message target / misc', () => {
  const now = new Date(2026, 9, 17, 15).getTime()
  const sum = (id: string, iso: string) => ({ id, title: id, created_at: iso, updated_at: iso, lastMessageAt: iso })
  it("reuses today's most recent conversation, else a fresh draft (null)", () => {
    expect(pickNewMessageTarget([sum('old', local(16, 9)), sum('today', local(17, 8))], now)).toBe('today')
    expect(pickNewMessageTarget([sum('old', local(16, 9))], now)).toBeNull()
    expect(pickNewMessageTarget([], now)).toBeNull()
  })
  it('inline tab mentions are detected', () => {
    expect(mentionsCurrentTab('what does THIS CHAPTER say about rest')).toBe(true)
    expect(mentionsCurrentTab('verses about rest')).toBe(false)
  })
  it('titles and captions', () => {
    expect(deriveChatTitle([note('a', local(1, 1), '   ')])).toBe('New Conversation')
    expect(deriveChatTitle([note('a', local(1, 1), 'x'.repeat(80))]).length).toBeLessThanOrEqual(60)
    expect(aiModeCaption({ commentary: true, deepSearch: false, tabContext: true })).toBe('Ask Berean · Commentary · This Tab')
  })
})
