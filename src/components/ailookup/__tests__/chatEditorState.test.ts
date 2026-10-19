// @vitest-environment jsdom
/** Berean Chat composer editor model: markdown in/out, strict input rules, keys, paste. */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { EditorView } from 'prosemirror-view'
import { TextSelection } from 'prosemirror-state'
import {
  createChatEditorState, docToMarkdown, markdownToDoc, activeFormats, toggleBlock, toggleFormatMark,
  looksLikeMarkdown, setLink, type ChatKeyHandlers,
} from '../composer/chatEditorState'

const views: EditorView[] = []
afterEach(() => { views.splice(0).forEach((v) => { v.destroy(); v.dom.remove() }) })

function make(md = '', over: Partial<ChatKeyHandlers> = {}) {
  const h: ChatKeyHandlers = { submit: vi.fn(), returnSends: () => true, escape: vi.fn(() => false), openLink: vi.fn(), ...over }
  const dom = document.createElement('div'); document.body.appendChild(dom)
  const view = new EditorView(dom, { state: createChatEditorState(md, h, () => 'Message') })
  view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)))
  views.push(view)
  return { view, h, md: () => docToMarkdown(view.state.doc) }
}
/** Real typing: through handleTextInput, the hook input rules listen on. */
function type(view: EditorView, text: string) {
  for (const ch of text) {
    const { from, to } = view.state.selection
    const handled = view.someProp('handleTextInput', (f) => f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)))
    if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to))
  }
}
function key(view: EditorView, k: string, mods: { shift?: boolean; meta?: boolean; composing?: boolean } = {}) {
  const ev = new KeyboardEvent('keydown', { key: k, shiftKey: !!mods.shift, metaKey: false, ctrlKey: !!mods.meta /* jsdom is not a Mac: Mod = Ctrl */, bubbles: true, cancelable: true, isComposing: !!mods.composing, keyCode: k === 'Enter' ? 13 : k === 'Backspace' ? 8 : k === 'Escape' ? 27 : 0 })
  view.dom.dispatchEvent(ev)
  return ev
}

describe('markdown round trip', () => {
  const cases = [
    'plain words', '**bold** and *italic*', '<u>under</u> ~~strike~~ `code`', '[site](https://sitgmeat.com)',
    '- one\n- two', '1. first\n2. second', '> a quote', '## Heading', '```\nlet x = 2 * 3\n```',
    'line one\nline two', '2 * 3 * 4', 'snake_case_name and file_v2', 'John 3:16 and Ps 23:1-6', 'https://example.com/a_b_c',
  ]
  for (const c of cases) it(JSON.stringify(c), () => { expect(docToMarkdown(markdownToDoc(c))).toBe(c) })
  it('an empty doc is the empty string; blank paragraphs are dropped', () => {
    expect(docToMarkdown(markdownToDoc(''))).toBe('')
    expect(docToMarkdown(markdownToDoc('a\n\n\n\nb'))).toBe('a\n\nb')
  })
})

