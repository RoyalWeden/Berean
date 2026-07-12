import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { bereanSchema as schema } from '../schema'
import { parseMarkdown } from '../parser'
import { serializeToMarkdown } from '../serializer'
import { replaceRangeWithBlock, replaceRangeWithText, replaceRangeWithWikilink } from '../autocomplete'
import { createBlockDecorationsPlugin } from '../blockDecorations'
import { useAppStore } from '@/store'

beforeAll(() => {
  const zeroRect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  // @ts-expect-error jsdom polyfill for a test-only environment gap
  Range.prototype.getClientRects = () => [zeroRect]
  Range.prototype.getBoundingClientRect = () => zeroRect
})

function makeView(content: string) {
  const state = EditorState.create({ schema, doc: parseMarkdown(content), plugins: [createBlockDecorationsPlugin()] })
  const dom = document.createElement('div')
  document.body.appendChild(dom)
  return new EditorView(dom, { state })
}

describe('replaceRangeWithBlock', () => {
  beforeEach(() => { useAppStore.getState().setNoteScriptureBlock?.(true) })
  afterEach(() => { useAppStore.getState().setNoteScriptureBlock?.(false) })

  it('splits a multi-line block into real separate paragraph nodes (not one text node with literal \\n)', () => {
    const view = makeView('Genesis 5:6')
    // Select the whole (only) paragraph's text and replace it — the
    // trigger-detection range in real usage (autocomplete.ts's
    // textBeforeCursor) always covers exactly the matched ref text on its
    // own line this way.
    const from = 1
    const to = 1 + 'Genesis 5:6'.length
    replaceRangeWithBlock(view, from, to, ['Genesis 5:6', '6 And Seth lived...'])
    expect(view.state.doc.childCount).toBe(2)
    expect(view.state.doc.child(0).type.name).toBe('paragraph')
    expect(view.state.doc.child(1).type.name).toBe('paragraph')
    expect(view.state.doc.child(0).textContent).toBe('Genesis 5:6')
    expect(view.state.doc.child(1).textContent).toBe('6 And Seth lived...')
    view.destroy()
  })

  it('mid-line insertion splits the surrounding paragraph at both ends — leading/trailing text on that line becomes its own paragraph, each block line lands as its own paragraph', () => {
    const view = makeView('before Genesis 5:6:7 after')
    const from = 'before '.length + 1
    const to = from + 'Genesis 5:6:7'.length
    replaceRangeWithBlock(view, from, to, ['Genesis 5:6-7', '6 And Seth...', '7 And Seth...'])
    const paras: string[] = []
    view.state.doc.forEach((n) => paras.push(n.textContent))
    expect(paras).toEqual(['before ', 'Genesis 5:6-7', '6 And Seth...', '7 And Seth...', ' after'])
    view.destroy()
  })

  it('a block inserted via replaceRangeWithBlock is detected by blockDecorations as a genuine multi-paragraph verse block', () => {
    const view = makeView('')
    replaceRangeWithBlock(view, 1, 1, ['Genesis 5:6-7', '6 And Seth lived an hundred and five years, and begat Enos:', '7 And Seth lived after he begat Enos eight hundred and seven years, and begat sons and daughters:'])
    const html = view.dom.innerHTML
    expect(html).toContain('pm-verse-block-first')
    expect(html).toContain('pm-verse-block-middle')
    expect(html).toContain('pm-verse-block-last')
    view.destroy()
  })

  it('regression: the old replaceRangeWithText path with a \\n-joined string does NOT produce separate paragraphs (documents the bug this file fixes)', () => {
    const view = makeView('')
    replaceRangeWithText(view, 1, 1, 'Genesis 5:6\n6 And Seth lived...')
    // Still a single paragraph — the '\n' is just a literal character inside
    // one text node, not a real paragraph break.
    expect(view.state.doc.childCount).toBe(1)
    expect(serializeToMarkdown(view.state.doc)).not.toContain('\n\n')
    view.destroy()
  })
})

describe('replaceRangeWithWikilink', () => {
  it('inserts a genuine wikilink mark (clickable immediately, not inert bracket text)', () => {
    const view = makeView('See ')
    const from = view.state.doc.content.size - 1
    replaceRangeWithWikilink(view, from, from, 'My Note')
    let wikilink: { title?: string } | undefined
    view.state.doc.descendants((n) => {
      const m = n.isText && n.marks.find((m) => m.type.name === 'wikilink')
      if (m) wikilink = m.attrs
    })
    expect(wikilink?.title).toBe('My Note')
    expect(view.state.doc.textContent).toBe('SeeMy Note')
    expect(serializeToMarkdown(view.state.doc)).toBe('See[[My Note]]')
    view.destroy()
  })

  it('regression: the old replaceRangeWithText(`[[${title}]]`) path leaves raw bracket text with no mark at all', () => {
    const view = makeView('See ')
    const from = view.state.doc.content.size - 1
    replaceRangeWithText(view, from, from, '[[My Note]]')
    let hasWikilinkMark = false
    view.state.doc.descendants((n) => {
      if (n.isText && n.marks.some((m) => m.type.name === 'wikilink')) hasWikilinkMark = true
    })
    expect(hasWikilinkMark).toBe(false)
    expect(view.state.doc.textContent).toBe('See[[My Note]]')
    view.destroy()
  })
})
