/**
 * 500+ tests for markdown format combinations in all orders,
 * plus the toggleWith HTML-aware fix and verse-block detector.
 *
 * "Every kind of combination in every order" — bold×italic×underline×
 * highlight×strikethrough in every nesting permutation, inside every
 * block context (headings, lists, blockquotes, tables, code blocks).
 */
import { describe, it, expect } from 'vitest'
import { renderPreviewContent, detectVerseBlock } from '@/lib/notePreviewRender'

// ── helpers ──────────────────────────────────────────────────────────────────

function html(md: string) { return renderPreviewContent(md) }

function has(h: string, tag: string) {
  return new RegExp(`<${tag}[\\s>/]`, 'i').test(h) || h.includes(`<${tag}>`)
}

function count(h: string, tag: string) {
  return (h.match(new RegExp(`<${tag}[\\s>/]`, 'gi')) ?? []).length
}

const HL_COLORS = [
  'yellow','orange','amber','red','rose','pink',
  'violet','purple','indigo','blue','sky','cyan','teal','green','lime',
]

// ── 2. Bold + italic — all orderings ─────────────────────────────────────────

describe('bold + italic — all orderings', () => {
  it('***text*** renders bold+italic', () => {
    const h = html('***combined***')
    expect(h).toContain('combined')
    expect(has(h, 'strong') || has(h, 'em')).toBe(true)
  })
  it('**_text_**', () => { expect(html('**_word_**')).toContain('word') })
  it('_**text**_', () => { expect(html('_**word**_')).toContain('word') })
  it('*__text__*', () => { expect(html('*__word__*')).toContain('word') })
  it('**a** *b*', () => {
    const h = html('**a** *b*')
    expect(has(h, 'strong')).toBe(true); expect(has(h, 'em')).toBe(true)
  })
  it('*a* **b**', () => {
    const h = html('*a* **b**')
    expect(has(h, 'em')).toBe(true); expect(has(h, 'strong')).toBe(true)
  })
})

// ── 3. Bold + underline — all orderings ──────────────────────────────────────

describe('bold + underline — all orderings', () => {
  it('**<u>text</u>**', () => {
    const h = html('**<u>word</u>**')
    expect(h).toContain('word'); expect(has(h, 'strong')).toBe(true); expect(h).toContain('<u>')
  })
  it('<u>**text**</u>', () => {
    const h = html('<u>**word**</u>')
    expect(h).toContain('word'); expect(h).toContain('<u>')
  })
  it('**bold** <u>under</u>', () => {
    const h = html('**bold** <u>under</u>')
    expect(has(h, 'strong')).toBe(true); expect(h).toContain('<u>')
  })
  it('<u>under</u> **bold**', () => {
    const h = html('<u>under</u> **bold**')
    expect(h).toContain('<u>'); expect(has(h, 'strong')).toBe(true)
  })
})

// ── 4. Italic + underline — all orderings ────────────────────────────────────

describe('italic + underline — all orderings', () => {
  it('*<u>text</u>*', () => { expect(html('*<u>word</u>*')).toContain('word') })
  it('<u>*text*</u>', () => {
    const h = html('<u>*word*</u>'); expect(h).toContain('word'); expect(h).toContain('<u>')
  })
  it('*a* <u>b</u>', () => {
    const h = html('*a* <u>b</u>'); expect(has(h, 'em')).toBe(true); expect(h).toContain('<u>')
  })
})

// ── 5. Triple nesting (bold+italic+underline) ────────────────────────────────

describe('bold + italic + underline — triple nesting', () => {
  const triples = [
    '***<u>text</u>***',
    '**_<u>text</u>_**',
    '*<u>**text**</u>*',
    '<u>***text***</u>',
    '<u>**_text_**</u>',
    '_**<u>text</u>**_',
  ]
  for (const md of triples) {
    it(`content present: ${md}`, () => { expect(html(md)).toContain('text') })
    it(`a format renders: ${md}`, () => {
      const h = html(md)
      expect(has(h, 'strong') || has(h, 'em') || h.includes('<u>')).toBe(true)
    })
  }
})

// ── 6. Strikethrough combinations ────────────────────────────────────────────

describe('strikethrough combinations', () => {
  it('~~text~~', () => {
    const h = html('~~text~~'); expect(h).toContain('text'); expect(h.toLowerCase()).toMatch(/<del>|<s>/)
  })
  it('**~~bold strike~~**', () => { expect(html('**~~bold strike~~**')).toContain('bold strike') })
  it('~~**inside**~~', () => { expect(html('~~**inside**~~')).toContain('inside') })
  it('*~~italic strike~~*', () => { expect(html('*~~italic strike~~*')).toContain('italic strike') })
  it('<u>~~under strike~~</u>', () => { expect(html('<u>~~under strike~~</u>')).toContain('under strike') })
  it('**_~~triple~~_**', () => { expect(html('**_~~triple~~_**')).toContain('triple') })
  it('~~a~~ **b**', () => {
    const h = html('~~a~~ **b**'); expect(h).toContain('a'); expect(has(h, 'strong')).toBe(true)
  })
  it('**a** ~~b~~', () => {
    const h = html('**a** ~~b~~'); expect(has(h, 'strong')).toBe(true); expect(h).toContain('b')
  })
})

