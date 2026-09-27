import type { Note } from '@/types'

/**
 * Notes on several selected verses, merged (SEP27-VERSE-002): each note ONCE, carrying every
 * selected verse it is attached to / found under, in the order the verses were selected (first
 * verse's notes first), then most recently edited first within a verse.
 */
export interface AggregatedNote { note: Note; refs: string[] }

export function aggregateVerseNotes(perVerse: ReadonlyArray<{ ref: string; notes: readonly Note[] }>): AggregatedNote[] {
  const byId = new Map<string, AggregatedNote>()
  for (const { ref, notes } of perVerse) {
    const sorted = [...notes].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    for (const n of sorted) {
      const cur = byId.get(n.id)
      if (cur) { if (!cur.refs.includes(ref)) cur.refs.push(ref) }
      else byId.set(n.id, { note: n, refs: [ref] })
    }
  }
  return [...byId.values()]
}
