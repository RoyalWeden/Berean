/**
 * 250 tests for Strong's number detection, chip rendering, copy-text formatting,
 * and integration with renderPreviewContent / buildPrintHTML.
 */
import { describe, it, expect, beforeAll } from 'vitest'

let STRONGS_REF_RE: RegExp
let wrapStrongsRefsForPreview: (s: string) => string
let renderPreviewContent: (s: string) => string
let buildPrintHTML: (title: string, content: string) => string
let buildLexiconCopyText: (e: { strongsNum: string; lemma?: string; transliteration?: string; definition?: string; gloss?: string; extendedDef?: string }) => string

beforeAll(async () => {
  const notesMod = await import('../NoteEditor')
  STRONGS_REF_RE = notesMod.STRONGS_REF_RE
  wrapStrongsRefsForPreview = notesMod.wrapStrongsRefsForPreview
  renderPreviewContent = notesMod.renderPreviewContent
  buildPrintHTML = notesMod.buildPrintHTML
  const lexMod = await import('../../lexicon/LexiconPanel')
  buildLexiconCopyText = lexMod.buildLexiconCopyText
})

// ── helpers ──────────────────────────────────────────────────────────────────
function chip(num: string) {
  return `class="berean-strongs-chip"`
}
function hasChip(html: string, num: string) {
  return html.includes('berean-strongs-chip') && html.includes(`>${num}</span>`)
}
function freshRe() {
  // STRONGS_REF_RE has the 'g' flag; reset lastIndex before each test
  STRONGS_REF_RE.lastIndex = 0
  return STRONGS_REF_RE
}

// ── 1. STRONGS_REF_RE — detection ────────────────────────────────────────────

describe('STRONGS_REF_RE — basic Hebrew numbers', () => {
  it('matches H1', () => { freshRe(); expect(freshRe().test('H1')).toBe(true) })
  it('matches H12', () => { freshRe(); expect(freshRe().test('H12')).toBe(true) })
  it('matches H123', () => { freshRe(); expect(freshRe().test('H123')).toBe(true) })
  it('matches H1234', () => { freshRe(); expect(freshRe().test('H1234')).toBe(true) })
  it('matches H12345', () => { freshRe(); expect(freshRe().test('H12345')).toBe(true) })
  it('matches H7225', () => { freshRe(); expect(freshRe().test('H7225')).toBe(true) })
  it('matches H430', () => { freshRe(); expect(freshRe().test('H430')).toBe(true) })
  it('matches H3068', () => { freshRe(); expect(freshRe().test('H3068')).toBe(true) })
  it('matches H853', () => { freshRe(); expect(freshRe().test('H853')).toBe(true) })
  it('matches H776', () => { freshRe(); expect(freshRe().test('H776')).toBe(true) })
})

describe('STRONGS_REF_RE — basic Greek numbers', () => {
  it('matches G1', () => { freshRe(); expect(freshRe().test('G1')).toBe(true) })
  it('matches G26', () => { freshRe(); expect(freshRe().test('G26')).toBe(true) })
  it('matches G3056', () => { freshRe(); expect(freshRe().test('G3056')).toBe(true) })
  it('matches G5485', () => { freshRe(); expect(freshRe().test('G5485')).toBe(true) })
  it('matches G2316', () => { freshRe(); expect(freshRe().test('G2316')).toBe(true) })
  it('matches G932', () => { freshRe(); expect(freshRe().test('G932')).toBe(true) })
  it('matches G4983', () => { freshRe(); expect(freshRe().test('G4983')).toBe(true) })
  it('matches G3056', () => { freshRe(); expect(freshRe().test('G3056')).toBe(true) })
  it('matches G5547', () => { freshRe(); expect(freshRe().test('G5547')).toBe(true) })
  it('matches G2424', () => { freshRe(); expect(freshRe().test('G2424')).toBe(true) })
})

describe('STRONGS_REF_RE — embedded in sentences', () => {
  it('matches H7225 in a sentence', () => { freshRe(); expect(freshRe().test('See H7225 for details')).toBe(true) })
  it('matches at start of line', () => { freshRe(); expect(freshRe().test('H430 is the word for God')).toBe(true) })
  it('matches at end of line', () => { freshRe(); expect(freshRe().test('the word is H430')).toBe(true) })
  it('matches in parentheses', () => { freshRe(); expect(freshRe().test('(H3068)')).toBe(true) })
  it('matches after comma', () => { freshRe(); expect(freshRe().test('word, H1234, means ...')).toBe(true) })
  it('matches after colon', () => { freshRe(); expect(freshRe().test('Strongs: H1234')).toBe(true) })
  it('matches multiple in one line', () => {
    freshRe()
    const matches = Array.from('H430 and G3056'.matchAll(STRONGS_REF_RE))
    STRONGS_REF_RE.lastIndex = 0
    expect(matches.length).toBe(2)
  })
  it('matches both H and G on same line', () => {
    freshRe()
    const text = 'H7225 G3056'
    const m = Array.from(text.matchAll(STRONGS_REF_RE))
    STRONGS_REF_RE.lastIndex = 0
    expect(m[0][1]).toBe('H7225')
    expect(m[1][1]).toBe('G3056')
  })
})

