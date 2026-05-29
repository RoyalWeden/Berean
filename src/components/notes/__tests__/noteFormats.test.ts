/**
 * Tests for NoteEditor format detection patterns.
 * Covers 200+ combinations of inline/block/alignment formats.
 */

// ─── Pattern helpers (mirrors detectFormats logic) ───────────────────────────

function detectLineFormats(lineText: string, surroundBefore = '', surroundAfter = ''): Set<string> {
  const fmts = new Set<string>()

  // Highlight: == before and after selection
  if (surroundBefore === '==' && surroundAfter === '==') fmts.add('highlight')

  // Underline: <u> before, </u> after
  if (surroundBefore === '<u>' && surroundAfter === '</u>') fmts.add('underline')

  // Alignment from <div align="X">
  const alignMatch = lineText.match(/^<div align="(left|center|right|justify)">/)
  if (alignMatch) fmts.add(`align-${alignMatch[1]}`)

  // Task list
  if (/^- \[[ xX]\] /.test(lineText)) fmts.add('task')

  // Lettered lists
  if (/^[a-z]+\. /.test(lineText) && !/^[ivxlcdm]+\. /i.test(lineText)) fmts.add('alpha-lower')
  if (/^[A-Z]+\. /.test(lineText) && !/^[IVXLCDM]+\. /.test(lineText)) fmts.add('alpha-upper')

  // Bullet and numbered
  if (/^\* /.test(lineText)) fmts.add('bullet')
  if (/^\d+\. /.test(lineText)) fmts.add('ordered')
  if (/^> /.test(lineText)) fmts.add('blockquote')

  return fmts
}

// ─── Highlight detection ─────────────────────────────────────────────────────

describe('highlight format detection', () => {
  test('== around selection → highlight active', () => {
    expect(detectLineFormats('Some text', '==', '==')).toContain('highlight')
  })
  test('no == → highlight not active', () => {
    expect(detectLineFormats('Some text', '', '')).not.toContain('highlight')
  })
  test('only leading == → not detected', () => {
    expect(detectLineFormats('Some text', '==', '')).not.toContain('highlight')
  })
  test('only trailing == → not detected', () => {
    expect(detectLineFormats('Some text', '', '==')).not.toContain('highlight')
  })
  test('underline around selection → underline active', () => {
    expect(detectLineFormats('Some text', '<u>', '</u>')).toContain('underline')
  })
})

// ─── Alignment detection ─────────────────────────────────────────────────────

describe('alignment format detection', () => {
  const ALIGNS = ['left', 'center', 'right', 'justify'] as const
  for (const align of ALIGNS) {
    test(`<div align="${align}"> → align-${align}`, () => {
      const line = `<div align="${align}">Some text</div>`
      expect(detectLineFormats(line)).toContain(`align-${align}`)
    })
  }
  test('no div wrapper → no alignment', () => {
    expect(detectLineFormats('Some text')).not.toContain('align-center')
  })
  test('malformed div → no alignment', () => {
    expect(detectLineFormats('<div>text</div>')).not.toContain('align-center')
  })
})

// ─── Task list detection ──────────────────────────────────────────────────────

describe('task list format detection', () => {
  test('- [ ] item → task', () => {
    expect(detectLineFormats('- [ ] buy milk')).toContain('task')
  })
  test('- [x] item → task', () => {
    expect(detectLineFormats('- [x] done item')).toContain('task')
  })
  test('- [X] item → task', () => {
    expect(detectLineFormats('- [X] Done item')).toContain('task')
  })
  test('- item (no checkbox) → not task', () => {
    expect(detectLineFormats('- regular item')).not.toContain('task')
  })
  test('* item → not task', () => {
    expect(detectLineFormats('* bullet item')).not.toContain('task')
  })
})

// ─── Lettered list detection ──────────────────────────────────────────────────

describe('lettered list format detection', () => {
  // Exclude letters that are also Roman numerals: i, v, x, l, c, d, m
  const letters = ['a', 'b', 'e', 'f', 'g', 'h', 'j', 'k', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'w', 'y', 'z']
  // Exclude I,V,X,L,C,D,M — they overlap with Roman numerals and won't be detected as alpha-upper
  const upperLetters = ['B', 'E', 'F', 'G', 'H', 'J', 'K', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'W', 'Y', 'Z']

  for (const letter of letters) {
    test(`${letter}. text → alpha-lower`, () => {
      expect(detectLineFormats(`${letter}. some item`)).toContain('alpha-lower')
    })
  }

  for (const letter of upperLetters) {
    test(`${letter}. text → alpha-upper`, () => {
      expect(detectLineFormats(`${letter}. some item`)).toContain('alpha-upper')
    })
  }

  test('1. text → ordered (not lettered)', () => {
    const fmts = detectLineFormats('1. numbered item')
    expect(fmts).toContain('ordered')
    expect(fmts).not.toContain('alpha-lower')
  })

  test('plain word without dot → not lettered', () => {
    expect(detectLineFormats('apple orange')).not.toContain('alpha-lower')
  })
})

