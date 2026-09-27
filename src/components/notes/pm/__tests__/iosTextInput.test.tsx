/**
 * NOTES-IOS-001/005/006/007 — the note editor's contract with native text input.
 *
 *  • An autocorrect / spelling "Replace…" / text-replacement arrives as `insertReplacementText`
 *    whose text is in `dataTransfer` (WebKit), not `data`. It must REPLACE the word, never delete
 *    it — reading only `data` turned every iOS autocorrection into a deleted word.
 *  • On iOS the browser applies replacements and single-character deletes natively (the keyboard's
 *    own text model stays in step); the editor does not intercept them.
 *  • Native Format (B / I / U / S) and undo / redo input events become the editor's own commands.
 *  • An outside content prop never replaces the document mid-composition.
 *  • Re-rendering with new callback identities never remounts the editor.
 *  • Native text services stay on: spellcheck follows the Notes setting, autocorrect on,
 *    capitalization never forced.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'

let container: HTMLDivElement | null = null
let root: Root | null = null
afterEach(() => { if (root) act(() => root!.unmount()); container?.remove(); container = null; root = null; vi.resetModules() })

async function mountEditor(content: string, opts: { ios?: boolean } = {}) {
  vi.resetModules()
  const ua = Object.getOwnPropertyDescriptor(window.navigator, 'userAgent')
  if (opts.ios) Object.defineProperty(window.navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15', configurable: true })
  const { default: NoteEditorPM } = await import('../NoteEditorPM')
  if (opts.ios) { if (ua) Object.defineProperty(window.navigator, 'userAgent', ua); else delete (window.navigator as unknown as { userAgent?: string }).userAgent }
  const emitted: string[] = []
  let view: EditorView | null = null
  const ready = vi.fn((v: EditorView | null) => { if (v) view = v })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const render = (c: string) => act(() => root!.render(<NoteEditorPM noteId="n1" content={c} onChange={(md) => emitted.push(md)} onEditorReady={(v) => ready(v)} />))
  render(content)
  return { emitted, render, ready, get view() { return view! } }
}

/** Fire a `beforeinput` the way WebKit does; returns whether the editor cancelled it. */
function beforeInput(view: EditorView, init: { inputType: string; data?: string | null; text?: string; range?: [Node, number, Node, number] }): boolean {
  const ev = new Event('beforeinput', { bubbles: true, cancelable: true })
  const dt = init.text != null ? { getData: (t: string) => (t === 'text/plain' ? init.text! : '') } : null
  Object.defineProperties(ev, {
    inputType: { value: init.inputType },
    data: { value: init.data ?? null },
    dataTransfer: { value: dt },
    getTargetRanges: { value: () => init.range ? [{ startContainer: init.range[0], startOffset: init.range[1], endContainer: init.range[2], endOffset: init.range[3], collapsed: false }] : [] },
  })
  view.dom.dispatchEvent(ev)
  return ev.defaultPrevented
}
const textNode = (view: EditorView) => view.dom.querySelector('p')!.firstChild as Text
const select = (view: EditorView, from: number, to: number) => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)))

describe('autocorrect / spelling replacement', () => {
  it('replaces the word with the text from dataTransfer (WebKit form: data is null)', async () => {
    const ed = await mountEditor('I teh word')
    const t = textNode(ed.view)
    const prevented = beforeInput(ed.view, { inputType: 'insertReplacementText', data: null, text: 'the', range: [t, 2, t, 5] })
    expect(prevented).toBe(true)
    expect(ed.view.dom.textContent).toBe('I the word')
    expect(ed.emitted.at(-1)).toBe('I the word')
  })

  it('with no replacement text at all it leaves the event to the browser (never deletes the word)', async () => {
    const ed = await mountEditor('I teh word')
    const t = textNode(ed.view)
    expect(beforeInput(ed.view, { inputType: 'insertReplacementText', data: null, range: [t, 2, t, 5] })).toBe(false)
    expect(ed.view.dom.textContent).toBe('I teh word')
  })

  it('on iOS the replacement and a single-character delete are left to WebKit', async () => {
    const ed = await mountEditor('I teh word', { ios: true })
    const t = textNode(ed.view)
    expect(beforeInput(ed.view, { inputType: 'insertReplacementText', data: null, text: 'the', range: [t, 2, t, 5] })).toBe(false)
    select(ed.view, 4, 4)
    expect(beforeInput(ed.view, { inputType: 'deleteContentBackward' })).toBe(false)
    expect(ed.view.dom.textContent).toBe('I teh word')
  })

  it('on the Mac a collapsed Backspace is still the editor’s exact one-character delete', async () => {
    const ed = await mountEditor('abc def')
    select(ed.view, 4, 4)
    expect(beforeInput(ed.view, { inputType: 'deleteContentBackward' })).toBe(true)
    expect(ed.view.dom.textContent).toBe('ab def')
  })
})

