import { describe, it, expect } from 'vitest'
import { buildCodeBlockDecorations, normalizeLang } from '../codeBlockHighlight'
import { bereanSchema as schema } from '../schema'

function docWithCodeBlock(code: string, params = '') {
  return schema.nodes.doc.create(null, [schema.nodes.code_block.create({ params }, code ? schema.text(code) : undefined)])
}

// Round 12 item 1: lightweight code-block syntax highlighting. Covers the tokenizer/
// decoration-building logic directly (no @lezer language grammars involved — see
// codeBlockHighlight.ts's own header comment for why) rather than a full editor mount,
// mirroring blockDecorations.ts's own test-boundary convention for its buildBlockDecorations.

function decosOf(doc: ReturnType<typeof docWithCodeBlock>) {
  const set = buildCodeBlockDecorations(doc)
  // `Decoration.inline(from, to, attrs)` puts the DOM attrs (our `{ class }`) on
  // `decoration.type.attrs`, not `.spec` (which defaults to an empty object when no 4th
  // `spec` argument is passed — see prosemirror-view's InlineType constructor).
  return set.find().map((d) => ({
    from: d.from,
    to: d.to,
    class: (d as unknown as { type: { attrs?: { class?: string } } }).type.attrs?.class,
  }))
}

describe('normalizeLang', () => {
  it('maps common shorthand aliases to their full language name', () => {
    expect(normalizeLang('js')).toBe('javascript')
    expect(normalizeLang('TS')).toBe('typescript')
    expect(normalizeLang('py')).toBe('python')
    expect(normalizeLang('sh')).toBe('bash')
  })

  it('passes an already-full language name through unchanged', () => {
    expect(normalizeLang('python')).toBe('python')
  })
})

describe('buildCodeBlockDecorations', () => {
  it('highlights a keyword, a string, a number, and a line comment in a JS block', () => {
    const doc = docWithCodeBlock('const x = 5; // set it\nconst s = "hi";', 'js')
    const decos = decosOf(doc)
    const classes = decos.map((d) => d.class)
    expect(classes).toContain('pm-code-tok-keyword')
    expect(classes).toContain('pm-code-tok-number')
    expect(classes).toContain('pm-code-tok-comment')
    expect(classes).toContain('pm-code-tok-string')
  })

  it('does not highlight a keyword-looking word that sits INSIDE a string', () => {
    const doc = docWithCodeBlock('const s = "return";', 'js')
    const decos = decosOf(doc)
    // The string decoration should span the whole literal including "return" — and there
    // should be no SEPARATE keyword decoration landing inside it.
    const keywordDecos = decos.filter((d) => d.class === 'pm-code-tok-keyword')
    expect(keywordDecos.some((d) => d.from >= 1 + 10)).toBe(false) // "return" starts after `const s = "`
  })

  it('produces no decorations at all for a code block with no/unknown language tag', () => {
    const doc = docWithCodeBlock('const x = 5;', '')
    expect(decosOf(doc)).toEqual([])
    const doc2 = docWithCodeBlock('fn main() {}', 'rust')
    expect(decosOf(doc2)).toEqual([])
  })

  it('highlights Python keywords via # comments and indentation-agnostic tokens', () => {
    const doc = docWithCodeBlock('def f():\n    return 1  # done', 'python')
    const classes = decosOf(doc).map((d) => d.class)
    expect(classes).toContain('pm-code-tok-keyword') // def, return
    expect(classes).toContain('pm-code-tok-comment')
    expect(classes).toContain('pm-code-tok-number')
  })

  it('highlights SQL keywords case-sensitively as written (lowercase table)', () => {
    const doc = docWithCodeBlock('select * from users where id = 1', 'sql')
    const classes = decosOf(doc).map((d) => d.class)
    expect(classes).toContain('pm-code-tok-keyword')
    expect(classes).toContain('pm-code-tok-number')
  })

  it('still highlights strings/numbers/comments for CSS and JSON, which have no keyword list', () => {
    const cssDoc = docWithCodeBlock('.a { color: red; } /* note */', 'css')
    expect(decosOf(cssDoc).map((d) => d.class)).toContain('pm-code-tok-comment')

    const jsonDoc = docWithCodeBlock('{"count": 42}', 'json')
    expect(decosOf(jsonDoc).map((d) => d.class)).toContain('pm-code-tok-number')
  })

  it('ignores non-code_block content entirely (a plain paragraph never gets token decorations)', () => {
    const doc = schema.nodes.doc.create(null, [schema.nodes.paragraph.create(null, schema.text('const x = 5;'))])
    expect(decosOf(doc)).toEqual([])
  })
})
