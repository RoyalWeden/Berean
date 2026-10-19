// @vitest-environment jsdom
/** Berean Chat controller: plain messages never reach the AI, writes into a new conversation
 *  never fork it, switching conversations never mixes state, no duplicate AI submissions, and a
 *  change from another window is merged without duplicates. Runs against the REAL aiChats
 *  service over an in-memory migrated DB; only the AI query is faked. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { makeContext, migratedUserDb } from '@/platform/db/__tests__/testDb'
import { createAiChatsService } from '@/platform/services/aiChatsService'
import { useChatController, type ChatController } from '../useChatController'
import type { AiLookupResponse } from '@/types/electron'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let svc: ReturnType<typeof createAiChatsService>
let query: ReturnType<typeof vi.fn<unknown[], Promise<AiLookupResponse>>>
let changeListeners: Array<(c: { id?: string; op: 'upsert' | 'delete' }) => void>
let resolveQuery: ((r: AiLookupResponse) => void) | null

const answer = (summary: string): AiLookupResponse => ({ results: [], keywords: ['x'], related: [], summary } as unknown as AiLookupResponse)

beforeEach(async () => {
  let seq = 0
  svc = createAiChatsService(makeContext({ userDb: await migratedUserDb(), uuid: () => `chat-${++seq}` }))
  changeListeners = []
  resolveQuery = null
  query = vi.fn<unknown[], Promise<AiLookupResponse>>(() => new Promise<AiLookupResponse>((r) => { resolveQuery = r }))
  ;(window as unknown as { aiLookup: unknown }).aiLookup = {
    checkAvailable: async () => ({ available: true, models: ['m'] }),
    query,
    listChats: () => svc.listChats(),
    getChat: (id: string) => svc.getChat(id),
    saveChat: (c: never) => svc.saveChat(c),
    deleteChat: (id: string) => svc.deleteChat(id),
    upsertMessages: (i: never) => svc.upsertMessages(i),
    renameChat: (id: string, t: string) => svc.renameChat(id, t),
    queryMessages: (q: never) => svc.queryMessages(q),
    listDays: () => svc.listDays(),
    onChatsChanged: (cb: (c: { id?: string; op: 'upsert' | 'delete' }) => void) => { changeListeners.push(cb); return () => {} },
    onProgress: () => {},
    onPartial: () => {},
  }
})

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null })

const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 5)) })

async function mount(opts: Partial<Parameters<typeof useChatController>[0]> = {}) {
  const ref: { current: ChatController | null } = { current: null }
  function Harness() { ref.current = useChatController({ aiSupported: true, ...opts }); return null }
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => root!.render(<Harness />))
  await settle()
  return ref as { current: ChatController }
}

describe('useChatController', () => {
  it('New Conversation while another conversation is still loading never leaves "loading" stuck on', async () => {
    await svc.upsertMessages({ title: 'Feasts', messages: [{ id: 'a', role: 'user', kind: 'note', content: 'Leviticus 23', createdAt: '2026-10-01T09:00:00.000Z' }] })
    const id = (await svc.listChats())[0].id
    const c = await mount()
    // A slow load (a big conversation, a cold database)…
    let release: () => void = () => {}
    const api = (window as unknown as { aiLookup: { getChat: (i: string) => Promise<unknown> } }).aiLookup
    const real = api.getChat
    api.getChat = (i: string) => new Promise((r) => { release = () => r(real(i)) })
    act(() => c.current.newConversation())
    act(() => c.current.openConversation(id))
    expect(c.current.loadingChat).toBe(true)
    // …abandoned by New Conversation before it finishes.
    act(() => c.current.newConversation())
    release()
    await settle()
    expect(c.current.activeChatId).toBeNull()
    expect(c.current.loadingChat).toBe(false)
    api.getChat = real
  })

  it('a plain message is saved to a new conversation and never sent to the AI', async () => {
    const c = await mount()
    await act(async () => { await c.current.send('remember to read Leviticus 23') })
    await settle()
    expect(query).not.toHaveBeenCalled()
    const list = await svc.listChats()
    expect(list).toHaveLength(1)
    const chat = await svc.getChat(list[0].id)
    expect(chat!.messages.map((m) => [m.kind, m.content])).toEqual([['note', 'remember to read Leviticus 23']])
    expect(c.current.activeChatId).toBe(list[0].id)
  })

  it('two quick sends into a brand-new conversation create ONE conversation, in order', async () => {
    const c = await mount()
    await act(async () => { void c.current.send('one'); void c.current.send('two') })
    await settle()
    const list = await svc.listChats()
    expect(list).toHaveLength(1)
    expect((await svc.getChat(list[0].id))!.messages.map((m) => m.content)).toEqual(['one', 'two'])
    expect(c.current.messages.map((m) => m.content)).toEqual(['one', 'two'])
  })

  it('Ask Berean reads the conversation\'s notes as context and records the request mode', async () => {
    const c = await mount()
    await act(async () => { await c.current.send('a private thought') })
    await settle()
    let done: Promise<boolean> | null = null
    await act(async () => { done = c.current.send('verses about the Sabbath', { ai: { commentary: true, deepSearch: false, tabContext: false } }) })
    expect(query).toHaveBeenCalledTimes(1)
    const [q, o] = query.mock.calls[0] as [string, { history: unknown[]; commentary: boolean; tabContext?: unknown }]
    expect(q).toBe('verses about the Sabbath')
    // TEST 2026-10-18 "make sure ai can interact with the regular messages" — the note rides along
    // as context (marked), only because the user explicitly asked Berean something.
    expect(o.history).toEqual([{ role: 'user', content: '(my note) a private thought' }])
    expect(o.commentary).toBe(true)
    expect(o.tabContext).toBeUndefined()
    await act(async () => { resolveQuery!(answer('Exodus 31:13')); await done })
    await settle()
    const chat = await svc.getChat(c.current.activeChatId!)
    expect(chat!.messages.map((m) => m.kind)).toEqual(['note', 'ai-request', 'ai-reply'])
    expect(chat!.messages[1].aiMode).toEqual({ commentary: true, deepSearch: false, tabContext: false })
    expect(chat!.messages[2]).toMatchObject({ summary: 'Exodus 31:13', replyTo: chat!.messages[1].id })
    expect(chat!.messages.some((m) => (m as { pending?: boolean }).pending)).toBe(false)
  })

  it('refuses a second AI request while one is running (no duplicate submissions)', async () => {
    const c = await mount()
    const ai = { commentary: false, deepSearch: false, tabContext: false }
    let first: Promise<boolean> | null = null
    let second = true
    await act(async () => { first = c.current.send('q1', { ai }); second = await c.current.send('q2', { ai }) })
    expect(second).toBe(false)
    expect(query).toHaveBeenCalledTimes(1)
    await act(async () => { resolveQuery!(answer('ok')); await first })
  })

  it('an AI reply lands in the conversation that asked, even after switching away', async () => {
    const other = await svc.upsertMessages({ messages: [{ id: 'o', role: 'user', kind: 'note', content: 'other chat', createdAt: new Date().toISOString() }] })
    const c = await mount()
    await act(async () => { await c.current.send('first note') })
    await settle()
    const asking = c.current.activeChatId!
    let done: Promise<boolean> | null = null
    await act(async () => { done = c.current.send('a question', { ai: { commentary: false, deepSearch: false, tabContext: false } }) })
    await settle()
    act(() => c.current.openConversation(other.id))
    await settle()
    await act(async () => { resolveQuery!(answer('the answer')); await done })
    await settle()
    // The screen shows the other conversation, untouched.
    expect(c.current.messages.map((m) => m.content)).toEqual(['other chat'])
    // The asking conversation got the reply.
    expect((await svc.getChat(asking))!.messages.map((m) => m.kind)).toEqual(['note', 'ai-request', 'ai-reply'])
  })

  it('a write from another window is merged in without duplicating local messages', async () => {
    const c = await mount()
    await act(async () => { await c.current.send('mine') })
    await settle()
    const id = c.current.activeChatId!
    await svc.upsertMessages({ chatId: id, messages: [{ id: 'w2', role: 'user', kind: 'note', content: 'from the chat window', createdAt: new Date(Date.now() + 1000).toISOString() }] })
    await act(async () => { changeListeners.forEach((cb) => cb({ id, op: 'upsert' })) })
    await settle()
    await act(async () => { await new Promise((r) => setTimeout(r, 150)) })
    await settle()
    expect(c.current.messages.map((m) => m.content)).toEqual(['mine', 'from the chat window'])
  })

  it('new conversation reuses the empty draft; startWithNewMessage picks today’s conversation', async () => {
    const today = await svc.upsertMessages({ messages: [{ id: 't', role: 'user', kind: 'note', content: 'today', createdAt: new Date().toISOString() }] })
    const c = await mount({ startWithNewMessage: true })
    expect(c.current.activeChatId).toBe(today.id)
    act(() => c.current.newConversation())
    act(() => c.current.newConversation())
    expect(c.current.activeChatId).toBeNull()
    expect(await svc.listChats()).toHaveLength(1) // drafts are never rows
  })

  it('All Messages shows every conversation as one stream', async () => {
    await svc.upsertMessages({ messages: [{ id: 'a', role: 'user', kind: 'note', content: 'A', createdAt: '2026-10-01T09:00:00.000Z' }] })
    await svc.upsertMessages({ messages: [{ id: 'b', role: 'user', kind: 'note', content: 'B', createdAt: '2026-10-02T09:00:00.000Z' }] })
    const c = await mount()
    act(() => c.current.setView({ kind: 'all' }))
    await settle()
    expect(c.current.transcript.map((i) => i.message.content)).toEqual(['A', 'B'])
  })
})

describe('reopening Chat: the remembered conversation', () => {
  const seed = async (title: string, at: string) => (await svc.upsertMessages({ chatId: null, title, messages: [{ id: `${title}-1`, role: 'user', kind: 'note', content: title, createdAt: at }] } as never)).id
  it('reopens the remembered conversation, even when another has newer messages', async () => {
    const older = await seed('Older', '2026-10-01T10:00:00.000Z')
    await seed('Newer', '2026-10-18T10:00:00.000Z')
    const c = await mount({ initialChatId: older, resumeLatest: true })
    expect(c.current.activeChatId).toBe(older)
  })
  it('a remembered conversation deleted meanwhile falls back to the latest one', async () => {
    const gone = await seed('Gone', '2026-10-01T10:00:00.000Z')
    const newer = await seed('Newer', '2026-10-18T10:00:00.000Z')
    await svc.deleteChat(gone)
    const c = await mount({ initialChatId: gone, resumeLatest: true })
    expect(c.current.activeChatId).toBe(newer)
  })
  it('an explicitly started new conversation with an unsent draft stays new (its text never goes to another conversation)', async () => {
    await seed('Latest', '2026-10-18T10:00:00.000Z')
    localStorage.setItem('berean-chat-drafts-v1', JSON.stringify({ new: { md: 'half-written thought', updatedAt: Date.now() } }))
    const c = await mount({ initialChatId: null, resumeLatest: true })
    expect(c.current.activeChatId).toBeNull()
    localStorage.clear()
  })
  it('a global-search result opens its conversation and asks for Find on that message', async () => {
    const id = await seed('Feasts', '2026-10-18T10:00:00.000Z')
    const c = await mount({ resumeLatest: false })
    act(() => c.current.setSearch('feasts'))
    act(() => c.current.openSearchResult(id, 'Feasts-1', 'feasts'))
    await settle()
    expect(c.current.search).toBe('')
    expect(c.current.activeChatId).toBe(id)
    expect(c.current.findRequest).toMatchObject({ query: 'feasts', messageId: 'Feasts-1' })
  })
})
