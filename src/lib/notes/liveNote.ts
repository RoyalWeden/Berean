import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import type { Note } from '@/types'

/**
 * Live open notes (DATA-LIVE-001) — the ONE rule every surface that shows an open, editable note
 * uses for changes made elsewhere (another device via iCloud, another window, a vault file):
 * the Mac Notes panel, the Mac Scripture right panel, the iPhone Notes tab editor and the iPhone
 * Scripture verse-sheet editor.
 *
 * The database is the source of truth. A change anywhere bumps `noteChangeToken`; the open note's
 * host re-reads its note and decides:
 *   ignore  nothing visible changed, or it is our own save coming back
 *   apply   the host's local copy is CLEAN (no save pending, no keystroke in the last 2 s): show
 *           the new title / text in the SAME mounted editor — no remount, no reopen, the cursor
 *           mapped to the same offset, the keyboard stays up
 *   defer   the user is typing: never replace their text. The outside text is kept as a note
 *           version ("external") — nothing is lost — and the note is looked at again when the
 *           typing pauses (the user's own newer save usually supersedes it, else it is applied)
 * An IME / autocorrect / dictation composition is protected by the editor itself, which reports
 * the content it could not apply (`deferredWhileComposing`) so the host records it the same way.
 */
export const ACTIVE_EDIT_MS = 2000

export interface NoteSnapshot { id: string; content: string; title: string | null | undefined }
export type ExternalDecision = 'ignore' | 'apply' | 'defer'

export function decideExternal(remote: NoteSnapshot, local: NoteSnapshot | null, o: { dirty: boolean; ownEcho?: boolean }): ExternalDecision {
  if (!local || remote.id !== local.id) return 'ignore'
  if (remote.content === local.content && (remote.title ?? '') === (local.title ?? '')) return 'ignore'
  if (o.ownEcho) return 'ignore'
  return o.dirty ? 'defer' : 'apply'
}

/** Keep the outside text as a version once (the user's next save would otherwise replace it). */
export function preserveExternal(n: NoteSnapshot, already: { current: string | null }): void {
  if (already.current === n.content) return
  already.current = n.content
  window.notes?.createNoteVersion?.(n.id, n.title || '', n.content, 'external').catch(() => {})
}

/**
 * The hook form for hosts that keep the open note in React state (the Mac panels). `getLocal`
 * and `isDirty` are read at decision time (refs), `onApply` receives the database's note.
 * Returns `deferredWhileComposing` for the editor's `onExternalDeferred`.
 */
export function useLiveNote(o: {
  noteId: string | null | undefined
  getLocal: () => NoteSnapshot | null
  isDirty: () => boolean
  isOwnEcho?: (n: Note) => boolean
  onApply: (n: Note) => void
}): { deferredWhileComposing: (content: string) => void } {
  const opts = useRef(o)
  opts.current = o
  const preserved = useRef<string | null>(null)
  /** What we last handed the host, and what the host showed just before (a racing duplicate
   *  event sees one of the two until the host re-renders; anything else means the user moved on). */
  const applied = useRef<{ content: string; title: string; before: string } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    preserved.current = null
    applied.current = null
    const id = o.noteId
    if (!id) return
    let alive = true
    const check = () => {
      window.notes.getNote(id).then((n) => {
        if (!alive || !n) return
        const cur = opts.current
        const local = cur.getLocal()
        // Several change events can race (each re-reads before the host re-renders): the same
        // outside version is handed over once.
        const a = applied.current
        if (a && local && n.content === a.content && (n.title ?? '') === a.title && (local.content === a.content || local.content === a.before)) return
        const decision = decideExternal(n, local, { dirty: cur.isDirty(), ownEcho: cur.isOwnEcho?.(n) })
        if (decision === 'ignore') { if (local && n.content === local.content) preserved.current = null; return }
        if (decision === 'defer') {
          preserveExternal(n, preserved)
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => { timer.current = null; check() }, ACTIVE_EDIT_MS + 200)
          return
        }
        preserved.current = null
        applied.current = { content: n.content, title: n.title ?? '', before: local?.content ?? '' }
        cur.onApply(n)
      }).catch(() => {})
    }
    const off = useAppStore.subscribe((s, p) => { if (s.noteChangeToken !== p.noteChangeToken) check() })
    return () => { alive = false; off(); if (timer.current) { clearTimeout(timer.current); timer.current = null } }
  }, [o.noteId])
  return {
    deferredWhileComposing: (content: string) => {
      const local = opts.current.getLocal()
      if (local) preserveExternal({ id: local.id, content, title: local.title }, preserved)
    },
  }
}
