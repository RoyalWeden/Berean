import { Plugin, PluginKey } from 'prosemirror-state'
import { keymap } from 'prosemirror-keymap'
import type { Command } from 'prosemirror-state'

// Port of NoteEditor.tsx's suppress-detection system (⌘⇧R,
// suppressedRangesField + isInSuppressedRange, NoteEditor.tsx:151-166,
// 3163-3176). Toggling on a selection excludes verse/lxx/lexicon-ref
// decoration in that range (NOT wikilinks — matches the original's scope).
// Pure in-memory: like the original, this is never serialized to markdown,
// and — since note-switching rebuilds a fresh EditorState via
// `EditorState.create` (see NoteEditorPM.tsx's note-switch effect), which
// re-runs every stateful plugin's `init()` — suppressed ranges are
// naturally cleared on note switch with no special-casing needed, exactly
// mirroring the CM6 version's de-facto (not deliberately designed) behavior
// from its own full-document-replace-on-switch transaction.

export interface SuppressedRange { from: number; to: number }

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

export function createSuppressRangesPlugin() {
  return new Plugin<SuppressedRange[]>({
    key: suppressRangesKey,
    state: {
      init: () => [],
      apply(tr, ranges) {
        const meta = tr.getMeta(suppressRangesKey) as SuppressedRange[] | undefined
        if (meta) return meta
        if (!tr.docChanged) return ranges
        return ranges
          .map((r) => ({ from: tr.mapping.map(r.from), to: tr.mapping.map(r.to, -1) }))
          .filter((r) => r.from < r.to)
      },
    },
  })
}

export const suppressRangesKeymap = keymap({
  'Mod-Shift-r': toggleSuppressCommand,
})