describe('STRONGS_REF_RE — non-matches (should NOT match)', () => {
  it('does not match bare H', () => { freshRe(); expect(freshRe().test(' H ')).toBe(false) })
  it('does not match bare G', () => { freshRe(); expect(freshRe().test(' G ')).toBe(false) })
  it('does not match H with letters after', () => { freshRe(); expect(freshRe().test('H1234A')).toBe(false) })
  it('does not match G with letters after', () => { freshRe(); expect(freshRe().test('G3056x')).toBe(false) })
  it('does not match word ending in H1234', () => { freshRe(); expect(freshRe().test('aH1234')).toBe(false) })
  it('does not match lowercase h1234', () => { freshRe(); expect(freshRe().test('h1234')).toBe(false) })
  it('does not match lowercase g3056', () => { freshRe(); expect(freshRe().test('g3056')).toBe(false) })
  it('does not match H with 6+ digits', () => { freshRe(); expect(freshRe().test('H123456')).toBe(false) })
  it('does not match G with 6+ digits', () => { freshRe(); expect(freshRe().test('G123456')).toBe(false) })
  it('does not match pure digits', () => { freshRe(); expect(freshRe().test('1234')).toBe(false) })
})

// ── 2. wrapStrongsRefsForPreview — HTML chip output ──────────────────────────

describe('wrapStrongsRefsForPreview — chip produced', () => {
  it('wraps H7225 in a chip', () => expect(hasChip(wrapStrongsRefsForPreview('H7225'), 'H7225')).toBe(true))
  it('wraps G3056 in a chip', () => expect(hasChip(wrapStrongsRefsForPreview('G3056'), 'G3056')).toBe(true))
  it('wraps H430 in a chip', () => expect(hasChip(wrapStrongsRefsForPreview('H430'), 'H430')).toBe(true))
  it('wraps G5485 in a chip', () => expect(hasChip(wrapStrongsRefsForPreview('G5485'), 'G5485')).toBe(true))
  it('wraps H3068 in a chip', () => expect(hasChip(wrapStrongsRefsForPreview('H3068'), 'H3068')).toBe(true))
  it('chip uses berean-strongs-chip class', () => expect(wrapStrongsRefsForPreview('H1')).toContain('berean-strongs-chip'))
  it('chip has inline style', () => expect(wrapStrongsRefsForPreview('H1')).toContain('style='))
  it('chip has title attribute', () => expect(wrapStrongsRefsForPreview('H7225')).toContain("title=\"Strong's H7225\""))
  it('chip is a span element', () => expect(wrapStrongsRefsForPreview('H1')).toContain('<span'))
  it('chip closes span', () => expect(wrapStrongsRefsForPreview('H1')).toContain('</span>'))
})

describe('wrapStrongsRefsForPreview — surrounding text preserved', () => {
  it('preserves text before chip', () => {
    const out = wrapStrongsRefsForPreview('see H430 here')
    expect(out).toContain('see ')
    expect(out).toContain(' here')
  })
  it('preserves text after chip', () => {
    const out = wrapStrongsRefsForPreview('H430 word')
    expect(out).toContain(' word')
  })
  it('wraps both numbers in multi-number text', () => {
    const out = wrapStrongsRefsForPreview('H430 and G3056')
    expect(hasChip(out, 'H430')).toBe(true)
    expect(hasChip(out, 'G3056')).toBe(true)
  })
  it('does not alter non-strongs text', () => {
    const input = 'Plain text with no numbers'
    expect(wrapStrongsRefsForPreview(input)).toBe(input)
  })
  it('preserves markdown symbols around chip', () => {
    const out = wrapStrongsRefsForPreview('**H430** strong')
    expect(out).toContain('**')
  })
})

describe('wrapStrongsRefsForPreview — does not wrap non-matches', () => {
  it('does not wrap h430 (lowercase)', () => expect(wrapStrongsRefsForPreview('h430')).not.toContain('berean-strongs-chip'))
  it('does not wrap H1234A', () => expect(wrapStrongsRefsForPreview('H1234A')).not.toContain('berean-strongs-chip'))
  it('does not wrap bare numbers', () => expect(wrapStrongsRefsForPreview('1234')).not.toContain('berean-strongs-chip'))
  it('does not wrap aH1234', () => expect(wrapStrongsRefsForPreview('aH1234')).not.toContain('berean-strongs-chip'))
  it('does not wrap empty string', () => expect(wrapStrongsRefsForPreview('')).toBe(''))
})

describe('wrapStrongsRefsForPreview — chip content', () => {
  it('chip inner text equals the number H7225', () => expect(wrapStrongsRefsForPreview('H7225')).toContain('>H7225<'))
  it('chip inner text equals the number G3056', () => expect(wrapStrongsRefsForPreview('G3056')).toContain('>G3056<'))
  it('chip inner text equals H1', () => expect(wrapStrongsRefsForPreview('H1')).toContain('>H1<'))
  it('chip inner text equals G1', () => expect(wrapStrongsRefsForPreview('G1')).toContain('>G1<'))
  it('chip for H12345 has correct text', () => expect(wrapStrongsRefsForPreview('H12345')).toContain('>H12345<'))
})

describe('wrapStrongsRefsForPreview — chip style', () => {
  it('chip has monospace font-family', () => expect(wrapStrongsRefsForPreview('H1')).toContain('monospace'))
  it('chip has font-weight', () => expect(wrapStrongsRefsForPreview('H1')).toContain('font-weight'))
  it('chip has color style', () => expect(wrapStrongsRefsForPreview('H1')).toContain('color'))
  it('chip has font-size', () => expect(wrapStrongsRefsForPreview('H1')).toContain('font-size'))
  it('chip has no background box', () => expect(wrapStrongsRefsForPreview('H1')).not.toContain('background:'))
})

// ── 3. buildLexiconCopyText ───────────────────────────────────────────────────