describe('native editing commands', () => {
  it('Format ▸ Bold / Italic from the iOS callout become the editor’s marks (markdown preserved)', async () => {
    const ed = await mountEditor('make this bold')
    select(ed.view, 6, 10)
    expect(beforeInput(ed.view, { inputType: 'formatBold' })).toBe(true)
    expect(ed.emitted.at(-1)).toBe('make **this** bold')
    expect(beforeInput(ed.view, { inputType: 'formatItalic' })).toBe(true)
    expect(ed.emitted.at(-1)).toMatch(/\*\*\*this\*\*\*|\*\*_this_\*\*|_\*\*this\*\*_/)
  })

  it('shake-to-undo / three-finger undo and redo use the editor’s history', async () => {
    const ed = await mountEditor('abc')
    select(ed.view, 4, 4)
    ed.view.dispatch(ed.view.state.tr.insertText('d'))
    expect(ed.view.dom.textContent).toBe('abcd')
    expect(beforeInput(ed.view, { inputType: 'historyUndo' })).toBe(true)
    expect(ed.view.dom.textContent).toBe('abc')
    expect(beforeInput(ed.view, { inputType: 'historyRedo' })).toBe(true)
    expect(ed.view.dom.textContent).toBe('abcd')
  })
})

describe('state ownership', () => {
  it('a content prop that arrives during a composition does not replace the document', async () => {
    const ed = await mountEditor('Hello')
    ;(ed.view as unknown as { input: { composing: boolean } }).input.composing = true
    ed.render('Something else from outside')
    expect(ed.view.dom.textContent).toBe('Hello')
    ;(ed.view as unknown as { input: { composing: boolean } }).input.composing = false
  })

  it('re-rendering with new callbacks never remounts the editor', async () => {
    const ed = await mountEditor('Stable')
    const dom = ed.view.dom
    for (let i = 0; i < 5; i++) ed.render('Stable')
    expect(ed.view.dom).toBe(dom)
    expect(container!.querySelectorAll('.ProseMirror')).toHaveLength(1)
    expect(ed.ready.mock.calls.filter(([v]) => v != null)).toHaveLength(1)
  })
})

describe('native text services', () => {
  it('spellcheck follows the Notes setting; autocorrect on; capitalization not forced', async () => {
    const ed = await mountEditor('x')
    // After mountEditor's resetModules — the same store instance the editor imported.
    const { useAppStore } = await import('@/store')
    expect(ed.view.dom.getAttribute('spellcheck')).toBe('true')
    expect(ed.view.dom.getAttribute('autocorrect')).toBe('on')
    expect(ed.view.dom.hasAttribute('autocapitalize')).toBe(false)
    act(() => useAppStore.setState({ noteSpellCheck: false }))
    expect(ed.view.dom.getAttribute('spellcheck')).toBe('false')
    // …and it survives the next editor update (ProseMirror re-applies its attributes).
    select(ed.view, 1, 2)
    expect(ed.view.dom.getAttribute('spellcheck')).toBe('false')
    act(() => useAppStore.setState({ noteSpellCheck: true }))
  })
})
