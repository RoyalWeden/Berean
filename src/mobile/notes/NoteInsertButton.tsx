import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus } from 'lucide-react'
import type { EditorView } from 'prosemirror-view'
import { NOTE_INSERT_ITEMS, runNoteInsert, insertLink, type NoteInsertId } from './noteInsertCommands'
import { haptic } from '../primitives/haptics'
import './noteEditor.css'

/** z-index just above the sheet `anchor` sits in (Sheet.tsx sets it inline), or null outside a sheet. */
export function useSheetOverlayZ(anchor: React.RefObject<HTMLElement>): number | null {
  const [z, setZ] = useState<number | null>(null)
  useLayoutEffect(() => {
    const sheet = anchor.current?.closest('.mobile-sheet') as HTMLElement | null
    const n = sheet ? parseInt(sheet.style.zIndex || '0', 10) : NaN
    setZ(Number.isFinite(n) && n > 0 ? n + 1 : null)
  }, [anchor])
  return z
}

/** True after the user scrolls the note (the editor's own scroller, or the sheet around it) DOWN;
 *  false again on any scroll up. */
function useHiddenOnScrollDown(view: EditorView | null): boolean {
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    if (!view) return
    const last = new WeakMap<EventTarget, number>()
    const onScroll = (e: Event) => {
      const el = e.target as HTMLElement | null
      if (!el || typeof el.contains !== 'function' || !el.contains(view.dom)) return
      const top = el.scrollTop, prev = last.get(el) ?? top
      last.set(el, top)
      if (top > prev + 4 && top > 24) setHidden(true)
      else if (top < prev - 4 || top <= 0) setHidden(false)
    }
    document.addEventListener('scroll', onScroll, true)
    return () => document.removeEventListener('scroll', onScroll, true)
  }, [view])
  return hidden
}

/**
 * The note editor's floating + (TEST25-NOTES-003): a glass circle at the bottom-left that opens
 * a compact insert menu (Scripture reference, image, link, heading, lists, quote, divider) — each
 * the editor's own command. Taps preventDefault on mousedown so the editor keeps focus (and the
 * iOS keyboard stays up). Hides while the note scrolls down, returns on scroll up; with the
 * keyboard open it sits just above it (noteEditor.css).
 *
 * `placement="inline"`: absolutely positioned in its (relative) editor container.
 * `placement="viewport"`: portaled, fixed to the screen's bottom-left above the enclosing sheet —
 * sheets are bottom-anchored, so that is the sheet's visible bottom at every detent.
 */
export function NoteInsertButton({ view, placement = 'inline', hidden = false }: { view: EditorView | null; placement?: 'inline' | 'viewport'; hidden?: boolean }) {
  const [open, setOpen] = useState(false)
  const [linkMode, setLinkMode] = useState(false)
  const [url, setUrl] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const z = useSheetOverlayZ(anchorRef)
  const scrolledAway = useHiddenOnScrollDown(view)

  const close = () => { setOpen(false); setLinkMode(false); setUrl('') }
  useEffect(() => {
    if (!open) return
    const onDown = (e: Event) => { if (!rootRef.current?.contains(e.target as Node)) close() }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open])
  useEffect(() => { if (scrolledAway || hidden) close() }, [scrolledAway, hidden])

  const pick = (id: NoteInsertId) => {
    if (!view) return
    void haptic.light()
    if (id === 'link') { setLinkMode(true); return }
    close()
    runNoteInsert(view, id)
  }
  const submitLink = () => {
    if (view && url.trim()) insertLink(view, url)
    close()
  }

  const keep = (e: React.MouseEvent) => e.preventDefault()
  const body = (
    <div
      ref={rootRef}
      className={`m-note-insert is-${placement}${scrolledAway || hidden ? ' is-hidden' : ''}`}
      style={placement === 'viewport' && z != null ? { zIndex: z } : undefined}
    >
      {open && (
        <div className="m-note-insert-menu" role="menu" aria-label="Insert">
          {linkMode ? (
            <form className="m-note-insert-link" onSubmit={(e) => { e.preventDefault(); submitLink() }}>
              <input
                type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" autoFocus
                placeholder="https://…" aria-label="Link address" value={url} onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') close() }}
              />
              <button type="submit" disabled={!url.trim()}>Add</button>
            </form>
          ) : NOTE_INSERT_ITEMS.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" role="menuitem" className="m-note-insert-row" onMouseDown={keep} onClick={() => pick(id)}>
              <Icon size={19} aria-hidden /><span>{label}</span>
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className="m-note-insert-fab"
        aria-label="Insert"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!view}
        onMouseDown={keep}
        onClick={() => { void haptic.light(); if (open) close(); else setOpen(true) }}
      >
        <Plus size={24} aria-hidden />
      </button>
    </div>
  )
  return (
    <>
      <span ref={anchorRef} hidden />
      {placement === 'viewport' ? createPortal(body, document.body) : body}
    </>
  )
}
