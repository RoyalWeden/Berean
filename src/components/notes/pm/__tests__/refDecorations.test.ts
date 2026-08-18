import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { bereanSchema as schema } from '../schema'
import { parseMarkdown } from '../parser'
import { buildRefDecorationsForDoc } from '../refDecorations'
import { useAppStore } from '@/store'

function decoClasses(doc: ReturnType<typeof parseMarkdown>) {
  const decos = buildRefDecorationsForDoc(doc)
  return decos.find(0, doc.content.size).map((d) => ({
    from: d.from,
    to: d.to,
    class: (d as unknown as { type: { attrs?: { class?: string } } }).type.attrs?.class ?? '',
  }))
}

// Regression: a wikilink whose title text happens to look like a verse
// reference or Strong's number, or a verse/lexicon BLOCK's own reference
// line, used to ALSO get matched by the general verse-ref/lexicon-ref scan
// — landing two conflicting decorations (e.g. "pm-verse-block-ref pm-verse-ref")
// on the exact same span, with the general one's underline visibly clashing
// with the block-ref's plain bold-accent styling. Both live editing and the
// read-only static renderer (staticRender.ts) go through this same function.
describe('buildRefDecorationsForDoc — exclusions', () => {
  it('a wikilink whose title looks like a verse ref gets ONLY the wikilink mark, not also pm-verse-ref', () => {
    const doc = parseMarkdown('See [[Genesis 1:1]] for context.')
    const classes = decoClasses(doc).map((d) => d.class)
    expect(classes).not.toContain('pm-verse-ref')
    expect(classes).not.toContain('pm-lxx-ref')
  })

  it('a wikilink whose title looks like a Strong\'s number gets no pm-lexicon-ref decoration', () => {
    const doc = parseMarkdown('See [[H7225]] for the word.')
    const classes = decoClasses(doc).map((d) => d.class)
    expect(classes).not.toContain('pm-lexicon-ref')
  })

  it('a genuine (non-wikilinked) verse ref elsewhere in the same doc still gets decorated', () => {
    const doc = parseMarkdown('See [[Genesis 1:1]] and also Exodus 20:3 directly.')
    const classes = decoClasses(doc).map((d) => d.class)
    expect(classes).toContain('pm-verse-ref')
  })

  describe('verse/lexicon block ref lines', () => {
    beforeEach(() => { useAppStore.getState().setNoteScriptureBlock?.(true) })
    afterEach(() => { useAppStore.getState().setNoteScriptureBlock?.(false) })

    it('a single-line verse block\'s own reference does not ALSO get a redundant pm-verse-ref decoration', () => {
      // buildRefDecorationsForDoc only ever produces pm-verse-ref/pm-lxx-ref/
      // pm-lexicon-ref decorations itself — the block's own pm-verse-block-ref
      // class comes from the SEPARATE buildBlockDecorations (blockDecorations.ts).
      // The bug this covers: this function used to ALSO emit a pm-verse-ref
      // for the exact same span, landing both classes on one element.
      const doc = parseMarkdown('Genesis 1:1 In the beginning God created')
      const found = decoClasses(doc)
      const onRefSpan = found.filter((d) => d.from < 1 + 'Genesis 1:1'.length && d.to > 1)
      expect(onRefSpan).toEqual([])
    })

    it('a Strong\'s number inside the ordinary BODY text of a verse (not the ref line) still gets decorated normally', () => {
      const doc = parseMarkdown('See H7225 for the word.')
      const classes = decoClasses(doc).map((d) => d.class)
      expect(classes).toContain('pm-lexicon-ref')
    })
  })

  // Regression: a verse ref sitting on its own line after a soft return ("hosea 6;\njubilees
  // 4:30") is parsed into ONE paragraph with a hard_break between the two text runs (not two
  // separate paragraphs) — see blockDecorations.ts's own comment on "hard_break lines within
  // one paragraph". node.textContent flattens that hard_break to ZERO characters even though
  // it still occupies one real document position, so match indices computed against the
  // flattened string landed one position too early once mapped back via `base + index` —
  // truncating the decoration's END by exactly one character (dropping the ref's last digit,
  // reported as "Jubilees 4:30" only underlining as far as "4:3"). Confirmed against the exact
  // real-world note content that triggered the report.
  it('a verse ref after a hard line break is decorated for its FULL span, not truncated by one char', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [
        schema.text('hosea 6; '),
        schema.node('hard_break'),
        schema.text('jubilees 4:30'),
      ]),
    ])
    const decos = buildRefDecorationsForDoc(doc)
      .find(0, doc.content.size)
      .filter((d) => (d as unknown as { type: { attrs?: { class?: string } } }).type.attrs?.class === 'pm-verse-ref')
    const jubDeco = decos.find((d) => doc.textBetween(d.from, d.to).toLowerCase().startsWith('jubilees'))
    expect(jubDeco).toBeDefined()
    expect(doc.textBetween(jubDeco!.from, jubDeco!.to)).toBe('jubilees 4:30')
  })
})
