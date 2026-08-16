import { describe, it, expect } from 'vitest'
import { parseMarkdown } from '../parser'
import { serializeToMarkdown } from '../serializer'
import { bereanSchema as schema } from '../schema'

function roundtrips(md: string) {
  const doc = parseMarkdown(md)
  return serializeToMarkdown(doc)
}

describe('markdown round-trip (parseMarkdown -> serializeToMarkdown)', () => {
  it('plain paragraphs', () => {
    const md = 'Hello world.\n\nSecond paragraph.'
    expect(roundtrips(md)).toBe(md)
  })

  it('preserves a trailing blank line at the very end of the doc (regression: a trailing Enter was silently dropped on the next tab-switch/reopen, since the doc-end has no following sibling to trigger the existing interior extra-blank-line recovery)', () => {
    const withTrailingBlank = schema.node('doc', null, [
      schema.node('paragraph', null, [schema.text('Hello world.')]),
      schema.node('paragraph', null, []),
    ])
    const md = serializeToMarkdown(withTrailingBlank)
    const reparsed = parseMarkdown(md)
    expect(reparsed.childCount).toBe(2)
    expect(reparsed.child(0).textContent).toBe('Hello world.')
    expect(reparsed.child(1).textContent).toBe('')

    // Multiple trailing blanks all survive, not just the first.
    const withTwoTrailingBlanks = schema.node('doc', null, [
      schema.node('paragraph', null, [schema.text('Hello world.')]),
      schema.node('paragraph', null, []),
      schema.node('paragraph', null, []),
    ])
    const reparsed2 = parseMarkdown(serializeToMarkdown(withTwoTrailingBlanks))
    expect(reparsed2.childCount).toBe(3)

    // An entirely blank note (no real content before the trailing empty paragraph) must stay
    // a genuinely empty string on save — not turn into a permanent lone marker character.
    const entirelyBlank = schema.node('doc', null, [schema.node('paragraph', null, [])])
    expect(serializeToMarkdown(entirelyBlank)).toBe('')

    // No false-positive extra blank when the doc doesn't actually end in one.
    expect(serializeToMarkdown(schema.node('doc', null, [
      schema.node('paragraph', null, [schema.text('Hello world.')]),
    ]))).toBe('Hello world.')
  })

  it('preserves extra blank lines exactly (regression: multiple consecutive Enters used to silently collapse to a single blank line on every reopen)', () => {
    expect(roundtrips('A\n\nB')).toBe('A\n\nB')       // 1 blank line (normal) — baseline, unaffected
    expect(roundtrips('A\n\n\nB')).toBe('A\n\n\nB')     // 2 blank lines
    expect(roundtrips('A\n\n\n\nB')).toBe('A\n\n\n\nB')   // 3 blank lines
    expect(roundtrips('A\n\n\n\n\nB')).toBe('A\n\n\n\n\nB') // 4 blank lines
  })

  it('extra-blank-line preservation is stable under repeated round-trips (idempotent, not growing)', () => {
    const once = roundtrips('A\n\n\n\nB')
    const twice = roundtrips(once)
    expect(twice).toBe(once)
  })

  it('does not inject extra-blank-line markers inside fenced code blocks (blank lines there are literal content)', () => {
    const md = 'before\n\n```\ncode line 1\n\n\ncode line 2\n```\n\nafter'
    expect(roundtrips(md)).toBe(md)
  })

  it('tab-indented paragraph is a paragraph, not an indented code block (regression: e-Sword import emits "\\n\\n\\t…" from RTF \\par+\\tab, which used to parse as a monospace code_block that swallowed inline formatting)', () => {
    const doc = parseMarkdown('First paragraph.\n\n\tIndented **bold** paragraph from an RTF note.')
    // Must NOT be a code_block; must keep the bold mark live (mark, not a node).
    const types = new Set<string>()
    const marks = new Set<string>()
    doc.descendants((n) => { types.add(n.type.name); n.marks.forEach((m) => marks.add(m.type.name)); return true })
    expect(types.has('code_block')).toBe(false)
    expect(marks.has('strong')).toBe(true)
  })

  it('4-space-indented paragraph is a paragraph, not an indented code block', () => {
    const doc = parseMarkdown('Lead in.\n\n    Four-space indented line.')
    const types = new Set<string>()
    doc.descendants((n) => { types.add(n.type.name); return true })
    expect(types.has('code_block')).toBe(false)
  })

  it('bold, italic, code, underline, strikethrough, highlight marks', () => {
    const md = 'This is **bold** and *italic* and `code` and <u>underlined</u> and ~~struck~~ and ==highlighted==.'
    expect(roundtrips(md)).toBe(md)
  })

  it('plain ==highlight== actually applies the highlight mark, not just literal "==" text (regression: was previously write-only — a serializer existed but no parser rule, so highlights vanished visually on every reopen)', () => {
    const doc = parseMarkdown('See ==this part== highlighted.')
    let found = false
    doc.descendants((node) => {
      if (node.isText && node.marks.some((m) => m.type.name === 'highlight' && m.attrs.color === null)) found = true
    })
    expect(found).toBe(true)
  })

  it('colored highlight <mark class="hl-amber"> round-trips and applies the color attr', () => {
    const md = 'A <mark class="hl-amber">colored highlight</mark> here.'
    expect(roundtrips(md)).toBe(md)
    const doc = parseMarkdown(md)
    let color: string | null = null
    doc.descendants((node) => {
      const m = node.marks?.find((mk) => mk.type.name === 'highlight')
      if (m) color = m.attrs.color
    })
    expect(color).toBe('amber')
  })

  it('headings', () => {
    const md = '# H1\n\n## H2\n\n### H3'
    expect(roundtrips(md)).toBe(md)
  })

  it('blockquote (non-callout) — a literal newline stays a real line break (Obsidian/CM6 semantics, not strict CommonMark)', () => {
    // markdown-it's `breaks: true` (see markdownIt.ts) makes every bare '\n'
    // inside a paragraph a real hard_break node instead of collapsing to a
    // space, matching both the CM6 editor being replaced (flat text, '\n'
    // always literal) and Obsidian's own convention. The one accepted,
    // documented normalization: a bare '\n' round-trips as an escaped
    // '\\\n' (backslash + newline is CommonMark's explicit hard-break
    // syntax) rather than byte-identically as a bare '\n' — semantically
    // identical (re-parses to the same hard break), not a content change.
    const md = '> A quoted line\n> continues here'
    expect(roundtrips(md)).toBe('> A quoted line\\\n> continues here')
  })

  it('callout: NOTE', () => {
    const md2 = '> [!NOTE] \n> Some callout body text'
    expect(roundtrips(md2)).toBe('> [!NOTE] \\\n> Some callout body text')
  })

  it('callout: WARNING with title text on the marker line', () => {
    const md = '> [!WARNING] Heads up\n> more text'
    expect(roundtrips(md)).toBe('> [!WARNING] Heads up\\\n> more text')
  })

  it('tight bullet list', () => {
    const md = '- item one\n- item two\n- item three'
    expect(roundtrips(md)).toBe(md)
  })

  it('loose bullet list (blank line between items)', () => {
    const md = '- item one\n\n- item two\n\n- item three'
    expect(roundtrips(md)).toBe(md)
  })

  it('task list checkboxes, mixed checked/unchecked', () => {
    const md = '- [ ] todo one\n- [x] done one\n- [ ] todo two'
    expect(roundtrips(md)).toBe(md)
  })

  it('ordered list, tight', () => {
    const md = '1. first\n2. second\n3. third'
    expect(roundtrips(md)).toBe(md)
  })

  it('GFM pipe table with alignment', () => {
    const md = '| Left | Center | Right |\n| --- | :---: | ---: |\n| a | b | c |\n| d | e | f |'
    expect(roundtrips(md)).toBe(md)
  })

  it('wikilink', () => {
    const md = 'See [[Genesis 1]] for more.'
    expect(roundtrips(md)).toBe(md)
  })

  it('link and image', () => {
    const md = 'A [link](https://example.com "title") and an image ![alt](https://example.com/x.png "t")'
    expect(roundtrips(md)).toBe(md)
  })

  // Regression coverage for the resize feature (schema.ts's `width` attr, nodeViews.ts's
  // imageNodeView drag handle) — previously images had zero test coverage at all. A resized
  // image's width round-trips as a `|wNNN` suffix on the alt text (parser.ts/serializer.ts's
  // `image` entries) rather than a separate markdown construct, so this also doubles as
  // confirmation that convention parses back into the right node attrs, not just that the
  // TEXT comes back unchanged.
  it('image with a resized width (|wNNN alt suffix convention)', () => {
    const md = '![a screenshot|w320](https://example.com/shot.png "t")'
    expect(roundtrips(md)).toBe(md)
    const doc = parseMarkdown(md)
    let imageNode: ReturnType<typeof schema.node> | null = null
    doc.descendants((node) => { if (node.type.name === 'image') imageNode = node })
    expect(imageNode).not.toBeNull()
    expect(imageNode!.attrs.alt).toBe('a screenshot')
    expect(imageNode!.attrs.width).toBe(320)
  })

  it('image with no width has a null width attr and no |w suffix', () => {
    const md = '![plain alt](https://example.com/x.png)'
    expect(roundtrips(md)).toBe(md)
    const doc = parseMarkdown(md)
    let imageNode: ReturnType<typeof schema.node> | null = null
    doc.descendants((node) => { if (node.type.name === 'image') imageNode = node })
    expect(imageNode!.attrs.width).toBeNull()
    expect(imageNode!.attrs.alt).toBe('plain alt')
  })

  // Regression coverage for the SVG-images-disappear bug: markdown-it's default
  // `validateLink` only whitelists data:image/(gif|png|jpeg|webp) — svg+xml wasn't on that
  // list, so an SVG image's src got silently reset to "" the moment the note was re-parsed
  // (see markdownIt.ts's `md.validateLink` override).
  it('image with a data:image/svg+xml URL survives round trip', () => {
    const svgB64 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString('base64')
    const md = `![diagram](data:image/svg+xml;base64,${svgB64})`
    expect(roundtrips(md)).toBe(md)
    const doc = parseMarkdown(md)
    let imageNode: ReturnType<typeof schema.node> | null = null
    doc.descendants((node) => { if (node.type.name === 'image') imageNode = node })
    expect(imageNode).not.toBeNull()
    expect(imageNode!.attrs.src).toBe(`data:image/svg+xml;base64,${svgB64}`)
  })

  it('code block (fenced)', () => {
    const md = '```js\nconst x = 1;\n```'
    expect(roundtrips(md)).toBe(md)
  })

  it('horizontal rule', () => {
    const md = 'above\n\n---\n\nbelow'
    expect(roundtrips(md)).toBe(md)
  })

  it('verse reference and lexicon reference stay as plain, unmodified text (no node wrapping)', () => {
    const md = 'See Gen 1:1 and H7225 for background.'
    expect(roundtrips(md)).toBe(md)
  })

  it('large mixed document does not throw and preserves structure count', () => {
    const md = [
      '# Study notes',
      '',
      '> [!TIP] \n> Remember this',
      '',
      '- [ ] read Genesis 1',
      '- [x] read Genesis 2',
      '',
      '| Ref | Note |',
      '| --- | --- |',
      '| Gen 1:1 | beginning |',
      '',
      'See [[Related Note]] and **Gen 1:1**.',
    ].join('\n')
    const out = roundtrips(md)
    expect(out.split('\n').length).toBeGreaterThan(5)
  })

  it('never throws on null/undefined content — a nullable DB content column used to crash EditorView construction and silently make the note non-editable', () => {
    // @ts-expect-error deliberately testing bad input
    expect(() => parseMarkdown(null)).not.toThrow()
    // @ts-expect-error deliberately testing bad input
    expect(() => parseMarkdown(undefined)).not.toThrow()
    // @ts-expect-error deliberately testing bad input
    expect(roundtrips(null)).toBe('')
  })
})
