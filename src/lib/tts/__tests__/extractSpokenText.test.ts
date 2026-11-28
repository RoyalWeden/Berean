import { describe, it, expect } from 'vitest'
import { buildSpokenWords } from '../extractSpokenText'
import type { Verse } from '@/types'
import type { WordReplacerRule } from '@/store'

// Regression coverage: "the LORD" -> Yehovah should be SPOKEN as "Yehovuh", matching what
// VerseRow.tsx already shows on screen (it suppresses the preceding "the"/"The" token when a
// Strong's-number rule replaces the word right after it) — extractSpokenText.ts didn't replicate
// that suppression at all, so Read Aloud kept saying "the Yehovah" out loud.

const DIVINE_NAME_RULE: WordReplacerRule = {
  id: 'strongs-h3068', queries: [], strongsNum: 'H3068', replacement: 'Yehovuh', wholeWord: false, enabled: true,
}

function verse(text: string, tagged: string): Verse {
  return { verse_num: 1, book_id: 'exo', chapter: 3, text, text_tagged: tagged }
}

describe('buildSpokenWords — divine-name Strong\'s replacement drops a preceding bare "the"', () => {
  it('plain text returns prepared speech and preserves the spacing used by word offsets', () => {
    const v = verse('  Jesus  said 40 words—then. ', '')
    const rules: WordReplacerRule[] = [{ id: 'name', queries: ['Jesus'], replacement: 'Yeshua', wholeWord: true, enabled: true }]
    const { words, spokenText } = buildSpokenWords(v, rules)
    expect(spokenText).toBe('  Yeshuwa  said forty words,then. ')
    expect(words.map(w => w.wordIndex)).toEqual([2, 4, 5, 6])
    for (const word of words) {
      expect(spokenText.slice(word.charStart, word.charStart + word.charLen)).toBe(word.text)
    }
  })
  it('"the LORD said" is spoken as "Yehovah said", not "the Yehovah said"', () => {
    const v = verse('the LORD said', 'the{} LORD{H3068} said{}')
    const { spokenText } = buildSpokenWords(v, [DIVINE_NAME_RULE])
    expect(spokenText).not.toContain('the Yehovah')
    expect(spokenText.trim().replace(/\s+/g, ' ')).toBe('Yehovuh said')
  })

  it('capitalized sentence-initial "The LORD" is also spoken as just "Yehovuh"', () => {
    const v = verse('The LORD is my shepherd', 'The{} LORD{H3068} is{} my{} shepherd{}')
    const { spokenText } = buildSpokenWords(v, [DIVINE_NAME_RULE])
    expect(spokenText.trim().replace(/\s+/g, ' ')).toBe('Yehovuh is my shepherd')
  })

  it('wordIndex numbering stays stable (slot kept, not removed) so it still lines up with VerseRow\'s own spokenIndex numbering', () => {
    const v = verse('the LORD said', 'the{} LORD{H3068} said{}')
    const { words } = buildSpokenWords(v, [DIVINE_NAME_RULE])
    expect(words.map(w => w.wordIndex)).toEqual([0, 1, 2])
    expect(words[0].text).toBe('') // "the" — blanked, not removed
    expect(words[1].text).toBe('Yehovuh')
    expect(words[2].text).toBe('said')
  })

  it('an UNRELATED preceding "the" (no adjacent Strong\'s replacement) is left alone', () => {
    const v = verse('the earth was void', 'the{} earth{} was{} void{}')
    const { spokenText } = buildSpokenWords(v, [DIVINE_NAME_RULE])
    expect(spokenText.trim().replace(/\s+/g, ' ')).toBe('the earth was void')
  })

  it('does nothing when no Strong\'s-number rule is enabled (plain text-pattern rules only)', () => {
    const v = verse('the LORD said', 'the{} LORD{H3068} said{}')
    const { spokenText } = buildSpokenWords(v, [])
    expect(spokenText.trim().replace(/\s+/g, ' ')).toBe('the LORD said')
  })
})