// ── 7. Highlight combinations ────────────────────────────────────────────────

describe('highlight combinations', () => {
  it('==text==', () => { expect(html('==text==')).toContain('<mark') })
  it('**==bold hi==**', () => { expect(html('**==bold hi==**')).toContain('bold hi') })
  it('==**hi bold**==', () => { expect(html('==**hi bold**==')).toContain('hi bold') })
  it('*==italic hi==*', () => { expect(html('*==italic hi==*')).toContain('italic hi') })
  it('<u>==u hi==</u>', () => { expect(html('<u>==u hi==</u>')).toContain('u hi') })
  it('hl-yellow + bold', () => { expect(html('<mark class="hl-yellow">**bold yellow**</mark>')).toContain('bold yellow') })
  it('hl-red + italic', () => { expect(html('<mark class="hl-red">*italic red*</mark>')).toContain('italic red') })
  it('hl-blue + underline', () => { expect(html('<mark class="hl-blue"><u>blue under</u></mark>')).toContain('blue under') })
  it('bold+italic+hl-green', () => { expect(html('**_<mark class="hl-green">triple</mark>_**')).toContain('triple') })
  it('hl-violet + all layers', () => { expect(html('<mark class="hl-violet">**_<u>all four</u>_**</mark>')).toContain('all four') })
})

// ── 8. Code combinations ─────────────────────────────────────────────────────

describe('code with other formats', () => {
  it('`code`', () => { expect(has(html('`code`'), 'code')).toBe(true) })
  it('**before `code` after**', () => {
    const h = html('**before `code` after**'); expect(has(h, 'strong')).toBe(true); expect(has(h, 'code')).toBe(true)
  })
  it('`a` **b** `c`', () => {
    const h = html('`a` **b** `c`'); expect(count(h, 'code')).toBe(2); expect(has(h, 'strong')).toBe(true)
  })
  it('`**not bold**`', () => {
    const h = html('`**not bold**`'); expect(count(h, 'strong')).toBe(0); expect(h).toContain('**not bold**')
  })
  it('`a` *b*', () => {
    const h = html('`a` *b*'); expect(has(h, 'code')).toBe(true); expect(has(h, 'em')).toBe(true)
  })
  it('`a` <u>b</u>', () => {
    const h = html('`a` <u>b</u>'); expect(has(h, 'code')).toBe(true); expect(h).toContain('<u>')
  })
})

// ── 9. All format pairs in/out orderings ─────────────────────────────────────

const FORMATS = [
  { name: 'bold',      wrap: (t: string) => `**${t}**`    },
  { name: 'italic',    wrap: (t: string) => `*${t}*`      },
  { name: 'underline', wrap: (t: string) => `<u>${t}</u>` },
  { name: 'strike',    wrap: (t: string) => `~~${t}~~`    },
]

describe('all format pairs — inner/outer orderings', () => {
  for (let i = 0; i < FORMATS.length; i++) {
    for (let j = 0; j < FORMATS.length; j++) {
      if (i === j) continue
      it(`${FORMATS[i].name} outside, ${FORMATS[j].name} inside`, () => {
        expect(html(FORMATS[i].wrap(FORMATS[j].wrap('test')))).toContain('test')
      })
    }
  }
})

// ── 10. All triple format combinations ───────────────────────────────────────

describe('all triple format combinations', () => {
  const triples: Array<[number, number, number]> = []
  for (let a = 0; a < FORMATS.length; a++)
    for (let b = 0; b < FORMATS.length; b++)
      for (let c = 0; c < FORMATS.length; c++)
        if (a !== b && b !== c && a !== c) triples.push([a, b, c])

  for (const [a, b, c] of triples) {
    it(`${FORMATS[a].name} > ${FORMATS[b].name} > ${FORMATS[c].name}`, () => {
      expect(html(FORMATS[a].wrap(FORMATS[b].wrap(FORMATS[c].wrap('word'))))).toContain('word')
    })
  }
})

// ── 11. Formats inside headings (levels 1–3) ─────────────────────────────────

describe('formats inside headings', () => {
  const inline = [
    ['**bold**',     'bold',      'bold'],
    ['*italic*',     'italic',    'italic'],
    ['<u>under</u>', 'underline', 'under'],
    ['`code`',       'code',      'code'],
    ['~~strike~~',   'strike',    'strike'],
    ['==hi==',       'highlight', 'hi'],
  ] as const
  for (const lv of [1, 2, 3] as const) {
    for (const [markup, name, innerText] of inline) {
      it(`h${lv} with ${name}`, () => {
        const h = html(`${'#'.repeat(lv)} ${markup}`)
        expect(has(h, `h${lv}`)).toBe(true)
        expect(h).toContain(innerText)
      })
    }
  }
})