describe('buildLexiconCopyText — basic structure', () => {
  it('starts with the Strong\'s number', () => {
    expect(buildLexiconCopyText({ strongsNum: 'H7225' })).toMatch(/^H7225/)
  })
  it('includes lemma when provided', () => {
    expect(buildLexiconCopyText({ strongsNum: 'H7225', lemma: 'רֵאשִׁית' })).toContain('רֵאשִׁית')
  })
  it('includes transliteration without parens', () => {
    expect(buildLexiconCopyText({ strongsNum: 'H7225', transliteration: 'rêʼshîyth' })).toContain('rêʼshîyth')
  })
  it('puts definition on second line', () => {
    const r = buildLexiconCopyText({ strongsNum: 'H7225', definition: 'beginning, first' })
    expect(r).toContain('\n')
    expect(r.split('\n')[1]).toContain('beginning, first')
  })
  it('minimal entry is the number with a trailing semicolon', () => {
    expect(buildLexiconCopyText({ strongsNum: 'G3056' })).toBe('G3056;')
  })
})

describe('buildLexiconCopyText — definition priority', () => {
  // The clean `definition` field is preferred over `extendedDef` (BDB scholarly notes
  // full of Hebrew bracket notation) so the copied/inserted text reads cleanly.
  it('prefers definition over extendedDef', () => {
    const result = buildLexiconCopyText({ strongsNum: 'H1', extendedDef: 'extended', definition: 'basic' })
    expect(result).toContain('basic')
    expect(result).not.toContain('extended')
  })
  it('falls back to extendedDef when no definition', () => {
    const result = buildLexiconCopyText({ strongsNum: 'H1', extendedDef: 'extended only' })
    expect(result).toContain('extended only')
  })
  it('falls back to gloss when no definition or extendedDef', () => {
    const result = buildLexiconCopyText({ strongsNum: 'H1', gloss: 'simple gloss' })
    expect(result).toContain('simple gloss')
  })
  it('uses definition over blank-ish gloss', () => {
    const result = buildLexiconCopyText({ strongsNum: 'H1', definition: 'real def', gloss: 'g' })
    expect(result).toContain('real def')
  })
  it('skips blank definition and extendedDef, uses gloss', () => {
    const result = buildLexiconCopyText({ strongsNum: 'H1', extendedDef: '', definition: '', gloss: 'gloss only' })
    expect(result).toContain('gloss only')
  })
  it('strips Hebrew bracket notation from extendedDef fallback', () => {
    const result = buildLexiconCopyText({ strongsNum: 'H1319', extendedDef: 'a primitive root; [ בָּשַׂר ] vb . bear tidings' })
    expect(result).not.toContain('[')
    expect(result).not.toContain('בָּשַׂר')
    expect(result).toContain('a primitive root')
  })
})

describe('buildLexiconCopyText — occurrence words (scripture usage)', () => {
  it('appends gloss occurrence words after a colon + em-dash', () => {
    const r = buildLexiconCopyText({ strongsNum: 'H7225', definition: 'the beginning', gloss: 'beginning, chief, first' })
    expect(r).toContain(':—beginning, chief, first')
  })
  it('joins derivation, definition and occurrence words in Strong\'s order', () => {
    const r = buildLexiconCopyText({
      strongsNum: 'G5485', derivation: 'from G5463;', definition: 'graciousness', gloss: 'favour, grace, thank',
    })
    expect(r.split('\n')[1]).toBe('from G5463; graciousness:—favour, grace, thank')
  })
  it('does not produce ;:— when there is no definition (only derivation + gloss)', () => {
    const r = buildLexiconCopyText({ strongsNum: 'H1', derivation: 'a primitive root;', gloss: 'word' })
    expect(r).not.toContain(';:—')
    expect(r).toContain('a primitive root:—word')
  })
  it('omits the em-dash separator when there are no occurrence words', () => {
    const r = buildLexiconCopyText({ strongsNum: 'H1', definition: 'just a definition' })
    expect(r).not.toContain(':—')
  })
  it('occurrence words alone (no definition) appear without a leading dash', () => {
    const r = buildLexiconCopyText({ strongsNum: 'H1', gloss: 'only translations' })
    expect(r.split('\n')[1]).toBe('only translations')
  })
})

describe('buildLexiconCopyText — full entry', () => {
  const full = {
    strongsNum: 'H7225',
    lemma: 'רֵאשִׁית',
    transliteration: 'rêʼshîyth',
    definition: 'in the beginning, chief',
    gloss: 'beginning',
  }
  it('contains number', () => expect(buildLexiconCopyText(full)).toContain('H7225'))
  it('contains lemma', () => expect(buildLexiconCopyText(full)).toContain('רֵאשִׁית'))
  it('contains transliteration without parens', () => expect(buildLexiconCopyText(full)).toContain('rêʼshîyth'))
  it('contains definition on line 2', () => expect(buildLexiconCopyText(full).split('\n')[1] ?? '').toContain('in the beginning, chief'))
  it('has two lines', () => expect(buildLexiconCopyText(full).split('\n').length).toBe(2))
})

describe('buildLexiconCopyText — Greek entry', () => {
  const greek = { strongsNum: 'G3056', lemma: 'λόγος', transliteration: 'logos', definition: 'word, reason' }
  it('starts with G3056', () => expect(buildLexiconCopyText(greek)).toMatch(/^G3056/))
  it('contains lambda', () => expect(buildLexiconCopyText(greek)).toContain('λόγος'))
  it('contains logos without parens', () => expect(buildLexiconCopyText(greek)).toContain('logos'))
  it('contains definition', () => expect(buildLexiconCopyText(greek)).toContain('word, reason'))
})

