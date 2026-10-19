// @vitest-environment jsdom
/**
 * 2026-10-18 Chat redesign: Ask Berean's mode and This Tab live in the composer (no floating
 * options panel), the conversation picker is searchable and scales to long histories, and Find
 * in a conversation matches rendered message text safely.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ChatComposer } from '../ChatComposer'
import { filterConversations, ChatConversationPicker } from '../ChatComposerControls'
import { chatModeFlags, chatModeOf } from '../chatModes'
import { collectFindMatches } from '../chatFind'
import { useAppStore } from '@/store'
import type { AiLookupChatSummary } from '@/types/electron'
import { editorEl, typeText, press } from './composerTestUtils'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | null = null
let host: HTMLDivElement | null = null
beforeEach(() => {
  try { localStorage.clear() } catch { /* */ }
  Element.prototype.scrollIntoView ??= function () { /* jsdom */ }
  useAppStore.setState({ aiLookupCommentaryOn: true, aiLookupAgenticOn: false, aiLookupUseTabContext: false })
})
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; document.body.innerHTML = '' })
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

describe('Ask Berean modes (the request switches are preserved)', () => {
  it('maps the two stored switches to a mode and back', () => {
    expect(chatModeOf(true, false)).toBe('commentary')
    expect(chatModeOf(true, true)).toBe('deep')
    expect(chatModeOf(false, false)).toBe('passages')
    expect(chatModeOf(false, true)).toBe('deep') // an old combination still reads as Deep Search
    for (const m of ['commentary', 'deep', 'passages'] as const) {
      const f = chatModeFlags(m)
      expect(chatModeOf(f.commentary, f.deepSearch)).toBe(m)
    }
  })
})

function mountComposer(props: Partial<React.ComponentProps<typeof ChatComposer>> = {}) {
  const onSend = vi.fn(async () => true)
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => root!.render(<ChatComposer aiAvailable aiBusy={false} tabContextLabel="John 3" onSend={onSend} {...props} />))
  return { h: host, onSend, field: () => editorEl(host!)! }
}
const button = (label: string | RegExp) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => {
  const l = b.getAttribute('aria-label') ?? b.textContent ?? ''
  return typeof label === 'string' ? l === label : label.test(l)
})
const arm = () => act(() => button('Ask Berean')!.click())

