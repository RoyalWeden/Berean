import { describe, it, expect } from 'vitest'
import { EditorState, NodeSelection } from 'prosemirror-state'
import { bereanSchema as schema } from '../schema'
import { parseMarkdown } from '../parser'
import { serializeToMarkdown } from '../serializer'
import {
  readLinkAt, applyLinkEdit, removeLinkIn, blockTextRange, canLinkBlock, checkUrl,
  noteLinkHref, noteIdFromHref, searchNotesForLink, wikilinkMatchesNote,
} from '../linkModel'
import { createSelectionStatsPlugin, getSelectionStats } from '../selectionStats'
import type { Note } from '@/types'

function stateOf(md: string) {
  return EditorState.create({ schema, doc: parseMarkdown(md) })
}
function rangeOf(state: EditorState, word: string) {
  let from = -1
  state.doc.descendants((node, pos) => {
    if (from < 0 && node.isText && node.text?.includes(word)) from = pos + node.text.indexOf(word)
  })
  return { from, to: from + word.length }
}
const md = (s: EditorState) => serializeToMarkdown(s.doc)

describe('wikilink display text — [[Title|text]] (Obsidian alias form)', () => {
  it('parses the alias as the shown text and keeps the target title', () => {
    const s = stateOf('See [[Book of Enoch|this study]] now')
    const r = rangeOf(s, 'this study')
    const link = readLinkAt(s, r.from + 2, r.from + 2)!
    expect(link.text).toBe('this study')
    expect(link.destination).toEqual({ kind: 'wikilink', title: 'Book of Enoch' })
  })
  it('round-trips both forms unchanged', () => {
    for (const src of ['See [[Book of Enoch]] now', 'See [[Book of Enoch|this study]] now']) {
      expect(md(stateOf(src))).toBe(src)
    }
  })
})

describe('applyLinkEdit / removeLinkIn', () => {
  it('links selected text to a note by its stable id, keeping the wording and other formatting', () => {
    const s = stateOf('A **bold claim** here')
    const r = rangeOf(s, 'bold claim')
    const tr = applyLinkEdit(s, r, 'bold claim', { kind: 'note', noteId: 'n-42' })!
    const out = s.apply(tr)
    expect(md(out)).toBe('A **[bold claim](berean://note/n-42)** here')
  })

  it('changes the shown text independently of the destination (one undo step: one transaction)', () => {
    const s = stateOf('The Book of Enoch says')
    const r = rangeOf(s, 'Book of Enoch')
    const out = s.apply(applyLinkEdit(s, r, 'Enoch', { kind: 'url', href: 'https://example.com/enoch' })!)
    expect(md(out)).toBe('The [Enoch](https://example.com/enoch) says')
  })

  it('creates a link at a caret with the given text', () => {
    const s = stateOf('Start end')
    const at = rangeOf(s, 'end').from
    const out = s.apply(applyLinkEdit(s, { from: at, to: at }, 'Notes ', { kind: 'note', noteId: 'x' })!)
    expect(md(out)).toBe('Start [Notes ](berean://note/x)end')
  })

  it('editing an existing link from a caret inside it edits the WHOLE link', () => {
    const s = stateOf('Go to [the site](https://a.com) today')
    const inside = rangeOf(s, 'site').from + 1
    const link = readLinkAt(s, inside, inside)!
    expect(link.text).toBe('the site')
    const out = s.apply(applyLinkEdit(s, link, link.text, { kind: 'url', href: 'https://b.com' })!)
    expect(md(out)).toBe('Go to [the site](https://b.com) today')
  })

  it('keeps a [[wikilink]] a wikilink when only its text changes (alias), and removing a link keeps its text', () => {
    const s = stateOf('See [[Psalms Study]] here')
    const r = rangeOf(s, 'Psalms Study')
    const link = readLinkAt(s, r.from, r.to)!
    const aliased = s.apply(applyLinkEdit(s, link, 'the psalms', { kind: 'wikilink', title: 'Psalms Study' })!)
    expect(md(aliased)).toBe('See [[Psalms Study|the psalms]] here')
    const r2 = rangeOf(aliased, 'the psalms')
    const removed = aliased.apply(removeLinkIn(aliased, readLinkAt(aliased, r2.from, r2.to)!))
    expect(md(removed)).toBe('See the psalms here')
  })
})

