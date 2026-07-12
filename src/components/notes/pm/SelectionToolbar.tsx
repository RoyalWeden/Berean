import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import type { EditorView } from 'prosemirror-view'
import { toggleMark, setBlockType, wrapIn, lift } from 'prosemirror-commands'
import { wrapInList, liftListItem, sinkListItem } from 'prosemirror-schema-list'
import {
  Bold, Italic, Underline, Strikethrough, Code, Highlighter, Link2, Link2Off,
  List, ListOrdered, CheckSquare, Quote, IndentIncrease, IndentDecrease, ChevronDown, Ban,
} from 'lucide-react'
import { bereanSchema as schema } from './schema'
import { toggleSuppressCommand } from './suppressRanges'
import { HIGHLIGHT_COLOR_IDS, HIGHLIGHT_LABELS, highlightDotColor } from '@/styles/highlightPalette'
import type { SelectionToolbarState } from './selectionToolbarPlugin'

// The floating "select text to format" toolbar — a from-scratch ProseMirror
// equivalent of NoteEditor.tsx's selToolbar (NoteEditor.tsx:4081-4300+).
// Redesigned around small anchored dropdown popovers (text type, highlight,
// list type) that layer OVER the toolbar without replacing its row — the
// original CM6 version's submenus swapped out the entire button row, which
// feels jarring/modal rather than fluid. Uses `.pm-toolbar-solid`
// (pmEditor.css) rather than the app's `.glass-panel` frosted-chrome
// treatment — an earlier version used `.glass-panel` (72% opacity + blur)
// with a Tailwind arbitrary-value `!bg-[...]/95` override attempting to
// make it more opaque, but that combination (important-modifier +
// arbitrary color + opacity fraction) didn't reliably generate/win against
// glass-panel's own background, leaving the toolbar and its dropdowns
// nearly transparent — the opposite of the intended fix.
// `.pm-toolbar-solid` is a plain, guaranteed-to-apply CSS rule instead.
export default function SelectionToolbar({
  view, toolbarState,
}: { view: EditorView; toolbarState: SelectionToolbarState }) {
  const [openDropdown, setOpenDropdown] = useState<'none' | 'type' | 'list' | 'highlight'>('none')
  const rootRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; flipped: boolean } | null>(null)

  // Close any open dropdown when the selection moves to a new spot.
  useEffect(() => { setOpenDropdown('none') }, [toolbarState])

  // Clamp the toolbar within the viewport instead of letting it render
  // off-screen or under other app chrome (the TopBar, the sidebar) — a real
  // bug: a selection near the top of the note (a very common place to
  // select text) put the toolbar's `top - 8, translateY(-100%)` position
  // ABOVE the visible window entirely, or with its left edge under the
  // sidebar, making its buttons genuinely unclickable despite rendering
  // "on top" by z-index (there's simply nothing there to click — the
  // toolbar was off-screen or behind chrome with a higher effective
  // stacking/coverage). Flips to render BELOW the selection when there
  // isn't enough room above, and clamps left/right to stay fully on
  // screen. Measured via the actual rendered element (post-layout), not a
  // guessed height, so this stays correct if the toolbar's content/size
  // changes (e.g. a dropdown open).
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const { left, top, right } = toolbarState.coords
    const centerX = (left + right) / 2
    const rect = el.getBoundingClientRect()
    const margin = 8
    const topBarSafeMargin = 44 // keep clear of the app's TopBar

    let clampedLeft = centerX - rect.width / 2
    clampedLeft = Math.max(margin, Math.min(clampedLeft, window.innerWidth - rect.width - margin))

    const wouldBeTop = top - 8 - rect.height
    const flipped = wouldBeTop < topBarSafeMargin
    const clampedTop = flipped ? top + 22 : wouldBeTop

    setPos({ left: clampedLeft, top: clampedTop, flipped })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolbarState, openDropdown])

  // Dismiss on outside click.
  useEffect(() => {
    if (openDropdown === 'none') return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpenDropdown('none')
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [openDropdown])


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
    setOpenDropdown('none')
  }

  // Distinct from applyHighlight: this REMOVES the mark entirely rather
  // than adding a colorless one. Previously the "no highlight" option
  // called addMark with `color: null`, which is STILL a highlight (plain
  // `==text==` styling) — there was no actual way to clear a highlight
  // once applied.
  function removeHighlight() {
    const { from, to } = view.state.selection
    view.dispatch(view.state.tr.removeMark(from, to, schema.marks.highlight))
    view.focus()
    setOpenDropdown('none')
  }

  function applyLink() {
    const url = window.prompt('Link URL:')
    if (!url) return
    const { from, to } = view.state.selection
    view.dispatch(view.state.tr.addMark(from, to, schema.marks.link.create({ href: url })))
    view.focus()
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
    setOpenDropdown('none')
  }

  const iconBtn = 'p-1.5 cursor-pointer transition-colors rounded-md flex-shrink-0'
  // Bumped well past the original 18% — too transparent to read clearly
  // against the toolbar's own already-translucent glass-panel background.
  const active = 'bg-[rgb(var(--color-accent))/35] text-[rgb(var(--color-accent))]'
  const inactive = 'text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-3))] hover:text-[rgb(var(--color-text-primary))]'
  const cls = (isActive: boolean) => `${iconBtn} ${isActive ? active : inactive}`
  const sep = <div className="w-px h-5 bg-[rgb(var(--color-surface-4))] mx-0.5 flex-shrink-0" />

  // Before the first layout measurement, render off-screen (never at a
  // guessed on-screen spot) so there's no visible flash-then-jump — the
  // useLayoutEffect above corrects this synchronously before paint.
  const style = pos
    ? { position: 'fixed' as const, left: pos.left, top: pos.top, zIndex: 60 }
    : { position: 'fixed' as const, left: -9999, top: -9999, zIndex: 60 }

  return (
    <div ref={rootRef} style={style} onMouseDown={(e) => e.preventDefault()}>
      <div className="pm-toolbar-solid relative flex items-center gap-0.5 rounded-xl px-1 py-1 shadow-2xl">
        {/* Text type */}
        <button
          title="Text type"
          onMouseDown={() => setOpenDropdown((v) => (v === 'type' ? 'none' : 'type'))}
          className={`${iconBtn} ${openDropdown === 'type' ? active : inactive} flex items-center gap-0.5 font-mono text-xs px-2`}
        >
          ¶ <ChevronDown size={10} />
        </button>
        {sep}

        {/* Inline marks */}
        <button title="Bold (⌘B)" onMouseDown={() => run(toggleMark(schema.marks.strong))} className={cls(isMarkActive('strong'))}><Bold size={14} /></button>
        <button title="Italic (⌘I)" onMouseDown={() => run(toggleMark(schema.marks.em))} className={cls(isMarkActive('em'))}><Italic size={14} /></button>
        <button title="Underline (⌘U)" onMouseDown={() => run(toggleMark(schema.marks.underline))} className={cls(isMarkActive('underline'))}><Underline size={14} /></button>
        <button title="Strikethrough" onMouseDown={() => run(toggleMark(schema.marks.strike))} className={cls(isMarkActive('strike'))}><Strikethrough size={14} /></button>
        <button title="Code (⌘`)" onMouseDown={() => run(toggleMark(schema.marks.code))} className={cls(isMarkActive('code'))}><Code size={14} /></button>

        {/* Highlight */}
        <button
          title="Highlight"
          onMouseDown={() => setOpenDropdown((v) => (v === 'highlight' ? 'none' : 'highlight'))}
          className={cls(openDropdown === 'highlight' || isMarkActive('highlight'))}
        >
          <Highlighter size={14} />
        </button>

        {sep}
        <button title="Link" onMouseDown={applyLink} className={cls(isMarkActive('link'))}><Link2 size={14} /></button>
        {sep}

        {/* Lists */}
        <button
          title="List type"
          onMouseDown={() => setOpenDropdown((v) => (v === 'list' ? 'none' : 'list'))}
          className={`${iconBtn} ${openDropdown === 'list' ? active : inactive}`}
        >
          <List size={14} />
        </button>
        <button
          title="Blockquote"
          onMouseDown={() => run((state, dispatch) => lift(state, dispatch) || wrapIn(schema.nodes.blockquote)(state, dispatch))}
          className={cls(false)}
        >
          <Quote size={14} />
        </button>
        <button title="Outdent (⇧Tab)" onMouseDown={() => run(liftListItem(schema.nodes.list_item))} className={cls(false)}><IndentDecrease size={14} /></button>
        {/* Outside a list, sinkListItem alone silently does nothing (same
            as the keymap's Tab handling, see keymap.ts) — falls back to
            inserting spaces so the button always visibly does SOMETHING. */}
        <button
          title="Indent (Tab)"
          onMouseDown={() => run((state, dispatch) => sinkListItem(schema.nodes.list_item)(state, dispatch) || (() => { if (dispatch) dispatch(state.tr.insertText('    ')); return true })())}
          className={cls(false)}
        >
          <IndentIncrease size={14} />
        </button>

        {sep}
        <button title="Suppress auto-detected refs (⌘⇧R)" onMouseDown={() => run(toggleSuppressCommand)} className={cls(false)}><Link2Off size={14} /></button>

        {/* ── Dropdowns: anchored popovers, layered over the toolbar rather
             than replacing its row — this is the "fluid" part: the main
             toolbar stays intact and visible while a focused set of options
             appears just below whichever button was clicked. ── */}
        {openDropdown === 'type' && (
          <div className="absolute top-full left-0 mt-1.5 pm-toolbar-solid rounded-lg shadow-2xl p-1 flex items-center gap-0.5">
            {[
              { label: '¶', level: 0 }, { label: 'H1', level: 1 }, { label: 'H2', level: 2 },
              { label: 'H3', level: 3 }, { label: 'H4', level: 4 }, { label: 'H5', level: 5 }, { label: 'H6', level: 6 },
            ].map(({ label, level }) => (
              <button
                key={label}
                onMouseDown={() => {
                  if (level === 0) run(setBlockType(schema.nodes.paragraph))
                  else run(setBlockType(schema.nodes.heading, { level }))
                  setOpenDropdown('none')
                }}
                className={`${iconBtn} ${inactive} text-xs font-mono px-2.5 py-1`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {openDropdown === 'list' && (
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 pm-toolbar-solid rounded-lg shadow-2xl p-1 flex items-center gap-0.5">
            <button title="Bullet list" onMouseDown={() => { run(wrapInList(schema.nodes.bullet_list, { marker: '*' })); setOpenDropdown('none') }} className={`${iconBtn} ${inactive}`}><List size={14} /></button>
            <button title="Dash list" onMouseDown={() => { run(wrapInList(schema.nodes.bullet_list, { marker: '-' })); setOpenDropdown('none') }} className={`${iconBtn} ${inactive} text-sm font-mono`}>–</button>
            <button title="Numbered list" onMouseDown={() => { run(wrapInList(schema.nodes.ordered_list)); setOpenDropdown('none') }} className={`${iconBtn} ${inactive}`}><ListOrdered size={14} /></button>
            <button title="Task list" onMouseDown={toggleTaskList} className={`${iconBtn} ${inactive}`}><CheckSquare size={14} /></button>
          </div>
        )}

        {openDropdown === 'highlight' && (
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 pm-toolbar-solid rounded-lg shadow-2xl p-2 w-[168px]">
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
    </div>
  )
}
