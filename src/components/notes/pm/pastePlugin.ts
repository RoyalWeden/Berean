import { Plugin } from 'prosemirror-state'
import { Slice, Fragment } from 'prosemirror-model'
import { bereanSchema as schema } from './schema'
import { insertImageFile } from './imageInsert'

// A copied blockquote / callout / list crosses the clipboard as an OPEN slice —
// openStart/openEnd = 2, because the selection was cut through both the wrapper
// and its inner paragraph on each side. ProseMirror then UNWRAPS it on paste:
// the inner paragraphs land as plain paragraphs and the quote / callout / list
// formatting is lost ("I copied a block that had a quote format and the quote
// format didn't work"). When the whole slice is exactly one such wrapper,
// re-close it (openStart/openEnd = 0) so it pastes as the block it was copied
// as. Mixed selections (text + a blockquote, two blockquotes, …) are left alone
// — childCount > 1 — and keep ProseMirror's default behaviour. Used as
// NoteEditorPM's `transformPasted`.
const RECLOSABLE_WRAPPERS = new Set(['blockquote', 'callout', 'bullet_list', 'ordered_list'])
export function reclosePastedWrapperBlock(slice: Slice): Slice {
  const only = slice.content.childCount === 1 ? slice.content.firstChild : null
  if (only && RECLOSABLE_WRAPPERS.has(only.type.name) && (slice.openStart > 0 || slice.openEnd > 0)) {
    return new Slice(Fragment.from(only), 0, 0)
  }
  return slice
}

// Port of NoteEditor.tsx's pasteHandler: image clipboard data becomes an
// inline `![](data:...)` image, a bare pasted URL becomes a markdown link
// (wrapping the current selection as link text, or the URL itself if no
// selection). Verse-block formatting is deliberately NOT triggered by paste
// here either — same rationale as the CM6 version: pasted text must stay
// plain so copy/paste round-trips losslessly (verse-block styling is a pure
// live-decoration concern, added in Phase 5).
//
// Also handles dropping an image FILE from Finder — same `insertImageFile` path as paste
// (imageInsert.ts), just triggered by `drop` instead of `paste`. Previously there was no drop
// handling for external files at all (only ProseMirror's own in-doc block-reorder drag, see
// blockHandles.ts), so dragging a screenshot in from Finder silently did nothing.
export const bereanPastePlugin = new Plugin({
  props: {
    handleDOMEvents: {
      paste(view, event) {
        const items = event.clipboardData?.items
        if (items) {
          for (const item of Array.from(items)) {
            if (item.type.startsWith('image/')) {
              event.preventDefault()
              const file = item.getAsFile()
              if (!file) return false
              insertImageFile(view, file)
              return true
            }
          }
        }

        const text = event.clipboardData?.getData('text/plain')
        if (text && /^https?:\/\/\S+$/.test(text.trim())) {
          event.preventDefault()
          const url = text.trim()
          const { from, to, empty } = view.state.selection
          const linkMark = schema.marks.link.create({ href: url })
          if (!empty) {
            const selectedText = view.state.doc.textBetween(from, to)
            const node = schema.text(selectedText, [linkMark])
            view.dispatch(view.state.tr.replaceSelectionWith(node, false).scrollIntoView())
          } else {
            const node = schema.text(url, [linkMark])
            view.dispatch(view.state.tr.insert(from, node).scrollIntoView())
          }
          return true
        }
        return false
      },
      drop(view, event) {
        const files = event.dataTransfer?.files
        if (!files || files.length === 0) return false
        const imageFile = Array.from(files).find((f) => f.type.startsWith('image/'))
        if (!imageFile) return false // let ProseMirror's own in-doc drag handling (block reorder) run
        event.preventDefault()
        const coords = { left: event.clientX, top: event.clientY }
        const dropPos = view.posAtCoords(coords)?.pos
        insertImageFile(view, imageFile, dropPos)
        return true
      },
    },
  },
})
