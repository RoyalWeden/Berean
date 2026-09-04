import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useAppStore } from '@/store'
import { initCrossWindowSync } from '@/lib/crossWindowSync'

// ── Fake `window.crossWindow` transport ─────────────────────────────────────
let inboundHandlers: Array<(m: unknown) => void> = []
const broadcasts: unknown[] = []
const directed: Array<{ to: number; msg: unknown }> = []

function installFakeTransport() {
  inboundHandlers = []
  broadcasts.length = 0
  directed.length = 0
  ;(window as unknown as { crossWindow: unknown }).crossWindow = {
    selfId: () => Promise.resolve(42),
    broadcast: (m: unknown) => broadcasts.push(m),
    sendTo: (to: number, msg: unknown) => directed.push({ to, msg }),
    list: () => Promise.resolve([42]),
    onMessage: (cb: (m: unknown) => void) => {
      inboundHandlers.push(cb)
      return () => { inboundHandlers = inboundHandlers.filter((h) => h !== cb) }
    },
    newWindow: () => Promise.resolve(),
  }
}
const deliver = (m: unknown) => inboundHandlers.forEach((h) => h(m))

let teardown: (() => void) | null = null

beforeEach(() => {
  installFakeTransport()
  // deterministic starting point
  useAppStore.setState({ theme: 'light', bibleFontSize: 16 })
  teardown = initCrossWindowSync()
})
afterEach(() => {
  teardown?.()
  teardown = null
  delete (window as unknown as { crossWindow?: unknown }).crossWindow
})

describe('crossWindowSync', () => {
  it('broadcasts a preference change made locally (debounced)', async () => {
    useAppStore.getState().setTheme('dark')
    expect(broadcasts.some((m) => (m as { kind?: string }).kind === 'prefs')).toBe(false) // not yet — debounced
    await new Promise((r) => setTimeout(r, 160))
    const msg = broadcasts.find((m) => (m as { kind?: string }).kind === 'prefs') as { patch: Record<string, unknown> }
    expect(msg).toBeTruthy()
    expect(msg.patch.theme).toBe('dark')
  })

  it('applies an inbound preference patch without re-broadcasting it (no echo)', () => {
    deliver({ kind: 'prefs', patch: { bibleFontSize: 22 } })
    expect(useAppStore.getState().bibleFontSize).toBe(22)
    expect(broadcasts.some((m) => (m as { kind?: string }).kind === 'prefs')).toBe(false)
  })

  it('does not broadcast a per-window field (activeSpace) when it changes locally', () => {
    useAppStore.getState().setActiveSpace('notes')
    expect(broadcasts.length).toBe(0)
  })

  it('answers a mirror request with the current shared + view state', async () => {
    useAppStore.setState({ theme: 'dark', activeSpace: 'lexicon' })
    deliver({ kind: 'requestMirror', replyTo: 99 })
    expect(directed).toHaveLength(1)
    expect(directed[0].to).toBe(99)
    const reply = directed[0].msg as { kind: string; prefs: Record<string, unknown>; view: Record<string, unknown> }
    expect(reply.kind).toBe('mirrorState')
    expect(reply.prefs.theme).toBe('dark')
    expect(reply.view.activeSpace).toBe('lexicon')
  })

  it('an inbound tabs message for a session drops a now-closed active tab', () => {
    const sid = useAppStore.getState().currentSessionId
    // pretend this window was looking at tab "gone" in scripture
    useAppStore.setState({
      tabs: { scripture: [{ id: 'gone', spaceId: 'scripture', type: 'bible', title: 'x', state: {} } as never], notes: [], lexicon: [], youtube: [], search: [] },
      activeTabId: { scripture: 'gone', notes: null, lexicon: null, youtube: null, search: null },
    })
    deliver({
      kind: 'tabs',
      sessionId: sid,
      tabs: { scripture: [], notes: [], lexicon: [], youtube: [], search: [] },
      order: [],
    })
    expect(useAppStore.getState().activeTabId.scripture).toBeNull()
  })

  it('an inbound tabs message keeps this window’s own state for a tab it already has, adopts new ones, drops removed ones', () => {
    const sid = useAppStore.getState().currentSessionId
    const mk = (id: string, state: object) => ({ id, spaceId: 'scripture', type: 'bible', title: id, state } as never)
    // this window has A (scrolled to ch 5) and B
    useAppStore.setState({
      tabs: { scripture: [mk('A', { bookId: 'Gen', chapter: 5 }), mk('B', { bookId: 'Exo', chapter: 1 })], notes: [], lexicon: [], youtube: [], search: [] },
      activeTabId: { scripture: 'A', notes: null, lexicon: null, youtube: null, search: null },
    })
    // another window: A now shows ch 99, B closed, C (new) added
    deliver({
      kind: 'tabs',
      sessionId: sid,
      tabs: { scripture: [mk('A', { bookId: 'Gen', chapter: 99 }), mk('C', { bookId: 'Lev', chapter: 3 })], notes: [], lexicon: [], youtube: [], search: [] },
      order: undefined,
    })
    const scr = useAppStore.getState().tabs.scripture
    expect(scr.map((t) => t.id)).toEqual(['A', 'C'])              // membership follows the sender
    expect((scr[0].state as { chapter: number }).chapter).toBe(5) // but A keeps THIS window's nav
    expect((scr[1].state as { chapter: number }).chapter).toBe(3) // new tab C adopts sender's state
  })

  it('a tabs message for a session this window is NOT on updates that session without touching the live view', () => {
    const s = useAppStore.getState()
    s.createSession('Second')
    const first = s.sessions[0].id
    const second = useAppStore.getState().currentSessionId // createSession switches to it
    expect(second).not.toBe(first)
    const before = useAppStore.getState().tabs
    deliver({
      kind: 'tabs',
      sessionId: first,
      tabs: { scripture: [{ id: 'x', spaceId: 'scripture', type: 'bible', title: 'x', state: {} } as never], notes: [], lexicon: [], youtube: [], search: [] },
      order: undefined,
    })
    expect(useAppStore.getState().tabs).toBe(before) // our (second session) live view untouched
    expect(useAppStore.getState().sessions.find((ss) => ss.id === first)?.tabs.scripture.map((t) => t.id)).toEqual(['x'])
  })

  it('sends a requestMirror on mount when spawned with ?mirrorFrom', async () => {
    teardown?.()
    const spy = vi.spyOn(window.history, 'replaceState')
    const orig = window.location.search
    Object.defineProperty(window, 'location', { value: { ...window.location, search: '?mirrorFrom=7' }, writable: true })
    installFakeTransport()
    teardown = initCrossWindowSync()
    await Promise.resolve(); await Promise.resolve()
    expect(directed.some((d) => d.to === 7 && (d.msg as { kind?: string }).kind === 'requestMirror')).toBe(true)
    Object.defineProperty(window, 'location', { value: { ...window.location, search: orig }, writable: true })
    spy.mockRestore()
  })
})