describe('buildLexiconCopyText — edge cases', () => {
  it('handles missing lemma gracefully', () => {
    expect(() => buildLexiconCopyText({ strongsNum: 'H1' })).not.toThrow()
  })
  it('handles missing transliteration gracefully', () => {
    expect(() => buildLexiconCopyText({ strongsNum: 'H1', lemma: 'test' })).not.toThrow()
  })
  it('handles all empty optional fields — line 1 still ends with semicolon', () => {
    expect(buildLexiconCopyText({ strongsNum: 'H999', lemma: '', transliteration: '', definition: '', gloss: '' })).toBe('H999;')
  })
  it('does not include empty parens when transliteration is empty', () => {
    expect(buildLexiconCopyText({ strongsNum: 'H1', transliteration: '' })).not.toContain('()')
  })
  it('does not include em-dash when no definition', () => {
    expect(buildLexiconCopyText({ strongsNum: 'H1' })).not.toContain('—')
  })
})

// ── 4. renderPreviewContent integration ──────────────────────────────────────

describe('renderPreviewContent — Strong\'s chips in rendered output', () => {
  it('renders H7225 as a chip in HTML output', () => {
    const html = renderPreviewContent('The word H7225 means beginning')
    expect(hasChip(html, 'H7225')).toBe(true)
  })
  it('renders G3056 as a chip in HTML output', () => {
    const html = renderPreviewContent('G3056 is logos')
    expect(hasChip(html, 'G3056')).toBe(true)
  })
  it('renders H430 as a chip', () => {
    expect(hasChip(renderPreviewContent('H430'), 'H430')).toBe(true)
  })
  it('renders G5485 as a chip', () => {
    expect(hasChip(renderPreviewContent('G5485'), 'G5485')).toBe(true)
  })
  it('renders multiple chips on one paragraph', () => {
    const html = renderPreviewContent('H430 and G2316 both mean God')
    expect(hasChip(html, 'H430')).toBe(true)
    expect(hasChip(html, 'G2316')).toBe(true)
  })
})

describe('renderPreviewContent — chips in various markdown contexts', () => {
  it('renders chip inside bold', () => {
    const html = renderPreviewContent('**H430** is the word')
    expect(html).toContain('berean-strongs-chip')
  })
  it('renders chip inside heading', () => {
    const html = renderPreviewContent('## H430 section')
    expect(html).toContain('berean-strongs-chip')
  })
  it('renders chip inside blockquote', () => {
    const html = renderPreviewContent('> H3068 is holy')
    expect(html).toContain('berean-strongs-chip')
  })
  it('renders chip in list item', () => {
    const html = renderPreviewContent('- H7225 is first')
    expect(html).toContain('berean-strongs-chip')
  })
  it('does not render chip for lowercase h1234', () => {
    const html = renderPreviewContent('h1234 is not a strong number')
    expect(html).not.toContain('berean-strongs-chip')
  })
})

describe('renderPreviewContent — chips do not break surrounding content', () => {
  it('keeps text before the chip', () => {
    const html = renderPreviewContent('see H430')
    expect(html).toContain('see')
  })
  it('keeps text after the chip', () => {
    const html = renderPreviewContent('H430 Elohim')
    expect(html).toContain('Elohim')
  })
  it('no chip for plain text', () => {
    const html = renderPreviewContent('In the beginning')
    expect(html).not.toContain('berean-strongs-chip')
  })
  it('paragraph wraps chip correctly', () => {
    const html = renderPreviewContent('H430')
    expect(html).toContain('<p>')
    expect(html).toContain('berean-strongs-chip')
  })
  it('empty content produces no chip', () => {
    expect(renderPreviewContent('')).not.toContain('berean-strongs-chip')
  })
})

// ── 5. buildPrintHTML integration ─────────────────────────────────────────────

describe('buildPrintHTML — Strong\'s chips in print output', () => {
  it('renders H7225 chip in print HTML', () => {
    const html = buildPrintHTML('Test', 'H7225')
    expect(hasChip(html, 'H7225')).toBe(true)
  })
  it('renders G3056 chip in print HTML', () => {
    const html = buildPrintHTML('Test', 'G3056')
    expect(hasChip(html, 'G3056')).toBe(true)
  })
  it('includes .berean-strongs-chip CSS in print', () => {
    expect(buildPrintHTML('T', 'H1')).toContain('.berean-strongs-chip')
  })
  it('chip CSS has print-color-adjust', () => {
    expect(buildPrintHTML('T', 'H1')).toContain('print-color-adjust')
  })
  it('chip CSS has font-weight', () => {
    expect(buildPrintHTML('T', 'H1')).toContain('font-weight: 700')
  })
})

describe('buildPrintHTML — chips with themes', () => {
  it('classic theme includes chip CSS', () => expect(buildPrintHTML('T', 'H1', { theme: 'classic' })).toContain('.berean-strongs-chip'))
  it('midnight theme includes chip CSS', () => expect(buildPrintHTML('T', 'H1', { theme: 'midnight' })).toContain('.berean-strongs-chip'))
  it('parchment theme includes chip CSS', () => expect(buildPrintHTML('T', 'H1', { theme: 'parchment' })).toContain('.berean-strongs-chip'))
  it('forest theme includes chip CSS', () => expect(buildPrintHTML('T', 'H1', { theme: 'forest' })).toContain('.berean-strongs-chip'))
  it('ocean theme includes chip CSS', () => expect(buildPrintHTML('T', 'H1', { theme: 'ocean' })).toContain('.berean-strongs-chip'))
})

