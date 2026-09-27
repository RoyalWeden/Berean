import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { EditorView } from 'prosemirror-view'
import { toggleMark } from 'prosemirror-commands'
import { Bold, Italic, Underline, Strikethrough, Highlighter, Link2, Code, X } from 'lucide-react'
import { bereanSchema as schema } from '@/components/notes/pm/schema'
import { createEditorCommands } from '@/components/notes/pm/editorCommands'
import type { SelectionToolbarState } from '@/components/notes/pm/selectionToolbarPlugin'
import { HIGHLIGHT_LABELS, highlightDotColor } from '@/styles/highlightPalette'
import type { HighlightColor } from '@/types'
import { useSheetOverlayZ } from './NoteInsertButton'
import './noteEditor.css'

/** The bar fits one phone-width row: the six most distinct pigments (the full palette stays on desktop). */
const PHONE_HIGHLIGHTS: HighlightColor[] = ['yellow', 'green', 'blue', 'pink', 'purple', 'orange']

/**
 * The phone's formatting bar for a text selection (TEST25-NOTES-003, NOTES-IOS-003), passed to
 * NoteEditorPM as `renderSelectionToolbar`: bold, italic, underline, strikethrough, highlight,
 * link, inline code as 44 pt glass buttons.
 *
 * It is DOCKED at the bottom of the screen (just above the keyboard when it is up), never floating
 * next to the selection: iOS draws its own edit callout (Cut · Copy · Paste · Replace · Look Up ·
 * Share…) above OR below the selection depending on room, so any Berean surface near the selection
 * eventually collides with it. Owning the bottom edge instead keeps exactly one floating menu —
 * Apple's — and puts Berean's formatting where iOS Notes puts its own (the keyboard's edge).
 * While it is shown the note's + insert button steps aside (same spot; `html[data-m-selbar]`).
 * Commands are the desktop bubble's (editorCommands.ts). `pm-toolbar-solid` keeps NoteEditorPM's
 * outside-tap dismiss from closing it; every button preventDefaults mousedown so the editor keeps
 * focus, the selection and the keyboard.
 */
export function PhoneSelectionToolbar({ view, state }: { view: EditorView; state: SelectionToolbarState }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [pane, setPane] = useState<'marks' | 'highlight' | 'link'>('marks')
  const [url, setUrl] = useState('')
  const linkRange = useRef<{ from: number; to: number } | null>(null)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const z = useSheetOverlayZ(anchorRef)
  const cmds = createEditorCommands(view)
  void state // re-rendered per selection change so the active-mark states stay current

  useEffect(() => {
    const root = document.documentElement
    root.dataset.mSelbar = ''
    return () => { delete root.dataset.mSelbar }
  }, [])

  const mark = (name: 'strong' | 'em' | 'underline' | 'strike' | 'code') => () => cmds.run(toggleMark(schema.marks[name]))
  const keep = (e: React.MouseEvent) => e.preventDefault()
  const btn = (label: string, Icon: typeof Bold, onPress: () => void, active = false) => (
    <button key={label} type="button" className={`m-selbar-btn${active ? ' is-on' : ''}`} aria-label={label} aria-pressed={active} onMouseDown={keep} onClick={onPress}>
      <Icon size={20} aria-hidden />
    </button>
  )

  return <>
    <span ref={anchorRef} hidden />
    {createPortal(<div
      ref={rootRef}
      className={`pm-toolbar-solid m-selbar${z != null ? ' is-sheet' : ''}`}
      role="toolbar"
      aria-label="Format"
      style={z != null ? { zIndex: z } : undefined}
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
    document.body)}
  </>
}
