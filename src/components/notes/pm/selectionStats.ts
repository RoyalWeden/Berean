import { useSyncExternalStore } from 'react'
import { Plugin, PluginKey } from 'prosemirror-state'
import { computeWordStats, type WordStats } from '@/lib/wordCount'

/**
 * The word / character count of the editor's current TEXT SELECTION, published for the note's Info
 * inspector (NoteSidePanel). Selecting text no longer adds a count to the bottom of the canvas
 * (TEST 2026-10-10): the inspector's own Words / Characters rows switch to the selection's counts,
 * set in italics and a quieter tint, and return to the whole note's counts when the selection
 * clears — the way Pages and Ulysses report a selection.
 *
 * A tiny keyed external store rather than React state in NotesPanel: a drag-selection changes the
 * selection on every mouse move, and only the inspector's two rows should re-render for it — not
 * the whole Notes panel and its editor. Keyed per editor (the tab id + note id) so a second editor
 * on screen never shows the other's selection.
 */

const stats = new Map<string, WordStats>()
const listeners = new Map<string, Set<() => void>>()

function notify(key: string) {
  listeners.get(key)?.forEach((l) => l())
}

export function selectionStatsKey(tabId: string | undefined, noteId: string | undefined): string {
  return `${tabId ?? ''}:${noteId ?? ''}`
}

export function publishSelectionStats(key: string, next: WordStats | null) {
  const prev = stats.get(key)
  if (!next) {
    if (!prev) return
    stats.delete(key)
    notify(key)
    return
  }
  if (prev && prev.words === next.words && prev.characters === next.characters) return
  stats.set(key, next)
  notify(key)
}

export function getSelectionStats(key: string): WordStats | null {
  return stats.get(key) ?? null
}

/** The selection's stats for this editor, or null while nothing is selected. */
export function useSelectionStats(key: string | null): WordStats | null {
  return useSyncExternalStore(
    (cb) => {
      if (!key) return () => {}
      let set = listeners.get(key)
      if (!set) { set = new Set(); listeners.set(key, set) }
      set.add(cb)
      return () => { set!.delete(cb); if (set!.size === 0) listeners.delete(key) }
    },
    () => (key ? stats.get(key) ?? null : null),
  )
}

const selectionStatsPluginKey = new PluginKey('berean-selection-stats')

/**
 * Publishes the selection's counts whenever the selection (or the selected text) changes. Only the
 * SELECTED range is read (never the whole document), and a burst of changes during a drag is
 * coalesced to one count per animation frame.
 */
export function createSelectionStatsPlugin(getKey: () => string) {
  return new Plugin({
    key: selectionStatsPluginKey,
    view(view) {
      let raf: number | null = null
      let publishedKey: string | null = null
      const compute = () => {
        raf = null
        const key = getKey()
        if (publishedKey && publishedKey !== key) publishSelectionStats(publishedKey, null)
        publishedKey = key
        const { selection, doc } = view.state
        if (selection.empty) { publishSelectionStats(key, null); return }
        publishSelectionStats(key, computeWordStats(doc.textBetween(selection.from, selection.to, '\n', '\n')))
      }
      const schedule = () => {
        if (raf != null) return
        raf = requestAnimationFrame(compute)
      }
      return {
        update(v, prevState) {
          if (v.state.selection.eq(prevState.selection) && (v.state.selection.empty || v.state.doc.eq(prevState.doc))) {
            // A different note loaded into the same view (the key changed) still needs a reset.
            if (publishedKey === getKey()) return
          }
          schedule()
        },
        destroy() {
          if (raf != null) cancelAnimationFrame(raf)
          if (publishedKey) publishSelectionStats(publishedKey, null)
        },
      }
    },
  })
}