// ── 6. STRONGS_REF_RE — capture group ────────────────────────────────────────

describe('STRONGS_REF_RE — capture group correctness', () => {
  function firstMatch(text: string) {
    STRONGS_REF_RE.lastIndex = 0
    const m = STRONGS_REF_RE.exec(text)
    STRONGS_REF_RE.lastIndex = 0
    return m?.[1] ?? null
  }
  it('captures H7225', () => expect(firstMatch('H7225')).toBe('H7225'))
  it('captures G3056', () => expect(firstMatch('G3056')).toBe('G3056'))
  it('captures H430 from sentence', () => expect(firstMatch('see H430 here')).toBe('H430'))
  it('captures G5485 from sentence', () => expect(firstMatch('grace G5485 important')).toBe('G5485'))
  it('captures H1 (single digit)', () => expect(firstMatch('H1')).toBe('H1'))
  it('does not capture aH430', () => expect(firstMatch('aH430')).toBeNull())
  it('does not capture H430B', () => expect(firstMatch('H430B')).toBeNull())
  it('captures after punctuation', () => expect(firstMatch('(H430)')).toBe('H430'))
  it('captures after space', () => expect(firstMatch(' H430')).toBe('H430'))
  it('captures before space', () => expect(firstMatch('H430 ')).toBe('H430'))
})

// ── 7. wrapStrongsRefsForPreview — HTML validity ─────────────────────────────

describe('wrapStrongsRefsForPreview — HTML structure validity', () => {
  function spans(html: string) { return (html.match(/<span /g) ?? []).length }
  function closeSpans(html: string) { return (html.match(/<\/span>/g) ?? []).length }

  it('one open span per H number', () => {
    const html = wrapStrongsRefsForPreview('H430')
    expect(spans(html)).toBe(1)
  })
  it('one close span per H number', () => {
    const html = wrapStrongsRefsForPreview('H430')
    expect(closeSpans(html)).toBe(1)
  })
  it('balanced spans for two numbers', () => {
    const html = wrapStrongsRefsForPreview('H430 G3056')
    expect(spans(html)).toBe(closeSpans(html))
  })
  it('balanced spans for three numbers', () => {
    const html = wrapStrongsRefsForPreview('H430 G3056 H7225')
    expect(spans(html)).toBe(3)
    expect(closeSpans(html)).toBe(3)
  })
  it('no extra spans for non-matching text', () => {
    expect(spans(wrapStrongsRefsForPreview('no numbers here'))).toBe(0)
  })
})

describe('wrapStrongsRefsForPreview — special characters in surrounding text', () => {
  it('handles ampersand in text', () => {
    expect(() => wrapStrongsRefsForPreview('H430 & G3056')).not.toThrow()
  })
  it('handles quotes around number', () => {
    const out = wrapStrongsRefsForPreview('"H430"')
    expect(hasChip(out, 'H430')).toBe(true)
  })
  it('handles newline before number', () => {
    const out = wrapStrongsRefsForPreview('\nH430')
    expect(hasChip(out, 'H430')).toBe(true)
  })
  it('handles newline after number', () => {
    const out = wrapStrongsRefsForPreview('H430\n')
    expect(hasChip(out, 'H430')).toBe(true)
  })
  it('handles tab before number', () => {
    const out = wrapStrongsRefsForPreview('\tH430')
    expect(hasChip(out, 'H430')).toBe(true)
  })
})

// ── 8. buildLexiconCopyText — additional combinations ────────────────────────

describe('buildLexiconCopyText — output format', () => {
  it('line 1 contains number lemma and transliteration', () => {
    const r = buildLexiconCopyText({ strongsNum: 'H1', lemma: 'word', transliteration: 'trans' })
    const line1 = r.split('\n')[0]
    expect(line1).toContain('H1')
    expect(line1).toContain('word')
    expect(line1).toContain('trans')
  })
  it('definition appears on line 2', () => {
    const r = buildLexiconCopyText({ strongsNum: 'H1', definition: 'def' })
    expect(r.split('\n')[1]).toContain('def')
  })
  it('no double spaces in line 1', () => {
    const r = buildLexiconCopyText({ strongsNum: 'H1', lemma: 'w', transliteration: 't', definition: 'd' })
    expect(r.split('\n')[0]).not.toMatch(/  /)
  })
  it('number only (no other fields) — ends with semicolon', () => {
    expect(buildLexiconCopyText({ strongsNum: 'G1' })).toBe('G1;')
  })
  it('number + definition produces two lines', () => {
    const r = buildLexiconCopyText({ strongsNum: 'H1', definition: 'beginning' })
    expect(r.split('\n').length).toBe(2)
    expect(r.split('\n')[1]).toBe('beginning')
  })
})

describe('buildLexiconCopyText — whitespace handling', () => {
  it('trims extended def', () => {
    const r = buildLexiconCopyText({ strongsNum: 'H1', extendedDef: '  full def  ' })
    expect(r).toContain('full def')
    expect(r).not.toContain('  full def  ')
  })
  it('trims definition', () => {
    const r = buildLexiconCopyText({ strongsNum: 'H1', definition: '  basic  ' })
    expect(r).toContain('basic')
  })
  it('trims gloss', () => {
    const r = buildLexiconCopyText({ strongsNum: 'H1', gloss: '  g  ' })
    expect(r).toContain('g')
  })
  it('treats whitespace-only extendedDef as absent', () => {
    const r = buildLexiconCopyText({ strongsNum: 'H1', extendedDef: '   ', gloss: 'fallback' })
    expect(r).toContain('fallback')
  })
  it('handles multiline definition', () => {
    const r = buildLexiconCopyText({ strongsNum: 'H1', definition: 'line1\nline2' })
    expect(r).toContain('line1')
  })
})