describe('composer: mode and This Tab are inline, the old options panel is gone', () => {
  it('no floating options panel; idle conversation view shows only ✦, the field and expand', () => {
    const { h } = mountComposer({ destination: <span>dest</span> })
    expect(button('Ask Berean options')).toBeUndefined()
    expect(h.querySelector('.chat-composer-accessory')).toBeNull()
    expect(h.textContent).not.toContain('Includes This Tab')
  })

  it('arming shows the mode and This Tab; the mode menu switches what is sent', async () => {
    const { onSend, field } = mountComposer()
    arm()
    expect(button(/^Ask Berean mode: Commentary$/)).toBeDefined()
    act(() => button(/^Ask Berean mode/)!.click())
    const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitemradio"]')]
    expect(items.map((i) => i.textContent?.split(/(?=[A-Z][a-z]+ [a-z])/)[0])).toHaveLength(3)
    expect(items.find((i) => i.getAttribute('aria-checked') === 'true')!.textContent).toContain('Commentary')
    act(() => items.find((i) => i.textContent?.startsWith('Deep Search'))!.click())
    expect(useAppStore.getState().aiLookupAgenticOn).toBe(true)
    expect(useAppStore.getState().aiLookupCommentaryOn).toBe(true)
    typeText(field(), 'where is grace taught')
    press(field(), 'Enter')
    await settle()
    expect(onSend).toHaveBeenLastCalledWith('where is grace taught', expect.objectContaining({ ai: { commentary: true, deepSearch: true, tabContext: false } }))
  })

  it('Passages Only sends commentary off (the old "Commentary unchecked" answer is still reachable)', async () => {
    const { onSend, field } = mountComposer()
    arm()
    act(() => button(/^Ask Berean mode/)!.click())
    act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitemradio"]')].find((i) => i.textContent?.startsWith('Passages Only'))!.click())
    typeText(field(), 'sabbath')
    press(field(), 'Enter')
    await settle()
    expect(onSend).toHaveBeenLastCalledWith('sabbath', expect.objectContaining({ ai: { commentary: false, deepSearch: false, tabContext: false } }))
  })

  it('This Tab is a separate toggle that names what it sends; off means not sent', async () => {
    const { onSend, field } = mountComposer()
    arm()
    const toggle = () => button(/This Tab|John 3/)!
    expect(toggle().getAttribute('aria-pressed')).toBe('false')
    expect(toggle().textContent).toBe('This Tab')
    act(() => toggle().click())
    expect(toggle().getAttribute('aria-pressed')).toBe('true')
    expect(toggle().textContent).toBe('John 3')
    typeText(field(), 'explain verse 16')
    press(field(), 'Enter')
    await settle()
    expect(onSend).toHaveBeenLastCalledWith('explain verse 16', expect.objectContaining({ ai: expect.objectContaining({ tabContext: true }) }))
  })

  it('a tab with nothing to read: the toggle is unavailable and stays off', () => {
    mountComposer({ tabContextLabel: null })
    arm()
    const t = button(/nothing Ask Berean can read/)!
    expect(t.getAttribute('aria-disabled')).toBe('true')
    act(() => t.click())
    expect(useAppStore.getState().aiLookupUseTabContext).toBe(false)
  })

  it('"this chapter" in the message shows the tab as included (the existing mention rule)', () => {
    const { field } = mountComposer()
    arm()
    typeText(field(), 'summarize this chapter')
    const t = button(/Included because your message mentions it/)!
    expect(t.getAttribute('aria-pressed')).toBe('true')
  })

  it('a plain message (not armed) never carries AI options', async () => {
    const { onSend, field } = mountComposer()
    typeText(field(), 'just a note')
    press(field(), 'Enter')
    await settle()
    expect(onSend).toHaveBeenLastCalledWith('just a note', {})
  })

  it('All Messages keeps the destination visible even while idle', () => {
    const { h } = mountComposer({ destination: <span data-testid="dest">Unfiled</span>, destinationAlwaysVisible: true })
    expect(h.querySelector('.chat-composer-dest [data-testid="dest"]')).not.toBeNull()
  })

  it('the conversation selector sits in the typing line, just left of expand (not a row below)', () => {
    const { h } = mountComposer({ destination: <span data-testid="dest">Unfiled</span>, destinationAlwaysVisible: true })
    const dest = h.querySelector('.chat-composer-dest')!
    const line = dest.parentElement!
    expect(line.contains(h.querySelector('[contenteditable]'))).toBe(true)
    expect(dest.nextElementSibling?.getAttribute('aria-label')).toBe('Expand Message Field')
    expect(h.querySelector('.chat-composer-accessory')).toBeNull() // nothing below while not armed
  })

  it('the formatting row stays open while a composer popover (the picker) has focus', async () => {
    const summaries = [sum('a', 'Feast notes', 'Leviticus 23', '2026-10-10T10:00:00Z')]
    const { h, field } = mountComposer({
      destinationAlwaysVisible: true,
      destination: <ChatConversationPicker destination={{ kind: 'conversation', chatId: 'a', title: 'Feast notes' }} summaries={summaries} allowUnfiled onPick={() => {}} onNew={() => {}} />,
    })
    act(() => field().focus())
    act(() => { field().dispatchEvent(new FocusEvent('focus')) })
    act(() => button('Conversation: Feast notes')!.click())
    await settle()
    await act(async () => { await new Promise((r) => setTimeout(r, 200)) }) // past the blur delay
    expect(h.querySelector('.chat-fmt-reveal')!.getAttribute('data-open')).toBe('true')
  })
})

const sum = (id: string, title: string, preview: string, when: string, pinned?: string): AiLookupChatSummary =>
  ({ id, title, preview, created_at: when, updated_at: when, lastMessageAt: when, messageCount: 1, pinnedAt: pinned ?? null, folder: null }) as AiLookupChatSummary

