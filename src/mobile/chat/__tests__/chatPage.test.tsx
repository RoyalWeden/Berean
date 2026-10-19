// @vitest-environment jsdom
/** iPhone Berean Chat page: plain messaging over the shared aiChats service; Ask Berean is
 *  shown but disabled with an explanation and never calls the AI; "New Message" entry reuses
 *  today's conversation instead of creating a duplicate. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { makeContext, migratedUserDb } from '@/platform/db/__tests__/testDb'
import { createAiChatsService } from '@/platform/services/aiChatsService'
import { SheetHost } from '../../primitives/Sheet'
import { PopoverMenuHost } from '../../primitives/PopoverMenu'
import { typeText, press, valueOf, selectAll } from '@/components/ailookup/__tests__/composerTestUtils'
import { readDraft } from '@/components/ailookup/composer/chatDrafts'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@capacitor/haptics', () => ({ Haptics: { impact: () => Promise.resolve(), selectionChanged: () => Promise.resolve(), notification: () => Promise.resolve() }, ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' }, NotificationType: { Success: 'SUCCESS', Warning: 'WARNING' } }))
const { ChatPage, ASK_BEREAN_PHONE_HINT } = await import('../ChatPage')
// jsdom has no layout: a jump to a message (search result) scrolls with scrollIntoView.
Element.prototype.scrollIntoView ??= function scrollIntoView() {}

let svc: ReturnType<typeof createAiChatsService>
const query = vi.fn()
beforeEach(async () => {
  try { localStorage.clear() } catch { /* */ }
  let n = 0
  svc = createAiChatsService(makeContext({ userDb: await migratedUserDb(), uuid: () => `chat-${++n}` }))
  query.mockReset()
  ;(window as unknown as { aiLookup: unknown }).aiLookup = {
    checkAvailable: async () => ({ available: false, models: [] }),
    query,
    listChats: () => svc.listChats(), getChat: (id: string) => svc.getChat(id), deleteChat: (id: string) => svc.deleteChat(id),
    upsertMessages: (i: never) => svc.upsertMessages(i), renameChat: (id: string, t: string) => svc.renameChat(id, t),
    queryMessages: (q: never) => svc.queryMessages(q), listDays: () => svc.listDays(),
    onChatsChanged: () => () => {}, onProgress: () => {}, onPartial: () => {},
  }
})
let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null })
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 5)) })

async function mount(el: React.ReactElement) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => root!.render(<SheetHost>{el}<PopoverMenuHost /></SheetHost>))
  await settle()
  return host
}
// The composer is the shared rich-text field (role=textbox inside .m-chat-input); value = markdown.
const field = (h: HTMLElement) => h.querySelector<HTMLElement>('.m-chat-input [role="textbox"]')!
function type(h: HTMLElement, text: string) { typeText(field(h), text) }

