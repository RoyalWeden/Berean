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
  // What the EDITOR is given (TEST25-NOTES-001): set when the note loads or is replaced from
  // outside (version restore) — never on a keystroke. The editor owns its live document; feeding
  // every save back into it is what raced with fast typing / autocorrect and lost text.
  const [editorContent, setEditorContent] = useState<string>('')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const snapshotTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSnapshot = useRef<string | null>(null)
  const latest = useRef<Note | null>(null)
  const pending = useRef<NotePatch>({})
  const bumpNoteToken = useAppStore((s) => s.bumpNoteToken)

  useEffect(() => {
    let alive = true
    setNote(undefined)
    window.notes.getNote(noteId).then((n) => { if (alive) { setNote(n); latest.current = n; lastSnapshot.current = n?.content ?? null; setEditorContent(n?.content ?? '') } }).catch(() => { if (alive) setNote(null) })
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
    // Patches ACCUMULATE until the debounced save runs (TEST25-NOTES-001): a title edit within
    // the debounce window used to replace a pending content patch, so that save lost the text.
    pending.current = { ...pending.current, ...patch }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      const toSave = pending.current
      pending.current = {}
      window.notes.updateNote(n.id, toSave).then(() => { setLastSavedAt(Date.now()); bumpNoteToken() }).catch(() => {
        // Keep the unsaved fields for the next save / flush rather than dropping them.
        pending.current = { ...toSave, ...pending.current }
      })
    }, SAVE_DEBOUNCE_MS)
    if ('content' in patch) {
      if (snapshotTimer.current) clearTimeout(snapshotTimer.current)
      snapshotTimer.current = setTimeout(() => snapshot('auto'), SNAPSHOT_IDLE_MS)
    }
  }, [bumpNoteToken, snapshot])

  /** Replace the local copy after an out-of-band change (pin, folder, restore). */
  const replace = useCallback((n: Note) => {
    const contentChanged = latest.current?.content !== n.content
    latest.current = n
    setNote(n)
    if (contentChanged) setEditorContent(n.content)
  }, [])

  useEffect(() => {
    const flush = () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current); saveTimer.current = null
        const n = latest.current
        pending.current = {}
        if (n) window.notes.updateNote(n.id, { title: n.title, content: n.content }).then(() => bumpNoteToken()).catch(() => {})
      }
      snapshot('auto')
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', flush)
    return () => { window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', flush); flush(); if (snapshotTimer.current) clearTimeout(snapshotTimer.current) }
  }, [bumpNoteToken, snapshot])

  return { note, latest, persist, replace, lastSavedAt, editorContent }
}
