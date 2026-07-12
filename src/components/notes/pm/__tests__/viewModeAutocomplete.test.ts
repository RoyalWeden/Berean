import { describe, it, expect, beforeAll } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { bereanSchema as schema } from '../schema'
import { createAutocompletePlugin, type SlashCommandTrigger, type VerseSuggestTrigger } from '../autocomplete'

// Regression coverage for the View-mode bug: NoteEditorPM keeps the SAME
// live EditorView mounted across the Edit/View mode toggle (just non-
// editable, via `editable: () => mode === 'edit'`) rather than swapping to a
// separate static renderer. The autocomplete plugin's update() hook fires on
// any selection change regardless of editability (cursor movement via arrow
// keys, or a version-switch content replace), so without an explicit
// `view.editable` check it kept popping the insert-scripture/lexicon-block
// suggestion even when the note wasn't editable at all.

beforeAll(() => {
  const zeroRect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  // @ts-expect-error jsdom polyfill for a test-only environment gap
  Range.prototype.getClientRects = () => [zeroRect]
  Range.prototype.getBoundingClientRect = () => zeroRect
})

function makeView(text: string, editable: boolean, callbacks: Parameters<typeof createAutocompletePlugin>[0]) {
  const state = EditorState.create({
    schema,
    doc: schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined)),
    plugins: [createAutocompletePlugin(callbacks)],
  })
  const dom = document.createElement('div')
  document.body.appendChild(dom)
  const view = new EditorView(dom, { state, editable: () => editable })
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, Math.max(1, view.state.doc.content.size - 1))))
  return view
}

describe('autocomplete plugin respects view.editable (View mode suppression)', () => {
  it('fires verse-suggest triggers in an editable view', () => {
    let trigger: unknown = null
    const view = makeView('Genesis 1:1', true, { onVerseSuggestTrigger: (t) => { trigger = t } })
    expect((trigger as VerseSuggestTrigger | null)?.ref).toBe('Genesis 1:1')
    view.destroy()
  })

  it('does not fire verse-suggest triggers in a non-editable (View mode) view', () => {
    let trigger: unknown = 'unset'
    const view = makeView('Genesis 1:1', false, { onVerseSuggestTrigger: (t) => { trigger = t } })
    expect(trigger).toBeNull()
    view.destroy()
  })

  it('does not fire slash-command triggers in a non-editable view', () => {
    let trigger: SlashCommandTrigger | null | undefined = undefined
    const view = makeView('/', false, { onSlashCommandTrigger: (t) => { trigger = t } })
    expect(trigger).toBeNull()
    view.destroy()
  })

  it('does not fire wikilink/strongs triggers in a non-editable view either', () => {
    let wikilink: unknown = 'unset'
    let strongs: unknown = 'unset'
    const view = makeView('[[Some note', false, {
      onWikilinkTrigger: (t) => { wikilink = t },
      onStrongsTrigger: (t) => { strongs = t },
    })
    expect(wikilink).toBeNull()
    expect(strongs).toBeNull()
    view.destroy()
  })
})
