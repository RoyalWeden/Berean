import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

// Port of NoteEditor.tsx's buildFindHighlightPlugin (NoteEditor.tsx:119-143):
// highlights every case-insensitive occurrence of `query` in the document
// with a `.berean-find-mark` class, so the parent panel's find bar can
// visually locate matches. Query is set via a dispatched transaction meta
// (see NoteEditorPM.tsx's findQuery-driven effect) rather than a prop
// re-render, since the plugin/decoration set lives inside EditorState.

export const findHighlightKey = new PluginKey<string>('berean-find-highlight')
const setQueryMeta = 'berean-set-find-query'

export function setFindQuery(view: import('prosemirror-view').EditorView, query: string) {
  view.dispatch(view.state.tr.setMeta(setQueryMeta, query))
}

export function createFindHighlightPlugin() {
  return new Plugin<string>({
    key: findHighlightKey,
    state: {
      init: () => '',
      apply(tr, query) {
        const meta = tr.getMeta(setQueryMeta) as string | undefined
        return meta !== undefined ? meta : query
      },
    },
    props: {
      decorations(state) {
        const query = this.getState(state)?.trim()
        if (!query) return null
        const lower = query.toLowerCase()
        const decorations: Decoration[] = []
        // Scan per TEXTBLOCK, not per individual text node — a query can
        // span multiple text runs split apart by marks (e.g. "1:1" where
        // "1:" is bold and "1" isn't), which per-text-node scanning would
        // miss entirely.
        state.doc.descendants((node, pos) => {
          if (!node.isTextblock) return true
          const text = node.textContent.toLowerCase()
          const base = pos + 1
          let i = 0
          while ((i = text.indexOf(lower, i)) !== -1) {
            decorations.push(Decoration.inline(base + i, base + i + lower.length, { class: 'berean-find-mark' }))
            i += lower.length
          }
          return false
        })
        return DecorationSet.create(state.doc, decorations)
      },
    },
  })
}