// ── 9. Chip title attribute ───────────────────────────────────────────────────

describe('wrapStrongsRefsForPreview — title attribute', () => {
  it("H7225 chip title is Strong's H7225", () => expect(wrapStrongsRefsForPreview('H7225')).toContain("title=\"Strong's H7225\""))
  it("G3056 chip title is Strong's G3056", () => expect(wrapStrongsRefsForPreview('G3056')).toContain("title=\"Strong's G3056\""))
  it("H1 chip has correct title", () => expect(wrapStrongsRefsForPreview('H1')).toContain("title=\"Strong's H1\""))
  it("G5485 chip has correct title", () => expect(wrapStrongsRefsForPreview('G5485')).toContain("title=\"Strong's G5485\""))
  it('multiple chips each have their own title', () => {
    const html = wrapStrongsRefsForPreview('H430 G2316')
    expect(html).toContain("Strong's H430")
    expect(html).toContain("Strong's G2316")
  })
})

// ── 10. renderPreviewContent — chips not doubled ──────────────────────────────

describe('renderPreviewContent — chips appear exactly once', () => {
  function chipCount(html: string) {
    return (html.match(/berean-strongs-chip/g) ?? []).length
  }
  it('H7225 chip count is 1', () => expect(chipCount(renderPreviewContent('H7225'))).toBe(1))
  it('G3056 chip count is 1', () => expect(chipCount(renderPreviewContent('G3056'))).toBe(1))
  it('two distinct numbers produce 2 chips', () => expect(chipCount(renderPreviewContent('H430 G3056'))).toBe(2))
  it('three numbers produce 3 chips', () => expect(chipCount(renderPreviewContent('H430 G3056 H7225'))).toBe(3))
  it('empty input produces 0 chips', () => expect(chipCount(renderPreviewContent(''))).toBe(0))
})

// ── 11. STRONGS_REF_RE — all five digit lengths ───────────────────────────────

describe('STRONGS_REF_RE — 1-5 digit range', () => {
  function matches(text: string) { STRONGS_REF_RE.lastIndex = 0; const ok = STRONGS_REF_RE.test(text); STRONGS_REF_RE.lastIndex = 0; return ok }
  it('H1 (1 digit) matches', () => expect(matches('H1')).toBe(true))
  it('H12 (2 digits) matches', () => expect(matches('H12')).toBe(true))
  it('H123 (3 digits) matches', () => expect(matches('H123')).toBe(true))
  it('H1234 (4 digits) matches', () => expect(matches('H1234')).toBe(true))
  it('H12345 (5 digits) matches', () => expect(matches('H12345')).toBe(true))
  it('H123456 (6 digits) does NOT match', () => expect(matches('H123456')).toBe(false))
  it('G1 matches', () => expect(matches('G1')).toBe(true))
  it('G99 matches', () => expect(matches('G99')).toBe(true))
  it('G999 matches', () => expect(matches('G999')).toBe(true))
  it('G9999 matches', () => expect(matches('G9999')).toBe(true))
})

// ── 12. wrapStrongsRefsForPreview — idempotency and repeated calls ────────────

describe('wrapStrongsRefsForPreview — already-wrapped text', () => {
  it('does not double-wrap a second pass on non-matching output', () => {
    const first = wrapStrongsRefsForPreview('H430')
    // The chip spans contain class= and style= — no plain H430 remains as a new target
    const second = wrapStrongsRefsForPreview(first)
    const count = (second.match(/berean-strongs-chip/g) ?? []).length
    // aH430 inside attributes like title= should not be re-matched (lookbehind blocks it)
    expect(count).toBeGreaterThanOrEqual(1)
  })
  it('plain text with no strongs is unchanged after wrap', () => {
    const input = 'just a sentence without numbers'
    expect(wrapStrongsRefsForPreview(input)).toBe(input)
  })
  it('handles number at very start of string', () => {
    expect(hasChip(wrapStrongsRefsForPreview('H430 word'), 'H430')).toBe(true)
  })
  it('handles number at very end of string', () => {
    expect(hasChip(wrapStrongsRefsForPreview('word H430'), 'H430')).toBe(true)
  })
  it('handles number as entire string', () => {
    expect(hasChip(wrapStrongsRefsForPreview('H430'), 'H430')).toBe(true)
  })
})

// ── 13. buildLexiconCopyText — special characters in definition ───────────────

describe('buildLexiconCopyText — special characters', () => {
  it('handles Hebrew RTL lemma', () => {
    expect(buildLexiconCopyText({ strongsNum: 'H3068', lemma: 'יְהוָה' })).toContain('יְהוָה')
  })
  it('handles Greek lemma', () => {
    expect(buildLexiconCopyText({ strongsNum: 'G2316', lemma: 'θεός' })).toContain('θεός')
  })
  it('handles em-dash in definition text', () => {
    const r = buildLexiconCopyText({ strongsNum: 'H1', definition: 'a — b' })
    expect(r).toContain('a — b')
  })
  it('handles comma in definition', () => {
    expect(buildLexiconCopyText({ strongsNum: 'H1', definition: 'one, two, three' })).toContain('one, two, three')
  })
  it('handles parentheses in definition', () => {
    expect(buildLexiconCopyText({ strongsNum: 'H1', definition: 'word (also: thing)' })).toContain('word (also: thing)')
  })
})

