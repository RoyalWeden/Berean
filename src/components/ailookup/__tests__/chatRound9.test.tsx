// @vitest-environment jsdom
/**
 * TEST 2026-10-19: the message "…" is a toggle; swiping the transcript left shows each message's
 * time and conversation (trackpad on the Mac, touch on the iPhone); Unfiled is a conversation near
 * the top of the sidebar; collapsing a group never changes the list's width (stable gutter).
 * Real aiChats service over a migrated DB, the standalone window.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { makeContext, migratedUserDb } from '@/platform/db/__tests__/testDb'
import { createAiChatsService } from '@/platform/services/aiChatsService'
import { formatTime, UNFILED_CHAT_ID } from '../chatModel'
import { REVEAL_LOCK, REVEAL_CLOSE_PULL, WHEEL_LOCK_ALLOWANCE, WHEEL_END_MS, SETTLE_MS, revealDistance } from '../useTimestampReveal'
import ChatWindowApp from '../ChatWindowApp'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let svc: ReturnType<typeof createAiChatsService>
const at = '2026-10-18T16:41:04.019Z'

beforeEach(async () => {
  const userDb = await migratedUserDb()
  svc = createAiChatsService(makeContext({ userDb }))
  const row = (id: string, title: string, msgs: unknown[], when: string) =>
    userDb.run('INSERT INTO ai_chats (id, title, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [id, title, JSON.stringify(msgs), when, when])
  await row('latest', 'Study', [
    { id: 'n1', role: 'user', kind: 'note', content: 'Titus 2:11', createdAt: at },
    { id: 'r1', role: 'assistant', kind: 'ai-reply', content: 'For the grace of God that bringeth salvation', createdAt: at },
  ], at)
  await row(UNFILED_CHAT_ID, '', [{ id: 'u1', role: 'user', kind: 'note', content: 'a loose thought', createdAt: '2026-10-17T09:00:00.000Z' }], '2026-10-17T09:00:00.000Z')
  ;(window as unknown as { aiLookup: unknown }).aiLookup = {
    checkAvailable: async () => ({ available: false, models: [] }),
    query: async () => { throw new Error('no') },
    listChats: () => svc.listChats(), getChat: (id: string) => svc.getChat(id), deleteChat: (id: string) => svc.deleteChat(id),
    upsertMessages: (i: never) => svc.upsertMessages(i), renameChat: (id: string, t: string) => svc.renameChat(id, t),
    queryMessages: (q: never) => svc.queryMessages(q), listDays: () => svc.listDays(),
    onChatsChanged: () => () => {}, onProgress: () => {}, onPartial: () => {},
  }
  ;(window as unknown as { chatWindow: unknown }).chatWindow = {
    takeHandoff: async () => null, onHandoff: () => () => {}, onNewConversation: () => () => {}, openInMain: async () => true,
    getMainTabContext: async () => null, returnToMain: async () => true,
  }
  window.matchMedia = window.matchMedia ?? ((() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never)
  Element.prototype.scrollIntoView ??= function () { /* jsdom */ }
  try { localStorage.clear() } catch { /* */ }
})
let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; document.body.innerHTML = '' })
const settle = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 5)) })
const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
async function mountWindow() {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => root!.render(<ChatWindowApp />))
  await settle()
  return host
}
const scroller = () => host!.querySelector<HTMLElement>('.chat-transcript-scroll')!
const wheel = (deltaX: number, deltaY = 0) => act(() => { scroller().dispatchEvent(new WheelEvent('wheel', { deltaX, deltaY, bubbles: true, cancelable: true })) })
function touch(type: string, x: number, y: number) {
  const e = new Event(type, { bubbles: true, cancelable: true })
  const list = type === 'touchend' ? [] : [{ identifier: 1, clientX: x, clientY: y }]
  Object.defineProperty(e, 'touches', { value: list })
  act(() => { (host!.querySelector('[data-message-id="n1"] [data-find-body]') ?? scroller()).dispatchEvent(e) })
  return e
}

