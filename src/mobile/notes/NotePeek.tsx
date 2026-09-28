import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { LucideIcon } from 'lucide-react'
import type { Note } from '@/types'
import { displayNoteTitle } from '@/lib/noteTitle'
import { stripMarkdownFormatting } from '@/lib/notePreviewText'
import { haptic } from '../primitives/haptics'
import { firstImageSrc, notePreviewText } from './notesHomeModel'

export interface PeekAction { id: string; label: string; icon: LucideIcon; destructive?: boolean; run: () => void }

/**
 * The long-press preview (NOTES-HOME-008) — iOS's context-menu preview: the page dims and blurs,
 * the note floats up as a card showing its text, and its actions list under it. Tap the card to
 * open the note, an action to run it, anywhere else (or Escape) to dismiss. Positioned from the
 * pressed row's rect but kept on screen (safe areas included); reduced motion drops the lift.
 */
export function NotePeek({ note, anchor, actions, onOpen, onClose }: {
  note: Note; anchor: DOMRect | null; actions: PeekAction[]; onOpen: () => void; onClose: () => void
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    cardRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const title = displayNoteTitle(note.title)
  const thumb = firstImageSrc(note.content)
  const text = notePreviewText(note, stripMarkdownFormatting, 700)
  // Near the top half → the preview sits at the row; lower rows lift toward the middle so the menu fits.
  const top = anchor ? Math.max(0, Math.min(anchor.top, window.innerHeight * 0.18)) : 0
  return createPortal(
    <div className="m-peek" role="dialog" aria-modal="true" aria-label={`${title} preview`} onClick={onClose}>
      <div className="m-peek-stack" style={{ ['--peek-top' as string]: `${top}px` }} onClick={(e) => e.stopPropagation()}>
        <div ref={cardRef} tabIndex={-1} className="m-peek-card" role="button" aria-label={`Open ${title}`}
          onClick={() => { onClose(); onOpen() }} onKeyDown={(e) => { if (e.key === 'Enter') { onClose(); onOpen() } }}>
          <div className="m-peek-title">{note.icon ? `${note.icon} ` : ''}{title}</div>
          {thumb && <img className="m-peek-img" src={thumb} alt="" />}
          <p className="m-peek-text">{text || 'No additional text'}</p>
        </div>
        <div className="m-peek-menu" role="menu">
          {actions.map((a) => (
            <button key={a.id} type="button" role="menuitem" className={`m-peek-item${a.destructive ? ' is-destructive' : ''}`}
              onClick={() => { void haptic.light(); onClose(); a.run() }}>
              <span>{a.label}</span><a.icon size={18} aria-hidden />
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