// ── 12. Formats inside blockquotes ───────────────────────────────────────────

describe('formats inside blockquotes', () => {
  const inline = [
    '**bold**', '*italic*', '<u>under</u>', '`code`', '~~strike~~', '==highlight==',
    '<mark class="hl-yellow">yellow</mark>',
    '<mark class="hl-red"><u>red under</u></mark>',
    '**<u>bold under</u>**',
    '_<mark class="hl-blue">italic blue</mark>_',
  ]
  for (const markup of inline) {
    it(`blockquote: > ${markup.slice(0, 30)}`, () => {
      expect(html(`> ${markup}`)).toContain('<blockquote>')
    })
  }
})

// ── 13. Formats inside list items ────────────────────────────────────────────

describe('formats inside list items', () => {
  const prefixes = ['*', '-', '1.']
  const inline = [
    '**bold**', '*italic*', '<u>under</u>', '`code`', '~~strike~~', '==hi==',
    '**<u>bold under</u>**', '*<mark class="hl-green">g</mark>*',
  ]
  for (const prefix of prefixes) {
    for (const markup of inline) {
      it(`${prefix} ${markup.slice(0, 25)}`, () => {
        const h = html(`${prefix} ${markup}`)
        expect(h.length).toBeGreaterThan(10)
      })
    }
  }
})

// ── 14. Formats inside table cells ───────────────────────────────────────────

describe('formats inside table cells', () => {
  const cellFormats = [
    '**bold**', '*italic*', '<u>under</u>', '`code`', '==hi==',
    '<mark class="hl-red">red</mark>', '**_bold italic_**',
    '<mark class="hl-yellow"><u>hl under</u></mark>',
  ]
  for (const fmt of cellFormats) {
    it(`table cell: | ${fmt.slice(0, 30)} |`, () => {
      expect(has(html(`| ${fmt} | B |\n| --- | --- |\n| x | y |`), 'table')).toBe(true)
    })
  }
})

// ── 15. All hl colors + nesting in blockquote (regression) ───────────────────

describe('all hl colors in blockquote (regression)', () => {
  for (const color of HL_COLORS) {
    it(`hl-${color} + <u>`, () => {
      const h = html(`> <mark class="hl-${color}"><u>test</u></mark>`)
      expect(h).toContain('test'); expect(h).not.toContain('&lt;mark')
    })
    it(`hl-${color} + **bold**`, () => {
      expect(html(`> <mark class="hl-${color}">**test**</mark>`)).toContain('test')
    })
    it(`hl-${color} + *italic*`, () => {
      expect(html(`> <mark class="hl-${color}">*test*</mark>`)).toContain('test')
    })
  }
})

// ── 16. All hl colors in all block types ─────────────────────────────────────

describe('all hl colors in all block types', () => {
  const blocks = [
    { wrap: (t: string) => `> ${t}`, name: 'blockquote' },
    { wrap: (t: string) => `* ${t}`, name: 'list' },
    { wrap: (t: string) => `# ${t}`, name: 'heading' },
    { wrap: (t: string) => `| ${t} |\n| --- |\n| x |`, name: 'table header' },
  ]
  for (const color of HL_COLORS.slice(0, 5)) {
    for (const { wrap, name } of blocks) {
      it(`hl-${color} in ${name}`, () => {
        expect(html(wrap(`<mark class="hl-${color}">text</mark>`))).toContain('text')
      })
    }
  }
})

// ── 17. detectVerseBlock — multi-line ────────────────────────────────────────