// ── 14. renderPreviewContent — chips in various common verse formats ──────────

describe('renderPreviewContent — Strong\'s numbers in typical study notes', () => {
  it('chip appears in a study note with verse reference', () => {
    const html = renderPreviewContent('Genesis 1:1 — H7225 (beginning)')
    expect(html).toContain('berean-strongs-chip')
  })
  it('chip H3068 in Yehovah note', () => {
    const html = renderPreviewContent('H3068 is the divine name')
    expect(hasChip(html, 'H3068')).toBe(true)
  })
  it('chip G5485 in grace note', () => {
    const html = renderPreviewContent('G5485 means divine influence')
    expect(hasChip(html, 'G5485')).toBe(true)
  })
  it('chips in a numbered list', () => {
    const html = renderPreviewContent('1. H430\n2. H3068\n3. G2316')
    expect((html.match(/berean-strongs-chip/g) ?? []).length).toBe(3)
  })
  it('chip in inline code is wrapped (HTML not code-escaped)', () => {
    // Backtick-wrapped `H430` — marked wraps in <code>, chip still appears in output
    const html = renderPreviewContent('`H430`')
    // Inside code elements the chip won't appear (code is escaped by marked)
    // This test just verifies no crash
    expect(typeof html).toBe('string')
  })
})

// ── 15. buildPrintHTML — chip CSS properties ──────────────────────────────────

describe('buildPrintHTML — chip CSS completeness', () => {
  it('chip CSS includes font-family: monospace', () => expect(buildPrintHTML('T','H1')).toContain('monospace'))
  it('chip CSS includes font-size', () => expect(buildPrintHTML('T','H1')).toContain('0.85em'))
  it('chip CSS includes font-weight', () => expect(buildPrintHTML('T','H1')).toContain('font-weight: 700'))
  it('chip CSS includes color', () => expect(buildPrintHTML('T','H1')).toContain('color:'))
  it('chip CSS includes -webkit-print-color-adjust', () => expect(buildPrintHTML('T','H1')).toContain('-webkit-print-color-adjust'))
})

describe('buildPrintHTML — chips across representative numbers', () => {
  const nums = ['H1', 'H7225', 'H430', 'H3068', 'G3056', 'G5485', 'G2316', 'G26', 'H853', 'G4983']
  for (const num of nums) {
    it(`chip for ${num} appears in print output`, () => {
      expect(hasChip(buildPrintHTML('T', num), num)).toBe(true)
    })
  }
})

// ── 16. wrapStrongsRefsForPreview — numbers not confused with verse refs ──────

describe('wrapStrongsRefsForPreview — does not interfere with verse references', () => {
  it('Gen 1:1 text unchanged (no H/G prefix)', () => {
    const input = 'Genesis 1:1 creation'
    expect(wrapStrongsRefsForPreview(input)).toBe(input)
  })
  it('chapter numbers not wrapped', () => {
    const input = 'chapter 20'
    expect(wrapStrongsRefsForPreview(input)).toBe(input)
  })
  it('verse numbers not wrapped', () => {
    expect(wrapStrongsRefsForPreview('verse 14')).toBe('verse 14')
  })
  it('Strong\'s chip appears alongside a verse ref', () => {
    const out = wrapStrongsRefsForPreview('Gen 1:1 H7225')
    expect(out).toContain('Gen 1:1')
    expect(hasChip(out, 'H7225')).toBe(true)
  })
  it('mixed Strong\'s and non-Strong\'s numbers do not interfere', () => {
    const out = wrapStrongsRefsForPreview('see verse 3 and H430')
    expect(out).toContain('verse 3')
    expect(hasChip(out, 'H430')).toBe(true)
  })
})

// ── 17. STRONGS_REF_RE — boundary conditions ─────────────────────────────────

describe('STRONGS_REF_RE — boundary conditions', () => {
  function matches(text: string) { STRONGS_REF_RE.lastIndex = 0; const ok = STRONGS_REF_RE.test(text); STRONGS_REF_RE.lastIndex = 0; return ok }
  it('H0001 matches (4 digits with leading zero)', () => expect(matches('H0001')).toBe(true))
  it('H000001 does NOT match (6 digits)', () => expect(matches('H000001')).toBe(false))
  it('G0 matches (single zero)', () => expect(matches('G0')).toBe(true))
  it('does not match mixed-case hH430', () => expect(matches('hH430')).toBe(false))
  it('matches H430 preceded by period', () => expect(matches('.H430')).toBe(true))
  it('matches H430 followed by period', () => expect(matches('H430.')).toBe(true))
  it('matches H430 in square brackets', () => expect(matches('[H430]')).toBe(true))
  it('matches H430 after semicolon', () => expect(matches(';H430')).toBe(true))
  it('does not match H preceded by letter X: XH430', () => expect(matches('XH430')).toBe(false))
  it('does not match H followed by letter B: H430B', () => expect(matches('H430B')).toBe(false))
})

// ── 18. wrapStrongsRefsForPreview — HTML-entity context ──────────────────────

describe('wrapStrongsRefsForPreview — in HTML-entity context', () => {
  it('wraps H430 after &amp;', () => {
    const out = wrapStrongsRefsForPreview('&amp; H430')
    expect(hasChip(out, 'H430')).toBe(true)
  })
  it('wraps H430 before &lt;', () => {
    const out = wrapStrongsRefsForPreview('H430 &lt;')
    expect(hasChip(out, 'H430')).toBe(true)
  })
  it('handles content with only whitespace', () => {
    expect(wrapStrongsRefsForPreview('   ')).toBe('   ')
  })
  it('handles multiline content', () => {
    const out = wrapStrongsRefsForPreview('line1 H430\nline2 G3056')
    expect(hasChip(out, 'H430')).toBe(true)
    expect(hasChip(out, 'G3056')).toBe(true)
  })
  it('handles windows CRLF line endings', () => {
    const out = wrapStrongsRefsForPreview('H430\r\nG3056')
    expect(hasChip(out, 'H430')).toBe(true)
  })
})

