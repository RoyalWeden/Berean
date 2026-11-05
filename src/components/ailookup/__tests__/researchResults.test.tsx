// @vitest-environment jsdom
/**
 * Model-free research results in a reply (ResearchResults via AiReplyBody): best Strong's match
 * first with the rest grouped Hebrew/Greek behind a disclosure (decision 8), provenance on every
 * row, a word-by-word table with untagged words visible (scenario 5), and stated limitations.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ChatNavContext } from '../chatNav'
import { AiReplyBody } from '../AiReplyBody'
import type { ChatMsg } from '../chatModel'
import type { ResearchPayload, ResearchStrongsCandidate } from '@/lib/research/payload'

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

const cand = (id: string, lemma: string, n: number, extra: Partial<ResearchStrongsCandidate> = {}): ResearchStrongsCandidate => ({
  id, lang: id[0] as 'H' | 'G', lemma, transliteration: `t-${id}`, gloss: `gloss ${id}`, definition: '', derivation: '',
  lexiconCount: 99, match: 'kjv-rendering', kjvRenderingCount: n, forms: ['mercy'], ...extra,
})

const research = (over: Partial<ResearchPayload> = {}): ResearchPayload => ({
  kind: 'word-study', term: 'mercy', ambiguous: true, wordTables: [], occurrences: [], limitations: [], method: 'deterministic',
  candidates: [cand('H2617', 'חֶסֶד', 149), cand('H7356', 'רַחַם', 30), cand('G1656', 'ἔλεος', 27)],
  ...over,
})

const reply = (r: ResearchPayload): ChatMsg => ({
  id: 'r1', role: 'assistant', kind: 'ai-reply', content: '', createdAt: '2026-10-28T10:00:00.000Z',
  results: [], visibleCount: 0, keywords: [], related: [], research: r,
  strongsCard: { strongsNum: 'H2617', lemma: 'חֶסֶד', transliteration: 'cheçed', gloss: '', definition: '', derivation: '', occurrenceCount: 160 },
} as ChatMsg)

describe('ResearchResults', () => {
  it('shows the best match with provenance, and groups the rest behind a disclosure', () => {
    const { el, nav } = mount(<AiReplyBody message={reply(research())} />)
    const rows = () => [...el.querySelectorAll<HTMLButtonElement>('button.chat-strongs')]
    expect(rows()).toHaveLength(1)
    expect(rows()[0].textContent).toContain('H2617')
    expect(rows()[0].textContent).toContain('KJV renders it “mercy” in 149 verses')
    const toggle = [...el.querySelectorAll('button')].find((b) => /2 more entries/.test(b.textContent ?? ''))!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    act(() => toggle.click())
    expect(el.querySelector('[aria-label="Hebrew entries"]')!.textContent).toContain('H7356')
    expect(el.querySelector('[aria-label="Greek entries"]')!.textContent).toContain('G1656')
    act(() => rows()[1].click())
    expect(nav).toHaveBeenLastCalledWith({ kind: 'lexicon', strongsNum: 'H7356' })
  })

  it('renders a word table with untagged and untranslated words visible', () => {
    const r = research({
      kind: 'word-table', term: undefined, candidates: [],
      wordTables: [{ textId: 'kjva', bookId: 'GEN', chapter: 1, untaggedText: false, verses: [{
        verse: 1, text: 'In the beginning God created',
        coverage: { tokens: 4, tagged: 3, untagged: 1 },
        tokens: [
          { index: 0, word: 'In', before: '', after: '', strongs: [], untranslated: false, supplied: false, redLetter: false, entries: [] },
          { index: 1, word: 'beginning', before: '', after: '', strongs: ['H7225'], untranslated: false, supplied: false, redLetter: false, entries: [{ id: 'H7225', lemma: 'רֵאשִׁית', transliteration: 'rêʼshîyth', gloss: 'beginning' }] },
          { index: 2, word: '', before: '', after: '', strongs: ['H853'], untranslated: true, supplied: false, redLetter: false, entries: [{ id: 'H853', lemma: 'אֵת', transliteration: 'ʼêth', gloss: '' }] },
          { index: 3, word: 'God', before: '', after: '', strongs: ['H430'], untranslated: false, supplied: false, redLetter: false, entries: [] },
        ],
      }] }],
      limitations: ["Berean's Greek Septuagint word tags aren't available yet, so this table shows the KJV's Strong's tags."],
    })
    const { el, nav } = mount(<AiReplyBody message={reply(r)} />)
    const table = el.querySelector('section[aria-label="Genesis 1:1, word by word"] table')!
    expect(table).toBeTruthy()
    expect(el.textContent).toContain('3 of 4 words tagged')
    const rows = table.querySelectorAll('tbody tr')
    expect(rows).toHaveLength(4)
    expect(rows[0].className).toBe('is-untagged')
    expect(rows[0].textContent).toContain('untagged')
    expect(rows[2].textContent).toContain('(untranslated)')
    act(() => (rows[1].querySelector('button.chat-wordtable-id') as HTMLButtonElement).click())
    expect(nav).toHaveBeenLastCalledWith({ kind: 'lexicon', strongsNum: 'H7225' })
    expect(el.querySelector('[aria-label="Limitations"]')!.textContent).toContain('Septuagint')
  })

  it('states exact tagged-verse counts when occurrences were computed', () => {
    const r = research({ kind: 'occurrences', candidates: [cand('G5485', 'χάρις', 0, { match: 'id' })], occurrences: [{ id: 'G5485', bookId: 'TIT', totals: [{ textId: 'kjva', verses: 4 }, { textId: 'lxx', verses: 0 }], byBook: [] }] })
    const { el } = mount(<AiReplyBody message={reply(r)} />)
    expect(el.textContent).toContain('Tagged in 4 KJV verses in Titus')
  })
})

describe('occurrences explorer', () => {
  it('lists tagged verses per book in canonical order behind a disclosure; a row opens the lexicon', () => {
    const r = research({ kind: 'occurrences', candidates: [cand('G5485', 'χάρις', 0, { match: 'id' })], occurrences: [{ id: 'G5485', totals: [{ textId: 'kjva', verses: 9 }], byBook: [
      { textId: 'kjva', bookId: 'ROM', verses: 6 }, { textId: 'kjva', bookId: 'LUK', verses: 3 },
    ] }] })
    const { el, nav } = mount(<AiReplyBody message={reply(r)} />)
    const toggle = [...el.querySelectorAll('button')].find((b) => /G5485 by book · 2 books/.test(b.textContent ?? ''))!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    act(() => toggle.click())
    const rows = [...el.querySelectorAll<HTMLButtonElement>('[aria-label="G5485 tagged verses by book"] button')]
    expect(rows.map((b) => b.getAttribute('aria-label'))).toEqual(['Luke: 3 verses', 'Romans: 6 verses'])
    act(() => rows[0].click())
    expect(nav).toHaveBeenLastCalledWith({ kind: 'lexicon', strongsNum: 'G5485' })
  })

  it('is hidden for a single book or a book-scoped count', () => {
    const r = research({ kind: 'occurrences', candidates: [cand('G5485', 'χάρις', 0, { match: 'id' })], occurrences: [{ id: 'G5485', bookId: 'TIT', totals: [{ textId: 'kjva', verses: 4 }], byBook: [{ textId: 'kjva', bookId: 'TIT', verses: 4 }] }] })
    const { el } = mount(<AiReplyBody message={reply(r)} />)
    expect(el.textContent).not.toMatch(/by book/)
  })
})

describe('typed outcome notice (spec §6.1 #15)', () => {
  it('names the failure and says results were found without the model — never "no matching verses"', () => {
    const m = { id: 'r2', role: 'assistant', kind: 'ai-reply', content: 'AI model timed out. …', createdAt: '2026-10-28T10:00:00.000Z', results: [], visibleCount: 0, keywords: [], related: [], errorCode: 'TIMEOUT', partial: true } as unknown as ChatMsg
    const { el } = mount(<AiReplyBody message={m} />)
    const n = el.querySelector('.chat-notice')!
    expect(n.getAttribute('role')).toBe('status')
    expect(n.textContent).toContain('AI model timed out')
    expect(n.textContent).toContain('Results found without the AI model are shown below.')
    expect(el.textContent).not.toMatch(/No matching/)
  })
})
