import { describe, it, expect } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { bereanSchema as schema } from '../schema'
import { bereanInputRules } from '../inputRules'
import { serializeToMarkdown } from '../serializer'

function makeView() {
  const state = EditorState.create({ schema, doc: schema.nodes.doc.create(null, schema.nodes.paragraph.create()), plugins: [bereanInputRules] })
  const dom = document.createElement('div')
  document.body.appendChild(dom)
  return new EditorView(dom, { state })
}

// Simulates real typing one character at a time via the SAME hook
// prosemirror-inputrules actually uses — `handleTextInput`, an EditorView
// prop invoked only by real browser input events. Dispatching plain
// `insertText` transactions directly (an earlier, wrong version of this
// helper) bypasses that hook entirely and can never trigger input rule
// matching, since prosemirror-inputrules doesn't inspect the transaction
// stream after the fact — it intercepts text input at the point of entry.
function type(view: EditorView, text: string) {
  for (const ch of text) {
    const { from, to } = view.state.selection
    const handled = view.someProp('handleTextInput', (f) => f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)))
    if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to))
  }
}

describe('markdown-shortcut input rules (live conversion while typing, not just on save/reload)', () => {
  it('# + space converts the line into a real heading node', () => {
    const view = makeView()
    type(view, '# Title')
    expect(view.state.doc.firstChild?.type.name).toBe('heading')
    expect(view.state.doc.firstChild?.attrs.level).toBe(1)
    expect(serializeToMarkdown(view.state.doc)).toBe('# Title')
    view.destroy()
  })

  it('## + space converts to heading level 2', () => {
    const view = makeView()
    type(view, '## Title')
    expect(view.state.doc.firstChild?.attrs.level).toBe(2)
    view.destroy()
  })

  it('> + space wraps the line in a real blockquote node', () => {
    const view = makeView()
    type(view, '> quoted text')
    expect(view.state.doc.firstChild?.type.name).toBe('blockquote')
    expect(serializeToMarkdown(view.state.doc)).toBe('> quoted text')
    view.destroy()
  })

  it('- + space converts to a real bullet list', () => {
    const view = makeView()
    type(view, '- item one')
    expect(view.state.doc.firstChild?.type.name).toBe('bullet_list')
    expect(serializeToMarkdown(view.state.doc)).toBe('- item one')
    view.destroy()
  })

  it('1. + space converts to a real ordered list', () => {
    const view = makeView()
    type(view, '1. item one')
    expect(view.state.doc.firstChild?.type.name).toBe('ordered_list')
    view.destroy()
  })

  it('- [ ] + space converts to a task list item with checked:false (two-stage: "- " first makes a plain bullet item, then "[ ] " converts that item to a task)', () => {
    const view = makeView()
    type(view, '- [ ] todo')
    const list = view.state.doc.firstChild
    expect(list?.type.name).toBe('bullet_list')
    expect(list?.firstChild?.attrs.checked).toBe(false)
    expect(list?.firstChild?.textContent).toBe('todo')
    view.destroy()
  })

  it('- [x] + space converts to a task list item with checked:true', () => {
    const view = makeView()
    type(view, '- [x] done')
    const list = view.state.doc.firstChild
    expect(list?.firstChild?.attrs.checked).toBe(true)
    view.destroy()
  })

  it('``` converts the line into a real code_block node', () => {
    const view = makeView()
    type(view, '```')
    expect(view.state.doc.firstChild?.type.name).toBe('code_block')
    view.destroy()
  })

  it('**text** applies the strong mark live', () => {
    const view = makeView()
    type(view, 'hello **world**')
    expect(serializeToMarkdown(view.state.doc)).toBe('hello **world**')
    let bold = false
    view.state.doc.descendants((n) => { if (n.isText && n.marks.some((m) => m.type.name === 'strong')) bold = true })
    expect(bold).toBe(true)
    view.destroy()
  })

  it('*text* applies the em mark live (and does not misfire on a preceding **bold** run)', () => {
    const view = makeView()
    type(view, 'plain *italic*')
    let em = false
    view.state.doc.descendants((n) => { if (n.isText && n.marks.some((m) => m.type.name === 'em')) em = true })
    expect(em).toBe(true)
    view.destroy()
  })

  it('~~text~~ applies the strike mark live', () => {
    const view = makeView()
    type(view, 'oops ~~mistake~~')
    let strike = false
    view.state.doc.descendants((n) => { if (n.isText && n.marks.some((m) => m.type.name === 'strike')) strike = true })
    expect(strike).toBe(true)
    view.destroy()
  })

  it('`text` applies the code mark live', () => {
    const view = makeView()
    type(view, 'run `npm test`')
    let code = false
    view.state.doc.descendants((n) => { if (n.isText && n.marks.some((m) => m.type.name === 'code')) code = true })
    expect(code).toBe(true)
    view.destroy()
  })

  it('==text== applies the highlight mark live', () => {
    const view = makeView()
    type(view, 'see ==this==')
    let hl = false
    view.state.doc.descendants((n) => { if (n.isText && n.marks.some((m) => m.type.name === 'highlight')) hl = true })
    expect(hl).toBe(true)
    view.destroy()
  })

  // Regression: hand-typing "[[Title]]" previously stayed as inert plain
  // text (the raw brackets, unclickable) since real wikilink marks were
  // only ever created by parseMarkdown at note-LOAD time — there was no
  // live-typing conversion rule at all, unlike every other markdown
  // shortcut above.
  it('[[Title]] applies the wikilink mark live and strips the brackets', () => {
    const view = makeView()
    type(view, 'see [[My Note]]')
    let wikilink: { title?: string } | undefined
    view.state.doc.descendants((n) => {
      const m = n.isText && n.marks.find((m) => m.type.name === 'wikilink')
      if (m) wikilink = m.attrs
    })
    expect(wikilink?.title).toBe('My Note')
    expect(view.state.doc.textContent).toBe('see My Note')
    expect(serializeToMarkdown(view.state.doc)).toBe('see [[My Note]]')
    view.destroy()
  })
})
