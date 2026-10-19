// @vitest-environment jsdom
/**
 * TEST 2026-10-18 Berean Chat round 3 — the standalone window under StrictMode (dev builds) lists
 * the history and opens on the panel's conversation + draft; messages show their time, render
 * formatting with verse / Strong's links; Edit loads the message into the MAIN composer.
 * Real aiChats service over a migrated DB.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import React, { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { makeContext, migratedUserDb } from '@/platform/db/__tests__/testDb'
import { createAiChatsService } from '@/platform/services/aiChatsService'
import { formatTime } from '../chatModel'
import ChatWindowApp from '../ChatWindowApp'
import { setValue, valueOf } from './composerTestUtils'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let svc: ReturnType<typeof createAiChatsService>
let handoff: { chatId: string | null; draft?: string } | null = null
const openInMain = vi.fn(async () => true)
const at = '2026-10-18T16:41:04.019Z'

beforeEach(async () => {
  const userDb = await migratedUserDb()
  svc = createAiChatsService(makeContext({ userDb }))
  const row = (id: string, title: string, msgs: unknown[], when: string) =>
    userDb.run('INSERT INTO ai_chats (id, title, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [id, title, JSON.stringify(msgs), when, when])
  await row('older', 'Feast notes', [{ id: 'o1', role: 'user', kind: 'note', content: 'Read Isaiah 58 before the feast', createdAt: '2026-10-17T10:00:00.000Z' }], '2026-10-17T10:00:00.000Z')
  await row('latest', 'Study', [
    { id: 'n1', role: 'user', kind: 'note', content: '**Grace** is G5485 — see Titus 2:11\n- teaching\n- denying ungodliness', createdAt: at },
  ], at)
  ;(window as unknown as { aiLookup: unknown }).aiLookup = {
    checkAvailable: async () => ({ available: false, models: [] }),
    query: async () => { throw new Error('no') },
    listChats: () => svc.listChats(), getChat: (id: string) => svc.getChat(id), deleteChat: (id: string) => svc.deleteChat(id),
    upsertMessages: (i: never) => svc.upsertMessages(i), renameChat: (id: string, t: string) => svc.renameChat(id, t),
    queryMessages: (q: never) => svc.queryMessages(q), listDays: () => svc.listDays(),
    onChatsChanged: () => () => {}, onProgress: () => {}, onPartial: () => {},
  }
  handoff = null
  openInMain.mockClear()
  ;(window as unknown as { chatWindow: unknown }).chatWindow = {
    takeHandoff: async () => { const h = handoff; handoff = null; return h },
    onHandoff: () => () => {}, onNewConversation: () => () => {}, openInMain,
    getMainTabContext: async () => null, returnToMain: async () => true,
  }
  window.matchMedia = window.matchMedia ?? ((() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never)
  try { localStorage.clear() } catch { /* */ }
})
let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null })
const settle = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 5)) })
async function mountWindow() {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => root!.render(<StrictMode><ChatWindowApp /></StrictMode>))
  await settle()
  return host
}
// The composer is the rich-text field (role=textbox); its value is markdown.
const composer = () => host!.querySelector<HTMLElement>('[role="textbox"][aria-label="Message"], [role="textbox"][aria-label="Edit message"]')!
const type = (el: HTMLElement, value: string) => setValue(el, value)

