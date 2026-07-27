import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { bereanSchema as schema } from '../schema'
import { createBlockDecorationsPlugin } from '../blockDecorations'
import { useAppStore } from '@/store'

// Verse/lexicon block detection now spans consecutive PARAGRAPH SIBLINGS
// (not just hard_break lines within one paragraph) — regression coverage
// for the bug where a multi-line block typed the ordinary way (one Enter
// per line, which creates separate paragraph nodes in ProseMirror, not a
// hard_break) was never detected at all, since the old implementation only
// looked for hard_break-separated lines within a single paragraph.

function docFromLines(...lines: string[]) {
  return schema.nodes.doc.create(null, lines.map((l) => schema.nodes.paragraph.create(null, l ? schema.text(l) : undefined)))
}

function makeView(doc: ReturnType<typeof docFromLines>) {
  const state = EditorState.create({ schema, doc, plugins: [createBlockDecorationsPlugin()] })
  const dom = document.createElement('div')
  document.body.appendChild(dom)
  return new EditorView(dom, { state })
}

describe('multi-paragraph verse/lexicon block detection', () => {
  let queryChapterMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    useAppStore.getState().setNoteScriptureBlock?.(true)
    // window.bible.queryChapter absent in jsdom by default — verseTextAccepted
    // treats that as "DB unavailable" and accepts structurally (returns true),
    // which is sufficient to exercise the decoration-shape logic here.
    queryChapterMock = vi.fn()
  })
  afterEach(() => { useAppStore.getState().setNoteScriptureBlock?.(false) })

  it('lexicon block (2-line header+definition, each its own paragraph) gets boxed as pm-lexicon-block-first/last', () => {
    const doc = docFromLines('G5463 χαίρω chaírō;', 'a primary verb; to be cheerful')
    const view = makeView(doc)
    const html = view.dom.innerHTML
    expect(html).toContain('pm-lexicon-block-first')
    expect(html).toContain('pm-lexicon-block-last')
    expect(html).toContain('pm-lexicon-block-ref')
    view.destroy()
  })

  it('multi-line verse block (ref + numbered verse lines, each its own paragraph) gets boxed across all 3 paragraphs', () => {
    const doc = docFromLines(
      'Genesis 5:6-7',
      '6 And Seth lived an hundred and five years, and begat Enos:',
      '7 And Seth lived after he begat Enos eight hundred and seven years, and begat sons and daughters:',
    )
    const view = makeView(doc)
    const html = view.dom.innerHTML
    expect(html).toContain('pm-verse-block-first')
    expect(html).toContain('pm-verse-block-middle')
    expect(html).toContain('pm-verse-block-last')
    view.destroy()
  })

  it('a single-paragraph block (via hard_break, e.g. from pasted/parsed markdown) still gets boxed as pm-verse-block-only', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.text('Genesis 5:6'),
        schema.nodes.hard_break.create(),
        schema.text('6 And Seth lived an hundred and five years'),
      ]),
    ])
    const view = makeView(doc)
    expect(view.dom.innerHTML).toContain('pm-verse-block-only')
    view.destroy()
  })

  it('lexicon blocks are NOT gated by noteScriptureBlock (matches the original CM6 behavior)', () => {
    useAppStore.getState().setNoteScriptureBlock?.(false)
    const doc = docFromLines('H7225 בְּרֵאשִׁית rêʼshîyth;', 'the first, in place, time, order or rank')
    const view = makeView(doc)
    expect(view.dom.innerHTML).toContain('pm-lexicon-block')
    view.destroy()
  })

  it('blank paragraphs between the ref line and verse lines (e.g. a rich-clipboard paste with blank lines) still get detected and boxed', () => {
    const doc = docFromLines(
      'Zephaniah 2:1-3',
      '',
      '1 Gather yourselves together, yea, gather together, O nation not desired;',
      '',
      "2 Before the decree bring forth, before the day pass as the chaff, before the fierce anger of Yehovah come upon you, before the day of Yehovah's anger come upon you.",
      '',
      "3 Seek ye Yehovah, all ye meek of the earth, which have wrought his judgment; seek righteousness, seek meekness: it may be ye shall be hid in the day of Yehovah's anger.",
    )
    const view = makeView(doc)
    const html = view.dom.innerHTML
    expect(html).toContain('pm-verse-block-first')
    expect(html).toContain('pm-verse-block-middle')
    expect(html).toContain('pm-verse-block-last')
    view.destroy()
  })

  it('a heading between two lines breaks the run — no cross-boundary detection through unrelated block types', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, schema.text('Genesis 5:6')),
      schema.nodes.heading.create({ level: 1 }, schema.text('Unrelated heading')),
      schema.nodes.paragraph.create(null, schema.text('6 And Seth lived an hundred and five years')),
    ])
    const view = makeView(doc)
    expect(view.dom.innerHTML).not.toContain('pm-verse-block')
    view.destroy()
  })
})