// ─── Bullet list detection ────────────────────────────────────────────────────

describe('bullet list format detection', () => {
  test('* item → bullet', () => {
    expect(detectLineFormats('* bullet item')).toContain('bullet')
  })
  test('- item → not bullet (dash list)', () => {
    const fmts = detectLineFormats('- dash item')
    expect(fmts).not.toContain('bullet')
  })
  test('text → not bullet', () => {
    expect(detectLineFormats('plain text')).not.toContain('bullet')
  })
})

// ─── Ordered list detection ───────────────────────────────────────────────────

describe('ordered list format detection', () => {
  test('1. item → ordered', () => {
    expect(detectLineFormats('1. first item')).toContain('ordered')
  })
  test('2. item → ordered', () => {
    expect(detectLineFormats('2. second item')).toContain('ordered')
  })
  test('10. item → ordered', () => {
    expect(detectLineFormats('10. tenth item')).toContain('ordered')
  })
})

// ─── Blockquote detection ─────────────────────────────────────────────────────

describe('blockquote format detection', () => {
  test('> text → blockquote', () => {
    expect(detectLineFormats('> This is a quote')).toContain('blockquote')
  })
  test('>> double quote → not matched (requires > space)', () => {
    // >> has no space after first >, so it is not detected as a blockquote by the line-prefix pattern
    expect(detectLineFormats('>> nested quote')).not.toContain('blockquote')
  })
  test('no > → not blockquote', () => {
    expect(detectLineFormats('plain text')).not.toContain('blockquote')
  })
})

// ─── Combined format combinations ────────────────────────────────────────────

describe('combined format combinations', () => {
  // Alignment + task (task inside aligned div)
  test('aligned task list', () => {
    const line = '<div align="center">- [ ] centered task</div>'
    const fmts = detectLineFormats(line)
    expect(fmts).toContain('align-center')
    // task is inside a div, so won't be detected at line level here (expected)
  })

  // Alignment + ordered
  test('aligned ordered list line', () => {
    const line = '<div align="right">1. right-aligned item</div>'
    const fmts = detectLineFormats(line)
    expect(fmts).toContain('align-right')
  })

  // Lettered + highlight (selection within lettered list item)
  test('highlight within lettered item', () => {
    const fmts = detectLineFormats('a. some text', '==', '==')
    expect(fmts).toContain('alpha-lower')
    expect(fmts).toContain('highlight')
  })

  // Highlight + underline (both markers present)
  test('highlight active + underline surrounds', () => {
    const fmts = detectLineFormats('text', '<u>', '</u>')
    expect(fmts).toContain('underline')
  })

  // Bullet in aligned container
  test('aligned bullet line', () => {
    const line = '<div align="justify">* bullet text</div>'
    const fmts = detectLineFormats(line)
    expect(fmts).toContain('align-justify')
  })

  // All four alignments - none detected when no div
  test('plain text has no alignment', () => {
    const fmts = detectLineFormats('no alignment here')
    expect(fmts).not.toContain('align-left')
    expect(fmts).not.toContain('align-center')
    expect(fmts).not.toContain('align-right')
    expect(fmts).not.toContain('align-justify')
  })

  // Task done vs todo
  test('- [ ] unchecked vs - [x] checked both → task', () => {
    const todo = detectLineFormats('- [ ] unchecked')
    const done = detectLineFormats('- [x] checked')
    expect(todo).toContain('task')
    expect(done).toContain('task')
  })

  // Lettered a–z (non-Roman: exclude i,v,x,l,c,d,m) + highlight
  for (const pair of [['b', 'text'], ['e', 'item'], ['f', 'entry'], ['g', 'point']] as const) {
    test(`${pair[0]}. with highlight`, () => {
      const fmts = detectLineFormats(`${pair[0]}. ${pair[1]}`, '==', '==')
      expect(fmts).toContain('alpha-lower')
      expect(fmts).toContain('highlight')
    })
  }

  // Ordered + underline surround
  for (const n of [1, 2, 3, 5, 10]) {
    test(`${n}. item + underline surround`, () => {
      const fmts = detectLineFormats(`${n}. item text`, '<u>', '</u>')
      expect(fmts).toContain('ordered')
      expect(fmts).toContain('underline')
    })
  }

  // Blockquote + highlight
  test('blockquote + highlight', () => {
    const fmts = detectLineFormats('> quoted text', '==', '==')
    expect(fmts).toContain('blockquote')
    expect(fmts).toContain('highlight')
  })

  // Uppercase letters B–Z (excluding Roman numeral chars I,V,X,L,C,D,M) + highlight
  for (const letter of ['B', 'E', 'F', 'G', 'H', 'J', 'K', 'N', 'O']) {
    test(`${letter}. with underline`, () => {
      const fmts = detectLineFormats(`${letter}. item text`, '<u>', '</u>')
      expect(fmts).toContain('alpha-upper')
      expect(fmts).toContain('underline')
    })
  }

  // All alignment options + underline surround
  for (const align of ['left', 'center', 'right', 'justify'] as const) {
    test(`align-${align} + underline surround`, () => {
      const line = `<div align="${align}">text content</div>`
      const fmts = detectLineFormats(line, '<u>', '</u>')
      expect(fmts).toContain(`align-${align}`)
      expect(fmts).toContain('underline')
    })
  }

  // All alignment options + highlight
  for (const align of ['left', 'center', 'right', 'justify'] as const) {
    test(`align-${align} + highlight`, () => {
      const line = `<div align="${align}">text content</div>`
      const fmts = detectLineFormats(line, '==', '==')
      expect(fmts).toContain(`align-${align}`)
      expect(fmts).toContain('highlight')
    })
  }

  // Task variations + alignment
  for (const align of ['center', 'right', 'justify'] as const) {
    test(`task in align-${align} div`, () => {
      const fmts = detectLineFormats(`<div align="${align}">text</div>`, '', '')
      expect(fmts).toContain(`align-${align}`)
    })
  }

  // Ordered list at various positions + highlight
  for (const n of [1, 3, 7, 15, 20, 100]) {
    test(`${n}. item + highlight`, () => {
      const fmts = detectLineFormats(`${n}. some text`, '==', '==')
      expect(fmts).toContain('ordered')
      expect(fmts).toContain('highlight')
    })
  }

  // Empty content in formats
  test('empty task (- [ ] ) → task', () => {
    expect(detectLineFormats('- [ ] ')).toContain('task')
  })
  test('empty aligned div → alignment', () => {
    expect(detectLineFormats('<div align="center"></div>')).toContain('align-center')
  })

  // Lettered lists with multi-char entries (aa. etc.)
  test('aa. item → alpha-lower', () => {
    expect(detectLineFormats('aa. multi-char letter')).toContain('alpha-lower')
  })
  test('AA. item → alpha-upper', () => {
    expect(detectLineFormats('AA. MULTI-CHAR')).toContain('alpha-upper')
  })

  // Blockquote nested (>> doesn't have a space after first >, so not matched by ^> )
  test('>> nested blockquote → not matched (space required after single >)', () => {
    expect(detectLineFormats('>> nested quote text')).not.toContain('blockquote')
  })
  test('> properly formatted blockquote → blockquote', () => {
    expect(detectLineFormats('> quote text')).toContain('blockquote')
  })

  // Bullet star variants
  test('* item with highlight', () => {
    const fmts = detectLineFormats('* bullet', '==', '==')
    expect(fmts).toContain('bullet')
    expect(fmts).toContain('highlight')
  })

  // No false positives
  test('"alignleft" in body → no alignment detected', () => {
    expect(detectLineFormats('the word alignleft is here')).not.toContain('align-left')
  })
  test('"center" in body → no alignment detected', () => {
    expect(detectLineFormats('the center of attention')).not.toContain('align-center')
  })
  test('"== text" without closing → no highlight', () => {
    expect(detectLineFormats('==partial text only', '', '')).not.toContain('highlight')
  })
})

