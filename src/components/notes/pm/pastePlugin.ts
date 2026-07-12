import { Plugin } from 'prosemirror-state'
import { bereanSchema as schema } from './schema'

// Port of NoteEditor.tsx's pasteHandler: image clipboard data becomes an
// inline `![](data:...)` image, a bare pasted URL becomes a markdown link
// (wrapping the current selection as link text, or the URL itself if no
// selection). Verse-block formatting is deliberately NOT triggered by paste
// here either — same rationale as the CM6 version: pasted text must stay
// plain so copy/paste round-trips losslessly (verse-block styling is a pure
// live-decoration concern, added in Phase 5).
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
              const reader = new FileReader()
              reader.onload = () => {
                const dataUrl = reader.result as string
                const { from } = view.state.selection
                const node = schema.nodes.image.create({ src: dataUrl })
                view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView())
              }
              reader.readAsDataURL(file)
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
    },
  },
})
