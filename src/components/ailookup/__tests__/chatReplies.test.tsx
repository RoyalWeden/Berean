// @vitest-environment jsdom
/** Berean Chat replies: the controller attaches `inReplyTo` to the next send (note or question),
 *  remembers the reply target per conversation across reopening, drops it when the quoted message
 *  is gone, sends the quoted message to Ask Berean as the last history turn, and the transcript
 *  shows a quote that jumps to the original. Real aiChats service over an in-memory DB. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { makeContext, migratedUserDb } from '@/platform/db/__tests__/testDb'
import { createAiChatsService } from '@/platform/services/aiChatsService'
import { useChatController, type ChatController } from '../useChatController'
import { aiHistoryFor, quoteSnippet, type ChatMsg } from '../chatModel'
import { readReplyTarget, writeReplyTarget, CHAT_REPLIES_KEY } from '../composer/chatReplies'
import { ChatTranscript } from '../ChatTranscript'
import { ChatRowActionsContext, type ChatRowActions } from '../ChatMessageRow'
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

describe('replies — controller', () => {
  it('the next note carries inReplyTo, then the reply target clears', async () => {
    const c = await mount()
    await act(async () => { await c.current.send('Read Titus 2:11-14') })
    await settle()
    const first = c.current.messages[0]
    act(() => c.current.startReply(first.id, c.current.activeChatId))
    expect(c.current.replyingTo?.id).toBe(first.id)
    await act(async () => { await c.current.send('Grace teaches — G5485') })
    await settle()
    const chat = await svc.getChat(c.current.activeChatId!)
    expect(chat!.messages.map((m) => [m.content, m.inReplyTo ?? null])).toEqual([['Read Titus 2:11-14', null], ['Grace teaches — G5485', first.id]])
    expect(c.current.replyingTo).toBeNull()
    expect(readReplyTarget(c.current.activeChatId!)).toBeNull()
  })

  it('remembers the reply target per conversation (switching away and back)', async () => {
    const c = await mount()
    await act(async () => { await c.current.send('first conversation') })
    await settle()
    const a = c.current.activeChatId!
    const msg = c.current.messages[0].id
    act(() => c.current.startReply(msg, a))
    act(() => c.current.newConversation())
    expect(c.current.replyingTo).toBeNull()
    act(() => c.current.openConversation(a))
    await settle()
    expect(c.current.replyingTo?.id).toBe(msg)
  })

  it('a deleted quoted message cancels the reply (the send is a plain message)', async () => {
    const c = await mount()
    await act(async () => { await c.current.send('soon gone') })
    await settle()
    const gone = c.current.messages[0].id
    act(() => c.current.startReply(gone, c.current.activeChatId))
    act(() => c.current.deleteMessage(gone, c.current.activeChatId))
    await settle()
    expect(c.current.replyingTo).toBeNull()
    await act(async () => { await c.current.send('after delete') })
    await settle()
    const chat = await svc.getChat(c.current.activeChatId!)
    expect(chat!.messages.find((m) => m.content === 'after delete')!.inReplyTo).toBeUndefined()
  })

  it('a question sent as a reply gives Ask Berean the quoted message as the last history turn', async () => {
    const c = await mount()
    await act(async () => { await c.current.send('Grace = divine influence upon the heart') })
    for (let i = 0; i < 10; i++) await act(async () => { await c.current.send(`filler ${i}`) })
    await settle()
    const quoted = c.current.messages[0].id
    act(() => c.current.startReply(quoted, c.current.activeChatId))
    await act(async () => { await c.current.send('Where does Scripture teach this?', { ai: { commentary: false, deepSearch: false, tabContext: false } }) })
    await settle()
    const history = (query.mock.calls[0][1] as { history: Array<{ content: string }> }).history
    expect(history[history.length - 1].content).toBe('(the message I am replying to) (my note) Grace = divine influence upon the heart')
    expect(history).toHaveLength(8)
    const chat = await svc.getChat(c.current.activeChatId!)
    expect(chat!.messages.find((m) => m.kind === 'ai-request')!.inReplyTo).toBe(quoted)
  })
})

describe('replies — model and storage', () => {
  const msg = (p: Partial<ChatMsg>): ChatMsg => ({ id: 'x', role: 'user', kind: 'note', content: '', createdAt: '2026-10-18T10:00:00.000Z', ...p })

  it('aiHistoryFor without a reply is unchanged; with one the quote moves last', () => {
    const ms = [msg({ id: 'a', content: 'one' }), msg({ id: 'b', content: 'two' }), msg({ id: 'c', content: 'three' })]
    expect(aiHistoryFor(ms).map((t) => t.content)).toEqual(['(my note) one', '(my note) two', '(my note) three'])
    expect(aiHistoryFor(ms, 8, 'a').map((t) => t.content)).toEqual(['(my note) two', '(my note) three', '(the message I am replying to) (my note) one'])
  })

  it('quoteSnippet: markdown stripped, AI replies fall back to their passages', () => {
    expect(quoteSnippet(msg({ content: '## Sabbath\n**Remember** the day' }))).toBe('Sabbath Remember the day')
    const reply = msg({ role: 'assistant', kind: 'ai-reply', results: [
      { bookName: 'Titus', chapter: 2, verse: 11, endVerse: 12, source: 'keyword' },
      { bookName: 'Romans', chapter: 6, verse: 14, source: 'keyword' },
    ] as ChatMsg['results'] })
    expect(quoteSnippet(reply)).toBe('Titus 2:11-12, Romans 6:14')
  })

  it('reply targets survive a reload and tolerate broken storage', () => {
    writeReplyTarget('chat-1', 'm-1')
    expect(readReplyTarget('chat-1')).toBe('m-1')
    writeReplyTarget('chat-1', null)
    expect(localStorage.getItem(CHAT_REPLIES_KEY)).toBeNull()
    localStorage.setItem(CHAT_REPLIES_KEY, '{not json')
    expect(readReplyTarget('chat-1')).toBeNull()
  })
})

describe('replies — transcript', () => {
  it('shows the quote above the reply and jumps to the original; a deleted original says so', () => {
    const jumpTo = vi.fn()
    const actions: ChatRowActions = { editNote: () => {}, editAndReask: () => {}, deleteMessage: () => {}, openConversation: () => {}, canAsk: false, jumpTo, startReply: () => {} }
    const items = [
      { key: 'a', chatId: 'c1', chatTitle: 'T', message: msgFull('a', 'Read Titus 2:11-14') },
      { key: 'b', chatId: 'c1', chatTitle: 'T', message: msgFull('b', 'Grace teaches', 'a') },
      { key: 'c', chatId: 'c1', chatTitle: 'T', message: msgFull('c', 'Orphan', 'zzz') },
    ]
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    act(() => root!.render(
      <ChatRowActionsContext.Provider value={actions}>
        <ChatTranscript items={items} resetKey="c:c1" crossConversation={false} hasOlder={false} loadingOlder={false} onLoadOlder={() => {}}
          typing={null} failedIds={new Set()} focusMessageId={null} onFocusHandled={() => {}} stickToken={0} empty={null} />
      </ChatRowActionsContext.Provider>,
    ))
    const quote = host.querySelector<HTMLButtonElement>('[data-message-id="b"] button.chat-reply-quote')!
    expect(quote.textContent).toBe('YouRead Titus 2:11-14')
    act(() => quote.click())
    expect(jumpTo).toHaveBeenCalledWith('a')
    expect(host.querySelector('[data-message-id="c"] .chat-reply-quote')!.textContent).toBe('Original message deleted')
    expect(host.querySelector('[data-message-id="a"] .chat-reply-quote')).toBeNull()
    expect(host.querySelector('[data-message-id="a"] button[aria-label="Reply"]')).not.toBeNull()
  })
})

function msgFull(id: string, content: string, inReplyTo?: string): ChatMsg {
  return { id, role: 'user', kind: 'note', content, createdAt: `2026-10-18T10:0${id.charCodeAt(0) % 10}:00.000Z`, ...(inReplyTo ? { inReplyTo } : {}) }
}
