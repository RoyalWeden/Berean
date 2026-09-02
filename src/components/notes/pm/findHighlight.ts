import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

// Port of NoteEditor.tsx's buildFindHighlightPlugin (NoteEditor.tsx:119-143):
// highlights every case-insensitive occurrence of `query` in the document
// with a `.berean-find-mark` class, so the parent panel's find bar can
// visually locate matches. Query is set via a dispatched transaction meta
// (see NoteEditorPM.tsx's findQuery-driven effect) rather than a prop
// re-render, since the plugin/decoration set lives inside EditorState.

export type FindMode = 'all' | 'any' | 'phrase'
interface FindState { query: string; mode: FindMode }

export const findHighlightKey = new PluginKey<FindState>('berean-find-highlight')
const setQueryMeta = 'berean-set-find-query'

/** `mode` defaults to 'phrase' (literal contiguous match — the Cmd+F find bar's behaviour).
 *  'all' / 'any' highlight every occurrence of each whitespace-separated term instead, so a
 *  multi-word notes-search query lights up all its words inside the read-only preview. */
export function setFindQuery(view: import('prosemirror-view').EditorView, query: string, mode: FindMode = 'phrase') {
  view.dispatch(view.state.tr.setMeta(setQueryMeta, { query, mode } as FindState))
}

export function createFindHighlightPlugin() {
  return new Plugin<FindState>({
    key: findHighlightKey,
    state: {
      init: () => ({ query: '', mode: 'phrase' }),
      apply(tr, cur) {
        const meta = tr.getMeta(setQueryMeta) as FindState | undefined
        return meta !== undefined ? meta : cur
      },
    },
    props: {
      decorations(state) {
        const fs = this.getState(state)
        const query = fs?.query.trim()
        if (!query) return null
        const terms = fs!.mode === 'phrase'
          ? [query.toLowerCase()]
          : Array.from(new Set(query.toLowerCase().split(/\s+/).filter((t) => t.length >= 2)))
        if (terms.length === 0) return null
        const decorations: Decoration[] = []
        // Scan per TEXTBLOCK, not per individual text node — a query can
        // span multiple text runs split apart by marks (e.g. "1:1" where
        // "1:" is bold and "1" isn't), which per-text-node scanning would
        // miss entirely.
        state.doc.descendants((node, pos) => {
          if (!node.isTextblock) return true
          const text = node.textContent.toLowerCase()
          const base = pos + 1
          for (const term of terms) {
            let i = 0
            while ((i = text.indexOf(term, i)) !== -1) {
              decorations.push(Decoration.inline(base + i, base + i + term.length, { class: 'berean-find-mark' }))
              i += term.length
            }
          }
          return false
        })
        return DecorationSet.create(state.doc, decorations)
      },
    },
  })
}