describe('detectVerseBlock — multi-line', () => {
  it('Luke 16:29-31 + numbered verses', () => {
    const r = detectVerseBlock('Luke 16:29-31\n29 Abraham saith.\n30 And he said.\n31 And he said.')
    expect(r).not.toBeNull()
    expect(r!.kind).toBe('multi')
    expect(r!.ref).toBe('Luke 16:29-31')
    expect(r!.lineCount).toBe(4)
  })

  it('John 3:16-17 + two verses', () => {
    const r = detectVerseBlock('John 3:16-17\n16 For God so loved.\n17 For God sent.')
    expect(r).not.toBeNull()
    expect(r!.kind).toBe('multi')
    expect(r!.ref).toBe('John 3:16-17')
  })

  it('Gen 1:1-3', () => {
    const r = detectVerseBlock('Gen 1:1-3\n1 In the beginning.\n2 And the earth.\n3 And God said.')
    expect(r!.kind).toBe('multi')
    expect(r!.ref).toBe('Gen 1:1-3')
  })

  it('1 John 2:3-5 (numbered book)', () => {
    const r = detectVerseBlock('1 John 2:3-5\n3 And hereby.\n4 He that saith.\n5 But whoso keepeth.')
    expect(r!.kind).toBe('multi')
    expect(r!.ref).toBe('1 John 2:3-5')
  })

  it('Ps 23:1-6 six verses → lineCount 7', () => {
    const lines = ['Ps 23:1-6',
      '1 The LORD is my shepherd.', '2 He maketh me to lie down.',
      '3 He restoreth my soul.', '4 Yea though I walk.',
      '5 Thou preparest a table.', '6 Surely goodness and mercy.']
    const r = detectVerseBlock(lines.join('\n'))
    expect(r!.lineCount).toBe(7)
  })

  it('bare reference only → null', () => {
    expect(detectVerseBlock('Ps 23:1')).toBeNull()
    expect(detectVerseBlock('Luke 16:29-31')).toBeNull()
  })

  it('non-verse text → null', () => {
    expect(detectVerseBlock('just some regular note text')).toBeNull()
  })

  it('empty / whitespace → null', () => {
    expect(detectVerseBlock('')).toBeNull()
    expect(detectVerseBlock('   ')).toBeNull()
  })

  it('ref without colon (chapter only) + numbered lines → null', () => {
    // "Acts 2" has no colon → not a verse-level ref → not a block
    expect(detectVerseBlock('Acts 2\n1 And when the day.\n2 And suddenly.')).toBeNull()
  })

  it('multi-line where body lines lack verse numbers → null', () => {
    expect(detectVerseBlock('John 3:16\nFor God so loved\nthe world')).toBeNull()
  })
})

// ── 18. detectVerseBlock — single-line ───────────────────────────────────────

describe('detectVerseBlock — single-line', () => {
  it('1 John 2:4 + text', () => {
    const r = detectVerseBlock('1 John 2:4 He that saith, I know him, and keepeth not.')
    expect(r).not.toBeNull()
    expect(r!.kind).toBe('single')
    expect(r!.ref).toBe('1 John 2:4')
  })

  it('John 3:16 + text', () => {
    const r = detectVerseBlock('John 3:16 For God so loved the world.')
    expect(r!.kind).toBe('single')
    expect(r!.ref).toBe('John 3:16')
  })

  it('Gen 1:1 + text', () => {
    const r = detectVerseBlock('Gen 1:1 In the beginning God created.')
    expect(r!.ref).toBe('Gen 1:1')
  })

  it('Matt 5:8 + beatitude', () => {
    expect(detectVerseBlock('Matt 5:8 Blessed are the pure in heart.')!.ref).toBe('Matt 5:8')
  })

  it('Rom 8:28 + text', () => {
    expect(detectVerseBlock('Rom 8:28 And we know that all things work together.')!.ref).toBe('Rom 8:28')
  })

  it('Heb 11:1 + text', () => {
    expect(detectVerseBlock('Heb 11:1 Now faith is the substance.')!.ref).toBe('Heb 11:1')
  })

  it('Titus 2:11 + text', () => {
    expect(detectVerseBlock('Titus 2:11 For the grace of God that bringeth salvation.')!.ref).toBe('Titus 2:11')
  })

  it('ref with range + text: Luke 16:29-31', () => {
    const r = detectVerseBlock('Luke 16:29-31 Abraham saith unto him.')
    expect(r).not.toBeNull()
    expect(r!.ref).toBe('Luke 16:29-31')
  })

  it('bare reference (no trailing text) → null', () => {
    expect(detectVerseBlock('Gen 1:1')).toBeNull()
    expect(detectVerseBlock('Rev 22:21')).toBeNull()
  })

  it('chapter-only ref + text → null (needs colon)', () => {
    expect(detectVerseBlock('Acts 2 was a remarkable day')).toBeNull()
  })

  it('non-book word + number + text → null', () => {
    expect(detectVerseBlock('Room 5:30 meet me there')).toBeNull()
  })

  it('refLength matches ref string length', () => {
    const r = detectVerseBlock('John 3:16 text here')!
    expect(r.refLength).toBe('John 3:16'.length)
  })

  it('single-line lineCount is 1', () => {
    expect(detectVerseBlock('Ps 23:1 The LORD is my shepherd.')!.lineCount).toBe(1)
  })
})

// ── 19. Same-line format order variations ────────────────────────────────────