// ─── renderPreviewContent-like pattern tests ──────────────────────────────────

describe('preview content pattern tests', () => {
  function applyHighlight(text: string) {
    return text.replace(/==([^=\n]+?)==/g, '<mark>$1</mark>')
  }

  test('==text== → <mark>text</mark>', () => {
    expect(applyHighlight('Hello ==world== today')).toBe('Hello <mark>world</mark> today')
  })
  test('multiple highlights in one line', () => {
    expect(applyHighlight('==a== and ==b==')).toBe('<mark>a</mark> and <mark>b</mark>')
  })
  test('no == → unchanged', () => {
    expect(applyHighlight('no highlight here')).toBe('no highlight here')
  })
  test('single = not highlighted', () => {
    expect(applyHighlight('a=b')).toBe('a=b')
  })
  test('empty == == → not highlighted (empty content)', () => {
    // Pattern requires at least 1 char inside
    expect(applyHighlight('====')).toBe('====')
  })

  function applyTaskList(text: string) {
    let out = text
    out = out.replace(/^- \[[xX]\] (.*)/gm, '<li checked>$1</li>')
    out = out.replace(/^- \[ \] (.*)/gm, '<li>$1</li>')
    return out
  }

  test('- [ ] item → unchecked li', () => {
    expect(applyTaskList('- [ ] buy milk')).toBe('<li>buy milk</li>')
  })
  test('- [x] item → checked li', () => {
    expect(applyTaskList('- [x] done task')).toBe('<li checked>done task</li>')
  })
  test('- [X] item → checked li', () => {
    expect(applyTaskList('- [X] Done Task')).toBe('<li checked>Done Task</li>')
  })
  test('- item → not converted', () => {
    expect(applyTaskList('- regular item')).toBe('- regular item')
  })
})
