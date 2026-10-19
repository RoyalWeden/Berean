// @vitest-environment jsdom
/**
 * Berean reply presentation (AiReplyBody): passage list with Scripture and commentary as distinct
 * elements, nested cross-ref disclosure, show-more, Strong's word → lexicon, verse menu, partial
 * (still-streaming) replies, and the AI reply as a content column (not a bubble) in ChatMessageRow.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { AiLookupResult } from '@/types/electron'
import { ChatNavContext } from '../chatNav'
import { AiReplyBody, VerseMenuContext } from '../AiReplyBody'
import { ChatMessageRow } from '../ChatMessageRow'
import type { ChatMsg } from '../chatModel'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; host = null })

const verse = (bookId: string, bookName: string, chapter: number, v: number, text: string, extra: Partial<AiLookupResult> = {}): AiLookupResult =>
  ({ textId: 'kjva', bookId, bookName, chapter, verse: v, text, source: 'fts', ...extra } as AiLookupResult)

const titus = verse('TIT', 'Titus', 2, 11, 'For the grace of God that bringeth salvation hath appeared to all men,', {
  commentary: 'Grace here is the **divine influence** upon the heart — compare Titus 2:12.', noted: true,
})
const reply = (over: Partial<ChatMsg> = {}): ChatMsg => ({
  id: 'r1', role: 'assistant', kind: 'ai-reply', content: '', createdAt: '2026-10-18T10:00:00.000Z',
  summary: 'Yeshua taught that grace **teaches** us.', keywords: ['grace'],
  results: [
    titus,
    verse('EPH', 'Ephesians', 2, 8, 'For by grace are ye saved through faith;'),
    verse('ROM', 'Romans', 6, 14, 'For sin shall not have dominion over you'),
    verse('JHN', 'John', 1, 17, 'For the law was given by Moses', { source: 'cross-ref', crossRefOf: { bookId: 'TIT', chapter: 2, verse: 11 } } as Partial<AiLookupResult>),
  ],
  visibleCount: 2,
  related: [verse('ACT', 'Acts', 13, 43, 'to continue in the grace of God.')],
  relatedNote: 'Other places grace is *continued in*.',
  ...over,
} as ChatMsg)

function mount(node: React.ReactNode) {
  const nav = vi.fn()
  const menu = vi.fn()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => root!.render(
    <ChatNavContext.Provider value={nav}><VerseMenuContext.Provider value={menu}>{node}</VerseMenuContext.Provider></ChatNavContext.Provider>,
  ))
  return { el: host, nav, menu }
}

describe('AiReplyBody', () => {
  it('renders summary prose as markdown and passages as a list with distinct Scripture and commentary', () => {
    const { el, nav, menu } = mount(<AiReplyBody message={reply()} question="What is grace?" />)
    expect(el.querySelector('.chat-ai-summary strong')!.textContent).toBe('teaches')
    const items = el.querySelectorAll('ul.chat-passages[aria-label="Passages"] > li')
    expect(items.length).toBe(2) // visibleCount
    const first = items[0]
    expect(first.querySelector('.chat-passage-ref')!.textContent).toContain('Titus 2:11')
    expect(first.querySelector('[aria-label="You have a note here"]')).toBeTruthy()
    const scripture = first.querySelector('blockquote.chat-scripture')!
    expect(scripture.textContent).toBe(titus.text)
    expect(scripture.querySelector('mark')!.textContent?.toLowerCase()).toBe('grace') // keyword highlight
    const commentary = first.querySelector('.chat-commentary')!
    expect(commentary).not.toBe(scripture)
    expect(scripture.contains(commentary)).toBe(false)
    expect(commentary.querySelector('strong')!.textContent).toBe('divine influence')
    // a ref inside commentary links on its own, without also opening the passage
    const inner = [...commentary.querySelectorAll<HTMLButtonElement>('button.chat-link')].find((b) => b.textContent === 'Titus 2:12')!
    act(() => inner.click())
    expect(nav).toHaveBeenCalledTimes(1)
    expect(nav).toHaveBeenLastCalledWith({ kind: 'verse', result: expect.objectContaining({ verse: 12 }) })
    // clicking the passage opens it (with the question threaded through)
    act(() => (first.querySelector('.chat-passage') as HTMLElement).click())
    expect(nav).toHaveBeenLastCalledWith({ kind: 'verse', result: titus, question: 'What is grace?' })
    // right-click keeps the verse menu
    act(() => { first.querySelector('.chat-passage')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })) })
    expect(menu).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ bookId: 'TIT', chapter: 2, verse: 11, lxx: false }))
  })

  it('nests cross-refs behind an "N related" disclosure', () => {
    const { el, nav } = mount(<AiReplyBody message={reply()} />)
    const toggle = el.querySelector<HTMLButtonElement>('.chat-crossrefs-toggle')!
    expect(toggle.textContent).toContain('1 related')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(el.querySelector('.chat-crossref-list')).toBeNull()
    act(() => toggle.click())
    const cr = el.querySelector<HTMLButtonElement>('.chat-crossref-list button')!
    expect(cr.textContent).toContain('John 1:17')
    expect(nav).not.toHaveBeenCalled() // the toggle never opens the parent passage
    act(() => cr.click())
    expect(nav).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'verse', result: expect.objectContaining({ bookId: 'JHN' }) }))
  })

  it('shows more passages on demand', () => {
    const { el } = mount(<AiReplyBody message={reply()} />)
    const more = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Show 1 more'))!
    act(() => more.click())
    expect(el.querySelectorAll('ul.chat-passages[aria-label="Passages"] > li').length).toBe(3)
    expect([...el.querySelectorAll('button')].some((b) => b.textContent?.includes('more'))).toBe(false)
  })

  it('lists related passages under a section label', () => {
    const { el } = mount(<AiReplyBody message={reply()} />)
    const section = el.querySelector('section[aria-label="Related Passages"]')!
    expect(section.textContent).toContain('Related Passages')
    expect(section.querySelector('em')!.textContent).toBe('continued in')
    expect(section.textContent).toContain('Acts 13:43')
  })

  it('opens the lexicon from the Strong\'s word', () => {
    const { el, nav } = mount(<AiReplyBody message={reply({ results: [], related: [], strongsCard: { strongsNum: 'G5485', lemma: 'χάρις', transliteration: 'charis', gloss: 'grace, favour', definition: '', derivation: 'from G5463', occurrenceCount: 156 } })} />)
    const card = el.querySelector<HTMLButtonElement>('button.chat-strongs')!
    expect(card.textContent).toContain('χάρις')
    expect(card.textContent).toContain('charis')
    expect(card.textContent).toContain('156 occurrences')
    act(() => card.click())
    expect(nav).toHaveBeenLastCalledWith({ kind: 'lexicon', strongsNum: 'G5485' })
  })

  it('shows a deterministic summary as a quiet badge', () => {
    const { el } = mount(<AiReplyBody message={reply({ keywords: [], summary: 'Found in your notes', results: [], related: [] })} />)
    expect(el.querySelector('.chat-source-badge')!.textContent).toBe('Found in your notes')
    expect(el.querySelector('.chat-ai-summary')).toBeNull()
  })

  it('renders a partial (pending) reply without raw syntax', () => {
    const { el } = mount(<AiReplyBody message={reply({ pending: true, summary: undefined, content: 'Grace is **divine', results: [titus], visibleCount: undefined, related: [] })} />)
    expect(el.textContent).toContain('Grace is divine')
    expect(el.textContent).not.toContain('**')
    expect(el.querySelectorAll('.chat-passage').length).toBe(1)
  })
})

describe('ChatMessageRow presentation', () => {
  const rowProps = { chatId: 'c1', chatTitle: 'Study', groupStart: true, groupEnd: true, showConversation: false, failed: false, focused: false }
  it('renders an AI reply as a content column (no bubble) under the Berean label', () => {
    const { el } = mount(<ChatMessageRow {...rowProps} message={reply()} side="berean" />)
    const col = el.querySelector('.chat-ai-column')!
    expect(col).toBeTruthy()
    expect(col.className).not.toContain('bg-')
    expect(el.textContent).toContain('Berean')
  })
  it('keeps plain user notes in accent bubbles with markdown', () => {
    const note: ChatMsg = { id: 'n1', role: 'user', kind: 'note', content: '**Grace** teaches — Titus 2:11', createdAt: '2026-10-18T10:00:00.000Z' } as ChatMsg
    const { el } = mount(<ChatMessageRow {...rowProps} message={note} side="me" />)
    const bubble = el.querySelector('.bg-accent')!
    expect(bubble.querySelector('.chat-md.is-accent strong')!.textContent).toBe('Grace')
    expect(bubble.querySelector('button.chat-link.is-on-accent')!.textContent).toBe('Titus 2:11')
  })

  it('shows a structured user note (table) as a neutral card, not an accent bubble', () => {
    const note: ChatMsg = { id: 'n2', role: 'user', kind: 'note', content: '| a | b |\n|---|---|\n| Yeshua | Titus 2:11 |', createdAt: '2026-10-18T10:00:00.000Z' } as ChatMsg
    const { el } = mount(<ChatMessageRow {...rowProps} message={note} side="me" />)
    expect(el.querySelector('.bg-accent')).toBeNull()
    const card = el.querySelector('[data-doc]')!
    expect(card.classList.contains('chat-bubble-doc')).toBe(true)
    expect(card.querySelector('.chat-table-wrap table')).toBeTruthy()
    expect(card.querySelector('button.chat-link:not(.is-on-accent)')!.textContent).toBe('Titus 2:11')
  })
})