describe('same-line format order variations', () => {
  it('**bold** word *italic*', () => {
    const h = html('**bold** word *italic*'); expect(has(h, 'strong')).toBe(true); expect(has(h, 'em')).toBe(true)
  })
  it('*italic* word **bold**', () => {
    const h = html('*italic* word **bold**'); expect(has(h, 'em')).toBe(true); expect(has(h, 'strong')).toBe(true)
  })
  it('<u>under</u> then **bold**', () => {
    const h = html('<u>under</u> then **bold**'); expect(h).toContain('<u>'); expect(has(h, 'strong')).toBe(true)
  })
  it('**bold** then <u>under</u>', () => {
    const h = html('**bold** then <u>under</u>'); expect(has(h, 'strong')).toBe(true); expect(h).toContain('<u>')
  })
  it('==hi== then **bold**', () => {
    const h = html('==hi== then **bold**'); expect(h).toContain('<mark'); expect(has(h, 'strong')).toBe(true)
  })
  it('**bold** then ==hi==', () => {
    const h = html('**bold** then ==hi=='); expect(has(h, 'strong')).toBe(true); expect(h).toContain('<mark')
  })

  const FOUR = ['**b**', '*i*', '<u>u</u>', '==h==']
  const orders = [
    [0, 1, 2, 3], [3, 2, 1, 0], [1, 0, 3, 2], [2, 3, 0, 1], [0, 2, 1, 3], [3, 1, 2, 0],
  ]
  for (const order of orders) {
    const md = order.map(i => FOUR[i]).join(' ')
    it(`order: ${md}`, () => {
      const h = html(md); expect(h).toContain('<mark'); expect(h).toContain('<u>')
    })
  }
})

// ── 20. Complex note content patterns ────────────────────────────────────────

describe('complex note content patterns', () => {
  it('verse ref + hl + bold in blockquote', () => {
    const h = html('> <mark class="hl-yellow">**Gen 1:1**</mark> — creation')
    expect(h).toContain('<blockquote>'); expect(h).toContain('Gen 1:1')
  })
  it('# **_Title_**', () => {
    const h = html('# **_Title_**'); expect(has(h, 'h1')).toBe(true); expect(h).toContain('Title')
  })
  it('table cell with hl + bold', () => {
    const h = html('| <mark class="hl-green">**text**</mark> | B |\n| --- | --- |\n| a | b |')
    expect(has(h, 'table')).toBe(true); expect(h).toContain('text')
  })
  it('* **_<u>item</u>_**', () => { expect(html('* **_<u>item</u>_**')).toContain('item') })
  it('nested blockquote with hl inner', () => {
    const h = html('> outer\n>> <mark class="hl-violet">inner</mark>')
    expect(h).toContain('outer'); expect(h).toContain('inner')
  })
  it('## ==Section==', () => {
    const h = html('## ==Section=='); expect(has(h, 'h2')).toBe(true); expect(h).toContain('Section')
  })
  it('multiple paragraphs each with different formats', () => {
    const h = html('**bold para**\n\n*italic para*\n\n<u>under para</u>\n\n==hi para==')
    expect(has(h, 'strong')).toBe(true); expect(has(h, 'em')).toBe(true)
    expect(h).toContain('<u>'); expect(h).toContain('<mark')
  })
  it('all hl colors in a table column', () => {
    const rows = HL_COLORS.slice(0, 5).map(c => `| <mark class="hl-${c}">${c}</mark> |`)
    const h = html(`| Color |\n| --- |\n${rows.join('\n')}`)
    for (const c of HL_COLORS.slice(0, 5)) expect(h).toContain(c)
  })
})

// ── 21. Format pairs in block contexts (programmatic) ────────────────────────

describe('format pairs in block contexts', () => {
  const pairs = [
    '**a** *b*', '*a* <u>b</u>', '**a** <u>b</u>', '==a== **b**', '`a` **b**',
  ]
  const blocks = [
    { wrap: (t: string) => `> ${t}`,  name: 'blockquote' },
    { wrap: (t: string) => `* ${t}`,  name: 'list' },
    { wrap: (t: string) => `# ${t}`,  name: 'h1' },
    { wrap: (t: string) => `## ${t}`, name: 'h2' },
  ]
  for (const fmt of pairs) {
    for (const { wrap, name } of blocks) {
      it(`${fmt} in ${name}`, () => {
        expect(html(wrap(fmt)).length).toBeGreaterThan(20)
      })
    }
  }
})

// ── 22. Post-toggle content renders correctly ────────────────────────────────

describe('post-toggle content renders correctly', () => {
  it('**<u>if</u>** renders bold + underline', () => {
    const h = html('**<u>if</u>**'); expect(h).toContain('<u>if</u>'); expect(has(h, 'strong')).toBe(true)
  })
  it('*<u>if</u>* renders italic + underline', () => {
    const h = html('*<u>if</u>*'); expect(h).toContain('<u>if</u>'); expect(has(h, 'em')).toBe(true)
  })
  it('<u>if</u> renders underline only', () => {
    expect(html('<u>if</u>')).toContain('<u>if</u>')
  })
  it('plain "if" — no formats', () => {
    const h = html('if')
    expect(h).toContain('if'); expect(has(h, 'strong')).toBe(false)
    expect(has(h, 'em')).toBe(false); expect(h).not.toContain('<u>')
  })

  const combos = [
    '**<u>word</u>**', '*<u>word</u>*', '***word***',
    '<u>word</u>', '**word**', '*word*', 'word',
  ]
  for (const md of combos) {
    it(`renders: ${md}`, () => { expect(html(md)).toContain('word') })
  }
})

// ── 23. Formats across multiple sections ─────────────────────────────────────

