import { describe, it, expect } from 'vitest'
import { getWordWindow, normalizeBookQuery, extractGlossWords, findMatchWordIndices, mapDisplayOffsetToOriginal, mapOriginalOffsetToDisplay, buildVerseDisplayText, getAnnotationRanges } from '../verseUtils'

// ─── getAnnotationRanges ───────────────────────────────────────────────────────

describe('getAnnotationRanges', () => {
  it('returns [] when there is no tagged text or the text is not kjva/lxx', () => {
    expect(getAnnotationRanges(undefined, 'kjva')).toEqual([])
    expect(getAnnotationRanges('word{}', 'enoch')).toEqual([])
  })

  it('marks red-letter (Yeshua\'s words) tokens with correct char ranges', () => {
    // Luke 22:8 — "Go and prepare..." onward is red-letter (Yeshua speaking)
    const text = 'And he sent Peter and John, saying, Go and prepare us the passover, that we may eat.'
    const tagged = 'And{G2532} he{} sent{G649} Peter{G4074} and{G2532} John,{G2491} saying,{G2036} !Go{G4198} !and{} !prepare{G2090} !us{G2254} !the{G3588} !passover,{G3957} !that{G2443} !we{} !may{G5315} !eat.{G5315}'
    const ranges = getAnnotationRanges(tagged, 'kjva')
    const redLetterRanges = ranges.filter((r) => r.isRedLetter)
    expect(redLetterRanges.length).toBeGreaterThan(0)
    const goStart = text.indexOf('Go')
    const goRange = redLetterRanges.find((r) => r.start === goStart)
    expect(goRange).toBeDefined()
    expect(text.slice(goRange!.start, goRange!.end)).toBe('Go')
  })

  it('marks italic (KJV translator-supplied) tokens with correct char ranges', () => {
    const text = 'God is a Spirit'
    const tagged = 'God{H430} is{} *a{} Spirit{H4151}'
    const ranges = getAnnotationRanges(tagged, 'kjva')
    const italicRanges = ranges.filter((r) => r.isItalic)
    expect(italicRanges).toHaveLength(1)
    expect(text.slice(italicRanges[0].start, italicRanges[0].end)).toBe('a')
  })
})

// ─── getWordWindow ─────────────────────────────────────────────────────────────

describe('getWordWindow', () => {
  it('returns null when no match indices provided', () => {
    expect(getWordWindow('The quick brown fox', [])).toBeNull()
    expect(getWordWindow('The quick brown fox', undefined)).toBeNull()
  })

  it('returns null when first match is within first 10 words (no windowing needed)', () => {
    const text = 'In the beginning God created the heavens and the earth'
    // word index 2 = "beginning" — within first 10 words
    expect(getWordWindow(text, [2])).toBeNull()
    expect(getWordWindow(text, [0])).toBeNull()
    expect(getWordWindow(text, [9])).toBeNull()
  })

  it('returns a windowed text when match is at index >= 10', () => {
    const words = Array.from({ length: 30 }, (_, i) => `word${i}`)
    const text = words.join(' ')
    const result = getWordWindow(text, [15])
    expect(result).not.toBeNull()
    expect(result!.windowText).toContain('…')
    expect(result!.windowText).toContain('word15')
  })

  it('includes 3 words before the match in the window', () => {
    const words = Array.from({ length: 30 }, (_, i) => `w${i}`)
    const text = words.join(' ')
    const result = getWordWindow(text, [15])!
    // Window starts at 15 - 3 = 12, so w12, w13, w14, w15 should appear
    expect(result.windowText).toContain('w12')
    expect(result.windowText).toContain('w15')
  })

  it('adjusts window match indices relative to the window', () => {
    const words = Array.from({ length: 30 }, (_, i) => `w${i}`)
    const text = words.join(' ')
    // match at word 15; window starts at 12; hasPrefix=true (offset=1)
    // relIdx = 15 - 12 + 1 = 4
    const result = getWordWindow(text, [15])!
    expect(result.windowMatchIndices).toContain(4)
  })

  it('handles multiple match indices, filtering those inside the window', () => {
    const words = Array.from({ length: 50 }, (_, i) => `w${i}`)
    const text = words.join(' ')
    // matches at 5 (outside window for first match at 20), 20, 25
    const result = getWordWindow(text, [20, 25])!
    expect(result.windowMatchIndices.length).toBe(2)
  })

  it('omits suffix ellipsis when window reaches the end', () => {
    const words = Array.from({ length: 15 }, (_, i) => `w${i}`)
    const text = words.join(' ')
    const result = getWordWindow(text, [12])!
    // windowEnd = min(15, 12-3+14) = 15 = words.length → no suffix
    expect(result.windowText.endsWith('…')).toBe(false)
  })
})

