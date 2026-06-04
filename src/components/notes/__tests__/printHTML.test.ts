/**
 * Comprehensive tests for buildPrintHTML and renderPreviewContent.
 *
 * Verifies that every markdown/formatting element the note editor supports
 * is correctly converted to styled HTML for print and PDF export.
 */
import { describe, it, expect, beforeAll } from 'vitest'

let buildPrintHTML: (title: string, content: string) => string
let renderPreviewContent: (content: string) => string

beforeAll(async () => {
  const mod = await import('../NoteEditor')
  buildPrintHTML = mod.buildPrintHTML
  renderPreviewContent = mod.renderPreviewContent
})

// ── helpers ────────────────────────────────────────────────────────────────────
function preview(md: string) { return renderPreviewContent(md) }
function print(md: string, title = 'Test') { return buildPrintHTML(title, md) }

// ── 1. buildPrintHTML document structure ──────────────────────────────────────

describe('buildPrintHTML — document structure', () => {
  it('produces a complete HTML document', () => {
    const html = print('Hello')
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<html>')
    expect(html).toContain('<head>')
    expect(html).toContain('<body>')
    expect(html).toContain('</html>')
  })

  it('includes charset meta tag', () => {
    expect(print('x')).toContain('charset="utf-8"')
  })

  it('sets the title from the note title', () => {
    expect(print('content', 'My Study Note')).toContain('<title>My Study Note</title>')
  })

  it('renders h1.note-doc-title with the note title', () => {
    const html = print('content', 'Genesis Study')
    expect(html).toContain('<h1 class="note-doc-title">Genesis Study</h1>')
  })

  it('escapes HTML special chars in title', () => {
    const html = print('body', '<script>alert("xss")</script>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('escapes ampersand in title', () => {
    expect(print('body', 'Faith & Works')).toContain('Faith &amp; Works')
  })

  it('includes @page CSS for print margins', () => {
    expect(print('x')).toContain('@page')
  })

  it('includes berean-verse-ref CSS rule', () => {
    expect(print('x')).toContain('a.berean-verse-ref')
  })

  it('includes berean-verse-block CSS rule', () => {
    expect(print('x')).toContain('.berean-verse-block')
  })

  it('includes mark element CSS', () => {
    expect(print('x')).toContain('mark {')
  })

  it('includes del/strikethrough CSS', () => {
    const html = print('x')
    expect(html).toContain('del')
  })

  it('includes table CSS', () => {
    const html = print('x')
    expect(html).toContain('border-collapse: collapse')
  })

  it('includes code block CSS', () => {
    expect(print('x')).toContain('pre {')
  })

  it('includes page-break-inside: avoid for pre', () => {
    expect(print('x')).toContain('page-break-inside: avoid')
  })

  it('handles empty content gracefully', () => {
    const html = print('', 'Empty Note')
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('Empty Note')
  })
})

// ── 2. Headings ──────────────────────────────────────────────────────────────

describe('buildPrintHTML — headings', () => {
  it('renders # as <h1>', () => {
    expect(preview('# Heading One')).toContain('<h1>Heading One</h1>')
  })

  it('renders ## as <h2>', () => {
    expect(preview('## Heading Two')).toContain('<h2>Heading Two</h2>')
  })

  it('renders ### as <h3>', () => {
    expect(preview('### Heading Three')).toContain('<h3>Heading Three</h3>')
  })

  it('renders #### as <h4>', () => {
    expect(preview('#### Heading Four')).toContain('<h4>Heading Four</h4>')
  })

  it('renders ##### as <h5>', () => {
    expect(preview('##### Heading Five')).toContain('<h5>Heading Five</h5>')
  })

  it('renders ###### as <h6>', () => {
    expect(preview('###### Heading Six')).toContain('<h6>Heading Six</h6>')
  })

  it('heading with bold inside', () => {
    expect(preview('## **Bold** heading')).toContain('<strong>Bold</strong>')
  })
})

// ── 3. Text formatting ────────────────────────────────────────────────────────

describe('buildPrintHTML — text formatting', () => {
  it('renders **bold** as <strong>', () => {
    expect(preview('**bold text**')).toContain('<strong>bold text</strong>')
  })

  it('renders __bold__ as <strong>', () => {
    expect(preview('__bold text__')).toContain('<strong>bold text</strong>')
  })

  it('renders *italic* as <em>', () => {
    expect(preview('*italic text*')).toContain('<em>italic text</em>')
  })

  it('renders _italic_ as <em>', () => {
    expect(preview('_italic text_')).toContain('<em>italic text</em>')
  })

  it('renders ~~strikethrough~~ as <del>', () => {
    expect(preview('~~struck out~~')).toContain('<del>struck out</del>')
  })

  it('renders <u>underline</u> as underlined text (HTML passthrough)', () => {
    const html = preview('<u>underlined</u>')
    expect(html).toContain('<u>underlined</u>')
  })

  it('renders **bold** inside <u>', () => {
    const html = preview('<u>**bold underline**</u>')
    expect(html).toContain('<u>')
    expect(html).toContain('bold underline')
  })

  it('renders ==highlight== as <mark>', () => {
    const html = preview('==highlighted text==')
    expect(html).toContain('<mark')
    expect(html).toContain('highlighted text')
    expect(html).toContain('</mark>')
  })

  it('==highlight== preserves inner content', () => {
    const html = preview('See ==this word== here')
    expect(html).toContain('this word')
    expect(html).toMatch(/<mark[^>]*>this word<\/mark>/)
  })

  it('multiple ==highlights== in one paragraph', () => {
    const html = preview('==first== and ==second==')
    const marks = (html.match(/<mark/g) || []).length
    expect(marks).toBeGreaterThanOrEqual(2)
  })

  it('inline `code` renders as <code>', () => {
    expect(preview('use `const x = 1` here')).toContain('<code>const x = 1</code>')
  })

  it('bold + italic combined ***text***', () => {
    const html = preview('***combined***')
    expect(html).toContain('<strong>')
    expect(html).toContain('<em>')
  })
})

// ── 4. Paragraphs & line breaks ───────────────────────────────────────────────

describe('buildPrintHTML — paragraphs', () => {
  it('wraps plain text in <p>', () => {
    expect(preview('Simple paragraph')).toContain('<p>Simple paragraph</p>')
  })

  it('two paragraphs separated by blank line', () => {
    const html = preview('Para one\n\nPara two')
    expect(html).toContain('<p>Para one</p>')
    expect(html).toContain('<p>Para two</p>')
  })

  it('hard line break (two spaces) renders as <br>', () => {
    const html = preview('Line one  \nLine two')
    expect(html).toContain('<br>')
  })
})

// ── 5. Code blocks ────────────────────────────────────────────────────────────

describe('buildPrintHTML — code blocks', () => {
  it('fenced code block renders as <pre><code>', () => {
    const html = preview('```\nconst x = 1\n```')
    expect(html).toContain('<pre>')
    expect(html).toContain('<code>')
    expect(html).toContain('const x = 1')
  })

  it('fenced code block with language hint', () => {
    const html = preview('```javascript\nconst y = 2\n```')
    expect(html).toContain('<pre>')
    expect(html).toContain('const y = 2')
  })

  it('code block does not process markdown inside', () => {
    const html = preview('```\n**not bold**\n```')
    expect(html).not.toContain('<strong>')
    expect(html).toContain('**not bold**')
  })

  it('indented code block (4 spaces)', () => {
    const html = preview('    indented code')
    expect(html).toContain('<code>')
    expect(html).toContain('indented code')
  })
})

// ── 6. Blockquotes ────────────────────────────────────────────────────────────

describe('buildPrintHTML — blockquotes', () => {
  it('> quote renders as <blockquote>', () => {
    const html = preview('> This is a quote')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('This is a quote')
  })

  it('blockquote can contain bold', () => {
    const html = preview('> **Bold** in quote')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('<strong>Bold</strong>')
  })

  it('multi-line blockquote', () => {
    const html = preview('> Line one\n> Line two')
    expect(html).toContain('<blockquote>')
  })
})

// ── 7. Ordered lists ──────────────────────────────────────────────────────────

describe('buildPrintHTML — ordered lists', () => {
  it('1. item renders as <ol><li>', () => {
    const html = preview('1. First item\n2. Second item')
    expect(html).toContain('<ol>')
    expect(html).toContain('<li>')
    expect(html).toContain('First item')
    expect(html).toContain('Second item')
  })

  it('ordered list items can contain bold', () => {
    const html = preview('1. **Bold** item')
    expect(html).toContain('<strong>Bold</strong>')
  })

  it('ordered list contains closing </ol>', () => {
    expect(preview('1. Item')).toContain('</ol>')
  })
})

// ── 8. Unordered / dash lists ─────────────────────────────────────────────────

describe('buildPrintHTML — dash lists', () => {
  it('- item renders as <ul>', () => {
    const html = preview('- Item one\n- Item two')
    expect(html).toContain('<ul')
    expect(html).toContain('<li>')
    expect(html).toContain('Item one')
    expect(html).toContain('Item two')
  })

  it('dash list wrapped in single <ul>', () => {
    const html = preview('- A\n- B\n- C')
    const ulCount = (html.match(/<ul/g) || []).length
    expect(ulCount).toBe(1)
  })

  it('dash list items can have bold text', () => {
    const html = preview('- **Bold** item')
    expect(html).toContain('<strong>Bold</strong>')
  })

  it('dash list contains closing </ul>', () => {
    expect(preview('- Item')).toContain('</ul>')
  })
})

// ── 9. Task lists ─────────────────────────────────────────────────────────────

describe('buildPrintHTML — task lists', () => {
  it('- [ ] renders as unchecked checkbox in <ul>', () => {
    const html = preview('- [ ] Unchecked task')
    expect(html).toContain('<ul')
    expect(html).toContain('<li')
    expect(html).toContain('<input')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('Unchecked task')
    expect(html).not.toContain('checked=""')
  })

  it('- [x] renders as checked checkbox', () => {
    const html = preview('- [x] Done task')
    expect(html).toContain('checked')
    expect(html).toContain('Done task')
  })

  it('- [X] (uppercase) also renders as checked', () => {
    const html = preview('- [X] Done task')
    expect(html).toContain('checked')
  })

  it('mixed task list wrapped in single <ul>', () => {
    const html = preview('- [ ] Todo\n- [x] Done\n- [ ] Another')
    const ulCount = (html.match(/<ul/g) || []).length
    expect(ulCount).toBe(1)
  })

  it('completed task has line-through style', () => {
    const html = preview('- [x] Completed')
    expect(html).toContain('line-through')
  })

  it('uncompleted task has no line-through', () => {
    const html = preview('- [ ] Pending')
    const liMatch = html.match(/<li[^>]*>[\s\S]*?Pending/)
    expect(liMatch).toBeTruthy()
    // The li for unchecked should NOT have line-through
    const liTag = html.match(/<li[^>]*>/)
    expect(liTag?.[0]).not.toContain('line-through')
  })

  it('task text can include bold', () => {
    const html = preview('- [ ] **Important** task')
    expect(html).toContain('<strong>Important</strong>')
  })

  it('task text can include inline code', () => {
    const html = preview('- [ ] Run `npm install`')
    expect(html).toContain('<code>npm install</code>')
  })

  it('task list checkbox is disabled', () => {
    const html = preview('- [ ] Item')
    expect(html).toContain('disabled')
  })

  it('task list separated from regular dash list', () => {
    const html = preview('- [ ] Task\n\n- Regular item')
    expect(html).toContain('Regular item')
  })
})

// ── 10. Tables ────────────────────────────────────────────────────────────────

describe('buildPrintHTML — tables', () => {
  const tableContent = '| A | B |\n|---|---|\n| 1 | 2 |'

  it('renders markdown table as <table>', () => {
    expect(preview(tableContent)).toContain('<table>')
  })

  it('table has <thead>', () => {
    expect(preview(tableContent)).toContain('<thead>')
  })

  it('table has <tbody>', () => {
    expect(preview(tableContent)).toContain('<tbody>')
  })

  it('table headers render as <th>', () => {
    expect(preview(tableContent)).toContain('<th>')
  })

  it('table cells render as <td>', () => {
    expect(preview(tableContent)).toContain('<td>')
  })

  it('table cell content is preserved', () => {
    const html = preview(tableContent)
    expect(html).toContain('A')
    expect(html).toContain('B')
    expect(html).toContain('1')
    expect(html).toContain('2')
  })

  it('table with bold in cell', () => {
    const html = preview('| **Bold** | B |\n|---|---|\n| 1 | 2 |')
    expect(html).toContain('<strong>Bold</strong>')
  })

  it('multi-column table', () => {
    const html = preview('| A | B | C | D |\n|---|---|---|---|\n| 1 | 2 | 3 | 4 |')
    expect((html.match(/<td>/g) || []).length).toBe(4)
  })

  it('table contains closing </table>', () => {
    expect(preview(tableContent)).toContain('</table>')
  })
})

// ── 11. Horizontal rule ──────────────────────────────────────────────────────

describe('buildPrintHTML — horizontal rule', () => {
  it('--- renders as <hr>', () => {
    expect(preview('---')).toContain('<hr')
  })

  it('*** renders as <hr>', () => {
    expect(preview('***')).toContain('<hr')
  })

  it('___ renders as <hr>', () => {
    expect(preview('___')).toContain('<hr')
  })
})

// ── 12. Links ────────────────────────────────────────────────────────────────

describe('buildPrintHTML — links', () => {
  it('[text](url) renders as <a>', () => {
    const html = preview('[Click here](https://example.com)')
    expect(html).toContain('<a ')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('Click here')
  })

  it('auto-linked URLs', () => {
    const html = preview('See https://example.com here')
    // marked may or may not auto-link; just check no crash
    expect(html).toContain('example.com')
  })
})

// ── 13. Callout boxes ────────────────────────────────────────────────────────

describe('buildPrintHTML — callout boxes', () => {
  it('>  [!NOTE] renders as styled div', () => {
    const html = preview('> [!NOTE] Title\n> Body text')
    expect(html).toContain('<div')
    expect(html).toContain('Body text')
  })

  it('[!TIP] renders', () => {
    const html = preview('> [!TIP] Tip\n> Tip body')
    expect(html).toContain('<div')
    expect(html).toContain('Tip body')
  })

  it('[!WARNING] renders', () => {
    const html = preview('> [!WARNING] Warn\n> Warning body')
    expect(html).toContain('<div')
    expect(html).toContain('Warning body')
  })

  it('[!IMPORTANT] renders', () => {
    const html = preview('> [!IMPORTANT] Imp\n> Important body')
    expect(html).toContain('<div')
    expect(html).toContain('Important body')
  })

  it('[!CAUTION] renders', () => {
    const html = preview('> [!CAUTION] Caut\n> Caution body')
    expect(html).toContain('<div')
    expect(html).toContain('Caution body')
  })

  it('callout body can contain bold', () => {
    const html = preview('> [!NOTE] Title\n> **Bold** body')
    expect(html).toContain('<strong>Bold</strong>')
  })

  it('callout has border-left styling', () => {
    const html = preview('> [!NOTE] Title\n> Content')
    expect(html).toContain('border-left')
  })
})

// ── 14. Wikilinks → regular links ────────────────────────────────────────────

describe('buildPrintHTML — wikilinks', () => {
  it('[[Note Title]] becomes a link', () => {
    const html = preview('See [[My Study Note]] here')
    expect(html).toContain('<a ')
    expect(html).toContain('My Study Note')
  })

  it('multiple wikilinks on one line', () => {
    const html = preview('[[Note A]] and [[Note B]]')
    const links = (html.match(/<a /g) || []).length
    expect(links).toBeGreaterThanOrEqual(2)
  })
})

// ── 15. Full note integration ─────────────────────────────────────────────────

describe('buildPrintHTML — full note integration', () => {
  const fullNote = `# Torah Study

**Study date:** June 2026

## Key Passages

> Hear O Israel: Yehovah our Elohim, Yehovah is one. — Deuteronomy 6:4

### Commandments

1. No other gods
2. No graven images

- [ ] Study Exodus 20
- [x] Read Deuteronomy 6
- [ ] Review Leviticus 23

### Notes

==Important:== see the parallel in Matthew 22:37

| Reference | Topic |
|-----------|-------|
| Deut 6:4 | Shema |
| Exo 20:3 | First commandment |

> [!NOTE] Cross-reference
> Compare with [[Shema Study]] for more context.

\`\`\`
Key verse memory aid
\`\`\`

---

*End of study*
`

  it('full note produces valid HTML document', () => {
    const html = print(fullNote, 'Torah Study')
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('</html>')
  })

  it('full note contains the note title', () => {
    expect(print(fullNote, 'Torah Study')).toContain('Torah Study')
  })

  it('full note renders headings', () => {
    const html = preview(fullNote)
    expect(html).toContain('<h1>')
    expect(html).toContain('<h2>')
    expect(html).toContain('<h3>')
  })

  it('full note renders bold and italic', () => {
    const html = preview(fullNote)
    expect(html).toContain('<strong>')
    expect(html).toContain('<em>')
  })

  it('full note renders ordered list', () => {
    expect(preview(fullNote)).toContain('<ol>')
  })

  it('full note renders task list in <ul>', () => {
    const html = preview(fullNote)
    expect(html).toContain('<ul')
    expect(html).toContain('type="checkbox"')
  })

  it('full note renders table', () => {
    expect(preview(fullNote)).toContain('<table>')
  })

  it('full note renders highlight mark', () => {
    const html = preview(fullNote)
    expect(html).toContain('<mark')
  })

  it('full note renders callout box', () => {
    const html = preview(fullNote)
    expect(html).toContain('Cross-reference')
  })

  it('full note renders code block', () => {
    expect(preview(fullNote)).toContain('<pre>')
  })

  it('full note renders horizontal rule', () => {
    expect(preview(fullNote)).toContain('<hr')
  })

  it('full note renders blockquote', () => {
    expect(preview(fullNote)).toContain('<blockquote>')
  })

  it('full note renders wikilink as anchor', () => {
    expect(preview(fullNote)).toContain('Shema Study')
  })

  it('full note does not expose raw markdown syntax in output', () => {
    const html = preview(fullNote)
    // No raw ** markers for bold (they should be converted)
    expect(html).not.toMatch(/\*\*[^*]+\*\*/)
    // No raw # for headings at line start
    expect(html).not.toMatch(/^# /m)
    // No raw == for highlights (they should be converted)
    expect(html).not.toMatch(/==[^=]+==/g)
  })
})

// ── 16. Edge cases ────────────────────────────────────────────────────────────

describe('buildPrintHTML — edge cases', () => {
  it('empty string produces valid document', () => {
    const html = print('', 'Empty')
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<body>')
  })

  it('content with only whitespace', () => {
    expect(() => print('   \n\n   ', 'Blank')).not.toThrow()
  })

  it('very long title does not break structure', () => {
    const title = 'A'.repeat(200)
    const html = print('content', title)
    expect(html).toContain(title)
  })

  it('content with HTML entities', () => {
    const html = preview('Use 5 &lt; 10 and &amp; for ampersand')
    expect(html).toBeTruthy()
  })

  it('nested bold inside italic', () => {
    const html = preview('*italic and **bold inside***')
    expect(html).toContain('<em>')
  })

  it('unicode content renders correctly', () => {
    const html = preview('יְהוָה — בְּרֵאשִׁית')
    expect(html).toContain('יְהוָה')
    expect(html).toContain('בְּרֵאשִׁית')
  })

  it('mixed list types near each other', () => {
    const content = '- Dash item\n\n1. Ordered item\n\n- [ ] Task item'
    const html = preview(content)
    expect(html).toContain('<ul')
    expect(html).toContain('<ol>')
    expect(html).toContain('type="checkbox"')
  })

  it('note with no formatting at all', () => {
    const html = print('Just plain text with no special formatting at all.', 'Plain')
    expect(html).toContain('Just plain text')
  })

  it('multiple ==highlights== in different paragraphs', () => {
    const html = preview('==first==\n\n==second==')
    const marks = (html.match(/<mark/g) || []).length
    expect(marks).toBeGreaterThanOrEqual(2)
  })
})