describe('input rules', () => {
  const conv: Array<[string, string]> = [
    ['**bold** ', '**bold**'], ['*it* ', '*it*'], ['_it_ ', '*it*'], ['~~gone~~ ', '~~gone~~'], ['`x` ', '`x`'],
    ['> quoted', '> quoted'], ['- item', '- item'], ['* item', '* item'], ['1. item', '1. item'], ['# Title', '# Title'],
  ]
  for (const [typed, out] of conv) it(`converts ${JSON.stringify(typed)}`, () => {
    const { view, md } = make()
    type(view, typed)
    expect(md()).toBe(out)
  })
  it('``` makes a code block, and nothing converts inside it', () => {
    const { view } = make()
    type(view, '```')
    expect(view.state.doc.firstChild!.type.name).toBe('code_block')
    type(view, '**x** _y_ # z')
    expect(view.state.doc.firstChild!.textContent).toBe('**x** _y_ # z')
  })
  const literal = ['2 * 3 * 4', 'snake_case_name', 'a*b*c', '__init__ ', 'https://x.com/_a_b_', 'John 3:16 and Ps 23:1-6', 'file_name_v2.txt', '**open', '** spaced **', 'x - y', '`code` inside `x`'.slice(0, 5)]
  for (const t of literal) it(`leaves ${JSON.stringify(t)} literal`, () => {
    const { view } = make()
    type(view, t)
    const d = view.state.doc
    let marked = false
    d.descendants((n) => { if (n.marks.length) marked = true })
    expect(marked).toBe(false)
    expect(d.firstChild!.type.name).toBe('paragraph')
    expect(d.textContent).toBe(t)
  })
  it('bolds inside a word ("gre**ger**" never shows its asterisks), like CommonMark', () => {
    const { view, md } = make()
    type(view, 'gre**ger**')
    expect(view.state.doc.textContent).toBe('greger')
    const bold: string[] = []
    view.state.doc.descendants((n) => { if (n.isText && n.marks.some((m) => m.type.name === 'strong')) bold.push(n.text!) })
    expect(bold).toEqual(['ger'])
    expect(md()).toBe('gre**ger**')
    type(view, ' and un~~do~~ne')
    expect(view.state.doc.textContent).toBe('greger and undone')
    expect(md()).toBe('gre**ger** and un~~do~~ne')
  })
  it('a single * or _ inside a word stays literal (2*3*4, snake_case)', () => {
    const { view } = make()
    type(view, 'x2*3*4 my_var_name ')
    expect(view.state.doc.textContent).toBe('x2*3*4 my_var_name ')
  })
  it('the caret stays after the converted text and typing continues unformatted', () => {
    const { view, md } = make()
    type(view, 'gre**ger**x')
    expect(md()).toBe('gre**ger**x')
    expect(view.state.selection.from).toBe(view.state.doc.content.size - 1)
  })
  it('nothing converts inside inline code', () => {
    const { view } = make()
    type(view, '`a **b** c` ')
    let bold = false
    view.state.doc.descendants((n) => { if (n.marks.some((m) => m.type.name === 'strong')) bold = true })
    expect(bold).toBe(false)
  })
  it('Backspace right after a conversion restores the literal text', () => {
    const { view } = make()
    type(view, '**bold**')
    expect(docToMarkdown(view.state.doc)).toBe('**bold**')
    key(view, 'Backspace')
    expect(view.state.doc.textContent).toBe('**bold**')
    expect(docToMarkdown(view.state.doc)).toBe('\\*\\*bold\\*\\*')
  })
  it('a list started after Shift+Return splits the line off', () => {
    const { view, md } = make()
    type(view, 'Notes:')
    key(view, 'Enter', { shift: true })
    type(view, '- first')
    expect(md()).toBe('Notes:\n\n- first')
  })
})

describe('keys', () => {
  it('Return sends, Shift+Return is a line break, ⌘Return asks', () => {
    const { view, h, md } = make()
    type(view, 'one')
    key(view, 'Enter', { shift: true })
    type(view, 'two')
    expect(md()).toBe('one\ntwo')
    expect(h.submit).not.toHaveBeenCalled()
    key(view, 'Enter')
    expect(h.submit).toHaveBeenLastCalledWith(false)
    key(view, 'Enter', { meta: true })
    expect(h.submit).toHaveBeenLastCalledWith(true)
  })
  it('Return inside a code block is a newline; on an empty last line it leaves the block', () => {
    const { view, h, md } = make()
    type(view, '```')
    type(view, 'a')
    key(view, 'Enter')
    type(view, 'b')
    expect(h.submit).not.toHaveBeenCalled()
    key(view, 'Enter'); key(view, 'Enter')
    type(view, 'after')
    expect(md()).toBe('```\na\nb\n```\n\nafter')
  })
  it('Shift+Return in a list adds an item; on an empty item leaves the list', () => {
    const { view, md } = make()
    type(view, '- a')
    key(view, 'Enter', { shift: true })
    type(view, 'b')
    key(view, 'Enter', { shift: true })
    key(view, 'Enter', { shift: true })
    type(view, 'out')
    expect(md()).toBe('- a\n- b\n\nout')
  })
  it('⌘B toggles bold and never sends', () => {
    const { view, h } = make('word')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 5)))
    key(view, 'b', { meta: true })
    expect(docToMarkdown(view.state.doc)).toBe('**word**')
    key(view, 'i', { meta: true })
    key(view, 'u', { meta: true })
    expect(docToMarkdown(view.state.doc)).toBe('***<u>word</u>***')
    expect(h.submit).not.toHaveBeenCalled()
  })
  it('an IME composition Enter never sends', () => {
    const { view, h } = make('かな')
    key(view, 'Enter', { composing: true })
    expect(h.submit).not.toHaveBeenCalled()
  })
  it('iPhone: Return is a new line', () => {
    const { view, h, md } = make('', { returnSends: () => false })
    type(view, 'a')
    key(view, 'Enter')
    type(view, 'b')
    expect(h.submit).not.toHaveBeenCalled()
    expect(md()).toBe('a\nb')
  })
  it('Esc runs the composer chain; ⌘K opens the link field or links a selected address', () => {
    const { view, h } = make('https://sitgmeat.com')
    key(view, 'Escape')
    expect(h.escape).toHaveBeenCalled()
    key(view, 'k', { meta: true })
    expect(h.openLink).toHaveBeenCalledTimes(1)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, view.state.doc.content.size - 1)))
    key(view, 'k', { meta: true })
    expect(h.openLink).toHaveBeenCalledTimes(1)
    expect(docToMarkdown(view.state.doc)).toBe('<https://sitgmeat.com>')
  })
})