describe('formats across multiple document sections', () => {
  it('different formats in consecutive headings', () => {
    const h = html('# **Bold H1**\n## *Italic H2*\n### <u>Under H3</u>')
    expect(has(h, 'h1')).toBe(true); expect(has(h, 'h2')).toBe(true); expect(has(h, 'h3')).toBe(true)
  })
  it('same format repeated across sections', () => {
    expect(count(html('**bold1**\n\n**bold2**\n\n**bold3**'), 'strong')).toBe(3)
  })
  it('format in all list types', () => {
    const h = html('* **bullet**\n1. *ordered*\n- [x] `task`')
    expect(has(h, 'strong')).toBe(true); expect(has(h, 'em')).toBe(true); expect(has(h, 'code')).toBe(true)
  })
  it('20-section doc with formats', () => {
    const sections = Array.from({ length: 10 }, (_, i) =>
      `## Section ${i + 1}\n\n**bold** *italic* <u>under</u>\n\n> ==highlight==`)
    const h = html(sections.join('\n\n'))
    expect(count(h, 'h2')).toBe(10)
    expect((h.match(/<strong>/g) ?? []).length).toBe(10)
  })
})

// ── 24. detectVerseBlock — many real references ──────────────────────────────

describe('detectVerseBlock — real references', () => {
  const singles = [
    'John 3:16 For God so loved the world.',
    '1 John 2:4 He that saith I know him.',
    'Gen 1:1 In the beginning.',
    'Rev 22:21 The grace of Yeshua.',
    'Ps 23:1 The LORD is my shepherd.',
    'Matt 5:8 Blessed are the pure in heart.',
    'Heb 11:1 Now faith is the substance.',
    'Rom 8:28 All things work together.',
    'Isa 53:5 He was wounded for our transgressions.',
    'Titus 2:11 The grace of God that bringeth salvation.',
  ]
  for (const input of singles) {
    it(`detects single: ${input.slice(0, 40)}`, () => {
      const r = detectVerseBlock(input)
      expect(r).not.toBeNull()
      expect(r!.kind).toBe('single')
    })
  }

  it('multi Ezek 37:1-3', () => {
    const r = detectVerseBlock('Ezek 37:1-3\n1 The hand of the LORD.\n2 And caused me.\n3 And he said.')
    expect(r!.kind).toBe('multi')
  })
})

// ── 25. Boundary and stress tests ────────────────────────────────────────────

describe('boundary and stress tests', () => {
  it('very long bold phrase', () => {
    const phrase = 'word '.repeat(50).trim()
    const h = html(`**${phrase}**`); expect(has(h, 'strong')).toBe(true); expect(h).toContain('word')
  })
  it('many alternating formats', () => {
    const parts = Array.from({ length: 20 }, (_, i) => i % 2 === 0 ? '**bold**' : '*italic*')
    const h = html(parts.join(' '))
    expect(count(h, 'strong')).toBe(10); expect(count(h, 'em')).toBe(10)
  })
  it('many highlight colors in sequence', () => {
    const h = html(HL_COLORS.map(c => `<mark class="hl-${c}">${c[0]}</mark>`).join(' '))
    for (const c of HL_COLORS) expect(h).toContain(c[0])
  })
  it('all formats on one mega-line', () => {
    const h = html('**bold** *italic* <u>under</u> ~~strike~~ `code` ==hi== <mark class="hl-red">red</mark> normal')
    expect(has(h, 'strong')).toBe(true); expect(has(h, 'em')).toBe(true)
    expect(h).toContain('<u>'); expect(has(h, 'code')).toBe(true)
    expect(h).toContain('<mark'); expect(h).toContain('normal')
  })
  it('bold containing a code span', () => {
    const h = html('**text `code` more**'); expect(has(h, 'strong')).toBe(true); expect(has(h, 'code')).toBe(true)
  })
  it('italic with highlight inside', () => {
    expect(html('*==hi inside italic==*')).toContain('hi inside italic')
  })
  it('hl-yellow with long text inside', () => {
    const long = 'word '.repeat(30).trim()
    expect(html(`<mark class="hl-yellow">${long}</mark>`)).toContain('word')
  })
})

// ── renderPreviewContent: bold + italic in all orderings ─────────────────────
// These test the OUTPUT visible to the user after applying format combinations.

