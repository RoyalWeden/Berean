// @vitest-environment jsdom
/** ComparisonView (via AiReplyBody): labelled panes, an explicit missing pane, navigation, and "Different wording". */
import { describe, it, expect, afterEach, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ChatNavContext } from '../chatNav'
import { AiReplyBody } from '../AiReplyBody'
import type { ChatMsg } from '../chatModel'
import type { ComparisonPane, ResearchPayload } from '@/lib/research/payload'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; host = null })

function mount(node: React.ReactNode) {
  const nav = vi.fn()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => root!.render(<ChatNavContext.Provider value={nav}>{node}</ChatNavContext.Provider>))
  return { el: host, nav }
}

const kjv: ComparisonPane = {
  label: 'KJV', textId: 'kjva', corpus: 'Bible', reference: 'Genesis 1:1', bookId: 'GEN', chapter: 1, verse: 1,
  verses: [{ chapter: 1, verse: 1, text: 'In the beginning God created the heaven and the earth.' }], differing: ['created'],
}
const lxx: ComparisonPane = {
  label: 'LXX (Brenton)', textId: 'lxx', corpus: 'LXX', reference: 'Genesis 1:1', bookId: 'GEN', chapter: 1, verse: 1,
  verses: [{ chapter: 1, verse: 1, text: 'In the beginning God made the heaven and the earth.' }], differing: ['made'],
}

const reply = (panes: ComparisonPane[], limitations: string[] = []): ChatMsg => ({
  id: 'c1', role: 'assistant', kind: 'ai-reply', content: '', createdAt: '2026-11-04T10:00:00.000Z',
  results: [], visibleCount: 0, keywords: [], related: [], summary: 'Genesis 1:1 in KJV and LXX (Brenton)',
  research: {
    kind: 'translation-parallel', candidates: [], ambiguous: false, wordTables: [], occurrences: [], limitations,
    passageComparison: { kind: 'translation-parallel', panes }, method: 'deterministic',
  } satisfies ResearchPayload,
} as ChatMsg)

describe('ComparisonView', () => {
  it('renders one labelled pane per text with its corpus', () => {
    const { el } = mount(<AiReplyBody message={reply([kjv, lxx])} />)
    expect(el.querySelector('section[aria-label="Translation parallel"]')).not.toBeNull()
    const panes = [...el.querySelectorAll('article')]
    expect(panes.map((p) => p.getAttribute('aria-label'))).toEqual(['Genesis 1:1, KJV', 'Genesis 1:1, LXX (Brenton)'])
    expect(panes[1].textContent).toContain('LXX')
    expect(panes[0].textContent).toContain('In the beginning God created')
  })

  it('marks only the different words, with a text alternative', () => {
    const { el } = mount(<AiReplyBody message={reply([kjv, lxx])} />)
    expect([...el.querySelectorAll('mark.chat-diff-word')].map((m) => m.textContent)).toEqual(['created', 'made'])
    expect(el.textContent).toContain('Different wording in this text: created.')
    expect(el.textContent).toContain('Underlined words are different wording')
  })

  it('shows an explicit pane for a passage missing from a text', () => {
    const missing: ComparisonPane = { ...lxx, reference: 'John 1:1', bookId: 'JHN', verses: [], missing: 'John is not in LXX (Brenton).', differing: undefined }
    const { el } = mount(<AiReplyBody message={reply([{ ...kjv, reference: 'John 1:1', bookId: 'JHN', differing: undefined }, missing])} />)
    const note = el.querySelector('[role="note"]')!
    expect(note.textContent).toBe('John is not in LXX (Brenton).')
    expect(el.querySelectorAll('mark')).toHaveLength(0)
    expect(el.querySelectorAll('article button')).toHaveLength(1) // nothing to open in the missing pane
  })

  it('opens the passage in its own text through the chat navigation', () => {
    const { el, nav } = mount(<AiReplyBody message={reply([kjv, lxx])} />)
    const buttons = [...el.querySelectorAll<HTMLButtonElement>('article button')]
    act(() => buttons[1].click())
    expect(nav).toHaveBeenLastCalledWith({ kind: 'verse', result: expect.objectContaining({ textId: 'lxx', bookId: 'GEN', chapter: 1, verse: 1 }) })
    expect(buttons[1].title).toBe('Open Genesis 1:1 in LXX (Brenton)')
  })

  it('lists limitations such as differing numbering', () => {
    const { el } = mount(<AiReplyBody message={reply([{ ...kjv, differing: undefined }, { ...lxx, differing: undefined }], ['Each is shown under its own numbering.'])} />)
    expect(el.querySelector('[aria-label="Limitations"]')!.textContent).toContain('own numbering')
    expect(el.querySelectorAll('mark')).toHaveLength(0)
  })
})
