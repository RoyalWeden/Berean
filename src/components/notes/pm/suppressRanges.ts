import { Plugin, PluginKey } from 'prosemirror-state'
import { keymap } from 'prosemirror-keymap'
import type { Command } from 'prosemirror-state'

// Port of NoteEditor.tsx's suppress-detection system (⌘⇧R,
// suppressedRangesField + isInSuppressedRange, NoteEditor.tsx:151-166,
// 3163-3176). Toggling on a selection excludes verse/lxx/lexicon-ref
// decoration in that range (NOT wikilinks — matches the original's scope).
//
// Never serialized to markdown — but IS kept in an in-memory, per-noteId
// cache below (cleared on app restart, not persisted to disk) so leaving a
// note's tab and coming back doesn't silently re-link something the user
// deliberately unlinked. Without this, note-switching rebuilding a fresh
// EditorState via `EditorState.create` (see NoteEditorPM.tsx's note-switch
// effect) re-runs every stateful plugin's `init()`, which wiped suppressed
// ranges on every switch — a real bug (reported: unlink a verse ref, leave
// the tab, come back, it's linked again), not deliberate design. The
// plugin's `view().update()` hook mirrors the live ranges into the cache on
// every transaction; `init()` seeds from it by the note id the caller
// currently reports (via `getNoteId`), so the same Plugin instance (built
// once at mount and reused across note switches — see NoteEditorPM.tsx)
// correctly restores each note's own suppressed ranges as you switch
// between notes, not just the most recent one.

export interface SuppressedRange { from: number; to: number }

const suppressedRangesCache = new Map<string, SuppressedRange[]>()

export const suppressRangesKey = new PluginKey<SuppressedRange[]>('berean-suppress-ranges')

export function isInSuppressedRange(view: { state: import('prosemirror-state').EditorState }, from: number, to: number): boolean {
  const ranges = suppressRangesKey.getState(view.state) ?? []
  return ranges.some((r) => r.from < to && r.to > from)
}

export const toggleSuppressCommand: Command = (state, dispatch) => {
  const { from, to } = state.selection
  if (from === to) return false
  const existing = suppressRangesKey.getState(state) ?? []
  const overlapping = existing.filter((r) => r.from < to && r.to > from)
  const next = overlapping.length > 0
    ? existing.filter((r) => !overlapping.includes(r)) // already suppressed → re-enable (remove)
    : [...existing, { from, to }] // not suppressed → suppress (add)
  if (dispatch) dispatch(state.tr.setMeta(suppressRangesKey, next))
  return true
}

export function createSuppressRangesPlugin(getNoteId?: () => string | null | undefined) {
  return new Plugin<SuppressedRange[]>({
    key: suppressRangesKey,
    state: {
      init: () => {
        const id = getNoteId?.()
        return id ? (suppressedRangesCache.get(id) ?? []) : []
      },
      apply(tr, ranges) {
        const meta = tr.getMeta(suppressRangesKey) as SuppressedRange[] | undefined
        if (meta) return meta
        if (!tr.docChanged) return ranges
        return ranges
          .map((r) => ({ from: tr.mapping.map(r.from), to: tr.mapping.map(r.to, -1) }))
          .filter((r) => r.from < r.to)
      },
    },
    view() {
      return {
        update(view) {
          const id = getNoteId?.()
          if (!id) return
          suppressedRangesCache.set(id, suppressRangesKey.getState(view.state) ?? [])
        },
      }
    },
  })
}

export const suppressRangesKeymap = keymap({
  'Mod-Shift-r': toggleSuppressCommand,
})
