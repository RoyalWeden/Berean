import React, { useEffect, useState } from 'react'
import { Reorder } from 'framer-motion'
import { Play, Plus, X, GripVertical, Save, Trash2, FolderOpen } from 'lucide-react'
import { useAppStore, type PlaybackQueueItem } from '@/store'
import type { BibleTabState } from '@/types'
import type { SavedPlaylist } from '@/types/electron'
import { bookChapterVerseLabel } from '@/lib/parseRef'
import { parseQueueRefInput, labelForQueueItem } from '@/lib/audioQueueRef'
import { Page, ListSection, Row, IconTap } from '../primitives/Page'
import { useActionSheet } from '../primitives/ActionSheet'
import { haptic } from '../primitives/haptics'
import { singleMove } from '../tabs/reorderDiff'

/**
 * Read Aloud queue + saved playlists on the phone (R045 / R096) — the desktop
 * `AudioQueuePopover` over the same store (`playbackQueue`, `playQueueIndex`, …) and
 * `window.playlists`: add the current chapter or a typed reference (same grammar, a range adds
 * one item per chapter), drag to reorder, remove, play from the top, save as / overwrite a
 * playlist (the queue autosaves to the playlist it was loaded from — `useQueueAutosave`, mounted
 * in the shell), load or delete saved playlists.
 */
