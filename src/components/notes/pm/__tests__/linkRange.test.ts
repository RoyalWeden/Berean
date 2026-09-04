import { describe, it, expect, beforeAll } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { bereanSchema as schema } from '../schema'
import { parseMarkdown } from '../parser'
import { serializeToMarkdown } from '../serializer'
import { createEditorCommands } from '../editorCommands'

beforeAll(() => {
  const zeroRect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  // @ts-expect-error jsdom polyfill
  Range.prototype.getClientRects = () => [zeroRect]
  Range.prototype.getBoundingClientRect = () => zeroRect
})

function makeView(md: string) {
  const state = EditorState.create({ schema, doc: parseMarkdown(md) })
  const dom = document.createElement('div')
  document.body.appendChild(dom)
  return new EditorView(dom, { state })
}

function rangeOfWord(view: EditorView, word: string) {
  let from = -1
  view.state.doc.descendants((node, pos) => {
    if (node.isText && node.text?.includes(word)) from = pos + node.text.indexOf(word)
  })
  return { from, to: from + word.length }
}

describe('applyLink with an explicit range (popover open -> editor blur -> submit)', () => {
  it('still applies the link inside a blockquote after the live selection has collapsed', () => {
    const view = makeView('> quoted words here')
    view.focus()
    const range = rangeOfWord(view, 'words')
    // popover opens -> component captures `range` here.
    // focusing the URL <input> blurs the editor; simulate the selection collapsing.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, range.from, range.from)))
    createEditorCommands(view).applyLink('https://ex.com', range)
    expect(serializeToMarkdown(view.state.doc)).toBe('> quoted [words](https://ex.com) here')
    view.destroy()
  })

  it('same for a plain paragraph', () => {
    const view = makeView('quoted words here')
    view.focus()
    const range = rangeOfWord(view, 'words')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, range.from, range.from)))
    createEditorCommands(view).applyLink('https://ex.com', range)
    expect(serializeToMarkdown(view.state.doc)).toBe('quoted [words](https://ex.com) here')
    view.destroy()
  })

  it('falls back to the live selection when no range is passed', () => {
    const view = makeView('quoted words here')
    view.focus()
    const range = rangeOfWord(view, 'words')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, range.from, range.to)))
    createEditorCommands(view).applyLink('https://ex.com')
    expect(serializeToMarkdown(view.state.doc)).toBe('quoted [words](https://ex.com) here')
    view.destroy()
  })

  it('is a no-op when neither an explicit range nor a live selection covers any text', () => {
    const view = makeView('quoted words here')
    view.focus()
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3, 3)))
    createEditorCommands(view).applyLink('https://ex.com')
    expect(serializeToMarkdown(view.state.doc)).toBe('quoted words here')
    view.destroy()
  })
})
