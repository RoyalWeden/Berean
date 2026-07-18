/**
 * buildVerseDisplayTokens — verifies the presenter view can render red-letter (Yeshua's
 * words) and KJV-italic words from KJVA text_tagged, with and without the word replacer.
 */
import { describe, it, expect } from 'vitest'
import { buildVerseDisplayTokens, buildVerseDisplayText } from '../verseUtils'
import type { WordReplacerRule } from '@/store'

const noRules: WordReplacerRule[] = []

// "And Jesus said, Follow me" with Yeshua's words red-lettered, "said" KJV-italic.
const tagged = 'And{H2532} !Jesus{G2424} *said{} !Follow{G190} !me{G3165}'
const plain = 'And Jesus said Follow me'

describe('buildVerseDisplayTokens — red-letter & italics', () => {
  it('flags red-letter and italic tokens for KJVA tagged text', () => {
    const toks = buildVerseDisplayTokens(plain, tagged, 'kjva', false, noRules)
    const byWord = Object.fromEntries(toks.map((t) => [t.word, t]))
    expect(byWord['And'].isRedLetter).toBe(false)
    expect(byWord['Jesus'].isRedLetter).toBe(true)
    expect(byWord['Follow'].isRedLetter).toBe(true)
    expect(byWord['me'].isRedLetter).toBe(true)
    expect(byWord['said'].isItalic).toBe(true)
    expect(byWord['said'].isRedLetter).toBe(false)
  })

  it('preserves red-letter flags even when the word replacer rewrites the word', () => {
    const rule: WordReplacerRule = { id: 'r1', queries: ['Jesus'], replacement: 'Yeshua', wholeWord: false, enabled: true }
    const toks = buildVerseDisplayTokens(plain, tagged, 'kjva', true, [rule])
    const yeshua = toks.find((t) => t.word === 'Yeshua')
    expect(yeshua).toBeDefined()
    expect(yeshua!.isRedLetter).toBe(true)
  })

  it('joined token words reproduce the display string for KJVA tagged', () => {
    const toks = buildVerseDisplayTokens(plain, tagged, 'kjva', false, noRules)
    expect(toks.map((t) => t.word).join(' ')).toBe(buildVerseDisplayText(plain, tagged, 'kjva', false, noRules) || plain)
  })

  it('returns a single non-styled token for non-KJVA / untagged text', () => {
    const toks = buildVerseDisplayTokens('In the beginning', null, 'lxx', false, noRules)
    expect(toks).toHaveLength(1)
    expect(toks[0]).toMatchObject({ word: 'In the beginning', isRedLetter: false, isItalic: false })
  })

  // A truthy-but-tokenless text_tagged (e.g. stray whitespace) must not collapse the
  // verse to an empty string / empty token list — fall back to the plain text.
  describe('tokenless-but-truthy text_tagged guard', () => {
    const PLAIN = 'All wisdom cometh from the Lord'

    // Space strings split to zero tokens; that's the tokenless case the guard targets.
    it.each(['   ', ' '])('buildVerseDisplayText falls back to plain for %j tagged', (tagged) => {
      expect(buildVerseDisplayText(PLAIN, tagged, 'kjva', true, [
        { id: 'r', queries: ['Lord'], replacement: 'Yehovah', wholeWord: true, enabled: true },
      ])).toContain('All wisdom cometh')
    })

    it('buildVerseDisplayTokens falls back to a single plain token for whitespace tagged', () => {
      const toks = buildVerseDisplayTokens(PLAIN, '   ', 'kjva', false, noRules)
      expect(toks).toHaveLength(1)
      expect(toks[0].word).toBe(PLAIN)
    })
  })
})
