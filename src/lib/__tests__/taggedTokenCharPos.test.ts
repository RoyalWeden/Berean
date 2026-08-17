/**
 * Regression test for the highlight/Strong's/Read-Aloud charPos drift bug.
 *
 * KJVA encodes a supplied-phrase Strong's alignment bracket as four tokens:
 *   sup>({}   /sup>{Gxxxx}   sup>){}   /sup>{}
 * The 2nd and 4th have an empty word but are NOT flagged `isStrongsBracket`, so callers keyed
 * only off `isParenthetical || isStrongsBracket` counted them as real words and advanced charPos
 * by 1 each — a +2 drift that misaligned every highlight, Strong's chip and Read-Aloud tint for
 * the rest of the verse. `tokenHasNoPlainText()` is the shared fix; both VerseRow.tsx's charPos
 * accumulation and extractSpokenText.ts's spoken-word builder consume it.
 *
 * The tagged strings below are verbatim from data/kjva.db.
 */
import { describe, it, expect } from 'vitest'
import { parseTaggedTokens, tokenHasNoPlainText } from '../taggedTokens'
import { buildSpokenWords } from '../tts/extractSpokenText'
import type { Verse } from '@/types'

/** Mirrors VerseRow.tsx's charPos accumulation; returns the total consumed char length. */
function accumulatedLength(tagged: string): number {
  let charPos = 0
  for (const t of parseTaggedTokens(tagged)) {
    if (!tokenHasNoPlainText(t)) charPos += t.word.length + 1 // word + trailing space
  }
  return Math.max(0, charPos - 1) // last token has no trailing space in verse.text
}

const cases: Array<{ ref: string; text: string; tagged: string }> = [
  {
    ref: 'John 7:41',
    text: 'Others said, This is the Christ. But some said, Shall Christ come out of Galilee?',
    tagged:
      'Others{G243} said,{G3004} This{G3778} is{G2076} the{G3588} Christ.{G5547} But{G1161} some{G243} said,{G3004} Shall{} sup>({} /sup>{G1063|G3361} sup>){} /sup>{} Christ{G5547} come{G2064} out{G1537} of{G1537} Galilee?{G1056}',
  },
  {
    ref: 'Acts 17:30',
    text: 'And the times of this ignorance God winked at; but now commandeth all men every where to repent:',
    tagged:
      'And{} sup>({} /sup>{G3767|G3303} sup>){} /sup>{} the{G3588} times{G5550} of{} this{} ignorance{G52} God{G2316} winked{G5237} at;{} but{} now{G3569} commandeth{G3853} all{G3956} men{G444} every{} where{G3837} to{} repent:{G3340}',
  },
  {
    ref: '1 Corinthians 7:20',
    text: 'Let every man abide in the same calling wherein he was called.',
    tagged:
      'Let{} every{} man{G1538} sup>({} /sup>{G1722|G5026} sup>){} /sup>{} abide{G3306} in{G1722} the{} same{G3588} calling{G2821} wherein{G3739} he{} was{} called.{G2564}',
  },
]
// Note: 19 of the 20 kjva.db verses carrying this pattern align exactly after the fix. The
// twentieth (1 Sam 23:28) is still off by one, but for an unrelated, known data-integrity reason
// tracked separately: its `text` spells "Sela–hammahlekoth" with an en dash while `text_tagged`
// has "Selahammahlekoth" — a text/text_tagged drift, not a token-classification bug.

describe('tokenHasNoPlainText — charPos alignment with verse.text', () => {
  for (const { ref, text, tagged } of cases) {
    it(`${ref}: accumulated charPos matches verse.text length`, () => {
      expect(accumulatedLength(tagged)).toBe(text.length)
    })
  }

  it('empty-word alignment tokens are excluded regardless of an attached Strong\'s number', () => {
    const tokens = parseTaggedTokens('sup>({} /sup>{G1063|G3361} sup>){} /sup>{}')
    expect(tokens).toHaveLength(4)
    expect(tokens.map(tokenHasNoPlainText)).toEqual([true, true, true, true])
    // The middle token carries a Strong's number but still contributes no plain text.
    expect(tokens[1].strongsNum).toEqual(['G1063', 'G3361'])
    expect(tokens[1].isStrongsBracket).toBe(false)
  })

  it('a real word with a Strong\'s number still counts as plain text', () => {
    const [t] = parseTaggedTokens('Christ{G5547}')
    expect(tokenHasNoPlainText(t)).toBe(false)
  })

  it('Read Aloud spoken words stay in sync with the rendered token list', () => {
    const { ref: _ref, text, tagged } = cases[0]
    const verse = { text, text_tagged: tagged } as Verse
    const { words, spokenText } = buildSpokenWords(verse)
    // No empty spoken slots from the alignment brackets, and the flat spoken text matches the
    // verse's own plain text exactly.
    expect(words.some((w) => w.text === '')).toBe(false)
    expect(spokenText).toBe(text)
    const last = words[words.length - 1]
    expect(last.charStart + last.charLen).toBe(text.length)
  })
})