describe('Berean Chat window (StrictMode)', () => {
  it('lists every conversation and resumes the latest — StrictMode used to discard all loads', async () => {
    const h = await mountWindow()
    const nav = h.querySelector('nav[aria-label="Conversations"]')!
    expect(nav.textContent).toContain('Study')
    expect(nav.textContent).toContain('Feast notes')
    expect(h.querySelector('header')!.textContent).toContain('1 message')
    expect(h.querySelector('[role="log"]')!.textContent).toContain('Grace')
  })

  it('opens on the conversation and draft handed over from the panel', async () => {
    handoff = { chatId: 'older', draft: 'unsent thought' }
    const h = await mountWindow()
    expect(h.querySelector('[role="log"]')!.textContent).toContain('Read Isaiah 58 before the feast')
    expect(valueOf(composer())).toBe('unsent thought')
  })

  it('shows each message\'s time and renders formatting with verse / Strong\'s links', async () => {
    const h = await mountWindow()
    const row = h.querySelector('[data-message-id="n1"]')!
    // The time rides in the swipe-in gutter (with the conversation), not under every bubble.
    expect(row.querySelector('.chat-reveal-time')!.textContent).toBe(formatTime(Date.parse(at)))
    expect(row.querySelector('.chat-row-meta')).toBeNull()
    expect(row.querySelector('strong')!.textContent).toBe('Grace')
    expect([...row.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['teaching', 'denying ungodliness'])
    const verse = [...row.querySelectorAll<HTMLButtonElement>('button.chat-link')].find((b) => b.textContent === 'Titus 2:11')!
    act(() => verse.click())
    expect(openInMain).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'verse', result: expect.objectContaining({ bookId: 'TIT', chapter: 2, verse: 11 }) }))
    const strongs = [...row.querySelectorAll<HTMLButtonElement>('button.chat-link')].find((b) => b.textContent === 'G5485')!
    act(() => strongs.click())
    expect(openInMain).toHaveBeenLastCalledWith({ kind: 'lexicon', strongsNum: 'G5485' })
  })

  it('Edit opens the message in the main composer (no second text box) and Return saves it', async () => {
    const h = await mountWindow()
    type(composer(), 'my draft')
    // Edit lives in the message's "…" (with Ask Berean and Delete); Reply and Copy stay buttons.
    expect(h.querySelector('[data-message-id="n1"] button[aria-label="Edit"]')).toBeNull()
    expect(h.querySelector('[data-message-id="n1"] button[aria-label="Reply"]')).not.toBeNull()
    act(() => h.querySelector<HTMLButtonElement>('[data-message-id="n1"] button[aria-label="More Actions"]')!.click())
    const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role^="menuitem"]')]
    expect(items.map((b) => b.textContent)).not.toContain('Reply')
    expect(items.map((b) => b.textContent)).toContain('Delete…')
    const edit = items.find((b) => b.textContent === 'Edit')!
    act(() => edit.click())
    await settle()
    expect(h.querySelectorAll('[role="textbox"]').length).toBe(1)
    expect(composer().getAttribute('aria-label')).toBe('Edit message')
    expect(valueOf(composer())).toContain('**Grace**')
    expect(composer().querySelector('strong')!.textContent).toBe('Grace') // shown as bold, not asterisks
    expect(h.textContent).toContain('Editing Message')
    expect(h.querySelector('[data-message-id="n1"]')!.textContent).toContain('Editing')
    type(composer(), 'Grace teaches us (Titus 2:12)')
    act(() => { composer().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    await settle()
    const saved = (await svc.getChat('latest'))!.messages.find((m) => m.id === 'n1')!
    expect(saved.content).toBe('Grace teaches us (Titus 2:12)')
    expect(saved.editedAt).toBeTruthy()
    expect(composer().getAttribute('aria-label')).toBe('Message')
    expect(valueOf(composer())).toBe('my draft') // the draft came back
    expect(h.querySelector('[data-message-id="n1"] .chat-row-meta')!.textContent).toContain('Edited')
  })
})

describe('ChatRichText', () => {
  it('renders the notes editor\'s inline markdown as elements, never as HTML', async () => {
    const { ChatRichText } = await import('../ChatRichText')
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    act(() => root!.render(<ChatRichText text={'*grace* <u>hesed</u> ~~old~~ ==key== `H2617` [site](https://sitgmeat.com)\n1. first\n2. second\n> Ps 23:1\n<img src=x onerror=alert(1)>'} />))
    const el = host
    expect(el.querySelector('em')!.textContent).toBe('grace')
    expect(el.querySelector('u')!.textContent).toBe('hesed')
    expect(el.querySelector('s')!.textContent).toBe('old')
    expect(el.querySelector('mark')!.textContent).toBe('key')
    expect(el.querySelector('code')!.textContent).toBe('H2617')
    expect(el.querySelector('a')!.getAttribute('href')).toBe('https://sitgmeat.com')
    expect([...el.querySelectorAll('ol li')].map((li) => li.textContent)).toEqual(['first', 'second'])
    expect(el.querySelector('blockquote button.chat-link')!.textContent).toBe('Ps 23:1')
    expect(el.querySelector('img')).toBeNull()
    expect(el.textContent).toContain('<img src=x onerror=alert(1)>')
  })
})