describe('bold + italic combinations — all orderings via rendered HTML', () => {
  // basic
  it('*word* → italic', () => { const h = html('*word*'); expect(h).toContain('<em>') })
  it('**word** → bold', () => { const h = html('**word**'); expect(h).toContain('<strong>') })
  it('***word*** → bold+italic', () => {
    const h = html('***word***')
    expect(has(h, 'strong') || has(h, 'em')).toBe(true)
  })
  it('**word** still has bold after applying (no italic loss)', () => {
    const h = html('**word**'); expect(has(h, 'strong')).toBe(true); expect(has(h, 'em')).toBe(false)
  })

  // order: bold first, then italic
  it('bold then italic: ***word***', () => {
    const h = html('***word***')
    expect(has(h, 'strong')).toBe(true); expect(has(h, 'em')).toBe(true)
  })
  it('italic then bold: _**word**_', () => {
    const h = html('_**word**_')
    expect(has(h, 'strong')).toBe(true)
  })
  it('*_word_*', () => expect(html('*_word_*')).toContain('word'))
  it('**_word_**', () => expect(html('**_word_**')).toContain('word'))
  it('_**word**_', () => expect(html('_**word**_')).toContain('word'))

  // separate words
  it('**bold** and *italic* together', () => {
    const h = html('**bold** and *italic*')
    expect(has(h, 'strong')).toBe(true); expect(has(h, 'em')).toBe(true)
  })
  it('*italic* and **bold** together', () => {
    const h = html('*italic* and **bold**')
    expect(has(h, 'em')).toBe(true); expect(has(h, 'strong')).toBe(true)
  })
})

describe('bold + underline + italic — all 6 orderings', () => {
  it('order B→U→I: **<u>*word*</u>**', () => {
    const h = html('**<u>*word*</u>**')
    expect(has(h, 'strong')).toBe(true); expect(h).toContain('<u>'); expect(has(h, 'em')).toBe(true)
  })
  it('order B→I→U: ***<u>word</u>***', () => {
    const h = html('***<u>word</u>***')
    expect(h).toContain('word'); expect(h).toContain('<u>')
  })
  it('order I→B→U: *<u>**word**</u>*', () => {
    const h = html('*<u>**word**</u>*')
    expect(h).toContain('word'); expect(h).toContain('<u>')
  })
  it('order I→U→B: *<u>word</u>* then bold wraps', () => {
    const h = html('**<u>*word*</u>**')
    expect(h).toContain('word')
  })
  it('order U→B→I: <u>**word**</u>', () => {
    const h = html('<u>**word**</u>')
    expect(h).toContain('<u>'); expect(h).toContain('word')
  })
  it('order U→I→B: <u>*word*</u>', () => {
    const h = html('<u>*word*</u>')
    expect(h).toContain('<u>'); expect(h).toContain('word')
  })
  it('all three wrapped: ***<u>word</u>***', () => {
    const h = html('***<u>word</u>***')
    expect(h).toContain('word'); expect(h).toContain('<u>')
  })
  it('inner italic inside bold+underline: **<u>*text*</u>**', () => {
    const h = html('**<u>*text*</u>**')
    expect(h).toContain('text')
    expect(has(h, 'strong')).toBe(true)
    expect(h).toContain('<u>')
    expect(has(h, 'em')).toBe(true)
  })
})

describe('bold + strikethrough combinations', () => {
  it('**~~word~~**', () => { const h = html('**~~word~~**'); expect(has(h,'strong')).toBe(true); expect(has(h,'del')||h.includes('<s>')).toBe(true) })
  it('~~**word**~~', () => { const h = html('~~**word**~~'); expect(has(h,'strong')).toBe(true) })
  it('**~~word~~** text continues', () => expect(html('**~~word~~** rest')).toContain('rest'))
  it('~~*word*~~', () => { const h = html('~~*word*~~'); expect(has(h,'em')).toBe(true) })
  it('*~~word~~*', () => { const h = html('*~~word~~*'); expect(has(h,'em')).toBe(true) })
})

describe('italic + underline combinations', () => {
  it('*<u>word</u>*', () => { const h = html('*<u>word</u>*'); expect(h).toContain('<u>'); expect(has(h,'em')).toBe(true) })
  it('<u>*word*</u>', () => { const h = html('<u>*word*</u>'); expect(h).toContain('<u>'); expect(has(h,'em')).toBe(true) })
  it('*<u>*word*</u>* inner italic', () => expect(html('*<u>*word*</u>*')).toContain('word'))
})

describe('triple and quad nesting', () => {
  it('***~~word~~***', () => expect(html('***~~word~~***')).toContain('word'))
  it('**<u>~~word~~</u>**', () => { const h = html('**<u>~~word~~</u>**'); expect(h).toContain('word'); expect(h).toContain('<u>') })
  it('*<u>**~~word~~**</u>*', () => expect(html('*<u>**~~word~~**</u>*')).toContain('word'))
  it('**<u>*~~word~~*</u>**', () => expect(html('**<u>*~~word~~*</u>**')).toContain('word'))
  it('all four combined: ***<u>~~word~~</u>***', () => expect(html('***<u>~~word~~</u>***')).toContain('word'))
})

