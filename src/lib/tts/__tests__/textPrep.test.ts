import { describe, it, expect } from 'vitest'
import { applyPronunciation, numberToWords, expandNumbers, expandAbbreviation, normalizePunctuation, prepareWordForSpeech } from '../textPrep'

describe('numberToWords', () => {
  it('spells small cardinals', () => {
    expect(numberToWords(0)).toBe('zero')
    expect(numberToWords(7)).toBe('seven')
    expect(numberToWords(19)).toBe('nineteen')
  })

  it('spells tens with hyphenation', () => {
    expect(numberToWords(20)).toBe('twenty')
    expect(numberToWords(21)).toBe('twenty-one')
    expect(numberToWords(99)).toBe('ninety-nine')
  })

  it('spells hundreds', () => {
    expect(numberToWords(100)).toBe('one hundred')
    expect(numberToWords(120)).toBe('one hundred and twenty')
    expect(numberToWords(365)).toBe('three hundred and sixty-five')
  })

  it('spells thousands/millions/billions, recursing on the remainder', () => {
    expect(numberToWords(1000)).toBe('one thousand')
    expect(numberToWords(2005)).toBe('two thousand and five')
    expect(numberToWords(70000)).toBe('seventy thousand')
    expect(numberToWords(1_000_000)).toBe('one million')
    expect(numberToWords(1_000_000_000)).toBe('one billion')
  })

  it('renders the last word as an ordinal when requested', () => {
    expect(numberToWords(1, true)).toBe('first')
    expect(numberToWords(42, true)).toBe('forty-second')
    expect(numberToWords(100, true)).toBe('one hundredth')
  })

  it('handles negatives', () => {
    expect(numberToWords(-5)).toBe('negative five')
  })
})

describe('expandNumbers', () => {
  it('expands a plain cardinal token', () => {
    expect(expandNumbers('40')).toBe('forty')
    expect(expandNumbers('700')).toBe('seven hundred')
  })

  it('expands an ordinal token (1st, 2nd, 3rd, 4th)', () => {
    expect(expandNumbers('1st')).toBe('first')
    expect(expandNumbers('2nd')).toBe('second')
    expect(expandNumbers('3rd')).toBe('third')
    expect(expandNumbers('42nd')).toBe('forty-second')
  })

  it('preserves surrounding punctuation/brackets', () => {
    expect(expandNumbers('40,')).toBe('forty,')
    expect(expandNumbers('(40)')).toBe('(forty)')
    expect(expandNumbers('40.')).toBe('forty.')
  })

  it('handles thousands-separated numerals', () => {
    expect(expandNumbers('1,000')).toBe('one thousand')
    expect(expandNumbers('2,005')).toBe('two thousand and five')
  })

  it('reads decimals digit-by-digit after "point"', () => {
    expect(expandNumbers('3.5')).toBe('three point five')
    expect(expandNumbers('3.14')).toBe('three point one four')
  })

  it('leaves non-numeric tokens untouched', () => {
    expect(expandNumbers('Yehovah')).toBe('Yehovah')
    expect(expandNumbers('H7225')).toBe('H7225')
  })

  it('leaves absurdly large numbers as digits rather than guessing', () => {
    const huge = '9999999999999'
    expect(expandNumbers(huge)).toBe(huge)
  })
})

describe('expandAbbreviation', () => {
  it('expands known abbreviations', () => {
    expect(expandAbbreviation('etc.')).toBe('et cetera')
    expect(expandAbbreviation('cf.')).toBe('compare')
    expect(expandAbbreviation('vs.')).toBe('versus')
  })

  it('reapplies sentence-initial capitalization', () => {
    expect(expandAbbreviation('Dr.')).toBe('Doctor')
    expect(expandAbbreviation('dr.')).toBe('doctor')
  })

  it('preserves a leading bracket/quote', () => {
    expect(expandAbbreviation('(cf.')).toBe('(compare')
  })

  it('leaves unrecognized tokens untouched', () => {
    expect(expandAbbreviation('beginning')).toBe('beginning')
  })
})

describe('normalizePunctuation', () => {
  it('turns em/en dashes into a pause comma', () => {
    expect(normalizePunctuation('earth—and')).toBe('earth,and')
    expect(normalizePunctuation('earth–and')).toBe('earth,and')
  })

  it('turns ellipsis into a pause comma', () => {
    expect(normalizePunctuation('wait...')).toBe('wait,')
    expect(normalizePunctuation('wait…')).toBe('wait,')
  })

  it('collapses repeated punctuation', () => {
    expect(normalizePunctuation('what!!')).toBe('what!')
    expect(normalizePunctuation('really??')).toBe('really?')
  })

  it('normalizes curly quotes to straight', () => {
    expect(normalizePunctuation('‘hello’')).toBe("'hello'")
    expect(normalizePunctuation('“hello”')).toBe('"hello"')
  })

  it('passes through plain tokens unchanged', () => {
    expect(normalizePunctuation('beginning')).toBe('beginning')
  })
})

describe('prepareWordForSpeech (combined entry point)', () => {
  it('expands abbreviations before falling through to punctuation cleanup', () => {
    expect(prepareWordForSpeech('etc.')).toBe('et cetera')
  })

  it('expands numbers when the token is not an abbreviation', () => {
    expect(prepareWordForSpeech('40')).toBe('forty')
  })

  it('normalizes punctuation on ordinary words', () => {
    expect(prepareWordForSpeech('flood—soon')).toBe('flood,soon')
  })

  it('never alters an ordinary word with no digits/abbreviation/special punctuation', () => {
    expect(prepareWordForSpeech('beginning.')).toBe('beginning.')
    expect(prepareWordForSpeech('everlasting')).toBe('everlasting')
  })
})

describe('applyPronunciation — divine-name respelling (spoken output only)', () => {
  // These change only how the word is VOICED. The word-replacer's own substitution (LORD →
  // Yehovah) is theological and settled upstream in extractSpokenText.ts; this layer exists
  // solely because Kokoro phonemizes English SPELLING, so the only way to fix an over-articulated
  // final syllable ("-vah" rhyming with "spa") is to spell it the way it should sound.
  it('respells Yehovah so the final syllable is a schwa (Yeh-ho-vuh)', () => {
    expect(applyPronunciation('Yehovah')).toBe('Yehovuh')
  })

  it('matches regardless of case', () => {
    expect(applyPronunciation('YEHOVAH')).toBe('Yehovuh')
    expect(applyPronunciation('yehovah')).toBe('Yehovuh')
  })

  it('preserves trailing punctuation, so sentence rhythm and chunk boundaries survive', () => {
    expect(applyPronunciation('Yehovah,')).toBe('Yehovuh,')
    expect(applyPronunciation('Yehovah.')).toBe('Yehovuh.')
    expect(applyPronunciation('Yehovah;')).toBe('Yehovuh;')
  })

  it('preserves leading punctuation', () => {
    expect(applyPronunciation('(Yehovah')).toBe('(Yehovuh')
  })

  it('handles the possessive', () => {
    expect(applyPronunciation("Yehovah's")).toBe("Yehovuh's")
  })

  it('respells Yeshua to a tighter two-beat "Ye-shua" sound', () => {
    expect(applyPronunciation('Yeshua')).toBe('Yeshwuh')
    expect(applyPronunciation("Yeshua's")).toBe("Yeshwuh's")
  })

  it('leaves ordinary words untouched', () => {
    expect(applyPronunciation('beginning')).toBe('beginning')
    expect(applyPronunciation('heavens.')).toBe('heavens.')
  })
})