// ─── normalizeBookQuery ────────────────────────────────────────────────────────

describe('normalizeBookQuery', () => {
  it('converts Roman numeral I prefix to 1', () => {
    expect(normalizeBookQuery('i sam')).toBe('1 sam')
    expect(normalizeBookQuery('I Samuel')).toBe('1 Samuel')
  })

  it('converts Roman numeral II prefix to 2', () => {
    expect(normalizeBookQuery('ii cor')).toBe('2 cor')
    expect(normalizeBookQuery('II Kings')).toBe('2 Kings')
  })

  it('converts Roman numeral III prefix to 3', () => {
    expect(normalizeBookQuery('iii john')).toBe('3 john')
    expect(normalizeBookQuery('III John')).toBe('3 John')
  })

  it('leaves already-numeric prefixes unchanged', () => {
    expect(normalizeBookQuery('1 samuel')).toBe('1 samuel')
    expect(normalizeBookQuery('2 kings')).toBe('2 kings')
  })

  it('leaves non-prefixed book names unchanged', () => {
    expect(normalizeBookQuery('genesis')).toBe('genesis')
    expect(normalizeBookQuery('matthew')).toBe('matthew')
    expect(normalizeBookQuery('isaiah')).toBe('isaiah')
  })

  it('does not match "i" followed by another letter (no false positive on "isaiah", "in")', () => {
    expect(normalizeBookQuery('isaiah')).toBe('isaiah')
    expect(normalizeBookQuery('in the beginning')).toBe('in the beginning')
  })
})

// ─── extractGlossWords ────────────────────────────────────────────────────────

describe('extractGlossWords', () => {
  it('extracts words of length >= 4', () => {
    const words = extractGlossWords('beginning, chief')
    expect(words).toContain('beginning')
    expect(words).toContain('chief')
  })

  it('strips parenthetical content', () => {
    const words = extractGlossWords('grace (as a gift), favour')
    expect(words).not.toContain('gift')
    expect(words).toContain('grace')
    expect(words).toContain('favour')
  })

  it('strips special characters', () => {
    const words = extractGlossWords('love × affection')
    expect(words).toContain('love')
    expect(words).toContain('affection')
  })

  it('filters out words shorter than 4 chars', () => {
    const words = extractGlossWords('go, run, walk, flee')
    expect(words).not.toContain('go')
    expect(words).not.toContain('run')
    expect(words).toContain('walk')
    expect(words).toContain('flee')
  })

  it('returns empty array for empty input', () => {
    expect(extractGlossWords('')).toEqual([])
  })
})

// ─── findMatchWordIndices ─────────────────────────────────────────────────────

describe('findMatchWordIndices', () => {
  it('finds indices from text_tagged primary path', () => {
    const tagged = 'For{G1063} by{G5485} grace{G5485} are{G2075}'
    const indices = findMatchWordIndices(tagged, '', 'G5485', [])
    expect(indices).toEqual([1, 2])
  })

  it('handles Hebrew tags', () => {
    const tagged = 'In{} the{} beginning{H7225} God{H430}'
    const indices = findMatchWordIndices(tagged, '', 'H7225', [])
    expect(indices).toEqual([2])
  })

  it('handles italic-prefixed tokens (* prefix)', () => {
    const tagged = '*that{} ye{G5210} might{G3588}'
    const indices = findMatchWordIndices(tagged, '', 'G5210', [])
    expect(indices).toEqual([1])
  })

  it('falls back to gloss-word matching when text_tagged is null', () => {
    const plain = 'For by grace are ye saved through faith'
    const fallback = ['grace', 'favour']
    const indices = findMatchWordIndices(null, plain, 'G5485', fallback)
    expect(indices).toContain(2) // "grace" is at index 2
  })

  it('falls back to gloss-word matching when text_tagged has no matching tag', () => {
    const tagged = 'For{G1063} by{} *grace{} are{G2075}'
    const plain = 'For by grace are ye saved'
    const fallback = ['grace', 'favour']
    const indices = findMatchWordIndices(tagged, plain, 'G5485', fallback)
    // tagged has no G5485 → falls back to gloss match on "grace" at index 2
    expect(indices).toContain(2)
  })

  it('matches plural form via +s rule', () => {
    const plain = 'These are the works of righteousness'
    const fallback = ['work']
    const indices = findMatchWordIndices(null, plain, 'G2041', fallback)
    expect(indices).toContain(3) // "works" matches fallback word "work" + s
  })

  it('returns empty array when no text_tagged and no fallback match', () => {
    const plain = 'In the beginning God created'
    const indices = findMatchWordIndices(null, plain, 'H1234', [])
    expect(indices).toEqual([])
  })

  it('is case-insensitive for the strongs number', () => {
    const tagged = 'grace{G5485}'
    expect(findMatchWordIndices(tagged, '', 'g5485', [])).toEqual([0])
    expect(findMatchWordIndices(tagged, '', 'G5485', [])).toEqual([0])
  })
})