describe('toolbar commands + active state', () => {
  it('marks report active from the selection and toggle on it', () => {
    const { view } = make('**grace** abounds')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
    expect(activeFormats(view.state).strong).toBe(true)
    expect(activeFormats(view.state).em).toBe(false)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 7, 14)))
    toggleFormatMark('em')(view.state, view.dispatch)
    expect(docToMarkdown(view.state.doc)).toBe('**grace** *abounds*')
  })
  it('with no selection a mark is stored for the next typing', () => {
    const { view, md } = make('a')
    type(view, ' ')
    toggleFormatMark('strong')(view.state, view.dispatch)
    expect(activeFormats(view.state).strong).toBe(true)
    type(view, 'b')
    expect(md()).toBe('a **b**')
  })
  it('lists, quote, heading and code block toggle', () => {
    const { view, md } = make('text')
    const run = (k: Parameters<typeof toggleBlock>[0]) => toggleBlock(k)(view.state, view.dispatch, view)
    run('bullet_list'); expect(md()).toBe('- text'); expect(activeFormats(view.state).bullet_list).toBe(true)
    run('ordered_list'); expect(md()).toBe('1. text')
    run('ordered_list'); expect(md()).toBe('text')
    run('blockquote'); expect(md()).toBe('> text'); run('blockquote'); expect(md()).toBe('text')
    run('heading'); expect(md()).toBe('## text'); run('bullet_list'); expect(md()).toBe('- text'); run('bullet_list')
    run('code_block'); expect(md()).toBe('```\ntext\n```'); run('code_block'); expect(md()).toBe('text')
  })
  it('a line-broken paragraph becomes a multi-line code block and back', () => {
    const { view, md } = make('a\nb')
    toggleBlock('code_block')(view.state, view.dispatch, view)
    expect(md()).toBe('```\na\nb\n```')
    toggleBlock('code_block')(view.state, view.dispatch, view)
    expect(md()).toBe('a\nb')
  })
  it('setLink links the selection or inserts the address', () => {
    const { view, md } = make('read this ')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 6, 10)))
    setLink('https://sitgmeat.com')(view.state, view.dispatch)
    expect(md()).toBe('read [this](https://sitgmeat.com)')
  })
})

describe('paste', () => {
  function paste(view: EditorView, data: Record<string, string>) {
    const ev = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(ev, 'clipboardData', { value: { getData: (t: string) => data[t] ?? '', files: [], items: [] } })
    view.dom.dispatchEvent(ev)
  }
  it('plain text pastes as text — no conversion', () => {
    const { view, md } = make()
    paste(view, { 'text/plain': 'snake_case 2 * 3 * 4\nnext line' })
    expect(md()).toBe('snake_case 2 * 3 * 4\nnext line')
  })
  it('markdown-looking text pastes as structure', () => {
    const { view, md } = make()
    paste(view, { 'text/plain': '**Grace** teaches\n\n- one\n- two' })
    expect(md()).toBe('**Grace** teaches\n\n- one\n- two')
  })
  it('detects markdown only when unambiguous', () => {
    expect(looksLikeMarkdown('2 * 3 * 4')).toBe(false)
    expect(looksLikeMarkdown('see John 3:16')).toBe(false)
    expect(looksLikeMarkdown('- a\n- b')).toBe(true)
    expect(looksLikeMarkdown('```\nx\n```')).toBe(true)
  })
})
