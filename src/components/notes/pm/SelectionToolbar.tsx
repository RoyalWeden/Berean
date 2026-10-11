import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { motion } from 'framer-motion'
import type { EditorView } from 'prosemirror-view'
import { toggleMark } from 'prosemirror-commands'
import { Bold, Italic, Underline, Highlighter, Link2, Link2Off } from 'lucide-react'
import { bereanSchema as schema } from './schema'
import { IconButton, ControlGroup, MenuSurface, ColorSwatchRow } from '@/components/ui'
import { POP_IN } from '@/lib/motion'
import { toggleSuppressCommand } from './suppressRanges'
import { HIGHLIGHT_COLOR_IDS, HIGHLIGHT_LABELS } from '@/styles/highlightPalette'
import type { SelectionToolbarState } from './selectionToolbarPlugin'
import { createEditorCommands } from './editorCommands'

/**
 * The compact bubble beside a text selection (TEST 2026-10-10). The formatting bar in the window
 * toolbar stays the one complete, persistent home for formatting; this bubble carries only what is
 * about THE SELECTED TEXT and worth reaching without travelling to the top of the window:
 * the three emphasis marks, Highlight (a colour, so a menu), Link — which opens the shared link
 * editor — and "Don't link references" for an auto-detected reference inside the selection.
 * Block-level controls (text style, lists, quote, indent, thread) were removed from it: they are
 * about the paragraph, not the words, and live in the toolbar and the block's own menu.
 *
 * Every button acts on mousedown with preventDefault (the root's onMouseDown) so the editor never
 * loses its selection or focus before the action runs.
 */
export default function SelectionToolbar({
  view, toolbarState, onOpenLink,
}: {
  view: EditorView
  toolbarState: SelectionToolbarState
  onOpenLink: (anchor: { left: number; top: number; bottom: number }) => void
}) {
  const [highlightOpen, setHighlightOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => { setHighlightOpen(false) }, [toolbarState])

  // Above the selection, centred on it; flipped below when there is no room above (a selection at
  // the top of the note, under the window toolbar) and clamped inside the window. Measured from the
  // real rendered element, before paint.
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const { left, top, right, bottom } = toolbarState.coords
    const rect = el.getBoundingClientRect()
    const margin = 8
    const topBarSafeMargin = 56 // keep clear of the window toolbar
    let x = (left + right) / 2 - rect.width / 2
    x = Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin))
    const above = top - 8 - rect.height
    const y = above < topBarSafeMargin ? bottom + 8 : above
    setPos({ left: x, top: y })
  }, [toolbarState])

  useEffect(() => {
    if (!highlightOpen) return
    const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setHighlightOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [highlightOpen])

  const cmds = createEditorCommands(view)
  const { isMarkActive, run } = cmds
  const linked = isMarkActive('link') || isMarkActive('wikilink')

  const style = pos
    ? { position: 'fixed' as const, left: pos.left, top: pos.top, zIndex: 'var(--z-popover)' as const }
    : { position: 'fixed' as const, left: -9999, top: -9999, zIndex: 'var(--z-popover)' as const }

  return (
    <motion.div
      ref={rootRef}
      style={style}
      onMouseDown={(e) => e.preventDefault()}
      {...POP_IN}
      // `pm-toolbar-solid` is the marker NoteEditorPM's outside-mousedown dismiss checks for.
      className="pm-toolbar-solid material-popover rounded-control relative flex items-center gap-1 px-1 py-1"
      role="toolbar"
      aria-label="Selection"
    >
      <ControlGroup>
        <IconButton icon={Bold} label="Bold" tooltip={{ shortcut: '⌘B', side: 'top' }} size={24} active={isMarkActive('strong')} onMouseDown={() => run(toggleMark(schema.marks.strong))} />
        <IconButton icon={Italic} label="Italic" tooltip={{ shortcut: '⌘I', side: 'top' }} size={24} active={isMarkActive('em')} onMouseDown={() => run(toggleMark(schema.marks.em))} />
        <IconButton icon={Underline} label="Underline" tooltip={{ shortcut: '⌘U', side: 'top' }} size={24} active={isMarkActive('underline')} onMouseDown={() => run(toggleMark(schema.marks.underline))} />
        <IconButton
          icon={Highlighter}
          label="Highlight"
          size={24}
          tooltip={{ shortcut: '⌘⇧H', side: 'top' }}
          active={highlightOpen || isMarkActive('highlight')}
          onMouseDown={() => setHighlightOpen((v) => !v)}
        />
      </ControlGroup>
      <ControlGroup>
        <IconButton
          icon={Link2}
          label={linked ? 'Edit Link…' : 'Link…'}
          size={24}
          tooltip={{ side: 'top' }}
          active={linked}
          onMouseDown={() => {
            const { left, top, bottom } = toolbarState.coords
            onOpenLink({ left, top, bottom })
          }}
        />
        <IconButton icon={Link2Off} label="Don’t Link References" size={24} tooltip={{ shortcut: '⌘⇧R', side: 'top' }} onMouseDown={() => run(toggleSuppressCommand)} />
      </ControlGroup>

      {highlightOpen && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5" style={{ zIndex: 'var(--z-menu)' }}>
          <MenuSurface className="p-2 w-[184px]">
            <ColorSwatchRow
              size={16}
              allowNone
              value={null}
              swatches={HIGHLIGHT_COLOR_IDS.map((id) => ({ id, rgb: `var(--highlight-${id})`, label: HIGHLIGHT_LABELS[id] }))}
              onChange={(id) => { if (id) cmds.applyHighlight(id); else cmds.removeHighlight(); setHighlightOpen(false) }}
            />
          </MenuSurface>
        </div>
      )}
    </motion.div>
  )
}