// ─── mapDisplayOffsetToOriginal ────────────────────────────────────────────────

describe('mapDisplayOffsetToOriginal', () => {
  it('returns the same offset when display === original', () => {
    const t = 'he hath bid his guests'
    for (let i = 0; i <= t.length; i++) expect(mapDisplayOffsetToOriginal(t, t, i)).toBe(i)
  })

  it('maps offsets after a longer replacement back to the original', () => {
    // "LORD" (4) → "Yehovah" (7): everything after gains +3 in display
    const orig = 'the LORD hath bid'      // indices: the=0-3, LORD=4-8, hath=9-13, bid=14-17
    const disp = 'the Yehovah hath bid'   // the=0-3, Yehovah=4-11, hath=12-16, bid=17-20
    // Start of "hath" in display is index 12 → should map to index 9 in original
    expect(mapDisplayOffsetToOriginal(disp, orig, 12)).toBe(9)
    // Start of "bid" in display is 17 → original 14
    expect(mapDisplayOffsetToOriginal(disp, orig, 17)).toBe(14)
    // End (after "bid") display 20 → original 17
    expect(mapDisplayOffsetToOriginal(disp, orig, 20)).toBe(17)
  })

  it('the reported Zeph 1:7 case: selecting "he hath bid his guests" keeps "he"', () => {
    // Two LORD→Yehovah replacements before the selection (+6 total)
    const orig = 'the LORD prepared the LORD he hath bid his guests'
    const disp = 'the Yehovah prepared the Yehovah he hath bid his guests'
    const heDisp = disp.indexOf('he hath')       // start of "he" in display
    const heOrig = orig.indexOf('he hath')        // start of "he" in original
    expect(mapDisplayOffsetToOriginal(disp, orig, heDisp)).toBe(heOrig)
    // end (after "guests")
    expect(mapDisplayOffsetToOriginal(disp, orig, disp.length)).toBe(orig.length)
  })

  it('words before the first replacement are unaffected', () => {
    const orig = 'the LORD is good'
    const disp = 'the Yehovah is good'
    expect(mapDisplayOffsetToOriginal(disp, orig, 0)).toBe(0)
    expect(mapDisplayOffsetToOriginal(disp, orig, 3)).toBe(3) // end of "the"
  })

  it('maps a replaced-word boundary to the original word start/end', () => {
    const orig = 'a LORD b'   // LORD: 2-6
    const disp = 'a Yehovah b' // Yehovah: 2-9
    // start of "Yehovah" (2) → start of "LORD" (2); end of "Yehovah" (9) → ~end of "LORD" (6)
    expect(mapDisplayOffsetToOriginal(disp, orig, 2)).toBe(2)
    expect(mapDisplayOffsetToOriginal(disp, orig, 9)).toBe(6)
    // "b" (matched word) stays exact
    expect(mapDisplayOffsetToOriginal(disp, orig, 10)).toBe(7) // start of "b"
  })

  it('maps the space between words correctly', () => {
    const orig = 'the LORD hath'
    const disp = 'the Yehovah hath'
    // the space before "hath": display index 11 → original index 8
    expect(mapDisplayOffsetToOriginal(disp, orig, 11)).toBe(8)
  })

  it('CASE: annotation hiding (deleted word) — offsets after the gap stay aligned', () => {
    const orig = 'a b c d'   // b deleted in display
    const disp = 'a c d'
    expect(mapDisplayOffsetToOriginal(disp, orig, 0)).toBe(0)        // "a"
    expect(mapDisplayOffsetToOriginal(disp, orig, 2)).toBe(4)        // start of "c" → orig "c" at 4
    expect(mapDisplayOffsetToOriginal(disp, orig, 4)).toBe(6)        // start of "d" → orig "d" at 6
    expect(mapDisplayOffsetToOriginal(disp, orig, disp.length)).toBe(orig.length)
  })

  it('CASE: replacement AND deletion combined', () => {
    const orig = 'the LORD supplied bread here' // "supplied" deleted, LORD→Yehovah
    const disp = 'the Yehovah bread here'
    // "bread" is a matched word — its start must map exactly
    expect(mapDisplayOffsetToOriginal(disp, orig, disp.indexOf('bread'))).toBe(orig.indexOf('bread'))
    expect(mapDisplayOffsetToOriginal(disp, orig, disp.indexOf('here'))).toBe(orig.indexOf('here'))
  })

  it('CASE: multi-word phrase replacement ("jesus christ" → "Yeshua Messiah")', () => {
    const orig = 'follow jesus christ today'
    const disp = 'follow Yeshua Messiah today'
    // "follow" and "today" are matched → exact boundaries
    expect(mapDisplayOffsetToOriginal(disp, orig, 0)).toBe(0)
    expect(mapDisplayOffsetToOriginal(disp, orig, disp.indexOf('today'))).toBe(orig.indexOf('today'))
  })

  it('CASE: offset 0 and offset at/over length clamp correctly', () => {
    expect(mapDisplayOffsetToOriginal('Yehovah x', 'LORD x', 0)).toBe(0)
    expect(mapDisplayOffsetToOriginal('Yehovah x', 'LORD x', 999)).toBe('LORD x'.length)
    expect(mapDisplayOffsetToOriginal('Yehovah x', 'LORD x', -5)).toBe(0)
  })

  it('CASE: no common words → proportional fallback (never throws / stays in range)', () => {
    const r = mapDisplayOffsetToOriginal('xx yy', 'aaaa bbbb', 3)
    expect(r).toBeGreaterThanOrEqual(0)
    expect(r).toBeLessThanOrEqual('aaaa bbbb'.length)
  })
})

