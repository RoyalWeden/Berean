import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { EditorView } from 'prosemirror-view'
import { TextSelection } from 'prosemirror-state'
import { deleteTable } from 'prosemirror-tables'
import {
  Bold, Italic, Underline, Strikethrough, Code, Highlighter, Link2,
  List, ListOrdered, CheckSquare, Quote, IndentIncrease, IndentDecrease, ChevronDown, Ban,
  Table2, Minus, BookOpen, Heading1, Heading2, Heading3, Rows3, Columns3, Trash2,
} from 'lucide-react'
import { toggleMark } from 'prosemirror-commands'
import { bereanSchema as schema } from './schema'
import { createEditorCommands } from './editorCommands'
import { insertBlockNode, buildEmptyTable } from './slashCommands'
import { addRowAfter, deleteRow, deleteColumn } from './tablePlugins'
import { HIGHLIGHT_COLOR_IDS, HIGHLIGHT_LABELS, highlightDotColor } from '@/styles/highlightPalette'
import { useAppStore } from '@/store'

type DropdownKind = 'type' | 'list' | 'highlight' | 'table'

// Persistent, always-visible formatting toolbar docked above the note editor —
// complements (doesn't replace) SelectionToolbar.tsx's selection-triggered bubble menu.
// The bubble covers "I selected this text, format it"; this bar covers "I want to change
// formatting without first selecting text" (starting a new heading, inserting a table,
// toggling Focus mode). Shares all command logic with the bubble via editorCommands.ts —
// this file owns only its own dropdown-open UI state, same split as SelectionToolbar.tsx.
//
// Dropdowns are portaled to document.body with a fixed position computed from the trigger
// button's own rect, NOT position:absolute inside this row — the row itself needs
// overflow-x-auto so a narrow panel doesn't force its buttons off-screen, but CSS couples
// overflow-x:auto to overflow-y:auto/hidden on the same box, which silently clipped any
// absolutely-positioned dropdown child that extended below the row (the dropdowns rendered
// into the DOM but were invisible — looked exactly like "clicking the button does nothing").
export default function Toolbar({ view }: { view: EditorView | null }) {
  const [openDropdown, setOpenDropdown] = useState<DropdownKind | 'none'>('none')
  const [dropdownPos, setDropdownPos] = useState<{ left: number; top: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const focusMode = useAppStore((s) => s.noteFocusMode)
  const toggleFocusMode = useAppStore((s) => s.toggleNoteFocusMode)

  function openDropdownAt(kind: DropdownKind, e: React.MouseEvent<HTMLButtonElement>) {
    if (openDropdown === kind) { setOpenDropdown('none'); return }
    const rect = e.currentTarget.getBoundingClientRect()
    setDropdownPos({ left: rect.left, top: rect.bottom + 4 })
    setOpenDropdown(kind)
  }

  useEffect(() => {
    if (openDropdown === 'none') return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (rootRef.current?.contains(t)) return
      if (dropdownRef.current?.contains(t)) return
      setOpenDropdown('none')
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [openDropdown])

  if (!view) return null
  const editorView = view // narrowed local — TS doesn't carry the null-check narrowing of a
  // parameter into nested function declarations below (insertVerseStarter), so this local
  // const stands in for `view` wherever it's referenced from inside one of those.
  const cmds = createEditorCommands(editorView)
  const { isMarkActive, run } = cmds

  function applyHighlight(color: string) { cmds.applyHighlight(color); setOpenDropdown('none') }
  function removeHighlight() { cmds.removeHighlight(); setOpenDropdown('none') }
  function toggleTaskList() { cmds.toggleTaskList(); setOpenDropdown('none') }
  // Verse blocks are plain paragraph text auto-detected by blockDecorations.ts once it
  // matches a real verse in the DB (see slashCommands.ts's startVerseBlock for the full
  // reasoning) — this button can't insert a finished block itself without a full book/
  // chapter/verse picker UI, which doesn't exist yet. Turning on the setting alone was a
  // silent no-op when it was already on (the reported "doesn't seem to do anything" bug) —
  // insert visible placeholder text, selected, so replacing it by typing is obvious and
  // immediate, and the existing verse-suggest autocomplete takes over as soon as what's
  // typed matches a real reference.
  function insertVerseStarter() {
    if (!useAppStore.getState().noteScriptureBlock) useAppStore.getState().setNoteScriptureBlock(true)
    const placeholder = 'Book chapter:verse'
    const { from } = editorView.state.selection
    const tr = editorView.state.tr.insertText(placeholder, from)
    tr.setSelection(TextSelection.create(tr.doc, from, from + placeholder.length))
    editorView.dispatch(tr)
    editorView.focus()
  }

  const iconBtn = 'p-1.5 cursor-pointer transition-colors rounded-md flex-shrink-0'
  const active = 'bg-[rgb(var(--color-accent))/20] text-[rgb(var(--color-accent))]'
  const inactive = 'text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-3))] hover:text-[rgb(var(--color-text-primary))]'
  const cls = (isActive: boolean) => `${iconBtn} ${isActive ? active : inactive}`
  const sep = <div className="w-px h-5 bg-[rgb(var(--color-surface-4))] mx-0.5 flex-shrink-0" />

  return (
    <div
      ref={rootRef}
      className="flex items-center gap-0.5 px-2 py-1 border-b border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] flex-shrink-0 overflow-x-auto"
    >
      {/* Text type */}
      <button
        title="Text type"
        onMouseDown={(e) => openDropdownAt('type', e)}
        className={`${iconBtn} ${openDropdown === 'type' ? active : inactive} flex items-center gap-0.5 font-mono text-xs px-2`}
      >
        ¶ <ChevronDown size={10} />
      </button>
      {sep}

      <button title="Bold (⌘B)" onMouseDown={() => run(toggleMark(schema.marks.strong))} className={cls(isMarkActive('strong'))}><Bold size={14} /></button>
      <button title="Italic (⌘I)" onMouseDown={() => run(toggleMark(schema.marks.em))} className={cls(isMarkActive('em'))}><Italic size={14} /></button>
      <button title="Underline (⌘U)" onMouseDown={() => run(toggleMark(schema.marks.underline))} className={cls(isMarkActive('underline'))}><Underline size={14} /></button>
      <button title="Strikethrough" onMouseDown={() => run(toggleMark(schema.marks.strike))} className={cls(isMarkActive('strike'))}><Strikethrough size={14} /></button>
      <button title="Code (⌘`)" onMouseDown={() => run(toggleMark(schema.marks.code))} className={cls(isMarkActive('code'))}><Code size={14} /></button>

      <button
        title="Highlight"
        onMouseDown={(e) => openDropdownAt('highlight', e)}
        className={cls(openDropdown === 'highlight' || isMarkActive('highlight'))}
      >
        <Highlighter size={14} />
      </button>

      {sep}
      <button title="Link" onMouseDown={cmds.applyLink} className={cls(isMarkActive('link'))}><Link2 size={14} /></button>
      {sep}

      <button
        title="List type"
        onMouseDown={(e) => openDropdownAt('list', e)}
        className={`${iconBtn} ${openDropdown === 'list' ? active : inactive}`}
      >
        <List size={14} />
      </button>
      <button title="Blockquote" onMouseDown={cmds.toggleBlockquote} className={cls(false)}><Quote size={14} /></button>
      <button title="Outdent (⇧Tab)" onMouseDown={cmds.outdent} className={cls(false)}><IndentDecrease size={14} /></button>
      <button title="Indent (Tab)" onMouseDown={cmds.indent} className={cls(false)}><IndentIncrease size={14} /></button>

      {sep}
      {/* Insert table: reuses insertBlockNode (slashCommands.ts) rather than the raw
          `replaceSelectionWith` this used before — replaceSelectionWith doesn't split the
          enclosing paragraph the way a block-level table needs, so inserting mid-paragraph
          silently produced a malformed/uneditable result. insertBlockNode already handles
          this correctly (same helper the working /table slash command uses). */}
      <button
        title="Table"
        onMouseDown={() => {
          const { from, to } = editorView.state.selection
          insertBlockNode(editorView, from, to, buildEmptyTable())
        }}
        className={cls(false)}
      ><Table2 size={14} /></button>
      {/* Table row/column management — only meaningful with the cursor inside an existing
          table; addRowAfter/deleteRow/deleteColumn/deleteTable are all real no-ops (return
          false, dispatch nothing) outside one, so this dropdown is always safe to show. */}
      <button
        title="Table row/column"
        onMouseDown={(e) => openDropdownAt('table', e)}
        className={`${iconBtn} ${openDropdown === 'table' ? active : inactive}`}
      >
        <Rows3 size={14} />
      </button>
      <button
        title="Divider"
        onMouseDown={() => {
          const { from, to } = editorView.state.selection
          insertBlockNode(editorView, from, to, schema.nodes.horizontal_rule.create())
        }}
        className={cls(false)}
      ><Minus size={14} /></button>
      {/* Verse blocks are plain paragraph text auto-detected by blockDecorations.ts, not a
          node this toolbar inserts directly (see slashCommands.ts's startVerseBlock — same
          reasoning) — this button just makes sure the detection setting is on and focuses
          the editor so the user can type a reference. */}
      <button title="Scripture verse — type a reference (e.g. Romans 14:3)" onMouseDown={insertVerseStarter} className={cls(false)}><BookOpen size={14} /></button>

      {sep}
      <button
        title={focusMode ? 'Exit Focus mode' : 'Focus mode — hide sidebar and chrome while writing'}
        onMouseDown={() => toggleFocusMode()}
        className={`${cls(focusMode)} text-[10px] font-medium px-2`}
      >
        Focus
      </button>

      {/* ── Dropdowns — portaled, see the file-level comment above for why ── */}
      {openDropdown !== 'none' && dropdownPos && createPortal(
        <div
          ref={dropdownRef}
          style={{ position: 'fixed', left: dropdownPos.left, top: dropdownPos.top, zIndex: 9999, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {openDropdown === 'type' && (
            <div className="pm-toolbar-solid rounded-lg shadow-2xl p-1 flex items-center gap-0.5">
              {[
                { label: '¶', level: 0 }, { label: 'H1', level: 1 }, { label: 'H2', level: 2 }, { label: 'H3', level: 3 }, { label: 'H4', level: 4 }, { label: 'H5', level: 5 }, { label: 'H6', level: 6 },
              ].map(({ label, level }) => (
                <button
                  key={label}
                  onMouseDown={() => { cmds.setHeading(level); setOpenDropdown('none') }}
                  className={`${iconBtn} ${inactive} text-xs font-mono px-2.5 py-1`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {openDropdown === 'list' && (
            <div className="pm-toolbar-solid rounded-lg shadow-2xl p-1 flex items-center gap-0.5">
              <button title="Bullet list" onMouseDown={() => { cmds.setBulletList('*'); setOpenDropdown('none') }} className={`${iconBtn} ${inactive}`}><List size={14} /></button>
              <button title="Dash list" onMouseDown={() => { cmds.setBulletList('-'); setOpenDropdown('none') }} className={`${iconBtn} ${inactive} text-sm font-mono`}>–</button>
              <button title="Numbered list" onMouseDown={() => { cmds.setOrderedList(); setOpenDropdown('none') }} className={`${iconBtn} ${inactive}`}><ListOrdered size={14} /></button>
              <button title="Task list" onMouseDown={toggleTaskList} className={`${iconBtn} ${inactive}`}><CheckSquare size={14} /></button>
            </div>
          )}

          {openDropdown === 'highlight' && (
            <div className="pm-toolbar-solid rounded-lg shadow-2xl p-2 w-[168px]">
              <div className="grid grid-cols-5 gap-1.5 mb-1.5">
                {HIGHLIGHT_COLOR_IDS.map((id) => (
                  <button
                    key={id}
                    title={HIGHLIGHT_LABELS[id]}
                    onMouseDown={() => applyHighlight(id)}
                    className="w-6 h-6 rounded-full cursor-pointer hover:scale-110 transition-transform border border-white/20 flex-shrink-0"
                    style={{ backgroundColor: highlightDotColor(id) }}
                  />
                ))}
              </div>
              <button
                onMouseDown={removeHighlight}
                className="w-full flex items-center justify-center gap-1.5 text-[11px] py-1 rounded-md cursor-pointer text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-3))] hover:text-[rgb(var(--color-text-primary))] transition-colors"
              >
                <Ban size={11} /> Remove highlight
              </button>
            </div>
          )}

          {openDropdown === 'table' && (
            <div className="pm-toolbar-solid rounded-lg shadow-2xl p-1 flex flex-col gap-0.5 min-w-[160px]">
              <button
                onMouseDown={() => { run(addRowAfter); setOpenDropdown('none') }}
                className={`${iconBtn} ${inactive} flex items-center gap-2 text-xs px-2 py-1.5 justify-start`}
              >
                <Rows3 size={13} /> Add row below
              </button>
              <button
                onMouseDown={() => { run(deleteRow); setOpenDropdown('none') }}
                className={`${iconBtn} ${inactive} flex items-center gap-2 text-xs px-2 py-1.5 justify-start`}
              >
                <Rows3 size={13} /> Delete row
              </button>
              <button
                onMouseDown={() => { run(deleteColumn); setOpenDropdown('none') }}
                className={`${iconBtn} ${inactive} flex items-center gap-2 text-xs px-2 py-1.5 justify-start`}
              >
                <Columns3 size={13} /> Delete column
              </button>
              <div className="h-px bg-[rgb(var(--color-surface-4))] my-0.5" />
              <button
                onMouseDown={() => { run(deleteTable); setOpenDropdown('none') }}
                className={`${iconBtn} text-red-400 hover:bg-red-500/15 flex items-center gap-2 text-xs px-2 py-1.5 justify-start`}
              >
                <Trash2 size={13} /> Delete table
              </button>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}
