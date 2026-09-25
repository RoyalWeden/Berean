import { useCallback, useEffect, useRef, useState } from 'react'
import type { Note } from '@/types'
import { useAppStore } from '@/store'

const SAVE_DEBOUNCE_MS = 500
const SNAPSHOT_IDLE_MS = 2 * 60 * 1000

export type NotePatch = Partial<Omit<Note, 'status' | 'icon'>> & { status?: Note['status'] | null; icon?: string | null }

/**
 * The iPhone note save semantics (shared by the full-page editor and the verse sheet's in-place
 * editor, SEP25): load the note, debounced `updateNote`, a version snapshot after two idle
 * minutes and when leaving, `bumpNoteToken` so every other view refreshes, and a flush on
 * pagehide / background / unmount so the last keystrokes are never lost.
 */
export function useNoteAutosave(noteId: string) {
  const [note, setNote] = useState<Note | null | undefined>(undefined)
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const snapshotTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSnapshot = useRef<string | null>(null)
  const latest = useRef<Note | null>(null)
  const bumpNoteToken = useAppStore((s) => s.bumpNoteToken)

  useEffect(() => {
    let alive = true
    setNote(undefined)
    window.notes.getNote(noteId).then((n) => { if (alive) { setNote(n); latest.current = n; lastSnapshot.current = n?.content ?? null } }).catch(() => { if (alive) setNote(null) })
    return () => { alive = false }
  }, [noteId])

  const snapshot = useCallback((kind: string) => {
    const n = latest.current
    if (!n || lastSnapshot.current === n.content) return
    lastSnapshot.current = n.content
    window.notes.createNoteVersion(n.id, n.title || '', n.content, kind).catch(() => {})
  }, [])

  const persist = useCallback((patch: NotePatch) => {
    const n = latest.current
    if (!n) return
    const updated = { ...n, ...patch, status: patch.status === null ? undefined : (patch.status ?? n.status), icon: patch.icon === null ? undefined : (patch.icon ?? n.icon), updatedAt: Date.now() } as Note
    latest.current = updated
    setNote(updated)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      window.notes.updateNote(n.id, patch).then(() => { setLastSavedAt(Date.now()); bumpNoteToken() }).catch(() => {})
    }, SAVE_DEBOUNCE_MS)
    if ('content' in patch) {
      if (snapshotTimer.current) clearTimeout(snapshotTimer.current)
      snapshotTimer.current = setTimeout(() => snapshot('auto'), SNAPSHOT_IDLE_MS)
    }
  }, [bumpNoteToken, snapshot])

  /** Replace the local copy after an out-of-band change (pin, folder, restore). */
  const replace = useCallback((n: Note) => { latest.current = n; setNote(n) }, [])

  useEffect(() => {
    const flush = () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current); saveTimer.current = null
        const n = latest.current
        if (n) window.notes.updateNote(n.id, { title: n.title, content: n.content }).then(() => bumpNoteToken()).catch(() => {})
      }
      snapshot('auto')
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', flush)
    return () => { window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', flush); flush(); if (snapshotTimer.current) clearTimeout(snapshotTimer.current) }
  }, [bumpNoteToken, snapshot])

  return { note, latest, persist, replace, lastSavedAt }
}