// ─── mapOriginalOffsetToDisplay (inverse — used to paint stored highlights) ─────

describe('mapOriginalOffsetToDisplay', () => {
  it('identity when texts are equal', () => {
    const t = 'he hath bid his guests'
    for (let i = 0; i <= t.length; i++) expect(mapOriginalOffsetToDisplay(t, t, i)).toBe(i)
  })

  it('maps an original-text highlight onto the longer replaced display text', () => {
    const orig = 'the LORD hath bid'
    const disp = 'the Yehovah hath bid'
    // "hath" starts at 9 in original → 12 in display
    expect(mapOriginalOffsetToDisplay(disp, orig, 9)).toBe(12)
    // "bid" 14 → 17
    expect(mapOriginalOffsetToDisplay(disp, orig, 14)).toBe(17)
  })

  it('maps a highlight onto display text that hid a word (deletion)', () => {
    const orig = 'a b c d' // b hidden
    const disp = 'a c d'
    // "c" at original 4 → display 2; "d" at original 6 → display 4
    expect(mapOriginalOffsetToDisplay(disp, orig, 4)).toBe(2)
    expect(mapOriginalOffsetToDisplay(disp, orig, 6)).toBe(4)
  })

  it('round-trips matched-word boundaries (display→orig→display)', () => {
    const orig = 'the LORD prepared a feast for guests'
    const disp = 'the Yehovah prepared a feast for guests'
    for (const w of ['prepared', 'feast', 'for', 'guests']) {
      const dPos = disp.indexOf(w)
      const oPos = mapDisplayOffsetToOriginal(disp, orig, dPos)
      expect(mapOriginalOffsetToDisplay(disp, orig, oPos)).toBe(dPos)
    }
  })

  it('clamps out-of-range offsets', () => {
    expect(mapOriginalOffsetToDisplay('Yehovah', 'LORD', -1)).toBe(0)
    expect(mapOriginalOffsetToDisplay('Yehovah', 'LORD', 99)).toBe('Yehovah'.length)
  })
})

describe('buildVerseDisplayText + selection mapping (2 Kings 23:7 LORD→Yehovah, "the" suppressed)', () => {
  const tagged = 'And{} he{} brake{} down{H5422} ~{H853} the{} houses{H1004} of{} the{} sodomites,{H6945} that{H834} *were{} by{} the{} house{H1004} of{} the{} LORD,{H3068} where{H834|H8033} the{} women{H802} wove{H707} hangings{H1004} for{} the{} grove.{H842}'
  const original = 'And he brake down the houses of the sodomites, that were by the house of the LORD, where the women wove hangings for the grove.'
  const rules = [{ id: 'h3068', queries: [], strongsNum: 'H3068', replacement: 'Yehovah', wholeWord: false, enabled: true }]

  it('produces the on-screen text with "the" suppressed and LORD→Yehovah', () => {
    const disp = buildVerseDisplayText(original, tagged, 'kjva', true, rules)
    expect(disp).toContain('house of Yehovah, where the women wove hangings for the grove.')
    expect(disp).not.toContain('the LORD')
    expect(disp).not.toContain('the Yehovah')
  })

  it('maps a selection after the replacement to the exact original offsets', () => {
    const disp = buildVerseDisplayText(original, tagged, 'kjva', true, rules)
    const sel = 'wove hangings for the grove'
    const ds = disp.indexOf(sel)
    const de = ds + sel.length
    const os = mapDisplayOffsetToOriginal(disp, original, ds)
    const oe = mapDisplayOffsetToOriginal(disp, original, de)
    // The mapped range must be exactly the same words in the original (no leading-space / dropped-char drift)
    expect(original.slice(os, oe)).toBe(sel)
  })
})
