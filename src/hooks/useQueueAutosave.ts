import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store'

const DEBOUNCE_MS = 800

/**
 * Autosaves the Read Aloud playback queue back to its source playlist whenever it changes —
 * mounted once at App.tsx's root, alongside useTTSPlayback(), so it keeps working regardless of
 * whether AudioQueuePopover.tsx happens to be open.
 *
 * Only fires once the queue is already linked to a NAMED, saved playlist
 * (`playbackQueueSourcePlaylistId` is set — i.e. the user loaded one, or has already saved this
 * queue once via "Save as playlist"). A brand-new, unnamed/ad-hoc queue is never autosaved —
 * there's nothing to save it AS until the user names it once, matching the existing manual
 * "Save as playlist" flow (AudioQueuePopover.tsx's saveQueueAsPlaylist).
 */
export function useQueueAutosave() {
  const playbackQueue = useAppStore((s) => s.playbackQueue)
  const sourcePlaylistId = useAppStore((s) => s.playbackQueueSourcePlaylistId)
  const sourcePlaylistName = useAppStore((s) => s.playbackQueueSourcePlaylistName)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Skip the very first run after a playlist is (re)loaded — that change IS the load itself,
  // not an edit, so saving immediately would be a redundant no-op write.
  const loadedKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    if (!sourcePlaylistId || !sourcePlaylistName) return

    const loadKey = sourcePlaylistId
    if (loadedKeyRef.current !== loadKey) {
      // First render after loading (or switching to) this playlist — just remember it, don't
      // immediately re-save it right back.
      loadedKeyRef.current = loadKey
      return
    }

    timerRef.current = setTimeout(() => {
      const items = playbackQueue.map((it) => ({
        bookId: it.bookId, chapter: it.chapter, startVerse: it.startVerse, endVerse: it.endVerse, textId: it.textId,
      }))
      // An empty queue is a real, savable state (the user cleared/removed everything) — persist
      // it rather than skipping, so the saved playlist reflects what's actually in the queue.
      window.playlists?.save(sourcePlaylistName, items, sourcePlaylistId).catch(() => {
        // Best-effort — a failed autosave isn't worth surfacing as an error; the user can still
        // "Save as playlist" manually, and the next queue edit will retry autosaving anyway.
      })
    }, DEBOUNCE_MS)

    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [playbackQueue, sourcePlaylistId, sourcePlaylistName])
}
