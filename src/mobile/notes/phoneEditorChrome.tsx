import React from 'react'
import type { EditorView } from 'prosemirror-view'
import type { SelectionToolbarState } from '@/components/notes/pm/selectionToolbarPlugin'
import type { WordStats } from '@/lib/wordCount'
import { PhoneSelectionToolbar } from './PhoneSelectionToolbar'

/** NoteEditorPM's `renderSelectionToolbar` for the phone (module-level, so it is a stable prop). */
export function renderPhoneSelectionToolbar(view: EditorView, state: SelectionToolbarState): React.ReactNode {
  return <PhoneSelectionToolbar view={view} state={state} />
}

/** "124 words · 690 characters · 1 min read" — the note caret's Statistics row. */
export function noteStatsLine(s: WordStats): string {
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
  return `${plural(s.words, 'word')} · ${plural(s.characters, 'character')} · ${s.minutes} min read`
}

/** The verse reference is shown under the title only when the title does not already say it. */
export function showVerseContextLine(title: string | null | undefined, refLabel: string): boolean {
  const norm = (x: string) => x.replace(/\s+/g, ' ').trim().toLowerCase()
  return !!refLabel && norm(title ?? '') !== norm(refLabel)
}