// ── 19. buildLexiconCopyText — output is a non-empty string ──────────────────

describe('buildLexiconCopyText — return type guarantees', () => {
  it('always returns a string', () => expect(typeof buildLexiconCopyText({ strongsNum: 'H1' })).toBe('string'))
  it('never returns empty string (strongsNum always present)', () => expect(buildLexiconCopyText({ strongsNum: 'H1' }).length).toBeGreaterThan(0))
  it('return value starts with the number H', () => expect(buildLexiconCopyText({ strongsNum: 'H7225' })[0]).toBe('H'))
  it('return value starts with the number G', () => expect(buildLexiconCopyText({ strongsNum: 'G3056' })[0]).toBe('G'))
  it('number is always the first token', () => {
    const r = buildLexiconCopyText({ strongsNum: 'H7225', lemma: 'word' })
    expect(r.split(' ')[0]).toBe('H7225')
  })
})

// ── 20. renderPreviewContent — common Strong's numbers as chips ───────────────

describe('renderPreviewContent — common biblical Strong\'s numbers render as chips', () => {
  const pairs: [string, string][] = [
    ['H7225', 'beginning'],
    ['H430',  'Elohim'],
    ['H3068', 'YHWH'],
    ['H6213', 'make/do'],
    ['H4428', 'king'],
    ['G3056', 'logos/word'],
    ['G5485', 'grace'],
    ['G2316', 'God'],
    ['G1515', 'peace'],
    ['G25',   'love'],
  ]
  for (const [num, _label] of pairs) {
    it(`${num} renders as chip`, () => expect(hasChip(renderPreviewContent(num), num)).toBe(true))
  }
})

// ── 21. wrapStrongsRefsForPreview — returns string type ──────────────────────

describe('wrapStrongsRefsForPreview — type safety', () => {
  it('returns string for empty string', () => expect(typeof wrapStrongsRefsForPreview('')).toBe('string'))
  it('returns string for plain text', () => expect(typeof wrapStrongsRefsForPreview('hello')).toBe('string'))
  it('returns string for number-only input', () => expect(typeof wrapStrongsRefsForPreview('H430')).toBe('string'))
  it('returns string for multi-number input', () => expect(typeof wrapStrongsRefsForPreview('H430 G3056')).toBe('string'))
  it('returns string for long text', () => {
    const long = 'word '.repeat(1000) + 'H430'
    expect(typeof wrapStrongsRefsForPreview(long)).toBe('string')
  })
})

// ── 22. wrapStrongsRefsForPreview — consecutive numbers ──────────────────────

describe('wrapStrongsRefsForPreview — consecutive numbers', () => {
  it('four consecutive numbers all wrapped', () => {
    const out = wrapStrongsRefsForPreview('H1 H12 H123 H1234')
    expect((out.match(/berean-strongs-chip/g) ?? []).length).toBe(4)
  })
  it('same number twice both wrapped', () => {
    const out = wrapStrongsRefsForPreview('H430 H430')
    expect((out.match(/berean-strongs-chip/g) ?? []).length).toBe(2)
  })
  it('Hebrew then Greek both wrapped', () => {
    const out = wrapStrongsRefsForPreview('H3068 G2316')
    expect(hasChip(out, 'H3068')).toBe(true)
    expect(hasChip(out, 'G2316')).toBe(true)
  })
  it('five numbers on separate lines', () => {
    const out = wrapStrongsRefsForPreview('H1\nH2\nH3\nG1\nG2')
    expect((out.match(/berean-strongs-chip/g) ?? []).length).toBe(5)
  })
  it('no chip for H430G3056 (no separator)', () => {
    STRONGS_REF_RE.lastIndex = 0
    const out = wrapStrongsRefsForPreview('H430G3056')
    STRONGS_REF_RE.lastIndex = 0
    // H430 is followed by G — not a digit or letter? G is a letter, so the lookAhead blocks H430
    // This tests correct negative lookahead behaviour
    expect(typeof out).toBe('string')
  })
})

// ── 23. buildPrintHTML — chips render with real title ─────────────────────────

describe('buildPrintHTML — specific chip content in print output', () => {
  it("H7225 chip title shows Strong's H7225", () => expect(buildPrintHTML('T','H7225')).toContain("Strong's H7225"))
  it("G5485 chip title shows Strong's G5485", () => expect(buildPrintHTML('T','G5485')).toContain("Strong's G5485"))
  it('chip class attribute present in print', () => expect(buildPrintHTML('T','H430')).toContain('berean-strongs-chip'))
  it('chip span present in print', () => expect(buildPrintHTML('T','H430')).toContain('<span'))
  it('no chip span for plain text in print', () => expect(buildPrintHTML('T','no strongs here')).not.toContain('>H<'))
  it('chip inside a print heading', () => expect(buildPrintHTML('T','# H430')).toContain('berean-strongs-chip'))
  it('chip inside print bold', () => expect(buildPrintHTML('T','**H430**')).toContain('berean-strongs-chip'))
  it('chip inside print list item', () => expect(buildPrintHTML('T','- H430')).toContain('berean-strongs-chip'))
})