describe('conversation picker filtering', () => {
  const list = [
    sum('a', 'Feast notes', 'Leviticus 23 and the appointed times', '2026-10-10T10:00:00Z'),
    sum('b', 'Sabbath study', 'Exodus 20 and Deuteronomy 5', '2026-10-17T10:00:00Z'),
    sum('c', 'Grace that teaches', 'Titus 2:11 grace', '2026-10-01T10:00:00Z', '2026-10-02T00:00:00Z'),
    sum('d', 'Notes on Isaiah', 'The sabbath a delight (58:13)', '2026-10-18T10:00:00Z'),
  ]
  it('no query: pinned first, then newest activity', () => {
    expect(filterConversations(list, '').map((s) => s.id)).toEqual(['c', 'd', 'b', 'a'])
  })
  it('every word must match title or preview; title matches rank above preview-only ones', () => {
    expect(filterConversations(list, 'sabbath').map((s) => s.id)).toEqual(['b', 'd'])
    expect(filterConversations(list, 'exodus deuteronomy').map((s) => s.id)).toEqual(['b'])
    expect(filterConversations(list, 'SABBATH STUDY').map((s) => s.id)).toEqual(['b'])
    expect(filterConversations(list, 'zzz')).toEqual([])
  })
  it('stays fast with thousands of conversations (summaries only, no message bodies)', () => {
    const big = Array.from({ length: 5000 }, (_, i) => sum(`x${i}`, `Study ${i}`, `preview ${i % 97}`, new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString()))
    const t0 = performance.now()
    const hits = filterConversations(big, 'study 4999')
    expect(performance.now() - t0).toBeLessThan(200)
    expect(hits[0].id).toBe('x4999')
  })
})

describe('conversation picker: the current choice is highlighted, not checked', () => {
  it('marks the selected row with a highlight and no check mark', async () => {
    const summaries = [sum('a', 'Feast notes', 'Leviticus 23', '2026-10-10T10:00:00Z'), sum('b', 'Sabbath study', 'Exodus 20', '2026-10-17T10:00:00Z')]
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    act(() => root!.render(<ChatConversationPicker destination={{ kind: 'conversation', chatId: 'a', title: 'Feast notes' }} summaries={summaries} allowUnfiled onPick={() => {}} onPickUnfiled={() => {}} onNew={() => {}} />))
    act(() => button('Conversation: Feast notes')!.click())
    await settle()
    const rows = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
    const sel = rows.filter((r) => r.classList.contains('is-selected'))
    expect(sel.map((r) => r.textContent)).toEqual([expect.stringContaining('Feast notes')])
    expect(sel[0].getAttribute('aria-selected')).toBe('true')
    expect(document.querySelector('[aria-label="Current conversation"]')).toBeNull()
    expect(document.querySelector('[role="listbox"] .lucide-check')).toBeNull()
  })
})

describe('find in conversation: rendered text, matched safely', () => {
  function fixture(html: string) {
    const div = document.createElement('div')
    div.innerHTML = html
    document.body.appendChild(div)
    return div
  }
  it('finds every match, across formatting, case-insensitively, skipping quotes of other messages', () => {
    const root = fixture(`
      <div data-message-id="m1"><div data-find-body>Grace and <b>gra</b>ce again — GRACE</div></div>
      <div data-message-id="m2"><div data-find-body><div class="chat-reply-quote">grace (quoted)</div>no match here</div><span>grace in a timestamp area</span></div>
      <div data-message-id="m3"><div data-find-body><p>Titus 2:11 — the <strong>grace</strong> of God</p></div></div>`)
    const m = collectFindMatches(root, 'grace')
    expect(m.map((x) => x.messageId)).toEqual(['m1', 'm1', 'm1', 'm3'])
    expect(m[1].range.toString()).toBe('grace') // "gra" + "ce" across two text nodes
    expect(collectFindMatches(root, '   ')).toEqual([])
  })
  it('treats Markdown / HTML-looking queries as plain text', () => {
    const root = fixture(`<div data-message-id="m1"><div data-find-body>Typed **literally** and &lt;b&gt;tags&lt;/b&gt; and a.b(c)</div></div>`)
    expect(collectFindMatches(root, '**literally**')).toHaveLength(1)
    expect(collectFindMatches(root, '<b>tags</b>')).toHaveLength(1)
    expect(collectFindMatches(root, 'a.b(c)')).toHaveLength(1)
    expect(collectFindMatches(root, '.*')).toHaveLength(0) // never a regular expression
  })
  it('a long message with many matches', () => {
    const root = fixture(`<div data-message-id="m1"><div data-find-body>${'Yeshua said. '.repeat(400)}</div></div>`)
    expect(collectFindMatches(root, 'yeshua')).toHaveLength(400)
  })
})
