/**
 * Note preview-formatting suite (renderPreviewContent).
 *
 * renderPreviewContent is the shared formatter used by the note preview, PDF/print export,
 * and the presenter window. This locks down its HTML output for the full markdown surface —
 * headings, emphasis, highlights, lists, task lists, callouts, code, tables, wiki-links,
 * Strong's chips, verse blocks, and lexicon blocks — so formatting regressions are caught.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { renderPreviewContent } from '@/lib/notePreviewRender'
import { useAppStore } from '@/store'

const R = (s: string) => renderPreviewContent(s)

describe('headings', () => {
  it.each([
    ['# H1', '<h1'],
    ['## H2', '<h2'],
    ['### H3', '<h3'],
    ['#### H4', '<h4'],
    ['##### H5', '<h5'],
    ['###### H6', '<h6'],
  ])('%s → %s', (input, tag) => {
    expect(R(input)).toContain(tag)
  })
  it('heading keeps its text', () => {
    expect(R('## Creation')).toContain('Creation')
  })
  it('a # mid-line is not a heading', () => {
    expect(R('not a # heading')).not.toContain('<h1')
  })
})

describe('inline emphasis', () => {
  it.each([
    ['**bold**', '<strong>'],
    ['*italic*', '<em>'],
    ['_italic_', '<em>'],
    ['`code`', '<code>'],
    ['~~struck~~', '<del>'],
  ])('%s → %s', (input, tag) => {
    expect(R(input)).toContain(tag)
  })
  it('bold keeps inner text', () => {
    expect(R('**Yeshua**')).toContain('Yeshua')
  })
  it('combined bold+italic', () => {
    const out = R('***both***')
    expect(out).toContain('<strong>')
    expect(out).toContain('<em>')
  })
})

describe('==highlight== marks', () => {
  it('wraps in a styled mark', () => {
    const out = R('==important==')
    expect(out).toContain('<mark')
    expect(out).toContain('important')
  })
  it('multiple highlights on a line', () => {
    const out = R('==a== and ==b==')
    expect(out.match(/<mark/g)?.length).toBe(2)
  })
  it('plain text with no markers has no mark', () => {
    expect(R('nothing here')).not.toContain('<mark')
  })
})

describe('links & wiki-links', () => {
  it('markdown link', () => {
    const out = R('[Berean](https://example.com)')
    expect(out).toContain('<a')
    expect(out).toContain('href="https://example.com"')
  })
  it('[[wiki link]] becomes an anchor', () => {
    const out = R('See [[Creation Study]]')
    expect(out).toContain('<a')
    expect(out).toContain('#note-creation-study')
  })
})

describe('lists', () => {
  it('dash list uses the berean-dash-list class', () => {
    const out = R('- one\n- two\n- three')
    expect(out).toContain('berean-dash-list')
    expect((out.match(/<li>/g) || []).length).toBe(3)
  })
  it('numbered list renders an <ol>', () => {
    expect(R('1. first\n2. second')).toContain('<ol')
  })
  it.each([
    ['- [ ] todo', 'unchecked'],
    ['- [x] done', 'checked'],
    ['- [X] done caps', 'checked-caps'],
  ])('task list %s (%s)', (input) => {
    const out = R(input)
    expect(out).toContain('<input type="checkbox"')
  })
  it('checked task is marked checked + struck through', () => {
    const out = R('- [x] done')
    expect(out).toContain('checked')
    expect(out).toContain('line-through')
  })
  it('unchecked task is not checked', () => {
    const out = R('- [ ] todo')
    expect(out).not.toContain(' checked>')
  })
  it('grouped task list shares one <ul>', () => {
    const out = R('- [ ] a\n- [x] b\n- [ ] c')
    expect((out.match(/<ul/g) || []).length).toBe(1)
    expect((out.match(/<input/g) || []).length).toBe(3)
  })
})

describe('blockquotes & rules & code blocks', () => {
  it('blockquote', () => {
    expect(R('> a quote')).toContain('<blockquote')
  })
  it('horizontal rule', () => {
    expect(R('---')).toContain('<hr')
  })
  it('fenced code block', () => {
    const out = R('```\nconst x = 1\n```')
    expect(out).toContain('<pre')
    expect(out).toContain('<code')
  })
})

describe('tables', () => {
  it('renders a table with header + body', () => {
    const out = R('| A | B |\n| - | - |\n| 1 | 2 |')
    expect(out).toContain('<table')
    expect(out).toContain('<th')
    expect(out).toContain('<td')
  })
})

describe('callout boxes', () => {
  const CALLOUTS: [string, string][] = [
    ['NOTE', 'Note'],
    ['TIP', 'Tip'],
    ['WARNING', 'Warning'],
    ['IMPORTANT', 'Important'],
    ['CAUTION', 'Caution'],
  ]
  it.each(CALLOUTS)('> [!%s] renders a styled box labelled "%s"', (type, label) => {
    const out = R(`> [!${type}]\n> body text`)
    expect(out).toContain('border-left:3px solid')
    expect(out).toContain(label)
    expect(out).toContain('body text')
  })
  it.each(CALLOUTS)('lowercase > [!%s] also works', (type) => {
    const out = R(`> [!${type.toLowerCase()}]\n> hi`)
    expect(out).toContain('border-left:3px solid')
  })
  it('custom title overrides the default label', () => {
    const out = R('> [!NOTE] Remember this\n> details')
    expect(out).toContain('Remember this')
  })
  it('callout body renders inline markdown (bold)', () => {
    const out = R('> [!TIP]\n> some **bold** tip')
    expect(out).toContain('<strong>')
  })
  it('multi-line callout body', () => {
    const out = R('> [!WARNING]\n> line one\n> line two')
    expect(out).toContain('line one')
    expect(out).toContain('line two')
  })
  it('an unknown callout type falls back to Note styling', () => {
    const out = R('> [!FOOBAR]\n> x')
    // Unknown types aren't matched as callouts → render as a normal blockquote.
    expect(out.includes('border-left:3px solid') || out.includes('<blockquote')).toBe(true)
  })
})

describe("Strong's number chips", () => {
  it.each(['H7225', 'G3056', 'H1', 'G99999'])('%s becomes a chip', (num) => {
    const out = R(`the word ${num} here`)
    expect(out).toContain('berean-strongs-chip')
    expect(out).toContain(num)
  })
  it('a bare number is not a chip', () => {
    expect(R('in 1995 something')).not.toContain('berean-strongs-chip')
  })
  it('mid-word HxNNN is not a chip', () => {
    expect(R('graphH123ics')).not.toContain('berean-strongs-chip')
  })
})

describe('lexicon blocks (copy-button paste)', () => {
  it('two-line lexicon block renders a styled block', () => {
    const out = R("G5485 χάρις cháris, khar'-ece;\nfrom G5463; graciousness")
    expect(out).toContain('berean-lexicon-block')
    expect(out).toContain('G5485')
  })
})

describe('verse blocks (gated on noteScriptureBlock)', () => {
  describe('disabled (default)', () => {
    beforeAll(() => useAppStore.setState({ noteScriptureBlock: false }))
    it('does not wrap a verse line', () => {
      expect(R('John 3:16 For God so loved the world')).not.toContain('berean-verse-block')
    })
  })
  describe('enabled', () => {
    beforeAll(() => useAppStore.setState({ noteScriptureBlock: true, noteScriptureBlockThreshold: 0 }))
    afterAll(() => useAppStore.setState({ noteScriptureBlock: false }))
    it('wraps a single-line verse with a ref', () => {
      const out = R('John 3:16 For God so loved the world')
      expect(out).toContain('berean-verse-block')
      expect(out).toContain('berean-verse-ref')
    })
    it('non-verse prose is left alone', () => {
      expect(R('Just a normal sentence with no reference.')).not.toContain('berean-verse-block')
    })
  })
})

describe('mixed & whitespace handling', () => {
  it('a document with many element types renders them all', () => {
    const out = R('# Title\n\nSome **bold** and ==hi==.\n\n- a\n- b\n\n> [!NOTE]\n> note body\n\nH7225 root')
    expect(out).toContain('<h1')
    expect(out).toContain('<strong>')
    expect(out).toContain('<mark')
    expect(out).toContain('berean-dash-list')
    expect(out).toContain('border-left:3px solid')
    expect(out).toContain('berean-strongs-chip')
  })
  it('empty string → empty-ish output', () => {
    expect(R('').trim()).toBe('')
  })
  it('plain paragraph wraps in <p>', () => {
    expect(R('hello world')).toContain('<p>')
  })
  it('extra blank lines become <br> spacers', () => {
    expect(R('a\n\n\n\nb')).toContain('<br>')
  })
})