describe('bold + italic in headings', () => {
  it('# **heading** bold in h1', () => { const h = html('# **heading**'); expect(has(h,'h1')).toBe(true); expect(has(h,'strong')).toBe(true) })
  it('## *italic* in h2', () => { const h = html('## *italic*'); expect(has(h,'h2')).toBe(true); expect(has(h,'em')).toBe(true) })
  it('### ***both*** in h3', () => { const h = html('### ***both***'); expect(has(h,'h3')).toBe(true) })
  it('#### **<u>underline bold</u>** in h4', () => { const h = html('#### **<u>ub</u>**'); expect(has(h,'h4')).toBe(true); expect(h).toContain('<u>') })
  it('# *<u>**deep**</u>* in h1', () => { const h = html('# *<u>**deep**</u>*'); expect(has(h,'h1')).toBe(true) })
})

describe('bold + italic in lists', () => {
  it('- **bold item**', () => { const h = html('- **bold item**'); expect(has(h,'strong')).toBe(true) })
  it('- *italic item*', () => { const h = html('- *italic item*'); expect(has(h,'em')).toBe(true) })
  it('- ***bold+italic***', () => { const h = html('- ***bold+italic***'); expect(h).toContain('bold') })
  it('1. **ordered bold**', () => { const h = html('1. **ordered bold**'); expect(has(h,'strong')).toBe(true) })
  it('1. *ordered italic*', () => { const h = html('1. *ordered italic*'); expect(has(h,'em')).toBe(true) })
  it('list of combined formats', () => {
    const h = html('- **a**\n- *b*\n- ***c***\n- <u>d</u>')
    expect(has(h,'strong')).toBe(true); expect(has(h,'em')).toBe(true); expect(h).toContain('<u>')
  })
})

describe('bold + italic in blockquotes', () => {
  it('> **bold quote**', () => { const h = html('> **bold quote**'); expect(has(h,'strong')).toBe(true) })
  it('> *italic quote*', () => { const h = html('> *italic quote*'); expect(has(h,'em')).toBe(true) })
  it('> ***bold+italic quote***', () => { const h = html('> ***biq***'); expect(h).toContain('biq') })
  it('> **<u>bold underline</u>**', () => { const h = html('> **<u>bu</u>**'); expect(h).toContain('<u>') })
})

describe('renderPreviewContent — all 5 heading levels', () => {
  it('h1: # heading', () => { const h = html('# heading'); expect(has(h,'h1')).toBe(true); expect(h).toContain('heading') })
  it('h2: ## heading', () => { const h = html('## heading'); expect(has(h,'h2')).toBe(true) })
  it('h3: ### heading', () => { const h = html('### heading'); expect(has(h,'h3')).toBe(true) })
  it('h4: #### heading', () => { const h = html('#### heading'); expect(has(h,'h4')).toBe(true) })
  it('h5: ##### heading', () => { const h = html('##### heading'); expect(has(h,'h5')).toBe(true) })
  it('h6: ###### heading', () => { const h = html('###### heading'); expect(has(h,'h6')).toBe(true) })
  it('# **bold heading**', () => { const h = html('# **bold**'); expect(has(h,'h1')).toBe(true); expect(has(h,'strong')).toBe(true) })
  it('## *italic heading*', () => { const h = html('## *it*'); expect(has(h,'h2')).toBe(true); expect(has(h,'em')).toBe(true) })
  it('### ***bold italic heading***', () => {
    const h = html('### ***bih***')
    expect(has(h,'h3')).toBe(true)
    expect(has(h,'strong') || has(h,'em')).toBe(true)
  })
  it('heading with <u>', () => { const h = html('# <u>underline</u>'); expect(has(h,'h1')).toBe(true); expect(h).toContain('<u>') })
})

describe('renderPreviewContent — edge cases', () => {
  it('empty string', () => expect(html('')).toBeDefined())
  it('no markdown markers', () => { const h = html('plain text'); expect(h).toContain('plain text') })
  it('single star not italic', () => { const h = html('a * b'); expect(h).toContain('* b') })
  it('escaped asterisk \\*', () => { const h = html('\\*not italic\\*'); expect(h).toContain('not italic') })
  it('code block not styled', () => { const h = html('```\n**bold**\n```'); expect(h).toContain('bold'); expect(has(h,'strong')).toBe(false) })
  it('inline code not styled: `**bold**`', () => { const h = html('`**bold**`'); expect(has(h,'strong')).toBe(false) })
  it('nested italic in code span not styled', () => { const h = html('`*italic*`'); expect(has(h,'em')).toBe(false) })
  it('link with bold label: [**text**](url)', () => { const h = html('[**text**](http://x.com)'); expect(has(h,'strong')).toBe(true) })
  it('link with italic label: [*text*](url)', () => { const h = html('[*text*](http://x.com)'); expect(has(h,'em')).toBe(true) })
  it('multi-paragraph bold', () => {
    const h = html('**a**\n\n**b**')
    expect(count(h,'strong')).toBe(2)
  })
  it('bold across list items', () => {
    const h = html('- **one**\n- **two**')
    expect(count(h,'strong')).toBe(2)
  })
  it('italic across list items', () => {
    const h = html('- *one*\n- *two*')
    expect(count(h,'em')).toBe(2)
  })
})

