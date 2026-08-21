import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ListMusic, Plus, X, ChevronUp, ChevronDown, Play, Save, FolderOpen, Trash2, CornerDownLeft } from 'lucide-react'
import { useAppStore, type PlaybackQueueItem } from '@/store'
import { bookChapterVerseLabel } from '@/lib/parseRef'
import { parseQueueRefInput } from '@/lib/audioQueueRef'
import type { BibleTabState } from '@/types'
import type { SavedPlaylist } from '@/types/electron'

/**
 * "Read Aloud playlists" popover — anchored off the floating player's expanded panel (see the
 * ListMusic trigger button in AudioPlayer.tsx). Deliberately a popover off the existing player
 * rather than a separate sidebar Space/tab: this is meant to feel like an extension of "the
 * audio player," not a new place in the app, per the original ask.
 *
 * Covers: viewing/reordering/removing items in the live queue, adding the chapter currently on
 * screen to it, playing from any queue position, and saving/loading/deleting NAMED playlists
 * (persisted via window.playlists — see electron/ipc/playlists.ts).
 */
export default function AudioQueuePopover({ onClose }: { onClose: () => void }) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const playbackQueue = useAppStore((s) => s.playbackQueue)
  const playbackQueueIndex = useAppStore((s) => s.playbackQueueIndex)
  const playbackQueueSourcePlaylistId = useAppStore((s) => s.playbackQueueSourcePlaylistId)
  const playbackQueueSourcePlaylistName = useAppStore((s) => s.playbackQueueSourcePlaylistName)
  const setPlaybackQueue = useAppStore((s) => s.setPlaybackQueue)
  const addToPlaybackQueue = useAppStore((s) => s.addToPlaybackQueue)
  const removeFromPlaybackQueue = useAppStore((s) => s.removeFromPlaybackQueue)
  const reorderPlaybackQueue = useAppStore((s) => s.reorderPlaybackQueue)
  const clearPlaybackQueue = useAppStore((s) => s.clearPlaybackQueue)
  const playQueueIndex = useAppStore((s) => s.playQueueIndex)
  const audioPlayback = useAppStore((s) => s.audioPlayback)
  const activeTabId = useAppStore((s) => s.activeTabId.scripture)
  const tabs = useAppStore((s) => s.tabs.scripture)

  const [savedPlaylists, setSavedPlaylists] = useState<SavedPlaylist[]>([])
  const [showSaveInput, setShowSaveInput] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [showLoadList, setShowLoadList] = useState(false)
  const [refInput, setRefInput] = useState('')
  const [refError, setRefError] = useState(false)

  useEffect(() => {
    window.playlists?.list().then(setSavedPlaylists).catch(() => {})
  }, [])

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  const activeTab = tabs.find((t) => t.id === activeTabId)
  const activeState = activeTab?.state as BibleTabState | undefined

  // Default text/translation for anything added without its own explicit source: whatever's
  // currently playing, else whatever the visible scripture tab is showing, else KJVA.
  const defaultTextId = (audioPlayback?.textId ?? activeState?.translation?.toLowerCase() ?? 'kjva')

  function addCurrentChapterToQueue() {
    if (!activeState?.bookId) return
    const textId = (activeState.translation ?? 'KJVA').toLowerCase()
    const item: PlaybackQueueItem = {
      bookId: activeState.bookId, chapter: activeState.chapter, startVerse: 1, endVerse: null, textId,
      label: bookChapterVerseLabel(activeState.bookId, activeState.chapter),
    }
    addToPlaybackQueue(item)
  }

  // Free-typed reference input — "Luke 15", "Luke 16:1-5", "Luke 13-15", "Luke 15:10-16:3", etc.
  // (same grammar as the app's other reference inputs — see parseRef.ts). A single typed
  // reference can add MORE THAN ONE queue item (a chapter or cross-chapter range expands into
  // one item per chapter it touches — see audioQueueRef.ts for why).
  function addRefInputToQueue() {
    const trimmed = refInput.trim()
    if (!trimmed) return
    const items = parseQueueRefInput(trimmed, defaultTextId)
    if (!items) { setRefError(true); return }
    for (const item of items) addToPlaybackQueue(item)
    setRefInput('')
    setRefError(false)
  }

  function playFromQueueStart() {
    if (playbackQueue.length === 0) return
    playQueueIndex(0)
  }

  async function saveQueueAsPlaylist() {
    const name = saveName.trim()
    if (!name || playbackQueue.length === 0) return
    const items = playbackQueue.map((it) => ({ bookId: it.bookId, chapter: it.chapter, startVerse: it.startVerse, endVerse: it.endVerse, textId: it.textId }))
    // Overwrite the playlist this queue was loaded from if the name matches it exactly and
    // hasn't been changed — otherwise this always forks a new playlist rather than silently
    // renaming/overwriting one the user may not have meant to replace.
    const existingId = playbackQueueSourcePlaylistId && playbackQueueSourcePlaylistName === name ? playbackQueueSourcePlaylistId : undefined
    const saved = await window.playlists.save(name, items, existingId)
    setSavedPlaylists((prev) => {
      const next = prev.filter((p) => p.id !== saved.id)
      return [saved, ...next]
    })
    setShowSaveInput(false)
    setSaveName('')
  }

  function loadPlaylist(pl: SavedPlaylist, autoplay: boolean) {
    const items: PlaybackQueueItem[] = pl.items.map((it) => ({
      bookId: it.bookId, chapter: it.chapter, startVerse: it.startVerse, endVerse: it.endVerse, textId: it.textId,
      label: bookChapterVerseLabel(it.bookId, it.chapter),
    }))
    setPlaybackQueue(items, pl.id, pl.name)
    setShowLoadList(false)
    if (autoplay && items.length > 0) playQueueIndex(0)
  }

  async function deletePlaylist(id: string) {
    await window.playlists.delete(id)
    setSavedPlaylists((prev) => prev.filter((p) => p.id !== id))
  }

  return createPortal(
    <div
      ref={popoverRef}
      className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 w-72 max-h-[70vh] overflow-y-auto rounded-xl shadow-2xl border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-1))] p-2.5"
    >
      <div className="flex items-center justify-between px-1 pb-1.5 mb-1.5 border-b border-[rgb(var(--color-surface-3))]">
        <div className="flex items-center gap-1.5 text-xs font-medium text-[rgb(var(--color-text-primary))]">
          <ListMusic size={13} /> Playlist queue
        </div>
        <button onClick={onClose} className="text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer">
          <X size={13} />
        </button>
      </div>

      {/* Type-a-reference-and-press-Enter — same reference grammar as everywhere else in the app
          ("Luke 15", "Luke 16:1-5", "Luke 13-15", "Luke 15:10-16:3"; see parseRef.ts). A single
          typed reference can add more than one queue entry (a chapter/cross-chapter range
          expands per-chapter — see audioQueueRef.ts). */}
      <div className="mb-1.5">
        <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md bg-[rgb(var(--color-surface-3))] border ${refError ? 'border-red-500/60' : 'border-[rgb(var(--color-surface-4))]'}`}>
          <Plus size={12} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
          <input
            value={refInput}
            onChange={(e) => { setRefInput(e.target.value); if (refError) setRefError(false) }}
            onKeyDown={(e) => { if (e.key === 'Enter') addRefInputToQueue() }}
            placeholder="Type a reference… e.g. Luke 15:10-16:3"
            className="flex-1 min-w-0 bg-transparent text-[11px] text-[rgb(var(--color-text-primary))] placeholder:text-[rgb(var(--color-text-muted))] outline-none"
          />
          <CornerDownLeft size={11} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
        </div>
        {refError && (
          <p className="px-1 pt-1 text-[10px] text-red-400">Couldn't recognize that reference.</p>
        )}
      </div>

      {playbackQueue.length === 0 ? (
        <p className="px-1 py-3 text-[11px] text-[rgb(var(--color-text-muted))]">
          Nothing queued. Type a reference above, add the chapter you're viewing, or load a saved playlist below.
        </p>
      ) : (
        <div className="space-y-0.5 mb-1.5">
          {playbackQueue.map((item, i) => (
            <div
              key={`${item.bookId}-${item.chapter}-${item.textId}-${i}`}
              className={`flex items-center gap-1 px-1.5 py-1 rounded-md text-xs ${i === playbackQueueIndex ? 'bg-[rgb(var(--color-accent))/12] text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-3))]'}`}
            >
              <button
                onClick={() => playQueueIndex(i)}
                className="flex-1 min-w-0 text-left truncate cursor-pointer"
                title={`Play ${item.label}`}
              >
                {i === playbackQueueIndex && audioPlayback ? '▶ ' : ''}{item.label}
              </button>
              <button
                onClick={() => reorderPlaybackQueue(i, Math.max(0, i - 1))}
                disabled={i === 0}
                className="p-0.5 text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] disabled:opacity-25 disabled:cursor-default cursor-pointer"
                title="Move up"
              >
                <ChevronUp size={12} />
              </button>
              <button
                onClick={() => reorderPlaybackQueue(i, Math.min(playbackQueue.length - 1, i + 1))}
                disabled={i === playbackQueue.length - 1}
                className="p-0.5 text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] disabled:opacity-25 disabled:cursor-default cursor-pointer"
                title="Move down"
              >
                <ChevronDown size={12} />
              </button>
              <button
                onClick={() => removeFromPlaybackQueue(i)}
                className="p-0.5 text-[rgb(var(--color-text-muted))] hover:text-red-400 cursor-pointer"
                title="Remove from queue"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1 mb-1.5">
        <button
          onClick={addCurrentChapterToQueue}
          disabled={!activeState?.bookId}
          className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[11px] text-[rgb(var(--color-text-secondary))] bg-[rgb(var(--color-surface-3))] hover:bg-[rgb(var(--color-surface-4))] disabled:opacity-40 disabled:cursor-default cursor-pointer transition-colors"
          title="Add the chapter you're currently viewing"
        >
          <Plus size={12} /> Add current
        </button>
        <button
          onClick={playFromQueueStart}
          disabled={playbackQueue.length === 0}
          className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[11px] text-white bg-[rgb(var(--color-accent))] hover:opacity-90 disabled:opacity-40 disabled:cursor-default cursor-pointer transition-colors"
          title="Play queue from the start"
        >
          <Play size={11} /> Play
        </button>
      </div>

      <div className="flex items-center gap-1 mb-1">
        {showSaveInput ? (
          <>
            <input
              autoFocus
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveQueueAsPlaylist(); if (e.key === 'Escape') setShowSaveInput(false) }}
              placeholder="Playlist name…"
              className="flex-1 min-w-0 px-2 py-1 text-[11px] rounded-md bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] outline-none"
            />
            <button onClick={saveQueueAsPlaylist} className="p-1.5 rounded-md text-[rgb(var(--color-accent))] hover:bg-[rgb(var(--color-accent))/12] cursor-pointer">
              <Save size={12} />
            </button>
          </>
        ) : (
          <button
            onClick={() => { setSaveName(playbackQueueSourcePlaylistName ?? ''); setShowSaveInput(true) }}
            disabled={playbackQueue.length === 0}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[11px] text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-3))] disabled:opacity-40 disabled:cursor-default cursor-pointer transition-colors"
          >
            <Save size={12} /> Save as playlist
          </button>
        )}
        <button
          onClick={() => setShowLoadList((v) => !v)}
          className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[11px] text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-3))] cursor-pointer transition-colors"
        >
          <FolderOpen size={12} /> Load
        </button>
        {playbackQueue.length > 0 && (
          <button
            onClick={clearPlaybackQueue}
            className="p-1.5 rounded-md text-[rgb(var(--color-text-muted))] hover:text-red-400 hover:bg-red-500/10 cursor-pointer transition-colors"
            title="Clear queue"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {showLoadList && (
        <div className="mt-1 pt-1.5 border-t border-[rgb(var(--color-surface-3))] space-y-0.5">
          {savedPlaylists.length === 0 ? (
            <p className="px-1 py-1 text-[11px] text-[rgb(var(--color-text-muted))]">No saved playlists yet.</p>
          ) : savedPlaylists.map((pl) => (
            <div key={pl.id} className="flex items-center gap-1 px-1.5 py-1 rounded-md text-xs text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-3))]">
              <button onClick={() => loadPlaylist(pl, true)} className="flex-1 min-w-0 text-left truncate cursor-pointer" title={`Play "${pl.name}"`}>
                {pl.name} <span className="text-[rgb(var(--color-text-muted))]">({pl.items.length})</span>
              </button>
              <button onClick={() => loadPlaylist(pl, false)} className="p-0.5 text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer" title="Load into queue without playing">
                <FolderOpen size={11} />
              </button>
              <button onClick={() => deletePlaylist(pl.id)} className="p-0.5 text-[rgb(var(--color-text-muted))] hover:text-red-400 cursor-pointer" title="Delete playlist">
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>,
    document.body
  )
}
