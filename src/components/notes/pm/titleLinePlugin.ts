import { Plugin, PluginKey, type EditorState } from 'prosemirror-state'

/**
 * Whether the selection sits entirely on the document's title line — a leading level-1 heading,
 * which IS the note's title when the note has no separate in-page title (the built-in guide notes'
 * `# Keyboard Shortcuts`). The formatting bar disables itself there (TEST 2026-10-08: formatting
 * a title makes no sense), the same as while the separate title field has focus.
 */
export function selectionInTitleLine(state: EditorState): boolean {
  const first = state.doc.firstChild
  if (!first || first.type.name !== 'heading' || first.attrs.level !== 1) return false
  const { $from, $to } = state.selection
  return $from.index(0) === 0 && $to.index(0) === 0
}

const titleLineKey = new PluginKey('titleLine')

/** Reports selectionInTitleLine changes (only on change — no re-render per keystroke). */
export function createTitleLinePlugin(onChange: (inTitleLine: boolean) => void) {
  let last: boolean | null = null
  const report = (state: EditorState) => {
    const v = selectionInTitleLine(state)
    if (v === last) return
    last = v
    onChange(v)
  }
  return new Plugin({
    key: titleLineKey,
    view(view) {
      report(view.state)
      return {
        update(v, prevState) {
          if (v.state.doc.eq(prevState.doc) && v.state.selection.eq(prevState.selection)) return
          report(v.state)
        },
      }
    },
  })
}
