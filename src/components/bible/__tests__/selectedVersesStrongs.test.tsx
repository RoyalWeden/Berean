import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { SelectedVerseBlock, selectedVerseHeading, selectionSignature } from '../SelectedVersesStrongs'

const ref = (verse: number, textId = 'kjva') => ({ bookId: 'DEU', chapter: 9, verse, textId })

describe('SelectedVersesStrongs helpers', () => {
  it('headings name each verse, LXX-suffixed', () => {
    expect(selectedVerseHeading(ref(4))).toBe('Deuteronomy 9:4')
    expect(selectedVerseHeading(ref(4, 'lxx'))).toBe('Deuteronomy 9:4 LXX')
  })

  it('selection signature is order-insensitive and changes with the selection', () => {
    expect(selectionSignature([ref(6), ref(4), ref(5)])).toBe(selectionSignature([ref(4), ref(5), ref(6)]))
    expect(selectionSignature([ref(4)])).not.toBe(selectionSignature([ref(4), ref(5)]))
    expect(selectionSignature([])).toBe('')
  })
})

describe('SelectedVerseBlock', () => {
  it('renders the heading and every Strong\'s number as a button, particles included', () => {
    const html = renderToString(createElement(SelectedVerseBlock, {
      verse: { ...ref(1, 'kjva'), bookId: 'GEN', chapter: 1, text: 'In the beginning God created the heaven',
        textTagged: 'In{} the{} beginning{H7225} God{H430} created{H1254} ~{H853} the{} heaven{H8064}' },
      onStrongsClick: () => {},
    }))
    expect(html).toContain('Genesis 1:1')
    for (const n of ['H7225', 'H430', 'H1254', 'H853', 'H8064']) expect(html).toContain(`aria-label="Open Strong&#x27;s ${n}"`)
    expect(html).not.toContain('No Strong')
  })

  it('untagged text shows the verse with a no-tagging note', () => {
    const html = renderToString(createElement(SelectedVerseBlock, {
      verse: { ...ref(4, 'lxx'), text: 'Speak not in thine heart', textTagged: null },
      onStrongsClick: () => {},
    }))
    expect(html).toContain('Speak not in thine heart')
    expect(html).toContain('No Strong')
  })
})
