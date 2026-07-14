import { useState, useRef, useEffect } from 'react'
import type { EditorView } from 'prosemirror-view'
import {
  Bold, Italic, Underline, Strikethrough, Code, Highlighter, Link2,
  List, ListOrdered, CheckSquare, Quote, IndentIncrease, IndentDecrease, ChevronDown, Ban,
  Table2, Minus, BookOpen, Heading1, Heading2, Heading3,
} from 'lucide-react'
import { toggleMark } from 'prosemirror-commands'
import { bereanSchema as schema } from './schema'
import { createEditorCommands } from './editorCommands'
import { HIGHLIGHT_COLOR_IDS, HIGHLIGHT_LABELS, highlightDotColor } from '@/styles/highlightPalette'
import { useAppStore } from '@/store'

// Persistent, always-visible formatting toolbar docked above the note editor —
// complements (doesn't replace) SelectionToolbar.tsx's selection-triggered bubble menu.
// The bubble covers "I selected this text, format it"; this bar covers "I want to change
// formatting without first selecting text" (starting a new heading, inserting a table,
// toggling Focus mode). Shares all command logic with the bubble via editorCommands.ts —
// this file owns only its own dropdown-open UI state, same split as SelectionToolbar.tsx.
export default function Toolbar({ view }: { view: EditorView | null }) {
  const [openDropdown, setOpenDropdown] = useState<'none' | 'type' | 'list' | 'highlight'>('none')
  const rootRef = useRef<HTMLDivElement>(null)
  const focusMode = useAppStore((s) => s.noteFocusMode)
  const toggleFocusMode = useAppStore((s) => s.toggleNoteFocusMode)

  useEffect(() => {
    if (openDropdown === 'none') return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpenDropdown('none')
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
  function insertVerseStarter() {
    if (!useAppStore.getState().noteScriptureBlock) useAppStore.getState().setNoteScriptureBlock(true)
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
      className="relative flex items-center gap-0.5 px-2 py-1 border-b border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] flex-shrink-0 overflow-x-auto"
    >
      {/* Text type */}
      <button
        title="Text type"
        onMouseDown={() => setOpenDropdown((v) => (v === 'type' ? 'none' : 'type'))}
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
        onMouseDown={() => setOpenDropdown((v) => (v === 'highlight' ? 'none' : 'highlight'))}
        className={cls(openDropdown === 'highlight' || isMarkActive('highlight'))}
      >
        <Highlighter size={14} />
      </button>

      {sep}
      <button title="Link" onMouseDown={cmds.applyLink} className={cls(isMarkActive('link'))}><Link2 size={14} /></button>
      {sep}

      <button
        title="List type"
        onMouseDown={() => setOpenDropdown((v) => (v === 'list' ? 'none' : 'list'))}
        className={`${iconBtn} ${openDropdown === 'list' ? active : inactive}`}
      >
        <List size={14} />
      </button>
      <button title="Blockquote" onMouseDown={cmds.toggleBlockquote} className={cls(false)}><Quote size={14} /></button>
      <button title="Outdent (⇧Tab)" onMouseDown={cmds.outdent} className={cls(false)}><IndentDecrease size={14} /></button>
      <button title="Indent (Tab)" onMouseDown={cmds.indent} className={cls(false)}><IndentIncrease size={14} /></button>

      {sep}
      <button title="Table" onMouseDown={() => run((state, dispatch) => {
        if (!dispatch) return false
        const cell = () => schema.nodes.table_cell.create()
        const header = () => schema.nodes.table_header.create()
        const headerRow = schema.nodes.table_row.create(null, [header(), header()])
        const bodyRow = schema.nodes.table_row.create(null, [cell(), cell()])
        const table = schema.nodes.table.create(null, [headerRow, bodyRow])
        dispatch(state.tr.replaceSelectionWith(table))
        return true
      })} className={cls(false)}><Table2 size={14} /></button>
      <button title="Divider" onMouseDown={() => run((state, dispatch) => {
        if (!dispatch) return false
        dispatch(state.tr.replaceSelectionWith(schema.nodes.horizontal_rule.create()))
        return true
      })} className={cls(false)}><Minus size={14} /></button>
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

      {/* ── Dropdowns ── */}
      {openDropdown === 'type' && (
        <div className="absolute top-full left-0 mt-1 pm-toolbar-solid rounded-lg shadow-2xl p-1 flex items-center gap-0.5 z-10">
          {[
            { label: '¶', level: 0, Icon: null },
            { label: 'H1', level: 1, Icon: Heading1 },
            { label: 'H2', level: 2, Icon: Heading2 },
            { label: 'H3', level: 3, Icon: Heading3 },
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
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 pm-toolbar-solid rounded-lg shadow-2xl p-1 flex items-center gap-0.5 z-10">
          <button title="Bullet list" onMouseDown={() => { cmds.setBulletList('*'); setOpenDropdown('none') }} className={`${iconBtn} ${inactive}`}><List size={14} /></button>
          <button title="Dash list" onMouseDown={() => { cmds.setBulletList('-'); setOpenDropdown('none') }} className={`${iconBtn} ${inactive} text-sm font-mono`}>–</button>
          <button title="Numbered list" onMouseDown={() => { cmds.setOrderedList(); setOpenDropdown('none') }} className={`${iconBtn} ${inactive}`}><ListOrdered size={14} /></button>
          <button title="Task list" onMouseDown={toggleTaskList} className={`${iconBtn} ${inactive}`}><CheckSquare size={14} /></button>
        </div>
      )}

      {openDropdown === 'highlight' && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 pm-toolbar-solid rounded-lg shadow-2xl p-2 w-[168px] z-10">
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
    </div>
  )
}
