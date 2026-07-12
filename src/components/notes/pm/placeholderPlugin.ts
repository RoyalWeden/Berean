import { Plugin } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

// Tags the sole empty first paragraph with `is-empty` so pmEditor.css's
// `::before` rule can show the placeholder text (a standard PM idiom, since
// there's no built-in placeholder prop).
export function createPlaceholderPlugin() {
  return new Plugin({
    props: {
      decorations(state) {
        const { doc } = state
        if (doc.childCount !== 1) return null
        const only = doc.firstChild
        if (!only || only.type.name !== 'paragraph' || only.content.size > 0) return null
        return DecorationSet.create(doc, [Decoration.node(0, only.nodeSize, { class: 'is-empty' })])
      },
    },
  })
}
