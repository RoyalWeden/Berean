/** TEST25-NOTES-003 — the iPhone note editor surface: no docked toolbar / stats, selection
 *  bubble, + insert menu over the editor's own commands, markdown input rules intact, verse notes
 *  as cards with a lone + when empty. */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import NoteEditorPM from '@/components/notes/pm/NoteEditorPM'
import { bereanSchema as schema } from '@/components/notes/pm/schema'
import { serializeToMarkdown } from '@/components/notes/pm/serializer'
import { runNoteInsert, insertLink, NOTE_INSERT_ITEMS } from '../notes/noteInsertCommands'
import { PhoneSelectionToolbar } from '../notes/PhoneSelectionToolbar'
import { NoteInsertButton } from '../notes/NoteInsertButton'
import { noteStatsLine, showVerseContextLine } from '../notes/phoneEditorChrome'
import { VerseNotesSheet } from '../study/VerseNotesSheet'
import type { SheetApi } from '../primitives/Sheet'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let container: HTMLDivElement | null = null
let root: Root | null = null
afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove()
  container = null
  root = null
  document.body.innerHTML = ''
})
function render(node: React.ReactNode) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(node))
  return container
}

function makeView(text = '') {
  const state = EditorState.create({ schema, doc: schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined)) })
  const dom = document.createElement('div')
  document.body.appendChild(dom)
  const view = new EditorView(dom, { state })
  view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)))
  return view
}

// Same simulation as pm/__tests__/inputRules.test.ts: the handleTextInput hook real typing hits.
function type(view: EditorView, text: string) {
  for (const ch of text) {
    const { from, to } = view.state.selection
    const handled = view.someProp('handleTextInput', (f) => f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)))
    if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to))
  }
}

describe('NoteEditorPM chrome', () => {
  it('shows the docked formatting toolbar and word count by default (desktop unchanged)', () => {
    const el = render(<NoteEditorPM content="Hello there" onChange={() => {}} />)
    expect(el.querySelector('[aria-label="Bold"]')).toBeTruthy()
    expect(el.textContent).toMatch(/2 words/)
    expect(el.querySelector('.pm-has-floating-toolbar')).toBeTruthy()
    expect(el.querySelector('.pm-chrome-phone')).toBeNull()
  })

  it('chrome="phone" hides the docked toolbar and the stats line', () => {
    const el = render(<NoteEditorPM content="Hello there" onChange={() => {}} chrome="phone" />)
    expect(el.querySelector('.ProseMirror')).toBeTruthy()
    expect(el.querySelector('[aria-label="Bold"]')).toBeNull()
    expect(el.textContent).not.toMatch(/words?/)
    expect(el.querySelector('.pm-has-floating-toolbar')).toBeNull()
    expect(el.querySelector('.pm-chrome-phone')).toBeTruthy()
  })

  it('onEditorReady hands out the live view, then null on unmount; markdown "## " still becomes a heading', () => {
    const ready = vi.fn()
    render(<NoteEditorPM content="" onChange={() => {}} chrome="phone" onEditorReady={ready} />)
    const view = ready.mock.calls[0][0] as EditorView
    expect(view).toBeInstanceOf(EditorView)
    act(() => type(view, '## Section'))
    expect(view.state.doc.firstChild?.type.name).toBe('heading')
    expect(view.state.doc.firstChild?.attrs.level).toBe(2)
    expect(serializeToMarkdown(view.state.doc)).toBe('## Section')
    act(() => root!.unmount()); root = null
    expect(ready).toHaveBeenLastCalledWith(null)
  })
})

describe('+ insert menu commands (the editor\'s own slash commands)', () => {
  it('offers the concise insert list', () => {
    expect(NOTE_INSERT_ITEMS.map((i) => i.id)).toEqual(['verse', 'image', 'link', 'h2', 'bullet', 'task', 'quote', 'divider'])
  })
  it('Heading converts the current line', () => {
    const v = makeView('Title'); runNoteInsert(v, 'h2')
    expect(serializeToMarkdown(v.state.doc)).toBe('## Title')
  })
  it('Bulleted list / Checklist / Quote wrap the line', () => {
    const a = makeView('one'); runNoteInsert(a, 'bullet')
    expect(a.state.doc.firstChild?.type.name).toBe('bullet_list')
    const b = makeView('todo'); runNoteInsert(b, 'task')
    expect(serializeToMarkdown(b.state.doc)).toMatch(/\[ \] todo/)
    const c = makeView('said'); runNoteInsert(c, 'quote')
    expect(c.state.doc.firstChild?.type.name).toBe('blockquote')
  })
  it('Divider inserts a horizontal rule', () => {
    const v = makeView(''); runNoteInsert(v, 'divider')
    let hr = false
    v.state.doc.descendants((n) => { if (n.type.name === 'horizontal_rule') hr = true })
    expect(hr).toBe(true)
  })
  it('Scripture reference starts a reference on its own line, placeholder selected', () => {
    const v = makeView('Some text'); runNoteInsert(v, 'verse')
    expect(v.state.doc.childCount).toBe(2)
    expect(v.state.doc.child(0).textContent).toBe('Some text')
    const { from, to } = v.state.selection
    expect(v.state.doc.textBetween(from, to)).toBe('Book chapter:verse')
  })
  it('Image opens a file picker', () => {
    const v = makeView('')
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    runNoteInsert(v, 'image')
    expect(document.querySelector('input[type="file"][accept="image/*"]')).toBeTruthy()
    click.mockRestore()
  })
  it('Link inserts linked text at the cursor, or links a selection', () => {
    const v = makeView('See ')
    insertLink(v, 'https://example.com', 'site')
    expect(serializeToMarkdown(v.state.doc)).toBe('See [site](https://example.com)')
    const w = makeView('word')
    w.dispatch(w.state.tr.setSelection(TextSelection.create(w.state.doc, 1, 5)))
    insertLink(w, 'https://x.org')
    expect(serializeToMarkdown(w.state.doc)).toBe('[word](https://x.org)')
  })
  it('the + button opens the menu and runs a command', () => {
    const v = makeView('Heading me')
    render(<NoteInsertButton view={v} />)
    const fab = document.querySelector('.m-note-insert-fab') as HTMLButtonElement
    act(() => fab.click())
    const rows = Array.from(document.querySelectorAll('.m-note-insert-row')) as HTMLButtonElement[]
    expect(rows.map((r) => r.textContent)).toContain('Heading')
    act(() => rows.find((r) => r.textContent === 'Heading')!.click())
    expect(serializeToMarkdown(v.state.doc)).toBe('## Heading me')
    expect(document.querySelector('.m-note-insert-menu')).toBeNull()
  })
})