export function QueuePage({ onBack }: { onBack: () => void }) {
  const actions = useActionSheet()
  const queue = useAppStore((s) => s.playbackQueue)
  const queueIndex = useAppStore((s) => s.playbackQueueIndex)
  const sourceId = useAppStore((s) => s.playbackQueueSourcePlaylistId)
  const sourceName = useAppStore((s) => s.playbackQueueSourcePlaylistName)
  const setPlaybackQueue = useAppStore((s) => s.setPlaybackQueue)
  const addToPlaybackQueue = useAppStore((s) => s.addToPlaybackQueue)
  const removeFromPlaybackQueue = useAppStore((s) => s.removeFromPlaybackQueue)
  const reorderPlaybackQueue = useAppStore((s) => s.reorderPlaybackQueue)
  const clearPlaybackQueue = useAppStore((s) => s.clearPlaybackQueue)
  const linkPlaybackQueueToPlaylist = useAppStore((s) => s.linkPlaybackQueueToPlaylist)
  const playQueueIndex = useAppStore((s) => s.playQueueIndex)
  const audioPlayback = useAppStore((s) => s.audioPlayback)
  const activeState = useAppStore((s) => { const t = s.tabs.scripture.find((x) => x.id === s.activeTabId.scripture); return t?.type === 'bible' ? (t.state as BibleTabState) : null })
  const [playlists, setPlaylists] = useState<SavedPlaylist[]>([])
  const [refInput, setRefInput] = useState('')
  const [refError, setRefError] = useState(false)
  const playlistsEpoch = useAppStore((s) => s.dataEpochs.playlists)
  useEffect(() => { window.playlists.list().then(setPlaylists).catch(() => setPlaylists([])) }, [playlistsEpoch])

  const defaultTextId = (audioPlayback?.textId ?? activeState?.translation?.toLowerCase() ?? 'kjva')
  const addCurrentChapter = () => {
    if (!activeState?.bookId) return
    const textId = (activeState.translation ?? 'KJVA').toLowerCase()
    addToPlaybackQueue({ bookId: activeState.bookId, chapter: activeState.chapter, startVerse: 1, endVerse: null, textId, label: bookChapterVerseLabel(activeState.bookId, activeState.chapter) })
    void haptic.light()
  }
  const addRef = () => {
    const trimmed = refInput.trim()
    if (!trimmed) return
    const items = parseQueueRefInput(trimmed, defaultTextId)
    if (!items) { setRefError(true); return }
    for (const it of items) addToPlaybackQueue(it)
    setRefInput(''); setRefError(false); void haptic.light()
  }
  const keys = queue.map((it, i) => `${i}:${it.bookId}:${it.chapter}:${it.startVerse}`)
  const onReorder = (next: string[]) => { const mv = singleMove(keys, next); if (mv) { void haptic.selection(); reorderPlaybackQueue(mv.from, mv.to) } }

  const savePlaylist = async () => {
    if (queue.length === 0) return
    const name = prompt('Playlist name', sourceName ?? '')?.trim()
    if (!name) return
    const items = queue.map((it) => ({ bookId: it.bookId, chapter: it.chapter, startVerse: it.startVerse, endVerse: it.endVerse, textId: it.textId }))
    const existingId = sourceId && sourceName === name ? sourceId : undefined
    const saved = await window.playlists.save(name, items, existingId)
    setPlaylists((prev) => [saved, ...prev.filter((p) => p.id !== saved.id)])
    linkPlaybackQueueToPlaylist(saved.id, saved.name)
    void haptic.success()
  }
  const loadPlaylist = (pl: SavedPlaylist, autoplay: boolean) => {
    const items: PlaybackQueueItem[] = pl.items.map((it) => ({ bookId: it.bookId, chapter: it.chapter, startVerse: it.startVerse, endVerse: it.endVerse, textId: it.textId, label: labelForQueueItem(it.bookId, it.chapter, it.startVerse, it.endVerse) }))
    setPlaybackQueue(items, pl.id, pl.name)
    if (autoplay && items.length > 0) playQueueIndex(0)
  }
  const playlistActions = (pl: SavedPlaylist) => actions(`playlist-${pl.id}`, pl.name, [
    { id: 'play', label: 'Play', onSelect: () => loadPlaylist(pl, true) },
    { id: 'load', label: 'Load into queue', onSelect: () => loadPlaylist(pl, false) },
    { id: 'rename', label: 'Rename…', onSelect: () => { const name = prompt('Playlist name', pl.name)?.trim(); if (name && name !== pl.name) window.playlists.rename(pl.id, name).then(() => setPlaylists((prev) => prev.map((p) => p.id === pl.id ? { ...p, name } : p))).catch(() => {}) } },
    { id: 'delete', label: 'Delete playlist', destructive: true, onSelect: () => { if (confirm(`Delete "${pl.name}"?`)) window.playlists.delete(pl.id).then(() => setPlaylists((prev) => prev.filter((p) => p.id !== pl.id))).catch(() => {}) } },
  ])

  return (
    <Page title="Read Aloud queue" onBack={onBack} right={queue.length > 0 ? <IconTap icon={Play} label="Play from the top" onClick={() => { void haptic.light(); playQueueIndex(0) }} /> : undefined}>
      <ListSection title={sourceName ? `Queue — ${sourceName}` : 'Queue'}>
        <div className="mobile-queue-add">
          <input className="mobile-input" placeholder="Add a reference (Luke 15, Luke 16:1-5, Luke 13-15)" value={refInput} aria-invalid={refError || undefined} onChange={(e) => { setRefInput(e.target.value); setRefError(false) }} onKeyDown={(e) => { if (e.key === 'Enter') addRef() }} aria-label="Reference to add" />
          <button type="button" className="mobile-button is-primary" onClick={addRef} aria-label="Add reference"><Plus size={18} aria-hidden /></button>
        </div>
        {refError && <div className="mobile-field-hint" role="alert">That reference wasn't understood.</div>}
        {activeState?.bookId && <Row title={`Add ${bookChapterVerseLabel(activeState.bookId, activeState.chapter)} (current chapter)`} leading={<Plus size={18} aria-hidden />} onClick={addCurrentChapter} />}
        {queue.length === 0 ? <div className="mobile-empty">The queue is empty. Add chapters above, or play from a verse's long-press menu.</div> : (
          <Reorder.Group axis="y" values={keys} onReorder={onReorder} className="mobile-tab-reorder" as="ul">
            {queue.map((it, i) => (
              <Reorder.Item key={keys[i]} value={keys[i]} as="li" className={`mobile-tab-reorder-row${i === queueIndex ? ' is-active' : ''}`}>
                <GripVertical size={18} aria-hidden className="mobile-tab-reorder-grip" />
                <button type="button" className="mobile-tab-reorder-title mobile-queue-item" onClick={() => { void haptic.selection(); playQueueIndex(i) }}>{it.label}<small>{it.textId.toUpperCase()}</small></button>
                <button type="button" className="mobile-tab-card-close" aria-label={`Remove ${it.label}`} onClick={() => removeFromPlaybackQueue(i)}><X size={16} aria-hidden /></button>
              </Reorder.Item>
            ))}
          </Reorder.Group>
        )}
        {queue.length > 0 && (
          <div className="mobile-queue-actions">
            <button type="button" className="mobile-button" onClick={() => { void savePlaylist() }}><Save size={16} aria-hidden /> {sourceId ? 'Save playlist' : 'Save as playlist'}</button>
            <button type="button" className="mobile-button" onClick={() => { if (confirm('Clear the queue?')) clearPlaybackQueue() }}><Trash2 size={16} aria-hidden /> Clear</button>
          </div>
        )}
      </ListSection>
      <ListSection title="Saved playlists">
        {playlists.length === 0 && <div className="mobile-empty">No playlists yet — save the queue to keep it.</div>}
        {playlists.map((pl) => (
          <Row key={pl.id} leading={<FolderOpen size={18} aria-hidden />} title={pl.name} subtitle={`${pl.items.length} item${pl.items.length === 1 ? '' : 's'}`} chevron onClick={() => playlistActions(pl)} />
        ))}
      </ListSection>
    </Page>
  )
}
