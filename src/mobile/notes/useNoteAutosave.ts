import { useCallback, useEffect, useRef, useState } from 'react'
import type { Note } from '@/types'
import { useAppStore } from '@/store'

const SAVE_DEBOUNCE_MS = 500
const SNAPSHOT_IDLE_MS = 2 * 60 * 1000
/** A keystroke this recent still counts as "the user is typing" for the external-update policy. */
const ACTIVE_EDIT_MS = 2000

/** Focus is in an editable element — a note editor or a title field is being typed in. */
function isTypingSomewhere(): boolean {
  const a = document.activeElement as HTMLElement | null
  return !!a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')
}

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
  // External-update policy (NOTES-IOS-004): contents this editor itself wrote (recognised as echoes,
  // never as outside changes), when it last changed, and external content already preserved.
  const ownContents = useRef(new Set<string>())
  const lastEditAt = useRef(0)
  const preservedExternal = useRef<string | null>(null)

  useEffect(() => {
    let alive = true
    setNote(undefined)
    ownContents.current.clear()
    window.notes.getNote(noteId).then((n) => { if (alive) { setNote(n); latest.current = n; lastSnapshot.current = n?.content ?? null; setEditorContent(n?.content ?? ''); if (n) remember(n.content) } }).catch(() => { if (alive) setNote(null) })
    return () => { alive = false }
  }, [noteId])

  const remember = (content: string) => {
    const set = ownContents.current
    set.delete(content); set.add(content)
    if (set.size > 32) set.delete(set.values().next().value as string)
  }

  /**
   * An outside change to this note (another device via iCloud, the desktop app, a vault file, a
   * second editor of the same note). The live editor is authoritative while the user is editing:
   *  • our own saves coming back are ignored;
   *  • while typing (focus in an editable, a keystroke in the last 2 s, or a save pending) the
   *    outside content is NOT applied — it is kept as a note version ("external") so the local
   *    save that follows can never silently destroy it, and re-checked once editing stops;
   *  • when idle, the outside content replaces the editor's document (a load, not a keystroke).
   */
  const considerExternal = useCallback((n: Note) => {
    const cur = latest.current
    if (!cur || n.id !== cur.id || n.content === cur.content || ownContents.current.has(n.content)) return
    const editing = saveTimer.current != null || isTypingSomewhere() || Date.now() - lastEditAt.current < ACTIVE_EDIT_MS
    if (editing) {
      if (preservedExternal.current !== n.content) {
        preservedExternal.current = n.content
        window.notes.createNoteVersion?.(n.id, n.title || '', n.content, 'external').catch(() => {})
      }
      return
    }
    latest.current = { ...cur, ...n }
    lastSnapshot.current = n.content
    remember(n.content)
    setNote(latest.current)
    setEditorContent(n.content)
  }, [])

  useEffect(() => {
    let alive = true
    const recheck = () => { window.notes.getNote(noteId).then((n) => { if (alive && n) considerExternal(n) }).catch(() => {}) }
    // Every note change in the app (saves, sync, other editors) bumps the shared note token —
    // `notes.onChanged` itself is single-listener (the app shell's), so it is not subscribed here.
    const off = useAppStore.subscribe((st, prev) => { if (st.noteChangeToken !== prev.noteChangeToken) recheck() })
    // Deferred outside changes are re-checked once the user leaves the field.
    let t: ReturnType<typeof setTimeout> | null = null
    const onFocusOut = () => { if (t) clearTimeout(t); t = setTimeout(() => { if (preservedExternal.current != null) recheck() }, ACTIVE_EDIT_MS + 100) }
    document.addEventListener('focusout', onFocusOut)
    return () => { alive = false; off(); document.removeEventListener('focusout', onFocusOut); if (t) clearTimeout(t) }
  }, [noteId, considerExternal])

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
    if ('content' in patch && typeof patch.content === 'string') { lastEditAt.current = Date.now(); remember(patch.content) }
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
    remember(n.content)
    setNote(n)
    if (contentChanged) setEditorContent(n.content)
  }, [])

  useEffect(() => {
    const flush = () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current); saveTimer.current = null
        const n = latest.current
        const rest = pending.current
        pending.current = {}
        if (n) window.notes.updateNote(n.id, { ...rest, title: n.title, content: n.content }).then(() => bumpNoteToken()).catch(() => {})
      }
      snapshot('auto')
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', flush)
    return () => { window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', flush); flush(); if (snapshotTimer.current) clearTimeout(snapshotTimer.current) }
  }, [bumpNoteToken, snapshot])

  return { note, latest, persist, replace, lastSavedAt, editorContent }
}
