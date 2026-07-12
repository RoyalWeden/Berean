import { describe, it, expect, beforeAll } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { bereanSchema as schema } from '../schema'
import { createAutocompletePlugin, type SlashCommandTrigger } from '../autocomplete'

beforeAll(() => {
  const zeroRect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  // @ts-expect-error jsdom polyfill for a test-only environment gap
  Range.prototype.getClientRects = () => [zeroRect]
  Range.prototype.getBoundingClientRect = () => zeroRect
})

function makeView(text: string, callbacks: Parameters<typeof createAutocompletePlugin>[0]) {
  const state = EditorState.create({
    schema,
    doc: schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined)),
    plugins: [createAutocompletePlugin(callbacks)],
  })
  const dom = document.createElement('div')
  document.body.appendChild(dom)
  const view = new EditorView(dom, { state })
  // Force the plugin's view() update hook to run once against the initial
  // state (it only fires on subsequent transactions otherwise). Position
  // content.size - 1, NOT content.size itself — the latter sits AT the
  // paragraph's closing boundary (one position past all its text), which
  // resolves to depth 0 (doc) rather than depth 1 (paragraph) and throws
  // textBeforeCursor's line-scoping off; real typing never lands the
  // cursor there, only content.size - 1 (still inside the paragraph).
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, Math.max(1, view.state.doc.content.size - 1))))
  return view
}

// Regression coverage for the fix: slash commands used to only fire when
// "/" was the very FIRST character of an otherwise-empty line — typing "/"
// after real content on the same line ("Some notes /") never triggered the
// menu at all, which the user explicitly asked to support ("make sure the
// slash commands work on lines that already have text too").
describe('slash-command trigger detection', () => {
  it('fires on an empty line ("/") — the original, already-working case', () => {
    let trigger: SlashCommandTrigger | null = null
    const view = makeView('/', { onSlashCommandTrigger: (t) => { trigger = t } })
    expect(trigger).toBeTruthy()
    expect(trigger!.query).toBe('')
    view.destroy()
  })

  it('fires right after existing text on the same line', () => {
    let trigger: SlashCommandTrigger | null = null
    const view = makeView('Some notes /', { onSlashCommandTrigger: (t) => { trigger = t } })
    expect(trigger).toBeTruthy()
    expect(trigger!.from).toBe(1 + 'Some notes '.length)
    view.destroy()
  })

  it('does not fire mid-word (e.g. "and/or")', () => {
    let trigger: SlashCommandTrigger | null | undefined = undefined
    makeView('and/or', { onSlashCommandTrigger: (t) => { trigger = t } })
    expect(trigger).toBeNull()
  })

  it('does not fire for a fraction like "1/2"', () => {
    let trigger: SlashCommandTrigger | null | undefined = undefined
    makeView('1/2', { onSlashCommandTrigger: (t) => { trigger = t } })
    expect(trigger).toBeNull()
  })

  it('includes the typed filter query after the slash', () => {
    let trigger: unknown = null
    const view = makeView('Notes /head', { onSlashCommandTrigger: (t) => { trigger = t } })
    expect((trigger as SlashCommandTrigger | null)?.query).toBe('head')
    view.destroy()
  })
})