describe('block links', () => {
  it('a heading, a paragraph and a single list item can be linked; a whole list cannot', () => {
    const s = stateOf('# Heading\n\nPara\n\n- one\n- two')
    expect(canLinkBlock(s.doc, 0)).toBe(true)
    const listPos = s.doc.child(0).nodeSize + s.doc.child(1).nodeSize
    expect(canLinkBlock(s.doc, listPos)).toBe(false)
    expect(canLinkBlock(s.doc, listPos + 1)).toBe(true) // the first list_item
  })

  it('linking a list item covers its text, keeps the list nested and the content intact', () => {
    const src = '- one\n- two\n  - nested'
    const s = stateOf(src)
    // The nested item.
    let itemPos = -1
    s.doc.descendants((n, pos) => { if (n.type === schema.nodes.list_item && n.textContent === 'nested') itemPos = pos })
    const range = blockTextRange(s.doc, itemPos)!
    const out = s.apply(applyLinkEdit(s, range, 'nested', { kind: 'url', href: 'https://x.org' })!)
    expect(md(out)).toBe('- one\n- two\n  - [nested](https://x.org)')
    // Still a NodeSelection-able list item afterwards (structure kept).
    expect(() => NodeSelection.create(out.doc, itemPos)).not.toThrow()
  })
})

describe('checkUrl', () => {
  it('accepts the schemes the editor always accepted, untouched', () => {
    for (const u of ['https://example.com/a?b=1', 'http://x.org', 'mailto:me@x.org', 'berean://verse/GEN/1/1', 'berean-dev://note/abc']) {
      expect(checkUrl(u)).toEqual({ ok: true, href: u })
    }
  })
  it('rejects a bare domain with a suggestion instead of silently rewriting it', () => {
    const r = checkUrl('example.com')
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.suggestion).toBe('https://example.com')
    expect(checkUrl('not a url').ok).toBe(false)
  })
})

describe('note link identity', () => {
  it('round-trips a note id through its href', () => {
    expect(noteIdFromHref(noteLinkHref('abc-123'))).toBe('abc-123')
    expect(noteIdFromHref('https://example.com')).toBeNull()
  })
  it('search ranks exact, then prefix, then contains; skips the current note', () => {
    const notes = [
      { id: '1', title: 'Enoch notes', updatedAt: 1 },
      { id: '2', title: 'Enoch', updatedAt: 0 },
      { id: '3', title: 'Book of Enoch', updatedAt: 5 },
      { id: '4', title: 'Enoch', updatedAt: 9 },
    ] as unknown as Note[]
    expect(searchNotesForLink(notes, 'enoch', 50, '4').map((n) => n.id)).toEqual(['2', '1', '3'])
    expect(wikilinkMatchesNote('Enoch#Intro', notes[1])).toBe(true)
  })
})

describe('selection stats for the inspector', () => {
  it('publishes the selection\'s counts (not the whole note\'s) and clears them when the selection empties', async () => {
    const { EditorView } = await import('prosemirror-view')
    const key = 'tab-1:note-1'
    const state = EditorState.create({ schema, doc: parseMarkdown('one two three\n\nfour five'), plugins: [createSelectionStatsPlugin(() => key)] })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const view = new EditorView(host, { state })
    const { TextSelection } = await import('prosemirror-state')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 8))) // "one two"
    await new Promise((r) => requestAnimationFrame(r))
    expect(getSelectionStats(key)).toMatchObject({ words: 2, characters: 7 })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)))
    await new Promise((r) => requestAnimationFrame(r))
    expect(getSelectionStats(key)).toBeNull()
    view.destroy()
  })
})
