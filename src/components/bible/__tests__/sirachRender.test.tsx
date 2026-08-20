import { describe, it, expect, beforeEach } from 'vitest'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import VerseRow from '../VerseRow'
import { useAppStore } from '@/store'

const SIR_1_1 = {
  book_id: 'SIR', chapter: 1, verse_num: 1,
  text: 'All wisdom cometh from the Lord, and is with him for ever.',
  text_tagged: null as string | null,
}

/** Extract the visible verse text (contents of the data-verse-text div), tags stripped. */
function visibleText(html: string): string {
  const m = html.match(/data-verse-text="true"[^>]*>(.*?)<\/div>/s)
  const inner = m ? m[1] : ''
  return inner.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
}

function render(props: Record<string, unknown>) {
  return renderToString(createElement(VerseRow as never, { verse: SIR_1_1, showStrongs: false, textId: 'kjva', ...props } as never))
}

const EXPECTED = 'All wisdom cometh from the Lord, and is with him for ever.'
const snapshot = useAppStore.getState()

describe('Sirach 1:1 render (KJVA plain-text path) — find which config eats the text', () => {
  beforeEach(() => { useAppStore.setState(snapshot, true) })

  it('default config', () => {
    expect(visibleText(render({}))).toBe(EXPECTED)
  })

  it('word replacer on (Lord→Yehovah)', () => {
    useAppStore.setState({ wordReplacerEnabled: true, wordReplacerRules: [{ id: 'l', enabled: true, queries: ['Lord'], replacement: 'Yehovah', wholeWord: true }] } as never)
    expect(visibleText(render({}))).toContain('All wisdom cometh')
  })

  it('kjva_italics hidden', () => {
    expect(visibleText(render({ hiddenAnnotations: ['kjva_italics'] }))).toBe(EXPECTED)
  })

  it('showStrongs on', () => {
    expect(visibleText(render({ showStrongs: true }))).toBe(EXPECTED)
  })

  it('full-verse char highlight', () => {
    const hl = [{ id: 'h', color: 'yellow', startWord: null, endWord: null, startChar: 0, endChar: EXPECTED.length }]
    expect(visibleText(render({ highlights: hl }))).toBe(EXPECTED)
  })

  it('partial char highlight', () => {
    const hl = [{ id: 'h', color: 'yellow', startWord: null, endWord: null, startChar: 4, endChar: 10 }]
    expect(visibleText(render({ highlights: hl }))).toBe(EXPECTED)
  })

  it('idiom highlighting on', () => {
    useAppStore.setState({ idiomHighlightEnabled: true, idiomCache: [{ id: 'i', term: 'wisdom', meaning: 'x', aliases: [], autoVariants: true }] } as never)
    expect(visibleText(render({}))).toBe(EXPECTED)
  })

  it('find query active', () => {
    expect(visibleText(render({ findQuery: 'wisdom' }))).toBe(EXPECTED)
  })

  it('hidden annotations + char highlight together', () => {
    const hl = [{ id: 'h', color: 'yellow', startWord: null, endWord: null, startChar: 4, endChar: 10 }]
    expect(visibleText(render({ hiddenAnnotations: ['kjva_italics'], highlights: hl }))).toBe(EXPECTED)
  })

  it('char highlight with endChar beyond text length', () => {
    const hl = [{ id: 'h', color: 'yellow', startWord: null, endWord: null, startChar: 0, endChar: 500 }]
    expect(visibleText(render({ highlights: hl }))).toBe(EXPECTED)
  })

  it('mixed legacy (word) + char highlights', () => {
    const hl = [
      { id: 'a', color: 'green', startWord: 0, endWord: 2, startChar: null, endChar: null },
      { id: 'b', color: 'yellow', startWord: null, endWord: null, startChar: 4, endChar: 10 },
    ]
    expect(visibleText(render({ highlights: hl }))).toBe(EXPECTED)
  })

  it('flash-highlighted (isHighlighted) row', () => {
    expect(visibleText(render({ isHighlighted: true }))).toBe(EXPECTED)
  })

  it('showStrongs + word replacer + hidden annotations combined', () => {
    useAppStore.setState({ wordReplacerEnabled: true, wordReplacerRules: [{ id: 'l', enabled: true, queries: ['Lord'], replacement: 'Yehovah', wholeWord: true }] } as never)
    expect(visibleText(render({ showStrongs: true, hiddenAnnotations: ['kjva_italics'] }))).toContain('All wisdom cometh')
  })

  // Guard: a truthy-but-tokenless text_tagged (stray whitespace) yields zero tokens, so the
  // tagged path must fall through to the plain-text path rather than render a blank verse.
  it('whitespace-only text_tagged falls back to plain text (not a blank verse)', () => {
    const verse = { ...SIR_1_1, text_tagged: '   ' }
    const html = renderToString(createElement(VerseRow as never, { verse, showStrongs: false, textId: 'kjva' } as never))
    expect(visibleText(html)).toBe(EXPECTED)
  })

  // Regression (the actual Sirach 0:1 bug report): once a verse carries ANY char highlight,
  // the plain-text (non-tagged) render used to fall back to raw verse.text for the WHOLE verse
  // unless `hasHidden` was also set — silently undoing the word replacer (the default-on
  // "Jesus"→"Yeshua" rule rendered as "Jesus" again the moment any highlight existed) and,
  // worse, desyncing VerseRow's selection-toolbar char-offset math (which always assumes the
  // word-replaced display text is what's on screen) from the actual DOM. A highlight placed
  // AFTER a length-changing replacement ("Jesus"→"Yeshua" is +1 char) then painted on the wrong
  // characters — reported live as highlighting "Son" landing on "on " instead.
  //
  // Uses the real default word-replacer rules (wordReplacerEnabled defaults to true, and
  // "jesus"→"Yeshua" ships as a default rule) rather than a custom rule set via
  // useAppStore.setState(): VerseRow's zustand hook resolves through React's SSR
  // getServerSnapshot, which reflects the store's state AT MODULE INIT, not a later setState()
  // call — a renderToString-only quirk (the real Electron renderer isn't SSR'd and doesn't have
  // this problem), but it means only rules already present at store creation are observable here.
  it('word replacer + char highlight: replacement still renders, and the highlight lands on the right word', () => {
    const verse = { ...SIR_1_1, text: 'Wisdom of Jesus the Son of Sirach.' }
    // "Son" starts at original-text offset 20 — after "Jesus" (offset 10-15), so it only lands
    // correctly in the display text if the highlight boundary is remapped past the +1 char delta.
    const hl = [{ id: 'h', color: 'yellow', startWord: null, endWord: null, startChar: 20, endChar: 23 }]
    const html = renderToString(createElement(VerseRow as never, { verse, showStrongs: false, textId: 'kjva', highlights: hl } as never))
    expect(visibleText(html)).toBe('Wisdom of Yeshua the Son of Sirach.')
    const m = html.match(/background-color:[^"]*"[^>]*>([^<]*)</)
    expect(m?.[1]).toBe('Son')
  })
})