describe('phone selection toolbar', () => {
  it('renders touch buttons below the selection and applies marks', () => {
    const v = makeView('bold me')
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 1, 5)))
    render(<PhoneSelectionToolbar view={v} state={{ coords: { left: 10, right: 60, top: 100, bottom: 120 } }} />)
    const bar = document.querySelector('.m-selbar.pm-toolbar-solid') as HTMLElement
    expect(bar).toBeTruthy()
    for (const l of ['Bold', 'Italic', 'Underline', 'Strikethrough', 'Highlight', 'Link', 'Inline code']) expect(bar.querySelector(`[aria-label="${l}"]`)).toBeTruthy()
    expect(parseFloat(bar.style.top)).toBeGreaterThan(120)
    act(() => (bar.querySelector('[aria-label="Bold"]') as HTMLButtonElement).click())
    expect(serializeToMarkdown(v.state.doc)).toBe('**bold** me')
  })
})

describe('header / stats helpers', () => {
  it('stats line', () => {
    expect(noteStatsLine({ words: 124, characters: 690, minutes: 1 })).toBe('124 words · 690 characters · 1 min read')
    expect(noteStatsLine({ words: 1, characters: 1, minutes: 1 })).toBe('1 word · 1 character · 1 min read')
  })
  it('verse reference line only when the title does not already say it', () => {
    expect(showVerseContextLine('Genesis 1:1', 'Genesis 1:1')).toBe(false)
    expect(showVerseContextLine(' genesis  1:1 ', 'Genesis 1:1')).toBe(false)
    expect(showVerseContextLine('Creation', 'Genesis 1:1')).toBe(true)
  })
})

describe('VerseNotesSheet', () => {
  const api = { close: vi.fn(), expand: vi.fn(), setDetent: vi.fn(), detent: 1, atLow: false, push: vi.fn(), pop: vi.fn(), popToRoot: vi.fn(), depth: 1 } as unknown as SheetApi
  const setNotes = (list: unknown[]) => { (window as unknown as { notes: unknown }).notes = { getVerseNotes: async () => list } }

  it('no note → only a floating + (no "New note" row); tapping it creates and opens the note in place', async () => {
    setNotes([])
    const onNewNote = vi.fn(async () => 'n-new')
    render(<VerseNotesSheet verseRef="1.1.1" textId="kjva" label="Genesis 1:1" api={api} onOpenNote={() => {}} onNewNote={onNewNote} />)
    await act(async () => { await Promise.resolve() })
    const fab = document.querySelector('.m-verse-notes-fab') as HTMLButtonElement
    expect(fab).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/New note/)
    await act(async () => { fab.click(); await Promise.resolve(); await Promise.resolve() })
    expect(onNewNote).toHaveBeenCalledTimes(1)
    expect(api.push).toHaveBeenCalledWith(expect.objectContaining({ key: 'note-n-new' }))
  })

  it('existing notes → preview cards, no +, no count heading', async () => {
    setNotes([{ id: 'a', title: 'Creation', content: 'In the **beginning** Yehovah created', type: 'verse', createdAt: 0, updatedAt: 0 }])
    render(<VerseNotesSheet verseRef="1.1.1" textId="kjva" label="Genesis 1:1" api={api} onOpenNote={() => {}} onNewNote={async () => null} />)
    await act(async () => { await Promise.resolve() })
    const card = document.querySelector('.m-verse-note-card') as HTMLElement
    expect(card.querySelector('.m-verse-note-card-title')?.textContent).toBe('Creation')
    expect(card.querySelector('.m-verse-note-card-preview')?.textContent).toBe('In the beginning Yehovah created')
    expect(document.querySelector('.m-verse-notes-fab')).toBeNull()
    expect(document.body.textContent).not.toMatch(/1 note on/)
  })
})
