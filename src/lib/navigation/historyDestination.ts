import type { HistoryEntry } from '@/types'
import type { Destination } from './destination'

/** A History entry as a destination (null = no destination form; the caller falls back to the
 *  desktop's history navigation). Shared so History rows, Recent places and the plus sheet open
 *  an entry with an explicit intent instead of the desktop's "active tab of that space". */
export function historyDestination(h: HistoryEntry): Destination | null {
  switch (h.type) {
    case 'bible': case 'compare':
      return h.bookId ? { kind: 'passage', bookId: h.bookId, chapter: h.chapter ?? 1, verse: h.verse, ...(h.translation ? { textId: h.translation.toLowerCase() } : {}) } : null
    case 'note': return h.noteId ? { kind: 'note', noteId: h.noteId } : null
    case 'lexicon': case 'strongs-click': return h.strongsNum ? { kind: 'strongs', num: h.strongsNum } : null
    case 'search': return h.query ? { kind: 'search', query: h.query } : null
    case 'youtube': return h.videoId ? { kind: 'video', videoId: h.videoId } : null
    default: return null
  }
}
