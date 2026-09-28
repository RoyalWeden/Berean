import React, { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import type { Note } from '@/types'
import { useAppStore } from '@/store'
import { stripMarkdownFormatting } from '@/lib/notePreviewText'
import type { SheetApi } from '../primitives/Sheet'
import { displayNoteTitle } from '@/lib/noteTitle'

/**
 * The Notes carets' location view (SEP24-008): find a note by title or text and open it in THIS
 * Notes tab — the notes counterpart of the Scripture caret's passage search.
 */
export function NoteFinder({ api }: { api: SheetApi }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<Note[]>([])
  useEffect(() => {
    let alive = true
    const t = setTimeout(() => {
      const p = q.trim().length >= 2 ? window.notes.searchNotes(q.trim(), 40, 'all') : window.notes.getNotes(20)
      p.then((r) => { if (alive) setRows(r as Note[]) }).catch(() => {})
    }, 160)
    return () => { alive = false; clearTimeout(t) }
  }, [q])
  return (
    <div className="mobile-note-finder">
      <form className="m-pp-search" role="search" onSubmit={(e) => { e.preventDefault(); if (rows[0]) { api.close(); useAppStore.getState().requestOpenNote(rows[0].id) } }}>
        <Search size={17} aria-hidden />
        <input type="search" autoFocus placeholder="Find a note" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a note" data-no-sheet-drag />
      </form>
      <div className="mobile-choice-list">
        {rows.map((n) => (
          <button key={n.id} type="button" className="mobile-choice-row" onClick={() => { api.close(); useAppStore.getState().requestOpenNote(n.id) }}>
            <span className="mobile-choice-label">{n.icon ? `${n.icon} ` : ''}{displayNoteTitle(n.title)}<small>{stripMarkdownFormatting(n.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)}</small></span>
          </button>
        ))}
        {rows.length === 0 && <div className="mobile-empty">{q.trim() ? 'No notes match.' : 'No notes yet.'}</div>}
      </div>
    </div>
  )
}
