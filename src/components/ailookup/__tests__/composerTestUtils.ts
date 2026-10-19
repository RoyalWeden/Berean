/** Test helpers for the rich-text chat composer (composer/ChatEditor.tsx) in jsdom. */
import { act } from 'react'
import { TextSelection } from 'prosemirror-state'
import { chatEditorViewFor } from '../composer/ChatEditor'
import { docToMarkdown, markdownToDoc } from '../composer/chatEditorState'

// jsdom has no layout: ProseMirror's scrollIntoView / coordsAtPos need Range rects.
if (typeof Range !== 'undefined') {
  const zeroRect = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [zeroRect] as unknown as DOMRectList
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => zeroRect
}

/** The editable element (role=textbox) — optionally by its aria-label. */
export const editorEl = (root: ParentNode, label?: string) =>
  root.querySelector<HTMLElement>(label ? `[role="textbox"][aria-label="${label}"]` : '[role="textbox"].chat-editor-pm')

export const viewOf = (el: Element | null) => {
  const v = chatEditorViewFor(el)
  if (!v) throw new Error('no chat editor view on element')
  return v
}

/** The composer's value as markdown. */
export const valueOf = (el: Element | null) => docToMarkdown(viewOf(el).state.doc)

/** Replace the whole content (like a user selecting all and typing / pasting markdown). */
export function setValue(el: Element | null, md: string) {
  const view = viewOf(el)
  act(() => {
    const doc = markdownToDoc(md)
    const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content)
    view.dispatch(tr.setSelection(TextSelection.atEnd(tr.doc)))
  })
}

/** Type character by character through handleTextInput (so input rules run). */
export function typeText(el: Element | null, text: string) {
  const view = viewOf(el)
  act(() => {
    for (const ch of text) {
      const { from, to } = view.state.selection
      const handled = view.someProp('handleTextInput', (f) => f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)))
      if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to))
    }
  })
}

/** A keydown on the editor. `mod` = ⌘ on a Mac (Ctrl under jsdom, which is not a Mac). */
export function press(el: Element | null, key: string, mods: { shift?: boolean; mod?: boolean; composing?: boolean } = {}) {
  const codes: Record<string, number> = { Enter: 13, Escape: 27, Backspace: 8 }
  act(() => {
    el!.dispatchEvent(new KeyboardEvent('keydown', {
      key, keyCode: codes[key] ?? 0, shiftKey: !!mods.shift, ctrlKey: !!mods.mod, isComposing: !!mods.composing, bubbles: true, cancelable: true,
    }))
  })
}

export function selectAll(el: Element | null) {
  const view = viewOf(el)
  act(() => { view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, view.state.doc.content.size - 1))) })
}
