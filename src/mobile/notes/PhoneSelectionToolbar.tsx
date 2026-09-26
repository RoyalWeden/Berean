import React, { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { EditorView } from 'prosemirror-view'
import { toggleMark } from 'prosemirror-commands'
import { Bold, Italic, Underline, Strikethrough, Highlighter, Link2, Code, X } from 'lucide-react'
import { bereanSchema as schema } from '@/components/notes/pm/schema'
import { createEditorCommands } from '@/components/notes/pm/editorCommands'
import type { SelectionToolbarState } from '@/components/notes/pm/selectionToolbarPlugin'
import { HIGHLIGHT_LABELS, highlightDotColor } from '@/styles/highlightPalette'
import type { HighlightColor } from '@/types'
import './noteEditor.css'

/** The bubble fits one phone-width row: the six most distinct pigments (the full palette stays on desktop). */
const PHONE_HIGHLIGHTS: HighlightColor[] = ['yellow', 'green', 'blue', 'pink', 'purple', 'orange']

/**
 * The phone's selection formatting bubble (TEST25-NOTES-003), passed to NoteEditorPM as
 * `renderSelectionToolbar`: bold, italic, underline, strikethrough, highlight, link, inline code
 * as 44 pt glass buttons, sitting BELOW the selection (the iOS edit callout sits above it) and
 * flipping above only when there is no room over the keyboard. Commands are the desktop bubble's
 * (editorCommands.ts). `pm-toolbar-solid` keeps NoteEditorPM's outside-tap dismiss from closing it.
 */
export function PhoneSelectionToolbar({ view, state }: { view: EditorView; state: SelectionToolbarState }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [pane, setPane] = useState<'marks' | 'highlight' | 'link'>('marks')
  const [url, setUrl] = useState('')
  const linkRange = useRef<{ from: number; to: number } | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const cmds = createEditorCommands(view)

  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const { left, right, top } = state.coords
    const bottom = state.coords.bottom ?? top + 20
    const rect = el.getBoundingClientRect()
    const margin = 8
    const vh = window.visualViewport?.height ?? window.innerHeight
    let x = (left + right) / 2 - rect.width / 2
    x = Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin))
    // Below the selection, past the iOS selection-handle knob; above when it would hit the keyboard.
    let y = bottom + 14
    if (y + rect.height > vh - margin) y = Math.max(margin, top - rect.height - 14)
    setPos({ left: x, top: y })
  }, [state, pane])

  const mark = (name: 'strong' | 'em' | 'underline' | 'strike' | 'code') => () => cmds.run(toggleMark(schema.marks[name]))
  const keep = (e: React.MouseEvent) => e.preventDefault()
  const btn = (label: string, Icon: typeof Bold, onPress: () => void, active = false) => (
    <button key={label} type="button" className={`m-selbar-btn${active ? ' is-on' : ''}`} aria-label={label} aria-pressed={active} onMouseDown={keep} onClick={onPress}>
      <Icon size={20} aria-hidden />
    </button>
  )

  return createPortal(
    <div
      ref={rootRef}
      className="pm-toolbar-solid m-selbar"
      role="toolbar"
      aria-label="Format"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
      onMouseDown={(e) => { if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault() }}
    >
      {pane === 'marks' && <>
        {btn('Bold', Bold, mark('strong'), cmds.isMarkActive('strong'))}
        {btn('Italic', Italic, mark('em'), cmds.isMarkActive('em'))}
        {btn('Underline', Underline, mark('underline'), cmds.isMarkActive('underline'))}
        {btn('Strikethrough', Strikethrough, mark('strike'), cmds.isMarkActive('strike'))}
        {btn('Highlight', Highlighter, () => setPane('highlight'), cmds.isMarkActive('highlight'))}
        {btn('Link', Link2, () => { const { from, to } = view.state.selection; linkRange.current = { from, to }; setUrl(cmds.currentLinkHref()); setPane('link') }, cmds.isMarkActive('link'))}
        {btn('Inline code', Code, mark('code'), cmds.isMarkActive('code'))}
      </>}
      {pane === 'highlight' && <>
        {PHONE_HIGHLIGHTS.map((id) => (
          <button key={id} type="button" className="m-selbar-swatch" aria-label={`Highlight ${HIGHLIGHT_LABELS[id]}`} onMouseDown={keep}
            onClick={() => { cmds.applyHighlight(id); setPane('marks') }}>
            <span style={{ background: highlightDotColor(id) }} />
          </button>
        ))}
        {btn('Remove highlight', X, () => { cmds.removeHighlight(); setPane('marks') })}
      </>}
      {pane === 'link' && (
        <form className="m-selbar-link" onSubmit={(e) => { e.preventDefault(); const u = url.trim(); if (u) cmds.applyLink(u, linkRange.current ?? undefined); else cmds.removeLink(linkRange.current ?? undefined); setPane('marks') }}>
          <input type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" autoFocus placeholder="https://…" aria-label="Link address" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button type="submit">{url.trim() ? 'Apply' : 'Remove'}</button>
        </form>
      )}
    </div>,
    document.body,
  )
}
