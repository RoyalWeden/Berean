// @vitest-environment jsdom
/** Berean Chat history in the embedded panel: the title is a conversation switcher (anchored
 *  popover) listing legacy conversations stored with ISO-text timestamps newest first; the panel
 *  resumes the latest one; renaming from the switcher persists; picking a row opens it; Esc
 *  closes the switcher. Real aiChats service over a migrated DB. */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { makeContext, migratedUserDb } from '@/platform/db/__tests__/testDb'
import { createAiChatsService } from '@/platform/services/aiChatsService'
import { useAppStore } from '@/store'
import AiLookupPanel from '../AiLookupPanel'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
beforeAll(() => {
  // Radix popper measures with ResizeObserver; jsdom has none.
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})

let svc: ReturnType<typeof createAiChatsService>
let userDb: Awaited<ReturnType<typeof migratedUserDb>>
beforeEach(async () => {
  userDb = await migratedUserDb()
  svc = createAiChatsService(makeContext({ userDb }))
  const legacy = (q: string, at: string) => JSON.stringify([
    { role: 'user', content: q, createdAt: at },
    { role: 'assistant', content: '', results: [{ bookId: 'REV', bookName: 'Revelation', chapter: 9, verse: 6, text: 'And in those days shall men seek death', textId: 'kjva', source: 'fts' }], visibleCount: 1, keywords: ['death'], related: [], createdAt: at },
  ])
  for (const [id, title, at] of [
    ['old', 'Oldest question', '2026-08-09T15:01:02.003Z'],
    ['newest', 'Newest question', '2026-08-14T00:56:48.328Z'],
    ['mid', 'Middle question', '2026-08-13T22:55:36.100Z'],
  ]) await userDb.run('INSERT INTO ai_chats (id, title, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [id, title, legacy(title, at), at, at])
  ;(window as unknown as { aiLookup: unknown }).aiLookup = {
    checkAvailable: async () => ({ available: false, models: [] }),
    query: async () => { throw new Error('no') },
    listChats: () => svc.listChats(), getChat: (id: string) => svc.getChat(id), deleteChat: (id: string) => svc.deleteChat(id),
    upsertMessages: (i: never) => svc.upsertMessages(i), renameChat: (id: string, t: string) => svc.renameChat(id, t),
    queryMessages: (q: never) => svc.queryMessages(q), listDays: () => svc.listDays(),
    onChatsChanged: () => () => {}, onProgress: () => {}, onPartial: () => {},
  }
  try { localStorage.clear() } catch { /* */ }
  Object.defineProperty(window, 'innerWidth', { value: 1400, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true })
  useAppStore.setState({ aiLookupPanelOpen: true, aiLookupPanelSize: null, aiLookupPanelPos: null, aiLookupActiveChatId: null })
})
let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; document.body.innerHTML = '' })
const settle = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 5)) })

const switcherButton = () => host!.querySelector<HTMLButtonElement>('button[aria-label^="Conversations —"]')!
const switcher = () => document.querySelector<HTMLElement>('[data-chat-switcher]')
async function openSwitcher() {
  act(() => switcherButton().click())
  await settle()
  expect(switcher()).not.toBeNull()
  return switcher()!
}
const rowTitles = (el: HTMLElement) => [...el.querySelectorAll('button[data-chat-id] .chat-hist-title')].map((t) => t.textContent)

describe('Berean Chat panel history', () => {
  it('lists conversations newest first in the switcher, resumes the latest, and renames from a row', async () => {
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    act(() => root!.render(<AiLookupPanel />))
    await settle()
    // One compact toolbar: no docked / slide-over sidebar any more.
    expect(host.querySelector('nav[aria-label="Conversations"]')).toBeNull()
    expect(switcherButton().textContent).toContain('Newest question')
    // Resumed: the newest conversation's legacy question and its verse card are in the transcript.
    const log = host.querySelector('[role="log"]')!
    expect(log.textContent).toContain('Newest question')
    expect(log.textContent).toContain('Revelation 9:6')

    const list = await openSwitcher()
    expect(rowTitles(list)).toEqual(['Newest question', 'Middle question', 'Oldest question'])
    expect(list.querySelector('button[data-chat-id="newest"]')!.getAttribute('aria-current')).toBe('true')

    // Rename: double-click the row → inline field → Return.
    act(() => { list.querySelector('button[data-chat-id="newest"]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
    const input = list.querySelector<HTMLInputElement>('input[aria-label="Conversation name"]')!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => { setter.call(input, 'Seeking death — Rev 9'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    await settle()
    expect((await svc.getChat('newest'))!.title).toBe('Seeking death — Rev 9')
    expect(rowTitles(switcher()!)).toContain('Seeking death — Rev 9')
    expect(switcherButton().textContent).toContain('Seeking death — Rev 9')
  })

  it('picking a conversation opens it and closes the switcher; Esc closes it back to the title', async () => {
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    act(() => root!.render(<AiLookupPanel />))
    await settle()
    let list = await openSwitcher()
    act(() => list.querySelector<HTMLButtonElement>('button[data-chat-id="mid"]')!.click())
    await settle()
    expect(switcher()).toBeNull()
    expect(host.querySelector('[role="log"]')!.textContent).toContain('Middle question')
    expect(switcherButton().textContent).toContain('Middle question')

    list = await openSwitcher()
    act(() => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    await settle()
    expect(switcher()).toBeNull()
    expect(document.activeElement).toBe(switcherButton())
  })

  it('opens at the new default size, clamped below the main toolbar', async () => {
    useAppStore.setState({ aiLookupPanelSize: { width: 200, height: 200 }, aiLookupPanelPos: { x: 10, y: 0 } })
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    act(() => root!.render(<AiLookupPanel />))
    await settle()
    const panel = host.querySelector<HTMLElement>('[role="dialog"][aria-label="Berean Chat"]')!
    expect(panel.style.width).toBe('360px')
    expect(panel.style.height).toBe('440px')
    expect(parseInt(panel.style.top, 10)).toBeGreaterThanOrEqual(52)
  })
})