describe('ChatPage (iPhone)', () => {
  it('New Message opens the composer; sending saves a plain note and never calls the AI', async () => {
    const h = await mount(<ChatPage newMessageToken={1} />)
    expect(h.querySelector('.m-chat-input')).not.toBeNull()
    type(h, 'Shabbat shalom — read Isaiah 58')
    act(() => { h.querySelector<HTMLButtonElement>('.m-chat-send')!.click() })
    await settle()
    const list = await svc.listChats()
    expect(list).toHaveLength(1)
    const chat = await svc.getChat(list[0].id)
    expect(chat!.messages.map((m) => [m.kind, m.content])).toEqual([['note', 'Shabbat shalom — read Isaiah 58']])
    expect(query).not.toHaveBeenCalled()
    expect(h.textContent).toContain('Shabbat shalom')
  })

  it('the sparkle explains Ask Berean is Mac-only', async () => {
    const h = await mount(<ChatPage newMessageToken={1} />)
    act(() => { h.querySelector<HTMLButtonElement>('.m-chat-ask')!.click() })
    expect(h.textContent).toContain(ASK_BEREAN_PHONE_HINT)
    expect(query).not.toHaveBeenCalled()
  })

  it("New Message reuses today's conversation (no duplicate rows)", async () => {
    const today = await svc.upsertMessages({ messages: [{ id: 't', role: 'user', kind: 'note', content: 'earlier today', createdAt: new Date().toISOString() }] })
    const h = await mount(<ChatPage newMessageToken={1} />)
    expect(h.textContent).toContain('earlier today')
    type(h, 'second note')
    act(() => { h.querySelector<HTMLButtonElement>('.m-chat-send')!.click() })
    await settle()
    expect(await svc.listChats()).toHaveLength(1)
    expect((await svc.getChat(today.id))!.messages.map((m) => m.content)).toEqual(['earlier today', 'second note'])
  })

  it('the list shows conversations and All Messages', async () => {
    await svc.upsertMessages({ title: 'Feasts', messages: [{ id: 'a', role: 'user', kind: 'note', content: 'Leviticus 23', createdAt: '2026-10-01T09:00:00.000Z' }] })
    const h = await mount(<ChatPage />)
    expect(h.textContent).toContain('All Messages')
    expect(h.textContent).toContain('Feasts')
    expect(h.textContent).toContain('Leviticus 23')
  })

  it('Unfiled sits under All Messages and opens as its own conversation (only unfiled messages)', async () => {
    await svc.upsertMessages({ title: 'Feasts', messages: [{ id: 'a', role: 'user', kind: 'note', content: 'Leviticus 23', createdAt: '2026-10-01T09:00:00.000Z' }] })
    await svc.upsertMessages({ chatId: 'berean-unfiled', title: '', messages: [{ id: 'u', role: 'user', kind: 'note', content: 'a loose thought', createdAt: '2026-10-02T09:00:00.000Z' }] } as never)
    const h = await mount(<ChatPage />)
    const titles = [...h.querySelectorAll('.mobile-row-title')].map((t) => t.textContent)
    expect(titles.slice(0, 2)).toEqual(['All Messages', 'Unfiled'])
    act(() => [...h.querySelectorAll<HTMLButtonElement>('.mobile-row')].find((b) => b.textContent?.startsWith('Unfiled'))!.click())
    await settle()
    const log = h.querySelector('[role="log"]')!
    expect(log.textContent).toContain('a loose thought')
    expect(log.textContent).not.toContain('Leviticus 23')
  })

  it('Send To shows the current destination as a highlighted row, not a check mark', async () => {
    await svc.upsertMessages({ title: 'Feasts', messages: [{ id: 'a', role: 'user', kind: 'note', content: 'Leviticus 23', createdAt: '2026-10-01T09:00:00.000Z' }] })
    const h = await mount(<ChatPage />)
    act(() => [...h.querySelectorAll<HTMLButtonElement>('.mobile-row')].find((b) => b.textContent?.startsWith('All Messages'))!.click())
    await settle()
    act(() => h.querySelector<HTMLButtonElement>('.m-chat-destination-pick')!.click())
    await settle()
    const sel = [...document.querySelectorAll<HTMLElement>('.mobile-row.is-selected')]
    expect(sel.map((r) => r.querySelector('.mobile-row-title')!.textContent)).toEqual(['Unfiled'])
    expect(sel[0].getAttribute('aria-current')).toBe('true')
    expect(document.querySelector('.m-chat-check')).toBeNull()
  })

  it('Return is a new line (Messages); the Send button sends the markdown', async () => {
    const h = await mount(<ChatPage newMessageToken={1} />)
    const send = h.querySelector<HTMLButtonElement>('.m-chat-send')!
    expect(send.disabled).toBe(true)
    expect(field(h).getAttribute('enterkeyhint')).toBe('enter')
    type(h, '**Shabbat** shalom')
    press(field(h), 'Enter')
    type(h, 'Isaiah 58')
    await settle()
    expect(await svc.listChats()).toHaveLength(0) // Return never sent
    expect(field(h).querySelector('strong')!.textContent).toBe('Shabbat')
    expect(send.disabled).toBe(false)
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    send.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true) // the keyboard stays up
    act(() => send.click())
    await settle()
    const chat = await svc.getChat((await svc.listChats())[0].id)
    expect(chat!.messages.map((m) => m.content)).toEqual(['**Shabbat** shalom\nIsaiah 58'])
    expect(valueOf(field(h))).toBe('')
  })

  it('shows the formatting row while the field is focused; it formats the selection', async () => {
    const h = await mount(<ChatPage newMessageToken={1} />)
    act(() => { field(h).blur(); field(h).dispatchEvent(new FocusEvent('blur')) })
    await act(async () => { await new Promise((r) => setTimeout(r, 200)) })
    expect(h.querySelector('.m-chat-format')).toBeNull()
    act(() => { field(h).dispatchEvent(new FocusEvent('focus')) })
    expect(h.querySelector('.m-chat-format')).not.toBeNull()
    type(h, 'hesed')
    selectAll(field(h))
    act(() => h.querySelector<HTMLButtonElement>('.m-chat-format button[aria-label="Italic"]')!.click())
    expect(valueOf(field(h))).toBe('*hesed*')
    act(() => h.querySelector<HTMLButtonElement>('.m-chat-format button[aria-label="More Formatting"]')!.click())
    await settle()
    expect(document.body.textContent).toContain('Strikethrough')
  })

  it('keeps an unsent draft per conversation across leaving and coming back', async () => {
    const h = await mount(<ChatPage newMessageToken={1} />)
    type(h, 'half a thought')
    await act(async () => { await new Promise((r) => setTimeout(r, 350)) })
    expect(readDraft('new')).toBe('half a thought')
    act(() => root!.unmount()); root = null; host!.remove()
    const again = await mount(<ChatPage newMessageToken={1} />)
    expect(valueOf(field(again))).toBe('half a thought')
  })

  it('long-press opens a popup menu (not a sheet); Edit loads the note (markdown) into the field; ✓ saves it and the draft returns', async () => {
    await svc.upsertMessages({ messages: [{ id: 'n1', role: 'user', kind: 'note', content: '**Grace** abounds', createdAt: new Date().toISOString() }] })
    const h = await mount(<ChatPage newMessageToken={1} />)
    type(h, 'draft')
    vi.useFakeTimers()
    const bubble = h.querySelector<HTMLElement>('[data-message-id="n1"]')!
    act(() => { bubble.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 })) })
    act(() => { vi.advanceTimersByTime(500) })
    vi.useRealTimers()
    await settle()
    expect(document.querySelector('.mobile-action-row')).toBeNull()
    const rows = [...document.querySelectorAll<HTMLButtonElement>('.m-popover-row')]
    expect(rows.map((b) => b.textContent)).toEqual(['Reply', 'Copy', 'Edit', 'Delete'])
    expect(bubble.dataset.pressed).toBe('true')
    const edit = rows.find((b) => b.textContent === 'Edit')!
    act(() => edit.click())
    expect(bubble.dataset.pressed).toBeUndefined()
    expect(field(h).getAttribute('aria-label')).toBe('Edit message')
    expect(field(h).querySelector('strong')!.textContent).toBe('Grace')
    type(h, ' to us')
    act(() => h.querySelector<HTMLButtonElement>('.m-chat-send[aria-label="Save Edit"]')!.click())
    await settle()
    const chat = (await svc.listChats())[0]
    expect((await svc.getChat(chat.id))!.messages[0].content).toBe('**Grace** abounds to us')
    expect(valueOf(field(h))).toBe('draft')
  })

  it('swipe left past the lock point keeps the times open; a rightward swipe then closes them instead of replying', async () => {
    await svc.upsertMessages({ messages: [{ id: 'q1', role: 'user', kind: 'note', content: 'Read Titus 2:11-14', createdAt: new Date().toISOString() }] })
    const h = await mount(<ChatPage newMessageToken={1} />)
    const row = h.querySelector<HTMLElement>('[data-message-id="q1"]')!
    const scroller = h.querySelector<HTMLElement>('.chat-transcript-scroll')!
    const touch = (type: string, x: number, y: number) => {
      const ev = new Event(type, { bubbles: true, cancelable: true }) as Event & { touches: unknown[] }
      Object.defineProperty(ev, 'touches', { value: type === 'touchend' ? [] : [{ identifier: 1, clientX: x, clientY: y }] })
      act(() => { row.dispatchEvent(ev) })
    }
    const drag = (from: number, to: number) => {
      touch('touchstart', from, 50)
      touch('touchmove', (from + to) / 2, 51)
      touch('touchmove', to, 52)
      touch('touchend', to, 52)
    }
    drag(330, 120) // 210 px left: past ~1.5× the gutter
    expect(scroller.dataset.reveal).toBe('locked')
    drag(100, 240) // rightward: would be a reply if the times were not open
    await settle()
    expect(scroller.dataset.reveal).toBe('settle')
    expect(h.querySelector('.chat-reply-bar')).toBeNull()
    await act(async () => { await new Promise((r) => setTimeout(r, 320)) })
    drag(100, 240) // closed again: the same swipe replies
    await settle()
    expect(h.querySelector('.chat-reply-bar')).not.toBeNull()
  })

  it('swiping a message right shows "Replying to" and the sent message quotes it; a short swipe does nothing', async () => {
    await svc.upsertMessages({ messages: [{ id: 'q1', role: 'user', kind: 'note', content: 'Read Titus 2:11-14', createdAt: new Date().toISOString() }] })
    const h = await mount(<ChatPage newMessageToken={1} />)
    const row = h.querySelector<HTMLElement>('[data-message-id="q1"]')!
    const touch = (type: string, x: number, y: number) => {
      const ev = new Event(type, { bubbles: true, cancelable: true }) as Event & { touches: unknown[] }
      Object.defineProperty(ev, 'touches', { value: type === 'touchend' ? [] : [{ identifier: 1, clientX: x, clientY: y }] })
      act(() => { row.dispatchEvent(ev) })
    }
    const drag = (to: number) => {
      touch('touchstart', 100, 50)
      touch('touchmove', 100 + to / 2, 51)
      touch('touchmove', 100 + to, 52)
      touch('touchend', 100 + to, 52)
    }
    drag(40)
    expect(h.querySelector('.chat-reply-bar')).toBeNull()
    drag(140)
    await settle()
    expect(h.querySelector('.chat-reply-bar')!.textContent).toContain('Replying to You')
    type(h, 'grace teaches')
    act(() => h.querySelector<HTMLButtonElement>('.m-chat-send')!.click())
    await settle()
    const chat = (await svc.listChats())[0]
    expect((await svc.getChat(chat.id))!.messages.map((m) => m.inReplyTo ?? null)).toEqual([null, 'q1'])
    expect(h.querySelector('.chat-reply-bar')).toBeNull()
  })

  it('… → Find in Conversation: a find bar takes the composer\'s place; it counts matches, steps, and Done brings the composer back', async () => {
    await svc.upsertMessages({ chatId: null, title: 'Sabbath', messages: [
      { id: 'n1', role: 'user', kind: 'note', content: 'Remember the **sabbath** day', createdAt: '2026-10-17T10:00:00.000Z' },
      { id: 'n2', role: 'user', kind: 'note', content: 'The sabbath was made for man; the Sabbath again', createdAt: '2026-10-17T10:01:00.000Z' },
    ] } as never)
    const h = await mount(<ChatPage />)
    act(() => [...h.querySelectorAll<HTMLElement>('.mobile-row, button')].find((b) => b.textContent?.includes('Sabbath'))!.click())
    await settle()
    act(() => h.querySelector<HTMLButtonElement>('button[aria-label="Conversation Options"]')!.click())
    await settle()
    act(() => [...document.querySelectorAll<HTMLButtonElement>('.m-popover-layer button')].find((b) => b.textContent?.includes('Find in Conversation'))!.click())
    await settle()
    const input = h.querySelector<HTMLInputElement>('.m-chat-find input')!
    expect(document.activeElement).toBe(input)
    expect(h.querySelector('.m-chat-input')).toBeNull() // the composer is out of the way
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'sabbath'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await settle()
    expect(h.querySelector('.m-chat-find')!.textContent).toContain('1 of 3')
    act(() => h.querySelector<HTMLButtonElement>('button[aria-label="Next Match"]')!.click())
    await settle()
    expect(h.querySelector('.m-chat-find')!.textContent).toContain('2 of 3')
    act(() => h.querySelector<HTMLButtonElement>('button[aria-label="Previous Match"]')!.click())
    act(() => h.querySelector<HTMLButtonElement>('button[aria-label="Previous Match"]')!.click())
    await settle()
    expect(h.querySelector('.m-chat-find')!.textContent).toContain('3 of 3') // wraps around
    act(() => [...h.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Done')!.click())
    await settle()
    expect(h.querySelector('.m-chat-find')).toBeNull()
    expect(h.querySelector('.m-chat-input')).not.toBeNull()
  })

  it('search: a filter (All / Conversations / Messages); a message result opens its conversation with Find on that message', async () => {
    await svc.upsertMessages({ chatId: null, title: 'Feasts', messages: [{ id: 'f1', role: 'user', kind: 'note', content: 'Read Leviticus 23', createdAt: '2026-10-17T10:00:00.000Z' }] } as never)
    await svc.upsertMessages({ chatId: null, title: 'Leviticus study', messages: [{ id: 'l1', role: 'user', kind: 'note', content: 'Holiness code', createdAt: '2026-10-16T10:00:00.000Z' }] } as never)
    const h = await mount(<ChatPage />)
    const search = h.querySelector<HTMLInputElement>('.m-chat-list .mobile-search-input')!
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'leviticus'); search.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => { await new Promise((r) => setTimeout(r, 260)) })
    await settle()
    const text = () => h.querySelector('.m-chat-list')!.textContent ?? ''
    expect(text()).toContain('Conversations')
    expect(text()).toContain('1 Message')
    act(() => [...h.querySelectorAll<HTMLButtonElement>('.m-chat-filters button')].find((b) => b.textContent === 'Messages')!.click())
    expect(h.querySelector('.m-chat-filters [aria-checked="true"]')!.textContent).toBe('Messages')
    expect(text()).not.toContain('Leviticus study') // the conversation-title hit is filtered out
    act(() => [...h.querySelectorAll<HTMLElement>('.mobile-row, button')].find((b) => b.textContent?.includes('Read Leviticus'))!.click())
    await settle()
    const find = h.querySelector<HTMLInputElement>('.m-chat-find input')!
    expect(find.value).toBe('leviticus')
    expect(h.querySelector('.m-chat-find')!.textContent).toContain('1 of 1')
  })

})
