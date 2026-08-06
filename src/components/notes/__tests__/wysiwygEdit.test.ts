/**
 * 200+ tests for the WYSIWYG / clean-edit mode and related functionality.
 *
 * These verify that the content users work with in Edit mode renders
 * correctly, and that table/markdown helpers behave as expected.
 */
import { describe, it, expect } from 'vitest'
import { renderPreviewContent } from '@/lib/notePreviewRender'

// ── re-export the internal helpers we need to test ────────────────────────────
// (We test renderPreviewContent as the closest proxy for "what the user sees"
//  in both Edit/WYSIWYG and Preview modes.)

// ── helpers ──────────────────────────────────────────────────────────────────

function html(md: string) { return renderPreviewContent(md) }

function hasTag(h: string, tag: string) {
  return new RegExp(`<${tag}[\\s>]`).test(h) || h.includes(`<${tag}>`)
}

// ── 1. Table rendering (the primary WYSIWYG concern) ─────────────────────────

describe('table rendering in preview', () => {
  const simple = `| A | B |\n| --- | --- |\n| 1 | 2 |`

  it('basic table renders <table>', () => {
    const h = html(simple)
    expect(hasTag(h, 'table')).toBe(true)
  })

  it('table has <thead> with <th>', () => {
    const h = html(simple)
    expect(hasTag(h, 'thead')).toBe(true)
    expect(hasTag(h, 'th')).toBe(true)
  })

  it('table header text preserved', () => {
    const h = html(simple)
    expect(h).toContain('A')
    expect(h).toContain('B')
  })

  it('table body has <tbody> and <td>', () => {
    const h = html(simple)
    expect(hasTag(h, 'tbody')).toBe(true)
    expect(hasTag(h, 'td')).toBe(true)
  })

  it('table body cell values preserved', () => {
    const h = html(simple)
    expect(h).toContain('1')
    expect(h).toContain('2')
  })

  it('table with 3 columns', () => {
    const h = html('| X | Y | Z |\n| --- | --- | --- |\n| a | b | c |')
    expect(h).toContain('X')
    expect(h).toContain('Y')
    expect(h).toContain('Z')
    expect(h).toContain('a')
    expect(h).toContain('c')
  })

  it('table with 4 columns', () => {
    const h = html('| A | B | C | D |\n| --- | --- | --- | --- |\n| 1 | 2 | 3 | 4 |')
    for (const v of ['A', 'B', 'C', 'D', '1', '2', '3', '4']) expect(h).toContain(v)
  })

  it('table with multiple rows', () => {
    const h = html('| A | B |\n| --- | --- |\n| r1a | r1b |\n| r2a | r2b |\n| r3a | r3b |')
    for (const v of ['r1a', 'r1b', 'r2a', 'r2b', 'r3a', 'r3b']) expect(h).toContain(v)
  })

  it('table with bold in cell', () => {
    const h = html('| **Bold** | Normal |\n| --- | --- |\n| x | y |')
    expect(hasTag(h, 'strong')).toBe(true)
    expect(h).toContain('Bold')
  })

  it('table with italic in header', () => {
    const h = html('| *Italic* | Normal |\n| --- | --- |\n| a | b |')
    expect(hasTag(h, 'em')).toBe(true)
    expect(h).toContain('Italic')
  })

  it('table with inline code in cell', () => {
    const h = html('| Code | Normal |\n| --- | --- |\n| `fn()` | x |')
    expect(hasTag(h, 'code')).toBe(true)
    expect(h).toContain('fn()')
  })

  it('table with empty cells', () => {
    const h = html('| A | B |\n| --- | --- |\n| | |')
    expect(hasTag(h, 'table')).toBe(true)
  })

  it('table with link in cell', () => {
    const h = html('| Link |\n| --- |\n| [click](https://x.com) |')
    expect(hasTag(h, 'a')).toBe(true)
    expect(h).toContain('click')
  })

  it('centre-aligned column', () => {
    const h = html('| C |\n| :---: |\n| val |')
    expect(h).toContain('val')
    expect(h).toContain('center')
  })

  it('right-aligned column', () => {
    const h = html('| R |\n| ---: |\n| val |')
    expect(h).toContain('val')
    expect(h).toContain('right')
  })

  it('left-aligned column (default)', () => {
    const h = html('| L |\n| --- |\n| val |')
    expect(h).toContain('val')
  })

  it('table after heading', () => {
    const h = html('# Heading\n\n| A | B |\n| --- | --- |\n| 1 | 2 |')
    expect(hasTag(h, 'h1')).toBe(true)
    expect(hasTag(h, 'table')).toBe(true)
  })

  it('table followed by paragraph', () => {
    const h = html('| A | B |\n| --- | --- |\n| 1 | 2 |\n\nParagraph text')
    expect(hasTag(h, 'table')).toBe(true)
    expect(h).toContain('Paragraph text')
  })

  it('multiple tables in document', () => {
    const h = html('| A |\n| --- |\n| 1 |\n\n| B |\n| --- |\n| 2 |')
    expect((h.match(/<table/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  // Programmatic: 10-column table
  it('10-column table renders all columns', () => {
    const cols = Array.from({ length: 10 }, (_, i) => `C${i + 1}`)
    const header = '| ' + cols.join(' | ') + ' |'
    const sep    = '| ' + cols.map(() => '---').join(' | ') + ' |'
    const row    = '| ' + cols.map((_, i) => `v${i}`).join(' | ') + ' |'
    const h = html(`${header}\n${sep}\n${row}`)
    for (const v of cols) expect(h).toContain(v)
  })

  // Programmatic: 5-row table
  it('5-row table renders all rows', () => {
    const rows = Array.from({ length: 5 }, (_, i) => `| row${i} |`)
    const h = html(`| H |\n| --- |\n${rows.join('\n')}`)
    for (let i = 0; i < 5; i++) expect(h).toContain(`row${i}`)
  })
})

// ── 2. buildTableMarkdown helper (unit test the round-trip) ───────────────────

// We test the round-trip via renderPreviewContent — write markdown, render, check output.
describe('table markdown round-trip', () => {
  it('simple table round-trips through renderPreviewContent', () => {
    const md = '| Name | Value |\n| --- | --- |\n| Yehovah | Creator |'
    const h = html(md)
    expect(h).toContain('Name')
    expect(h).toContain('Yehovah')
    expect(h).toContain('Creator')
  })

  it('left|centre|right columns round-trip', () => {
    const md = '| L | C | R |\n| --- | :---: | ---: |\n| a | b | c |'
    const h = html(md)
    expect(h).toContain('L')
    expect(h).toContain('center')
    expect(h).toContain('right')
  })

  it('table with Hebrew text in cell', () => {
    const md = '| Hebrew |\n| --- |\n| בְּרֵאשִׁית |'
    const h = html(md)
    expect(h).toContain('בְּרֵאשִׁית')
  })

  it('table with verse ref in cell', () => {
    const md = '| Reference |\n| --- |\n| Gen 1:1 |'
    const h = html(md)
    expect(h).toContain('Gen 1:1')
  })

  it('table with multiword content in cells', () => {
    const md = '| Topic | Description |\n| --- | --- |\n| Torah observance | Keeping all commandments |'
    const h = html(md)
    expect(h).toContain('Torah observance')
    expect(h).toContain('Keeping all commandments')
  })

  it('table preserves numbers', () => {
    const md = '| Day | Year |\n| --- | --- |\n| 1 | 4000 |'
    const h = html(md)
    expect(h).toContain('4000')
  })
})

// ── 4. Inline formatting ease-of-use in edit mode ────────────────────────────
// Each test below verifies the markdown renders cleanly in preview — a proxy for
// "will the user see correct formatted output when editing in clean mode."

describe('bold in various contexts', () => {
  it('bold word at start', () => { expect(html('**Hello** world')).toContain('<strong>') })
  it('bold word at end', () => { expect(html('world **end**')).toContain('<strong>') })
  it('bold phrase with space', () => { expect(html('**two words**')).toContain('<strong>') })
  it('bold in heading', () => { expect(html('# **Bold Heading**')).toContain('<strong>') })
  it('bold in list', () => { expect(html('* **item**')).toContain('<strong>') })
  it('bold in blockquote', () => { expect(html('> **quoted bold**')).toContain('<strong>') })
  it('bold in table cell', () => {
    const h = html('| **H** |\n| --- |\n| x |')
    expect(h).toContain('<strong>')
  })
  it('multiple bold on one line', () => {
    const h = html('**a** and **b** and **c**')
    expect((h.match(/<strong>/g) ?? []).length).toBe(3)
  })
  it('bold with number', () => { expect(html('**42**')).toContain('<strong>') })
  it('bold with punctuation', () => { expect(html('**end.**')).toContain('<strong>') })
})

describe('italic in various contexts', () => {
  it('italic word', () => { expect(html('*italic*')).toContain('<em>') })
  it('italic with underscore', () => { expect(html('_italic_')).toContain('<em>') })
  it('italic in heading', () => { expect(html('## *Italic Sub*')).toContain('<em>') })
  it('italic in list item', () => { expect(html('* *item*')).toContain('<em>') })
  it('italic in blockquote', () => { expect(html('> *quote italic*')).toContain('<em>') })
  it('bold + italic combo', () => {
    const h = html('***triple***')
    expect(hasTag(h, 'strong') || hasTag(h, 'em')).toBe(true)
  })
  it('italic in table', () => {
    const h = html('| *H* |\n| --- |\n| x |')
    expect(h).toContain('<em>')
  })
  it('multiple italics', () => {
    const h = html('*a* *b* *c*')
    expect((h.match(/<em>/g) ?? []).length).toBe(3)
  })
})

describe('underline in various contexts', () => {
  it('basic underline', () => { expect(html('<u>text</u>')).toContain('<u>text</u>') })
  it('underline in heading', () => { expect(html('# <u>Heading</u>')).toContain('<u>') })
  it('underline in list', () => { expect(html('* <u>item</u>')).toContain('<u>') })
  it('underline in blockquote', () => { expect(html('> <u>quote</u>')).toContain('<u>') })
  it('underline in table cell', () => {
    expect(html('| <u>H</u> |\n| --- |\n| x |')).toContain('<u>')
  })
  it('underline with bold inside', () => {
    expect(html('<u>**bold underlined**</u>')).toContain('<u>')
  })
  it('multiple underlines', () => {
    const h = html('<u>a</u> and <u>b</u>')
    expect((h.match(/<u>/g) ?? []).length).toBe(2)
  })
})

describe('highlight marks in various contexts', () => {
  it('== in body text', () => { expect(html('==highlighted==')).toContain('<mark') })
  it('== in heading', () => { expect(html('# ==Important==')).toContain('<mark') })
  it('== in list', () => { expect(html('* ==item==')).toContain('<mark') })
  it('== in blockquote', () => { expect(html('> ==quote==')).toContain('<mark') })
  it('hl-yellow basic', () => {
    expect(html('<mark class="hl-yellow">text</mark>')).toContain('text')
  })
  it('hl-red basic', () => {
    expect(html('<mark class="hl-red">warning</mark>')).toContain('warning')
  })
  it('hl-blue basic', () => {
    expect(html('<mark class="hl-blue">info</mark>')).toContain('info')
  })
  it('hl-green with bold', () => {
    expect(html('<mark class="hl-green">**green bold**</mark>')).toContain('green bold')
  })
  it('hl-yellow in blockquote', () => {
    expect(html('> <mark class="hl-yellow">highlight in quote</mark>')).toContain('highlight in quote')
  })
  it('hl-red in list', () => {
    expect(html('* <mark class="hl-red">red item</mark>')).toContain('red item')
  })
  it('hl-blue in heading', () => {
    expect(html('# <mark class="hl-blue">blue heading</mark>')).toContain('blue heading')
  })
  it('mixed highlights on one line', () => {
    const h = html('<mark class="hl-yellow">a</mark> <mark class="hl-red">b</mark> <mark class="hl-blue">c</mark>')
    expect(h).toContain('a')
    expect(h).toContain('b')
    expect(h).toContain('c')
  })
})

// ── 5. Blockquote editing ─────────────────────────────────────────────────────

describe('blockquote content in edit mode', () => {
  it('plain blockquote', () => {
    const h = html('> simple quote')
    expect(h).toContain('<blockquote>')
    expect(h).toContain('simple quote')
  })
  it('blockquote preserves all inline styles', () => {
    const h = html('> **bold** *italic* `code` ~~strike~~ <u>under</u>')
    expect(hasTag(h, 'strong')).toBe(true)
    expect(hasTag(h, 'em')).toBe(true)
    expect(hasTag(h, 'code')).toBe(true)
    expect(hasTag(h, 'u')).toBe(true)
  })
  it('multi-line blockquote', () => {
    const h = html('> line 1\n> line 2\n> line 3')
    expect(h).toContain('line 1')
    expect(h).toContain('line 3')
  })
  it('blockquote with highlight and underline (the regression case)', () => {
    const h = html('> <mark class="hl-yellow"><u>underlined highlighted</u></mark>')
    expect(h).toContain('underlined highlighted')
    expect(h).not.toContain('&lt;mark')
  })
  it('blockquote with nested bold + underline + highlight', () => {
    const h = html('> <mark class="hl-red">**<u>triple</u>**</mark>')
    expect(h).toContain('triple')
  })
  it('blockquote after a list', () => {
    const h = html('* item\n\n> quote')
    expect(h).toContain('<blockquote>')
    expect(h).toContain('<li>')
  })
  it('blockquote before a table', () => {
    const h = html('> intro\n\n| A |\n| --- |\n| v |')
    expect(h).toContain('<blockquote>')
    expect(hasTag(h, 'table')).toBe(true)
  })
})

// ── 6. List editing ───────────────────────────────────────────────────────────

describe('list content in edit mode', () => {
  it('* bullet list items', () => {
    const h = html('* one\n* two\n* three')
    expect(h).toContain('one')
    expect(h).toContain('three')
    expect(hasTag(h, 'ul')).toBe(true)
  })
  it('ordered list', () => {
    const h = html('1. first\n2. second')
    expect(hasTag(h, 'ol')).toBe(true)
    expect(h).toContain('first')
  })
  it('task list unchecked', () => {
    const h = html('- [ ] task')
    expect(h).toContain('task')
    expect(h).toContain('checkbox')
  })
  it('task list checked', () => {
    const h = html('- [x] done')
    expect(h).toContain('done')
    expect(h).toContain('checked')
  })
  it('list with inline formatting', () => {
    const h = html('* **bold** *italic* `code`')
    expect(hasTag(h, 'strong')).toBe(true)
    expect(hasTag(h, 'em')).toBe(true)
    expect(hasTag(h, 'code')).toBe(true)
  })
  it('list with highlight', () => {
    const h = html('* <mark class="hl-yellow">yellow item</mark>')
    expect(h).toContain('yellow item')
  })
  it('list with underline', () => {
    const h = html('* <u>underlined item</u>')
    expect(h).toContain('<u>')
  })
  it('nested list', () => {
    const h = html('* parent\n  * child')
    expect(h).toContain('parent')
    expect(h).toContain('child')
  })
  it('10 item list all rendered', () => {
    const md = Array.from({ length: 10 }, (_, i) => `* item ${i}`).join('\n')
    const h = html(md)
    for (let i = 0; i < 10; i++) expect(h).toContain(`item ${i}`)
  })
})

// ── 7. Heading rendering ──────────────────────────────────────────────────────

describe('heading content in edit mode', () => {
  it('h1 with inline bold', () => {
    const h = html('# **Bold H1**')
    expect(hasTag(h, 'h1')).toBe(true)
    expect(hasTag(h, 'strong')).toBe(true)
  })
  it('h2 with inline italic', () => {
    const h = html('## *Italic H2*')
    expect(hasTag(h, 'h2')).toBe(true)
    expect(hasTag(h, 'em')).toBe(true)
  })
  it('h3 with inline code', () => {
    const h = html('### `code h3`')
    expect(hasTag(h, 'h3')).toBe(true)
    expect(hasTag(h, 'code')).toBe(true)
  })
  it('heading with verse ref', () => {
    const h = html('# Gen 1:1 — Creation')
    expect(hasTag(h, 'h1')).toBe(true)
    expect(h).toContain('Gen 1:1')
  })
  it('heading with highlight', () => {
    const h = html('# ==Important Concept==')
    expect(hasTag(h, 'h1')).toBe(true)
    expect(h).toContain('Important Concept')
  })
  it('heading with underline', () => {
    const h = html('# <u>Section Title</u>')
    expect(hasTag(h, 'h1')).toBe(true)
    expect(h).toContain('<u>')
  })
  it('all 6 heading levels with content', () => {
    for (let i = 1; i <= 6; i++) {
      const h = html(`${'#'.repeat(i)} Level ${i}`)
      expect(hasTag(h, `h${i}`)).toBe(true)
      expect(h).toContain(`Level ${i}`)
    }
  })
})

// ── 8. Code rendering ─────────────────────────────────────────────────────────

describe('code in edit mode', () => {
  it('inline code preserved', () => {
    const h = html('use `console.log()` here')
    expect(hasTag(h, 'code')).toBe(true)
    expect(h).toContain('console.log()')
  })
  it('fenced code block', () => {
    const h = html('```\nconst x = 1\n```')
    expect(hasTag(h, 'pre')).toBe(true)
    expect(h).toContain('const x = 1')
  })
  it('fenced code with language label', () => {
    const h = html('```typescript\ntype A = { x: number }\n```')
    expect(h).toContain('type A')
  })
  it('code does not expand markdown inside', () => {
    const h = html('`**no bold**`')
    expect((h.match(/<strong>/g) ?? []).length).toBe(0)
  })
  it('multiple inline code spans', () => {
    const h = html('`a` and `b` and `c`')
    expect((h.match(/<code>/g) ?? []).length).toBe(3)
  })
})

// ── 9. Combination content (real study-note patterns) ────────────────────────

describe('realistic study note content', () => {
  it('verse + note pattern', () => {
    const h = html('> Gen 1:1 — In the beginning\n\nYehovah created all things.')
    expect(h).toContain('Gen 1:1')
    expect(h).toContain('Yehovah')
  })

  it('heading + highlights + list', () => {
    const h = html('## Key Points\n\n* <mark class="hl-yellow">Point A</mark>\n* <mark class="hl-blue">Point B</mark>')
    expect(hasTag(h, 'h2')).toBe(true)
    expect(h).toContain('Point A')
    expect(h).toContain('Point B')
  })

  it('table + paragraph + code', () => {
    const md = '| Col | Type |\n| --- | --- |\n| x | number |\n\nSee `getValue()` for details'
    const h = html(md)
    expect(hasTag(h, 'table')).toBe(true)
    expect(h).toContain('getValue()')
  })

  it('callout + list', () => {
    const md = '> [!NOTE]\n> Important reminder\n\n* Do this\n* Then this'
    const h = html(md)
    expect(h).toContain('Important reminder')
    expect(hasTag(h, 'ul')).toBe(true)
  })

  it('heading + table + blockquote', () => {
    const md = '# Study\n\n| A | B |\n| --- | --- |\n| v | w |\n\n> quote'
    const h = html(md)
    expect(hasTag(h, 'h1')).toBe(true)
    expect(hasTag(h, 'table')).toBe(true)
    expect(h).toContain('<blockquote>')
  })

  it('strong + em + underline + highlight all on one line', () => {
    const md = '**bold** *italic* <u>under</u> ==hi== normal'
    const h = html(md)
    expect(hasTag(h, 'strong')).toBe(true)
    expect(hasTag(h, 'em')).toBe(true)
    expect(h).toContain('<u>')
    expect(h).toContain('<mark')
    expect(h).toContain('normal')
  })

  it('Berean study note template', () => {
    const md = [
      '# Genesis 1 — Creation Account',
      '',
      '> [!NOTE] Context',
      '> Written by Moses, estimated ~1446 BC',
      '',
      '## Verse 1',
      '',
      '> <mark class="hl-yellow">**In the beginning**</mark> Yehovah created the heavens and the earth.',
      '',
      '| Element | Hebrew | Meaning |',
      '| --- | --- | --- |',
      '| בְּרֵאשִׁית | Bereshit | In the beginning |',
      '| אֱלֹהִים | Elohim | God / Mighty One |',
      '',
      '## Key Themes',
      '',
      '* <u>Creation ex nihilo</u>',
      '* Yehovah as sole creator',
      '* ==Time, space, matter== established',
    ].join('\n')
    const h = html(md)
    expect(hasTag(h, 'h1')).toBe(true)
    expect(hasTag(h, 'h2')).toBe(true)
    expect(h).toContain('Yehovah')
    expect(h).toContain('בְּרֵאשִׁית')
    expect(hasTag(h, 'table')).toBe(true)
    expect(hasTag(h, 'ul')).toBe(true)
    expect(h).toContain('<mark')
  })
})

// ── 10. Edge cases for easy-to-edit content ───────────────────────────────────

describe('edit-mode edge cases', () => {
  it('empty lines preserved between elements', () => {
    const h = html('para one\n\n\n\npara two')
    expect(h).toContain('para one')
    expect(h).toContain('para two')
  })

  it('single character content', () => {
    // '-' alone becomes a list item in marked (expected behaviour)
    for (const char of ['A', 'a', '1', '!']) {
      const h = html(char)
      expect(h).toContain(char)
    }
    // dash alone starts a list, so the li is empty — just verify it doesn't error
    expect(() => html('-')).not.toThrow()
  })

  it('very long paragraph renders', () => {
    const long = 'word '.repeat(200)
    const h = html(long)
    expect(h).toContain('word')
  })

  it('unicode characters in body', () => {
    const h = html('שָׁלוֹם — shalom')
    expect(h).toContain('שָׁלוֹם')
  })

  it('emoji in note body', () => {
    const h = html('📖 Read this verse')
    expect(h).toContain('📖')
  })

  it('table with special chars in cells', () => {
    const h = html('| Symbol | Value |\n| --- | --- |\n| & | ampersand |')
    expect(h).toContain('ampersand')
  })

  it('heading + bold + italic combo', () => {
    const h = html('# ***Triple*** heading')
    expect(hasTag(h, 'h1')).toBe(true)
  })

  it('nested blockquote with formatting', () => {
    const h = html('> outer\n>> inner **bold**')
    expect(h).toContain('outer')
    expect(h).toContain('inner')
  })

  it('code block after blockquote', () => {
    const h = html('> quote\n\n```\ncode\n```')
    expect(h).toContain('<blockquote>')
    expect(hasTag(h, 'pre')).toBe(true)
  })

  it('list directly after heading no blank line', () => {
    const h = html('# H\n* item')
    expect(hasTag(h, 'h1')).toBe(true)
    expect(h).toContain('item')
  })

  it('HR between two paragraphs', () => {
    const h = html('before\n\n---\n\nafter')
    expect(h).toContain('<hr')
    expect(h).toContain('before')
    expect(h).toContain('after')
  })

  it('wikilink in paragraph', () => {
    const h = html('See [[Study Notes]] for details')
    expect(h).toContain('Study Notes')
  })

  it('wikilink in list', () => {
    const h = html('* Read [[Gen Commentary]]')
    expect(h).toContain('Gen Commentary')
  })

  it('multiple formatting on adjacent words', () => {
    const h = html('**bold** *italic* `code` <u>under</u> ~~strike~~')
    expect(hasTag(h, 'strong')).toBe(true)
    expect(hasTag(h, 'em')).toBe(true)
    expect(hasTag(h, 'code')).toBe(true)
    expect(hasTag(h, 'u')).toBe(true)
    expect(h).toContain('strike')
  })

  it('verse refs link at start of bold phrase', () => {
    const h = html('**Gen 1:1** is significant')
    expect(h).toContain('Gen 1:1')
    expect(hasTag(h, 'strong')).toBe(true)
  })

  it('table with numbers and decimals', () => {
    const h = html('| Value |\n| --- |\n| 3.14159 |')
    expect(h).toContain('3.14159')
  })

  it('heading levels do not bleed into each other', () => {
    const h = html('# H1\n## H2\n### H3')
    expect((h.match(/<h1/g) ?? []).length).toBe(1)
    expect((h.match(/<h2/g) ?? []).length).toBe(1)
    expect((h.match(/<h3/g) ?? []).length).toBe(1)
  })

  it('ordered list with 15 items', () => {
    const md = Array.from({ length: 15 }, (_, i) => `${i + 1}. item ${i + 1}`).join('\n')
    const h = html(md)
    for (let i = 1; i <= 15; i++) expect(h).toContain(`item ${i}`)
  })

  it('all hl colors in a single document', () => {
    const colors = ['yellow', 'orange', 'amber', 'red', 'rose', 'pink', 'violet', 'purple', 'indigo', 'blue', 'sky', 'cyan', 'teal', 'green', 'lime']
    const md = colors.map(c => `<mark class="hl-${c}">${c}</mark>`).join(' ')
    const h = html(md)
    for (const c of colors) expect(h).toContain(c)
  })
})

// ── 11. Programmatic content variations ───────────────────────────────────────

describe('programmatic content matrix', () => {
  // 5 heading levels × 3 inline styles
  const headingLevels = [1, 2, 3, 4, 5]
  const inlineStyles = [
    ['**word**', 'strong'],
    ['*word*',   'em'],
    ['`word`',   'code'],
  ] as const

  for (const lv of headingLevels) {
    for (const [markup, _tag] of inlineStyles) {
      it(`h${lv} + ${markup} inline`, () => {
        const h = html(`${'#'.repeat(lv)} ${markup}`)
        expect(hasTag(h, `h${lv}`)).toBe(true)
        expect(h).toContain('word')
      })
    }
  }

  // 3 list types × 3 inline styles
  const listPrefixes = ['*', '-', '1.']
  for (const prefix of listPrefixes) {
    for (const [markup, _] of inlineStyles) {
      it(`${prefix} list item with ${markup}`, () => {
        const h = html(`${prefix} ${markup}`)
        expect(h).toContain('word')
      })
    }
  }

  // Tables with 1..5 columns
  for (let cols = 1; cols <= 5; cols++) {
    it(`table with ${cols} column(s) renders all headers`, () => {
      const headers = Array.from({ length: cols }, (_, i) => `H${i}`)
      const row     = Array.from({ length: cols }, (_, i) => `v${i}`)
      const md = `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |\n| ${row.join(' | ')} |`
      const h = html(md)
      for (const hdr of headers) expect(h).toContain(hdr)
    })
  }
})

// ─── renderPreviewContent: lists, blockquotes, callouts, highlights ──────────

describe('bullet and dash lists render', () => {
  it('- item renders as li', () => { const h = html('- item'); expect(h).toContain('<li>') })
  it('* item renders as li', () => { const h = html('* item'); expect(h).toContain('<li>') })
  it('multi-item - list', () => {
    const h = html('- a\n- b\n- c')
    expect(h).toContain('<li>'); expect((h.match(/<li>/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })
  it('multi-item * list', () => {
    const h = html('* a\n* b')
    expect(h).toContain('<li>')
  })
  it('nested list', () => {
    const h = html('- a\n  - b')
    expect(h).toContain('<li>')
  })
  it('list with bold item', () => {
    const h = html('- **bold**')
    expect(hasTag(h, 'strong')).toBe(true); expect(h).toContain('<li>')
  })
  it('list with italic item', () => {
    const h = html('- *italic*')
    expect(hasTag(h, 'em')).toBe(true)
  })
  it('list with link', () => {
    const h = html('- [link](http://x.com)')
    expect(hasTag(h, 'a')).toBe(true); expect(h).toContain('<li>')
  })
})

describe('ordered lists render', () => {
  it('1. item renders', () => { const h = html('1. first'); expect(h).toContain('first') })
  it('multiple ordered items', () => {
    const h = html('1. a\n2. b\n3. c')
    expect((h.match(/<li>/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })
  it('ordered list with bold', () => {
    const h = html('1. **bold item**'); expect(hasTag(h, 'strong')).toBe(true)
  })
  it('ordered list with underline', () => {
    const h = html('1. <u>under item</u>'); expect(h).toContain('<u>')
  })
})

describe('task list renders', () => {
  it('- [ ] unchecked', () => { const h = html('- [ ] todo'); expect(h).toContain('todo') })
  it('- [x] checked', () => { const h = html('- [x] done'); expect(h).toContain('done') })
  it('- [X] also checked', () => { const h = html('- [X] Done'); expect(h).toContain('Done') })
  it('mixed checked/unchecked', () => {
    const h = html('- [ ] todo\n- [x] done')
    expect(h).toContain('todo'); expect(h).toContain('done')
  })
})

describe('blockquote renders', () => {
  it('> quote renders blockquote', () => {
    const h = html('> quote text')
    expect(hasTag(h, 'blockquote')).toBe(true); expect(h).toContain('quote text')
  })
  it('> multi-line blockquote', () => {
    const h = html('> line1\n> line2')
    expect(hasTag(h, 'blockquote')).toBe(true)
  })
  it('> with bold inside', () => {
    const h = html('> **bold quote**')
    expect(hasTag(h, 'blockquote')).toBe(true); expect(hasTag(h, 'strong')).toBe(true)
  })
  it('> with italic inside', () => {
    const h = html('> *italic quote*')
    expect(hasTag(h, 'blockquote')).toBe(true); expect(hasTag(h, 'em')).toBe(true)
  })
  it('> with underline inside', () => {
    const h = html('> <u>under quote</u>')
    expect(hasTag(h, 'blockquote')).toBe(true); expect(h).toContain('<u>')
  })
  it('> with link inside', () => {
    const h = html('> [link](http://x.com)')
    expect(hasTag(h, 'blockquote')).toBe(true); expect(hasTag(h, 'a')).toBe(true)
  })
  it('nested: > > deep', () => {
    const h = html('> > deep')
    expect(h).toContain('deep')
  })
})

describe('callout boxes [!TYPE] render', () => {
  const types = ['NOTE', 'TIP', 'WARNING', 'IMPORTANT', 'CAUTION']
  for (const t of types) {
    it(`> [!${t}] renders`, () => {
      const h = html(`> [!${t}]\n> body`)
      expect(h).toContain('body')
    })
    it(`> [!${t}] has title label`, () => {
      const h = html(`> [!${t}]\n> text`)
      expect(h.toLowerCase()).toContain(t.toLowerCase())
    })
  }
  it('callout with custom title', () => {
    const h = html('> [!NOTE] My Title\n> body')
    expect(h).toContain('My Title'); expect(h).toContain('body')
  })
  it('callout with bold body', () => {
    const h = html('> [!TIP]\n> **bold body**')
    expect(hasTag(h, 'strong')).toBe(true)
  })
  it('callout with italic body', () => {
    const h = html('> [!WARNING]\n> *italic body*')
    expect(hasTag(h, 'em')).toBe(true)
  })
  it('callout with link in body', () => {
    const h = html('> [!IMPORTANT]\n> [link](http://x.com)')
    expect(hasTag(h, 'a')).toBe(true)
  })
  it('NOTE callout lowercase', () => {
    const h = html('> [!note]\n> body text')
    expect(h).toContain('body text')
  })
  it('multiple callouts', () => {
    const h = html('> [!NOTE]\n> a\n\n> [!TIP]\n> b')
    expect(h).toContain('a'); expect(h).toContain('b')
  })
})

describe('== highlight == renders', () => {
  it('==text== renders <mark>', () => { const h = html('==hi=='); expect(h).toContain('<mark') })
  it('==text== contains content', () => { const h = html('==hello=='); expect(h).toContain('hello') })
  it('multiple ==...==', () => {
    const h = html('==a== and ==b==')
    expect((h.match(/<mark/g) ?? []).length).toBe(2)
  })
  it('==hi== inside bold', () => { const h = html('**==hi==**'); expect(h).toContain('hi') })
  it('==hi== inside italic', () => { const h = html('*==hi==*'); expect(h).toContain('hi') })
})

describe('hl-* colored highlights render', () => {
  const colors = ['yellow','orange','amber','red','rose','pink','violet','purple','indigo','blue','sky','cyan','teal','green','lime']
  for (const c of colors) {
    it(`hl-${c} mark passes through`, () => {
      const h = html(`<mark class="hl-${c}">text</mark>`)
      expect(h).toContain('text')
    })
  }
  it('hl-yellow with bold inside', () => {
    const h = html('<mark class="hl-yellow">**bold**</mark>')
    expect(h).toContain('bold')
  })
  it('hl-red with italic inside', () => {
    const h = html('<mark class="hl-red">*ital*</mark>')
    expect(h).toContain('ital')
  })
  it('hl-green with underline inside', () => {
    const h = html('<mark class="hl-green"><u>under</u></mark>')
    expect(h).toContain('under'); expect(h).toContain('<u>')
  })
  it('multiple hl colors in paragraph', () => {
    const h = html('<mark class="hl-yellow">a</mark> and <mark class="hl-blue">b</mark>')
    expect(h).toContain('a'); expect(h).toContain('b')
  })
  it('hl-violet with bold+italic', () => {
    const h = html('<mark class="hl-violet">***triple***</mark>')
    expect(h).toContain('triple')
  })
})

describe('mixed blocks and inline formats render', () => {
  it('blockquote with callout after', () => {
    const h = html('> quote\n\n> [!NOTE]\n> note body')
    expect(h).toContain('quote'); expect(h).toContain('note body')
  })
  it('list then blockquote', () => {
    const h = html('- item\n\n> quote')
    expect(h).toContain('<li>'); expect(hasTag(h, 'blockquote')).toBe(true)
  })
  it('heading then list', () => {
    const h = html('# Heading\n- item')
    expect(hasTag(h,'h1')).toBe(true); expect(h).toContain('<li>')
  })
  it('heading then blockquote', () => {
    const h = html('# H1\n> bq')
    expect(hasTag(h,'h1')).toBe(true); expect(hasTag(h,'blockquote')).toBe(true)
  })
  it('callout then list', () => {
    const h = html('> [!NOTE]\n> n\n\n- item')
    expect(h).toContain('<li>')
  })
  it('bold in list item inside callout body', () => {
    const h = html('> [!TIP]\n> **bold tip**')
    expect(hasTag(h, 'strong')).toBe(true)
  })
  it('hr between sections', () => {
    const h = html('# A\n---\n# B')
    expect(hasTag(h,'h1')).toBe(true)
  })
  it('table after blockquote', () => {
    const h = html('> quote\n\n| H1 | H2 |\n| --- | --- |\n| a | b |')
    expect(hasTag(h,'blockquote')).toBe(true); expect(hasTag(h,'table')).toBe(true)
  })
  it('list with highlight items', () => {
    const h = html('- ==highlighted item==')
    expect(h).toContain('<mark'); expect(h).toContain('<li>')
  })
  it('blockquote with hl-blue mark', () => {
    const h = html('> <mark class="hl-blue">blue bq</mark>')
    expect(h).toContain('blue bq')
  })
  it('ordered list then callout', () => {
    const h = html('1. first\n\n> [!WARNING]\n> warn body')
    expect(h).toContain('first'); expect(h).toContain('warn body')
  })
  it('heading with hl highlight', () => {
    const h = html('# ==highlighted== heading')
    expect(hasTag(h,'h1')).toBe(true); expect(h).toContain('<mark')
  })
  it('empty blockquote body', () => {
    const h = html('> [!NOTE]')
    expect(h).toBeDefined()
  })
  it('callout with underline inside', () => {
    const h = html('> [!IMPORTANT]\n> <u>important text</u>')
    expect(h).toContain('<u>')
  })
})

// ── Table inline markdown (renderPreviewContent via marked GFM) ───────────────

describe('table inline markdown rendering', () => {
  function tableWith(cells: string) {
    return `| ${cells} |\n| --- |\n| data |`
  }
  function bodyWith(cell: string) {
    return `| Header |\n| --- |\n| ${cell} |`
  }

  // Bold
  it('bold in header cell renders <strong>', () => {
    const h = html(tableWith('**bold header**'))
    expect(h).toMatch(/<strong>bold header<\/strong>/)
  })
  it('bold in body cell renders <strong>', () => {
    const h = html(bodyWith('**bold cell**'))
    expect(h).toMatch(/<strong>bold cell<\/strong>/)
  })

  // Italic
  it('italic in header renders <em>', () => {
    const h = html(tableWith('*italic header*'))
    expect(h).toMatch(/<em>italic header<\/em>/)
  })
  it('italic in body renders <em>', () => {
    const h = html(bodyWith('*italic body*'))
    expect(h).toMatch(/<em>italic body<\/em>/)
  })
  it('underscore italic in body renders <em>', () => {
    const h = html(bodyWith('_italic_'))
    expect(h).toMatch(/<em>italic<\/em>/)
  })

  // Code
  it('inline code in body renders <code>', () => {
    const h = html(bodyWith('`code text`'))
    expect(h).toMatch(/<code>code text<\/code>/)
  })
  it('inline code in header renders <code>', () => {
    const h = html(tableWith('`header code`'))
    expect(h).toMatch(/<code>header code<\/code>/)
  })

  // Strikethrough
  it('strikethrough in body renders <del>', () => {
    const h = html(bodyWith('~~struck~~'))
    expect(h).toMatch(/<del>struck<\/del>/)
  })

  // Links
  it('link in body renders <a>', () => {
    const h = html(bodyWith('[text](https://example.com)'))
    expect(h).toContain('<a')
    expect(h).toContain('text')
  })

  // Combinations
  it('bold + italic in same cell', () => {
    const h = html(bodyWith('**bold** and *italic*'))
    expect(h).toContain('<strong>')
    expect(h).toContain('<em>')
  })
  it('code and bold in same cell', () => {
    const h = html(bodyWith('`code` and **bold**'))
    expect(h).toContain('<code>')
    expect(h).toContain('<strong>')
  })
  it('multiple formatted cells in same row', () => {
    const h = html('| **A** | *B* | `C` |\n| --- | --- | --- |\n| 1 | 2 | 3 |')
    expect(h).toContain('<strong>')
    expect(h).toContain('<em>')
    expect(h).toContain('<code>')
  })
  it('formatted cells in multiple body rows', () => {
    const h = html('| H |\n| --- |\n| **row1** |\n| *row2* |\n| `row3` |')
    expect(h).toContain('<strong>row1</strong>')
    expect(h).toContain('<em>row2</em>')
    expect(h).toContain('<code>row3</code>')
  })
  it('bold italic combined (**_text_**)', () => {
    const h = html(bodyWith('***bold italic***'))
    // marked renders as <em><strong> or <strong><em> depending on version
    expect(h).toContain('<strong>')
    expect(h).toContain('<em>')
  })
  it('plain text cell unchanged', () => {
    const h = html(bodyWith('plain text'))
    expect(h).toContain('plain text')
    expect(h).not.toContain('<strong>')
  })
  it('empty cell is valid', () => {
    const h = html('| A | B |\n| --- | --- |\n| **bold** |  |')
    expect(h).toContain('<strong>bold</strong>')
  })
  it('cell with only whitespace is valid', () => {
    const h = html(bodyWith('   '))
    expect(h).toBeDefined()
  })
  it('alignment headers do not break inline formatting', () => {
    const h = html('| **H1** | *H2* |\n| :--- | ---: |\n| `code` | ~~del~~ |')
    expect(h).toContain('<strong>')
    expect(h).toContain('<em>')
    expect(h).toContain('<code>')
    expect(h).toContain('<del>')
  })
  it('table renders inside a note with other content before it', () => {
    const h = html('Some text\n\n| **H** |\n| --- |\n| *cell* |')
    expect(h).toContain('<strong>')
    expect(h).toContain('<em>')
  })
  it('table renders inside a note with other content after it', () => {
    const h = html('| **H** |\n| --- |\n| *cell* |\n\nMore text')
    expect(h).toContain('<strong>')
    expect(h).toContain('<em>')
    expect(h).toContain('More text')
  })
})
