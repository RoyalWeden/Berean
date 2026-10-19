// @vitest-environment jsdom
/** Berean Chat organisation (2026-10-18): All Messages writes to no conversation unless one is
 *  picked; pins and folders through the controller; the list's Pinned / Folders / date grouping.
 *  Real aiChats service over an in-memory DB. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { makeContext, migratedUserDb } from '@/platform/db/__tests__/testDb'
import { createAiChatsService } from '@/platform/services/aiChatsService'
import { useChatController, type ChatController } from '../useChatController'
import { UNFILED_CHAT_ID } from '../chatModel'
import { organizeConversations } from '../ChatHistoryList'
import type { AiLookupChatSummary } from '@/types/electron'
import type { AiLookupResponse } from '@/types/electron'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let svc: ReturnType<typeof createAiChatsService>
let query: ReturnType<typeof vi.fn<unknown[], Promise<AiLookupResponse>>>

beforeEach(async () => {
  localStorage.clear()
  let seq = 0
  svc = createAiChatsService(makeContext({ userDb: await migratedUserDb(), uuid: () => `chat-${++seq}` }))
  query = vi.fn<unknown[], Promise<AiLookupResponse>>(async () => ({ results: [], keywords: ['x'], related: [], summary: 'ok' } as unknown as AiLookupResponse))
  ;(window as unknown as { aiLookup: unknown }).aiLookup = {
    checkAvailable: async () => ({ available: true, models: ['m'] }),
    query,
    listChats: () => svc.listChats(),
    getChat: (id: string) => svc.getChat(id),
    saveChat: (c: never) => svc.saveChat(c),
    deleteChat: (id: string) => svc.deleteChat(id),
    upsertMessages: (i: never) => svc.upsertMessages(i),
    renameChat: (id: string, t: string) => svc.renameChat(id, t),
    organizeChat: (id: string, ch: never) => svc.organizeChat(id, ch),
    renameFolder: (f: string, t: string | null) => svc.renameFolder(f, t),
    queryMessages: (q: never) => svc.queryMessages(q),
    listDays: () => svc.listDays(),
    onChatsChanged: () => () => {},
    onProgress: () => {},
    onPartial: () => {},
  }
})

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null })
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 5)) })

async function mount() {
  const ref: { current: ChatController | null } = { current: null }
  function Harness() { ref.current = useChatController({ aiSupported: true }); return null }
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => root!.render(<Harness />))
  await settle()
  return ref as { current: ChatController }
}

describe('All Messages destination', () => {
  it('a message written in All Messages goes to NO conversation (none is created or touched)', async () => {
    const c = await mount()
    await act(async () => { await c.current.send('in a conversation') })
    await settle()
    const conv = c.current.activeChatId!
    act(() => c.current.setView({ kind: 'all' }))
    await settle()
    expect(c.current.crossDestination).toBeNull()
    await act(async () => { await c.current.send('just a thought') })
    await settle()
    expect((await svc.listChats()).map((s) => s.id)).toEqual([conv])
    expect((await svc.getChat(conv))!.messages.map((m) => m.content)).toEqual(['in a conversation'])
    expect((await svc.getChat(UNFILED_CHAT_ID))!.messages.map((m) => m.content)).toEqual(['just a thought'])
    expect(c.current.transcript.map((t) => t.message.content)).toEqual(['in a conversation', 'just a thought'])
  })

  it('picking a conversation sends there; leaving and coming back resets to none', async () => {
    const c = await mount()
    await act(async () => { await c.current.send('first') })
    await settle()
    const conv = c.current.activeChatId!
    act(() => c.current.newConversation())
    act(() => c.current.setView({ kind: 'all' }))
    await settle()
    act(() => c.current.setCrossDestination(conv))
    await settle()
    expect(c.current.crossDestination).toBe(conv)
    await act(async () => { await c.current.send('filed') })
    await settle()
    expect((await svc.getChat(conv))!.messages.map((m) => m.content)).toEqual(['first', 'filed'])
    act(() => c.current.openConversation(conv))
    act(() => c.current.setView({ kind: 'all' }))
    await settle()
    expect(c.current.crossDestination).toBeNull()
  })

  it('Unfiled opens as its own conversation: only unfiled messages, and new ones stay unfiled', async () => {
    const c = await mount()
    await act(async () => { await c.current.send('in a conversation') })
    await settle()
    const conv = c.current.activeChatId!
    act(() => c.current.setView({ kind: 'all' }))
    await settle()
    await act(async () => { await c.current.send('just a thought') })
    await settle()
    act(() => c.current.openConversation(UNFILED_CHAT_ID))
    await settle()
    expect(c.current.view.kind).toBe('conversation')
    expect(c.current.activeChatId).toBe(UNFILED_CHAT_ID)
    expect(c.current.activeTitle).toBe('Unfiled')
    expect(c.current.transcript.map((t) => t.message.content)).toEqual(['just a thought'])
    await act(async () => { await c.current.send('another thought') })
    await settle()
    expect((await svc.listChats()).map((s) => s.id)).toEqual([conv])
    expect((await svc.getChat(UNFILED_CHAT_ID))!.messages.map((m) => m.content)).toEqual(['just a thought', 'another thought'])
    expect((await svc.getChat(conv))!.messages.map((m) => m.content)).toEqual(['in a conversation'])
  })
})

describe('pins and folders', () => {
  it('pin, file, rename and delete a folder through the controller', async () => {
    const c = await mount()
    await act(async () => { await c.current.send('one') })
    await settle()
    const id = c.current.activeChatId!
    await act(async () => { await c.current.pinChat(id, true) })
    await act(async () => { await c.current.moveToFolder(id, 'Feasts') })
    await settle()
    expect(c.current.folders).toEqual(['Feasts'])
    let s = c.current.summaries.find((x) => x.id === id)!
    expect(s.pinnedAt).toBeTruthy()
    expect(s.folder).toBe('Feasts')
    await act(async () => { await c.current.renameFolder('Feasts', 'Appointed Times') })
    await settle()
    expect(c.current.folders).toEqual(['Appointed Times'])
    await act(async () => { await c.current.renameFolder('Appointed Times', null) })
    await act(async () => { await c.current.pinChat(id, false) })
    await settle()
    s = c.current.summaries.find((x) => x.id === id)!
    expect([s.pinnedAt ?? null, s.folder ?? null, c.current.folders]).toEqual([null, null, []])
  })

  it('organizeConversations: Pinned (newest pin first), folders A→Z, the rest by date — each conversation once', () => {
    const now = Date.parse('2026-10-18T12:00:00')
    const mk = (id: string, at: string, extra: Partial<AiLookupChatSummary> = {}): AiLookupChatSummary => ({ id, title: id, created_at: at, updated_at: at, lastMessageAt: at, ...extra })
    const o = organizeConversations([
      mk('a', '2026-10-18T10:00:00', { pinnedAt: '2026-10-01T00:00:00', folder: 'Zeta' }),
      mk('b', '2026-10-17T10:00:00', { pinnedAt: '2026-10-05T00:00:00' }),
      mk('c', '2026-10-10T10:00:00', { folder: 'Zeta' }),
      mk('d', '2026-10-12T10:00:00', { folder: 'Alpha' }),
      mk('e', '2026-10-18T09:00:00'),
    ], now)
    expect(o.pinned.map((s) => s.id)).toEqual(['b', 'a'])
    expect(o.folders.map((f) => [f.name, f.items.map((s) => s.id)])).toEqual([['Alpha', ['d']], ['Zeta', ['c']]])
    expect(o.groups.flatMap((g) => g.items.map((s) => s.id))).toEqual(['e'])
  })
})
