import { toggleMark, setBlockType, wrapIn, lift } from 'prosemirror-commands'
import { wrapInList, liftListItem, sinkListItem } from 'prosemirror-schema-list'
import type { EditorView } from 'prosemirror-view'
import { bereanSchema as schema } from './schema'

// Shared ProseMirror command logic, extracted from SelectionToolbar.tsx so both the
// selection-triggered bubble menu and the new persistent toolbar (Toolbar.tsx) call the
// exact same functions instead of maintaining two copies. Callers own their own dropdown
// open/close UI state — none of these functions touch it (SelectionToolbar.tsx and
// Toolbar.tsx each close their own dropdown after calling one of these).
export function createEditorCommands(view: EditorView) {
  function isMarkActive(markName: string): boolean {
    const type = schema.marks[markName]
    const { from, to, empty } = view.state.selection
    if (empty) return !!type.isInSet(view.state.storedMarks ?? view.state.selection.$from.marks())
    return view.state.doc.rangeHasMark(from, to, type)
  }

  function run(command: (state: typeof view.state, dispatch: typeof view.dispatch) => boolean) {
    command(view.state, view.dispatch)
    view.focus()
  }

  function applyHighlight(color: string) {
    const { from, to } = view.state.selection
    view.dispatch(view.state.tr.addMark(from, to, schema.marks.highlight.create({ color })))
    view.focus()
  }

  // Distinct from applyHighlight: this REMOVES the mark entirely rather than adding a
  // colorless one — addMark with `color: null` is STILL a highlight (plain `==text==`
  // styling), so this is the only way to actually clear one once applied.
  function removeHighlight() {
    const { from, to } = view.state.selection
    view.dispatch(view.state.tr.removeMark(from, to, schema.marks.highlight))
    view.focus()
  }

  // Electron's renderer doesn't support window.prompt() (throws "prompt() is and
  // will not be supported"), so the URL can't be collected here — callers own a
  // small popover/input UI instead and pass the already-collected url in.
  function applyLink(url: string) {
    if (!url) return
    const { from, to } = view.state.selection
    view.dispatch(view.state.tr.addMark(from, to, schema.marks.link.create({ href: url })))
    view.focus()
  }

  // Reads the href of an existing link mark at the current selection/cursor, so a
  // link-URL popover can be pre-filled when editing a link rather than always
  // starting blank.
  function currentLinkHref(): string {
    const { from, to, empty } = view.state.selection
    const marks = empty
      ? (view.state.storedMarks ?? view.state.selection.$from.marks())
      : null
    if (marks) {
      const mark = schema.marks.link.isInSet(marks)
      return mark?.attrs.href ?? ''
    }
    let href = ''
    view.state.doc.nodesBetween(from, to, (node) => {
      const mark = schema.marks.link.isInSet(node.marks)
      if (mark) href = mark.attrs.href
    })
    return href
  }

  function toggleTaskList() {
    const cmd = wrapInList(schema.nodes.bullet_list)
    cmd(view.state, (tr) => {
      view.dispatch(tr)
      const { from, to } = view.state.selection
      const stampTr = view.state.tr
      view.state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name === 'list_item' && node.attrs.checked === null) stampTr.setNodeAttribute(pos, 'checked', false)
      })
      if (stampTr.docChanged) view.dispatch(stampTr)
    })
    view.focus()
  }

  function setHeading(level: number) {
    if (level === 0) run(setBlockType(schema.nodes.paragraph))
    else run(setBlockType(schema.nodes.heading, { level }))
  }

  // Toggle, not one-way set: a second click on the toolbar's code-block button returns
  // the block to a plain paragraph, matching how the blockquote button below behaves.
  // (The /code slash command stays one-way — it converts whatever you typed the command
  // in, so there's never an existing code block to toggle back out of.)
  function toggleCodeBlock() {
    run((state, dispatch) => {
      const inCodeBlock = state.selection.$from.parent.type === schema.nodes.code_block
      return setBlockType(inCodeBlock ? schema.nodes.paragraph : schema.nodes.code_block)(state, dispatch)
    })
  }

  function toggleBlockquote() {
    run((state, dispatch) => lift(state, dispatch) || wrapIn(schema.nodes.blockquote)(state, dispatch))
  }

  function outdent() {
    run(liftListItem(schema.nodes.list_item))
  }

  // Outside a list, sinkListItem alone silently does nothing (same as the keymap's Tab
  // handling, see keymap.ts) — falls back to inserting spaces so the button always
  // visibly does SOMETHING.
  function indent() {
    run((state, dispatch) => sinkListItem(schema.nodes.list_item)(state, dispatch) || (() => { if (dispatch) dispatch(state.tr.insertText('    ')); return true })())
  }

  function setBulletList(marker: '*' | '-') {
    run(wrapInList(schema.nodes.bullet_list, { marker }))
  }

  function setOrderedList() {
    run(wrapInList(schema.nodes.ordered_list))
  }

  return {
    isMarkActive, run, applyHighlight, removeHighlight, applyLink, currentLinkHref, toggleTaskList,
    setHeading, toggleBlockquote, toggleCodeBlock, outdent, indent, setBulletList, setOrderedList,
  }
}
