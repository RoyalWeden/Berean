import { Fragment } from 'react'
import type { Note } from '@/types'
import { bookName } from '@/lib/parseRef'
import { noteStatusMeta } from '@/lib/noteStatus'

// Shared badge logic/rendering so every "note preview" surface (list rows, board/Kanban cards,
// and anywhere else a note gets summarized) shows exactly the same badges, styled exactly the
// same way — the type/source/status badges used to be reimplemented per-surface, which is how
// the board view ended up with none of them at all while the list view had all three.

const WIKILINK_BADGE = 'bg-[rgb(var(--link-wikilink)/0.15)] text-[rgb(var(--link-wikilink))]'

export function noteTypeBadge(note: Note): { label: string; cls: string } | null {
  if (note.type === 'daily' || note.type === 'journal' ||
      (note.type === 'general' && !!(note.title?.startsWith('Daily — ') || note.title?.startsWith('Journal — '))))
    return { label: 'Daily', cls: 'bg-warning/15 text-warning' }
  if (note.type === 'youtube') return { label: 'Video', cls: 'bg-destructive/15 text-destructive' }
  if (note.type === 'idiom') return { label: 'Idiom', cls: WIKILINK_BADGE }
  if (note.verseRef || note.type === 'verse') return null // shown via the verseRef chip instead
  return null
}

export function noteSourceBadge(note: Note): { label: string; cls: string } | null {
  if (note.tags?.includes('biblegateway'))
    return { label: 'BG', cls: 'bg-info/15 text-info' }
  if (note.tags?.includes('esword'))
    return { label: 'eSw', cls: WIKILINK_BADGE }
  return null
}

export function formatVerseRef(ref: string): string {
  if (!ref.includes('.')) {
    // Old BibleGateway imports stored the raw passage string (e.g. "Matthew 24:32").
    // Return it as-is — it's already human-readable.
    return ref
  }
  const [bookId, chapter, verse] = ref.split('.')
  const name = bookId ? bookName(bookId) : ref
  return verse ? `${name} ${chapter}:${verse}` : `${name} ${chapter}`
}

const PILL = 'text-caption2 font-medium px-1.5 py-0.5 rounded-chip leading-none'

/** The badge set (type, source, status, verse ref) for one note — same order, same pill style,
 *  everywhere it's used. Renders as a Fragment (no wrapping element) so callers can drop these
 *  pills into their own flex-wrap row alongside other content (e.g. a trailing date). `size="sm"`
 *  shrinks it slightly for tighter card layouts (board/Kanban) without changing which badges
 *  show or their relative styling. */
export function NoteBadgeRow({ note, size = 'md', showStatus = true }: { note: Note; size?: 'sm' | 'md'; showStatus?: boolean }) {
  const badge = noteTypeBadge(note)
  const sourceBadge = noteSourceBadge(note)
  const status = showStatus ? noteStatusMeta(note.status) : null
  const pill = size === 'sm' ? `${PILL} text-micro` : PILL
  return (
    <Fragment>
      {badge && <span className={`${pill} ${badge.cls}`}>{badge.label}</span>}
      {sourceBadge && <span className={`${pill} ${sourceBadge.cls}`}>{sourceBadge.label}</span>}
      {status && (
        <span
          className={`flex items-center gap-1 ${pill}`}
          style={{ backgroundColor: `${status.color}26`, color: status.color }}
        >
          <status.icon size={size === 'sm' ? 8 : 9} /> {status.label}
        </span>
      )}
      {note.verseRef && (
        <span className={`${pill} text-accent bg-accent-muted`}>
          {formatVerseRef(note.verseRef)}
        </span>
      )}
    </Fragment>
  )
}