describe('message "…" is a toggle', () => {
  it('a second press on "…" closes its menu instead of reopening it', async () => {
    const h = await mountWindow()
    const more = () => h.querySelector<HTMLButtonElement>('[data-message-id="n1"] button[aria-label="More Actions"]')!
    act(() => more().click())
    expect(document.querySelector('[role="menu"]')).not.toBeNull()
    expect(more().getAttribute('aria-expanded')).toBe('true')
    // A real press: pointerdown → (outside) mousedown closes the menu → click.
    act(() => {
      more().dispatchEvent(new Event('pointerdown', { bubbles: true }))
      more().dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    act(() => more().click())
    expect(document.querySelector('[role="menu"]')).toBeNull()
    act(() => more().click()) // and the next press opens it again
    expect(document.querySelector('[role="menu"]')).not.toBeNull()
  })
})

// What the hook moved: your message's bubble line, Berean's answer, and their gutters.
const mine = () => host!.querySelector<HTMLElement>('[data-message-id="n1"] > .group')!
const theirs = () => host!.querySelector<HTMLElement>('[data-message-id="r1"] > .group')!
const gutterOf = (id: string) => host!.querySelector<HTMLElement>(`[data-message-id="${id}"] .chat-reveal`)!
const shift = (e: HTMLElement) => { const m = /translateX\((-?[\d.]+)px\)/.exec(e.style.transform); return m ? -parseFloat(m[1]) : 0 }
const frame = () => wait(30)

const R = () => revealDistance(scroller())
const LOCK = () => Math.round(R() * 1.5)

describe('swipe left for times', () => {
  it('each message carries its time; the conversation only in All Messages (and it opens it)', async () => {
    const h = await mountWindow()
    expect(h.querySelector('[data-message-id="n1"] .chat-reveal-time')!.textContent).toBe(formatTime(Date.parse(at)))
    expect(h.querySelector('[data-message-id="n1"] .chat-reveal-conv')).toBeNull() // in the conversation itself: redundant
    expect(scroller().dataset.reveal).toBeUndefined()
    act(() => [...h.querySelectorAll<HTMLButtonElement>('nav [data-roving]')].find((r) => r.textContent === 'All Messages')!.click())
    await settle()
    expect(scroller().dataset.revealSize).toBe('wide') // room for the conversation's name
    const conv = h.querySelector<HTMLButtonElement>('[data-message-id="u1"] .chat-reveal-conv')!
    expect(conv.textContent).toBe('Unfiled')
    expect(h.querySelector('[data-message-id="n1"] .chat-reveal-conv')!.textContent).toBe('Study')
    // Locked, a click on the name opens that conversation (it is not swallowed like other clicks).
    wheel(LOCK() + WHEEL_LOCK_ALLOWANCE + 20, 0)
    await wait(WHEEL_END_MS + 60)
    expect(scroller().dataset.reveal).toBe('locked')
    act(() => h.querySelector<HTMLButtonElement>('[data-message-id="n1"] .chat-reveal-conv')!.click())
    await settle()
    expect(h.querySelector('header')!.textContent).toContain('Study')
  })

  it('inside a conversation the gutter is only as wide as a time: the slide and the lock point shrink with it', async () => {
    await mountWindow()
    expect(scroller().dataset.revealSize).toBeUndefined() // narrow (All Messages sets 'wide')
    scroller().style.setProperty('--chat-reveal-w', '54px') // chat.css's narrow width
    const narrow = 54 + 12
    wheel(narrow, 0)
    await frame()
    expect(shift(mine())).toBe(narrow)
    wheel(Math.round(narrow * 1.5) + WHEEL_LOCK_ALLOWANCE - narrow + 5, 0) // past ~1.5× of the NARROW reveal
    await wait(WHEEL_END_MS + 60)
    expect(scroller().dataset.reveal).toBe('locked')
    expect(Math.round(narrow * 1.5) + WHEEL_LOCK_ALLOWANCE).toBeLessThan(REVEAL_LOCK) // a wide lock would not have engaged
  })

  it('only your messages slide; Berean\'s stay put while their times slide in', async () => {
    await mountWindow()
    wheel(60, 0)
    await frame()
    expect(scroller().dataset.reveal).toBe('drag')
    expect(shift(mine())).toBe(60)
    expect(shift(theirs())).toBe(0)
    expect(shift(gutterOf('r1'))).toBe(60)
    expect(parseFloat(gutterOf('r1').style.opacity)).toBeCloseTo(Math.min(1, 60 / R()), 2)
  })

  it('trackpad peek: slides and settles back after the gesture; nothing is left inline', async () => {
    await mountWindow()
    wheel(40, 2)
    await frame()
    expect(shift(mine())).toBe(40)
    wheel(R() - 40 + 20, 0) // past the full reveal, short of the lock point — a rubber band
    await frame()
    expect(shift(mine())).toBeGreaterThan(R())
    expect(shift(mine())).toBeLessThan(R() + 20)
    await wait(WHEEL_END_MS + 60)
    expect(scroller().dataset.reveal).toBe('settle')
    expect(shift(mine())).toBe(0)
    await wait(SETTLE_MS + 60)
    expect(scroller().dataset.reveal).toBeUndefined()
    expect(mine().getAttribute('style') ?? '').toBe('')
  })

  it('trackpad: a slow drag with pauses between events keeps following the fingers', async () => {
    await mountWindow()
    for (let i = 0; i < 6; i++) {
      wheel(10, 0)
      await wait(250)
      expect(scroller().dataset.reveal).toBe('drag')
    }
    expect(shift(mine())).toBe(60)
  })

  it('trackpad: picking the drag up again while it slides back continues from where the rows are', async () => {
    await mountWindow()
    wheel(100, 0)
    await wait(WHEEL_END_MS + 20)
    expect(scroller().dataset.reveal).toBe('settle')
    wheel(10, 0)
    await frame()
    expect(scroller().dataset.reveal).toBe('drag')
    expect(shift(mine())).toBeGreaterThan(40) // not back at 10
  })

  it('lock: at the lock point it pops and springs back to the locked place while still dragging', async () => {
    await mountWindow()
    wheel(LOCK() + WHEEL_LOCK_ALLOWANCE + 10, 0)
    await frame()
    expect(shift(mine())).toBeGreaterThan(R()) // the pop…
    await wait(80)
    expect(shift(mine())).toBe(R()) // …and already back, fingers still down
    expect(mine().style.transition).toContain('transform')
    wheel(40, 0) // pulling further does not stretch it again
    await frame()
    expect(shift(mine())).toBe(R())
    await wait(WHEEL_END_MS + 60)
    expect(scroller().dataset.reveal).toBe('locked')
    expect(mine().style.transform).toBe('') // held by the static rule now, not per frame
    wheel(0, 60) // a vertical scroll
    await wait(WHEEL_END_MS + 60)
    expect(scroller().dataset.reveal).toBe('locked')
  })

  it('trackpad: just past the lock point is not enough (flick allowance), and pushing back cancels', async () => {
    await mountWindow()
    wheel(LOCK() + 5, 0)
    await wait(WHEEL_END_MS + 60)
    expect(scroller().dataset.reveal).toBe('settle')
    await wait(SETTLE_MS + 60)
    wheel(LOCK() + WHEEL_LOCK_ALLOWANCE + 20, 0)
    await frame()
    wheel(-120, 0)
    await wait(WHEEL_END_MS + 60)
    expect(scroller().dataset.reveal).toBe('settle')
  })

  it('locked: Esc, a click (swallowed), a rightward swipe, or another conversation close it', async () => {
    const h = await mountWindow()
    const lockIt = async () => { wheel(LOCK() + WHEEL_LOCK_ALLOWANCE + 20, 0); await wait(WHEEL_END_MS + 60); expect(scroller().dataset.reveal).toBe('locked') }
    const closed = async () => { expect(scroller().dataset.reveal).toBe('settle'); await wait(SETTLE_MS + 60) }
    await lockIt()
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
    await closed()
    await lockIt()
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    act(() => { h.querySelector('[data-message-id="n1"] [data-find-body]')!.dispatchEvent(click) })
    expect(click.defaultPrevented).toBe(true)
    await closed()
    await lockIt()
    wheel(-(REVEAL_CLOSE_PULL + 10), 0)
    await wait(WHEEL_END_MS + 60)
    await closed()
    await lockIt()
    wheel(-10, 0) // a small rightward nudge leaves it locked
    await wait(WHEEL_END_MS + 60)
    expect(scroller().dataset.reveal).toBe('locked')
    act(() => [...h.querySelectorAll<HTMLButtonElement>('nav [data-roving]')].find((r) => r.textContent === 'Unfiled')!.click())
    await settle()
    expect(scroller().dataset.reveal).not.toBe('locked')
  })

  it('trackpad: vertical scrolling never reveals, and a swipe the other way does nothing', async () => {
    await mountWindow()
    wheel(3, 40)
    wheel(60, 0) // same gesture, already locked to vertical
    await frame()
    expect(scroller().dataset.reveal).toBeUndefined()
    await wait(WHEEL_END_MS + 60)
    wheel(-50, 0)
    await frame()
    expect(scroller().dataset.reveal).toBeUndefined()
  })

  it('touch lock: past ~1.5× it stays; a rightward swipe then closes it and is not passed on (no reply)', async () => {
    await mountWindow()
    touch('touchstart', 360, 200)
    touch('touchmove', 340, 200)
    touch('touchmove', 360 - LOCK() - 10, 200)
    touch('touchend', 0, 0)
    expect(scroller().dataset.reveal).toBe('locked')
    let reachedAncestor = false
    const spy = () => { reachedAncestor = true }
    document.body.addEventListener('touchmove', spy)
    touch('touchstart', 100, 200)
    touch('touchmove', 120, 200)
    const right = touch('touchmove', 160, 200)
    document.body.removeEventListener('touchmove', spy)
    expect(right.defaultPrevented).toBe(true)
    expect(reachedAncestor).toBe(false)
    touch('touchend', 0, 0)
    expect(scroller().dataset.reveal).toBe('settle')
  })

  it('touch: a leftward drag follows the finger and blocks scrolling; letting go settles back; rightward is left to reply', async () => {
    await mountWindow()
    touch('touchstart', 300, 200)
    const mv = touch('touchmove', 240, 204)
    expect(mv.defaultPrevented).toBe(true)
    expect(scroller().dataset.reveal).toBe('drag')
    expect(shift(mine())).toBe(60)
    touch('touchend', 0, 0)
    expect(scroller().dataset.reveal).toBe('settle')
    await wait(SETTLE_MS + 60)
    touch('touchstart', 100, 200)
    const right = touch('touchmove', 160, 200)
    expect(right.defaultPrevented).toBe(false)
    expect(scroller().dataset.reveal).toBeUndefined()
  })
})

describe('Unfiled near the top of the sidebar', () => {
  it('opens as its own conversation with only the unfiled messages, and shows as selected', async () => {
    const h = await mountWindow()
    const nav = h.querySelector('nav[aria-label="Conversations"]')!
    const rows = [...nav.querySelectorAll<HTMLElement>('[data-roving]')].map((r) => r.textContent)
    expect(rows.slice(0, 2)).toEqual(['All Messages', 'Unfiled'])
    const unfiled = [...nav.querySelectorAll<HTMLButtonElement>('[data-roving]')].find((r) => r.textContent === 'Unfiled')!
    act(() => unfiled.click())
    await settle()
    expect(unfiled.getAttribute('aria-current')).toBe('true')
    const log = h.querySelector('[role="log"]')!
    expect(log.textContent).toContain('a loose thought')
    expect(log.textContent).not.toContain('Titus 2:11')
    expect(h.querySelector('header')!.textContent).toContain('Unfiled')
    expect(h.querySelector('header button[title*="rename"]')).toBeNull() // Unfiled cannot be renamed
  })

  it('the history list reserves its scrollbar track (collapsing a group cannot change its width)', async () => {
    const h = await mountWindow()
    expect(h.querySelector('nav[aria-label="Conversations"] .chat-hist-scroll')).not.toBeNull()
  })
})
