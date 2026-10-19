// @vitest-environment jsdom
/** Berean Chat window layout: the sidebar toggle is always in the title bar (same spot whether
 *  the sidebar is shown or not), its state is remembered, ⌃⌘S toggles it, and a narrow window
 *  collapses the sidebar (overlay on demand) without overwriting the remembered choice. */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import React, { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { makeContext, migratedUserDb } from '@/platform/db/__tests__/testDb'
import { createAiChatsService } from '@/platform/services/aiChatsService'
import ChatWindowApp, { SIDEBAR_KEY, isToggleSidebarKey } from '../ChatWindowApp'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})

const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { value: w, configurable: true })

beforeEach(async () => {
  const userDb = await migratedUserDb()
  const svc = createAiChatsService(makeContext({ userDb }))
  await userDb.run('INSERT INTO ai_chats (id, title, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ['a', 'Feast notes', JSON.stringify([{ id: 'm1', role: 'user', kind: 'note', content: 'Leviticus 23', createdAt: '2026-10-17T10:00:00.000Z' }]), '2026-10-17T10:00:00.000Z', '2026-10-17T10:00:00.000Z'])
  ;(window as unknown as { aiLookup: unknown }).aiLookup = {
    checkAvailable: async () => ({ available: false, models: [] }),
    query: async () => { throw new Error('no') },
    listChats: () => svc.listChats(), getChat: (id: string) => svc.getChat(id), deleteChat: (id: string) => svc.deleteChat(id),
    upsertMessages: (i: never) => svc.upsertMessages(i), renameChat: (id: string, t: string) => svc.renameChat(id, t),
    queryMessages: (q: never) => svc.queryMessages(q), listDays: () => svc.listDays(),
    onChatsChanged: () => () => {}, onProgress: () => {}, onPartial: () => {},
  }
  ;(window as unknown as { chatWindow: unknown }).chatWindow = {
    takeHandoff: async () => null, onHandoff: () => () => {}, onNewConversation: () => () => {},
    openInMain: async () => true, getMainTabContext: async () => null, returnToMain: async () => true,
  }
  window.matchMedia = window.matchMedia ?? ((() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never)
  try { localStorage.clear() } catch { /* */ }
  setWidth(1024)
})
let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; document.body.innerHTML = '' })
const settle = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 5)) })
async function mount() {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => root!.render(<StrictMode><ChatWindowApp /></StrictMode>))
  await settle()
  return host
}
const toggle = () => host!.querySelector<HTMLButtonElement>('button[aria-label="Hide Sidebar"], button[aria-label="Show Sidebar"]')!
const sidebar = () => host!.querySelector('nav[aria-label="Conversations"]')
const press = (init: KeyboardEventInit) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init })) })

describe('Berean Chat window sidebar', () => {
  it('toggles from the title bar, keeps the toggle in place, and remembers the choice', async () => {
    await mount()
    expect(sidebar()).not.toBeNull()
    const spot = toggle().parentElement!.getAttribute('style')
    act(() => toggle().click())
    expect(sidebar()).toBeNull()
    expect(toggle().getAttribute('aria-label')).toBe('Show Sidebar')
    expect(toggle().parentElement!.getAttribute('style')).toBe(spot) // no jump
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe('0')
    act(() => root!.unmount()); host!.remove(); root = null
    await mount()
    expect(sidebar()).toBeNull() // remembered across launches
  })

  it('⌃⌘S (and ⌘⇧S) toggle the sidebar', async () => {
    expect(isToggleSidebarKey({ key: 's', metaKey: true, ctrlKey: true, shiftKey: false, altKey: false })).toBe(true)
    expect(isToggleSidebarKey({ key: 'S', metaKey: true, ctrlKey: false, shiftKey: true, altKey: false })).toBe(true)
    expect(isToggleSidebarKey({ key: 's', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false })).toBe(false)
    await mount()
    press({ key: 's', metaKey: true, ctrlKey: true })
    expect(sidebar()).toBeNull()
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe('0')
    press({ key: 's', metaKey: true, ctrlKey: true })
    expect(sidebar()).not.toBeNull()
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe('1')
  })

  it('a narrow window collapses the sidebar without forgetting it; the toggle shows it as an overlay', async () => {
    await mount()
    expect(sidebar()).not.toBeNull()
    setWidth(560)
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(sidebar()).toBeNull()
    expect(localStorage.getItem(SIDEBAR_KEY)).toBeNull() // never written
    act(() => toggle().click())
    expect(sidebar()).not.toBeNull() // overlay
    expect(localStorage.getItem(SIDEBAR_KEY)).toBeNull()
    press({ key: 'Escape' })
    expect(sidebar()).toBeNull()
    setWidth(1024)
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(sidebar()).not.toBeNull() // the remembered "shown" comes back
  })

  it('⌥⌘F (search all messages) reveals the sidebar with its search focused', async () => {
    localStorage.setItem(SIDEBAR_KEY, '0')
    await mount()
    expect(sidebar()).toBeNull()
    press({ key: 'ƒ', code: 'KeyF', metaKey: true, altKey: true })
    await settle()
    expect(sidebar()).not.toBeNull()
    expect(document.activeElement?.getAttribute('role')).toBe('searchbox')
  })

  it('⌘F finds in the open conversation — not global search, not the composer', async () => {
    localStorage.setItem(SIDEBAR_KEY, '0')
    await mount()
    press({ key: 'f', code: 'KeyF', metaKey: true })
    await settle()
    expect(sidebar()).toBeNull() // global search was not opened
    const input = document.querySelector<HTMLInputElement>('[data-find-bar] input')!
    expect(input.placeholder).toBe('Find in Conversation')
    expect(document.activeElement).toBe(input)
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'leviticus')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await settle()
    expect(document.querySelector('[data-find-bar]')!.textContent).toContain('1 of 1')
    expect(document.querySelector('.chat-composer')!.textContent).not.toContain('leviticus')
    // Escape closes it and hands focus back to the composer.
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
    await settle()
    expect(document.querySelector('[data-find-bar]')).toBeNull()
    expect(document.activeElement?.closest('.chat-composer')).not.toBeNull()
  })
})
