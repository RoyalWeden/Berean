import { describe, it, expect } from 'vitest'
import { renderMarkdownToHTML } from '../staticRender'

// Closes a named test gap (round 12): staticRender.ts had NO coverage at all for columns,
// tables, or code_block parity with the live editor — this file covers all three, plus
// the basic shell every surface (NoteVersionHistory, ContinuousDailyScroll, ViewerApp/
// Presenter, print/PDF export) relies on staticRender.ts to reproduce faithfully.

describe('renderMarkdownToHTML — columns', () => {
  it('renders a column_list/column pair with the exact classes pmEditor.css styles live', () => {
    const md = '<!-- berean:columns -->\n<!-- berean:col -->\nLeft text.\n<!-- /berean:col -->\n<!-- berean:col -->\nRight text.\n<!-- /berean:col -->\n<!-- /berean:columns -->'
    const html = renderMarkdownToHTML(md)
    expect(html).toContain('pm-column-list')
    expect((html.match(/pm-column"/g) ?? []).length).toBe(2)
    expect(html).toContain('Left text.')
    expect(html).toContain('Right text.')
  })

  it('renders block content nested inside a column (a heading), not just plain text', () => {
    const md = '<!-- berean:columns -->\n<!-- berean:col -->\n## Column heading\n<!-- /berean:col -->\n<!-- berean:col -->\nPlain.\n<!-- /berean:col -->\n<!-- /berean:columns -->'
    const html = renderMarkdownToHTML(md)
    expect(html).toContain('<h2>Column heading</h2>')
  })
})

describe('renderMarkdownToHTML — tables', () => {
  it('renders a GFM table with real <table>/<tr>/<th>/<td> structure and correct cell text', () => {
    const md = '| A | B |\n| --- | --- |\n| one | two |'
    const html = renderMarkdownToHTML(md)
    expect(html).toContain('<table')
    expect(html).toContain('<th')
    expect(html).toContain('>A<')
    expect(html).toContain('>B<')
    expect(html).toContain('>one<')
    expect(html).toContain('>two<')
  })

  it('carries the cell alignment attr through as the same inline text-align style the schema toDOM produces', () => {
    const md = '| A | B |\n| :---: | ---: |\n| one | two |'
    const html = renderMarkdownToHTML(md)
    expect(html).toContain('text-align: center')
    expect(html).toContain('text-align: right')
  })
})

describe('renderMarkdownToHTML — code_block', () => {
  it('renders the same .pm-code-block > pre > code structure the live NodeView uses', () => {
    const md = '```\nplain unhighlighted line\n```'
    const html = renderMarkdownToHTML(md)
    expect(html).toContain('pm-code-block')
    expect(html).toContain('<pre>')
    expect(html).toContain('<code>')
    // No known language tag -> no token spans -> the raw text passes through unsplit.
    expect(html).toContain('plain unhighlighted line')
  })

  it('applies the SAME token highlight classes the live codeBlockHighlight.ts plugin would, for a recognized language', () => {
    const md = '```js\nconst x = 1; // note\n```'
    const html = renderMarkdownToHTML(md)
    expect(html).toContain('pm-code-tok-keyword')
    expect(html).toContain('pm-code-tok-number')
    expect(html).toContain('pm-code-tok-comment')
  })

  it('has no token classes at all for an unset/unrecognized language, same as the live editor', () => {
    const md = '```\nconst x = 1;\n```'
    const html = renderMarkdownToHTML(md)
    expect(html).not.toContain('pm-code-tok-')
  })

  it('does NOT render the live-only language-picker select or Copy button (read-only surfaces have no interactive header)', () => {
    const md = '```js\nconst x = 1;\n```'
    const html = renderMarkdownToHTML(md)
    expect(html).not.toContain('pm-code-block-header')
    expect(html).not.toContain('<select')
  })
})
